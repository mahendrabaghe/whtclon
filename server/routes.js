import crypto from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';
import {
  authenticateToken, clearSessionCookie, issueToken, setSessionCookie
} from './auth.js';
import { Conversation, Invitation, Message, User } from './models.js';
import { findValidInvitation, hashInviteToken, requireMember } from './security.js';
import { broadcastConversationMessage, notifyConversationMemberLeft } from './socket.js';
import {
  createDownloadUrl, createProfileImageUploadUrl, createUploadUrl, deleteStoredAttachments,
  isStorageConfigured, completeProfileImageUpload
} from './uploads.js';
import { allowedAttachmentTypes, sanitizeFileName } from './validation.js';

export const api = Router();
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const uploadLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
const usernamePattern = /^[a-zA-Z0-9_]{3,24}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const profileImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxProfileImageBytes = 5 * 1024 * 1024;
const publicUser = (user) => ({
  _id: String(user._id), username: user.username, displayName: user.displayName,
  email: user.email, about: user.about || '', avatarUrl: user.avatarUrl,
  hasAvatar: Boolean(user.avatarKey), avatarVersion: user.updatedAt?.getTime?.() || 0,
  lastSeenAt: user.lastSeenAt
});
const accountUser = publicUser;

api.get('/health', (_req, res) => res.json({ status: 'ok' }));

api.post('/auth/register', authLimit, asyncHandler(async (req, res) => {
  const { username, displayName, email, password } = req.body || {};
  if (typeof username !== 'string' || !usernamePattern.test(username) || typeof displayName !== 'string' ||
      displayName.trim().length < 1 || displayName.trim().length > 60 ||
      typeof email !== 'string' || !emailPattern.test(email) || email.length > 254 ||
      typeof password !== 'string' || password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: 'Use a 3-24 character username, valid email, display name up to 60 characters, and password of 10-128 characters.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, displayName: displayName.trim(), email, passwordHash });
    const token = issueToken(user);
    setSessionCookie(req, res, token);
    res.set('Cache-Control', 'no-store');
    return res.status(201).json({ token, user: accountUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'That username or email is already registered.' });
    throw error;
  }
}));

api.post('/auth/login', authLimit, asyncHandler(async (req, res) => {
  const { password } = req.body || {};
  const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase()
    : typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const validEmail = identifier.length <= 254 && emailPattern.test(identifier);
  const validUsername = usernamePattern.test(identifier);
  if ((!validEmail && !validUsername) || typeof password !== 'string' || password.length > 128) {
    return res.status(400).json({ error: 'Enter a valid email or username and password.' });
  }
  const user = await User.findOne(validEmail ? { email: identifier } : { username: identifier }).select('+passwordHash');
  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email/username or password is incorrect.' });
  }
  const token = issueToken(user);
  setSessionCookie(req, res, token);
  res.set('Cache-Control', 'no-store');
  return res.json({ token, user: accountUser(user) });
}));

api.post('/auth/logout', (req, res) => {
  if (req.get('x-connectx-request') !== '1') {
    return res.status(403).json({ error: 'The request could not be verified. Refresh and try again.' });
  }
  clearSessionCookie(req, res);
  res.set('Cache-Control', 'no-store');
  return res.json({ loggedOut: true });
});

api.get('/avatars/:userId', authenticateToken, asyncHandler(async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.userId)) return res.status(404).end();
  const user = await User.findById(req.params.userId).select('+avatarKey');
  if (!user?.avatarKey) return res.status(404).end();
  const url = await createDownloadUrl({
    key: user.avatarKey, fileName: 'connectx-profile-image', contentType: user.avatarContentType || 'image/jpeg'
  });
  res.set('Cache-Control', 'private, max-age=240');
  return res.redirect(302, url);
}));

api.use(authenticateToken);

api.get('/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ user: accountUser(req.user) });
});

api.patch('/profile', asyncHandler(async (req, res) => {
  const { displayName, about, avatarUrl } = req.body || {};
  const update = {};
  if (displayName !== undefined) {
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 60) {
      return res.status(400).json({ error: 'Display name must be 1-60 characters.' });
    }
    update.displayName = displayName.trim();
  }
  if (about !== undefined) {
    if (typeof about !== 'string' || about.trim().length > 240) {
      return res.status(400).json({ error: 'About must be 240 characters or fewer.' });
    }
    update.about = about.trim();
  }
  if (avatarUrl !== undefined) {
    if (typeof avatarUrl !== 'string' || avatarUrl.length > 2048 ||
        (avatarUrl && !/^https:\/\//i.test(avatarUrl))) {
      return res.status(400).json({ error: 'Profile picture must be an HTTPS URL.' });
    }
    update.avatarUrl = avatarUrl;
    update.avatarKey = '';
    update.avatarContentType = 'image/jpeg';
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: 'No profile changes provided.' });
  const previousAvatarKey = req.user.get('avatarKey');
  Object.assign(req.user, update);
  await req.user.save();
  let cleanupWarning = false;
  if (update.avatarKey === '' && previousAvatarKey) {
    try {
      await deleteStoredAttachments([previousAvatarKey]);
    } catch (error) {
      cleanupWarning = true;
      console.error(`Profile image cleanup failed (${error.name || 'Error'}).`);
    }
  }
  return res.json({ user: accountUser(req.user), cleanupWarning });
}));

api.post('/profile/avatar-upload', uploadLimit, asyncHandler(async (req, res) => {
  if (!isStorageConfigured()) {
    return res.status(503).json({ error: 'Profile picture uploads are not configured. Set the Cloudinary environment variables on the server.' });
  }
  const { contentType, size } = req.body || {};
  if (!profileImageTypes.has(contentType) || !Number.isSafeInteger(size) ||
      size < 1 || size > maxProfileImageBytes) {
    return res.status(400).json({ error: 'Choose a JPEG, PNG, or WebP profile picture up to 5 MB.' });
  }
  const upload = await createProfileImageUploadUrl({
    userId: req.user.id, contentType, size
  });
  res.set('Cache-Control', 'no-store');
  return res.status(201).json({ ...upload, contentType, size });
}));

api.post('/profile/avatar', asyncHandler(async (req, res) => {
  const { key, contentType, size, displayName, about } = req.body || {};
  if (!profileImageTypes.has(contentType) || !Number.isSafeInteger(size) ||
      size < 1 || size > maxProfileImageBytes) {
    return res.status(400).json({ error: 'Choose a JPEG, PNG, or WebP profile picture up to 5 MB.' });
  }
  if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 60 ||
      typeof about !== 'string' || about.trim().length > 240) {
    return res.status(400).json({ error: 'Enter a display name up to 60 characters and an about line up to 240 characters.' });
  }
  const verifiedKey = await completeProfileImageUpload({ key, userId: req.user.id, contentType, size });
  const previousAvatarKey = req.user.get('avatarKey');
  req.user.avatarKey = verifiedKey;
  req.user.avatarUrl = '';
  req.user.displayName = displayName.trim();
  req.user.about = about.trim();
  req.user.avatarContentType = contentType;
  await req.user.save();
  let cleanupWarning = false;
  if (previousAvatarKey && previousAvatarKey !== verifiedKey) {
    try {
      await deleteStoredAttachments([previousAvatarKey]);
    } catch (error) {
      cleanupWarning = true;
      console.error(`Profile image cleanup failed (${error.name || 'Error'}).`);
    }
  }
  return res.json({ user: accountUser(req.user), cleanupWarning });
}));

api.get('/ice-servers', (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (config.turnUrls.length && config.turnSecret) {
    const username = `${Math.floor(Date.now() / 1000) + config.turnCredentialTtlSeconds}:${req.user.id}`;
    const credential = crypto.createHmac('sha1', config.turnSecret).update(username).digest('base64');
    iceServers.push({ urls: config.turnUrls, username, credential });
  }
  res.set('Cache-Control', 'no-store').json({ iceServers });
});

api.get('/invitations/:token', asyncHandler(async (req, res) => {
  const invitation = await findValidInvitation(req.params.token);
  if (!invitation) return res.status(404).json({ error: 'Invitation is invalid, expired, or revoked.' });
  const conversation = await Conversation.findById(invitation.conversationId)
    .populate('participantIds', 'displayName username avatarUrl avatarKey avatarContentType about updatedAt');
  if (!conversation || conversation.participantIds.length >= 2) return res.status(410).json({ error: 'This invitation can no longer be used.' });
  return res.json({ valid: true, createdBy: publicUser(conversation.participantIds.find((user) => String(user._id) === String(invitation.createdBy)) || conversation.participantIds[0]) });
}));

api.post('/conversations', asyncHandler(async (req, res) => {
  const conversation = await Conversation.create({ participantIds: [req.user._id], createdBy: req.user._id });
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.invitationTtlHours * 60 * 60 * 1000);
  await Invitation.create({
    tokenHash: hashInviteToken(token), conversationId: conversation._id,
    createdBy: req.user._id, expiresAt
  });
  return res.status(201).json({
    conversationId: String(conversation._id), inviteToken: token, expiresAt,
    conversation: { _id: String(conversation._id), participantIds: [publicUser(req.user)], lastMessage: null, unreadCount: 0 }
  });
}));

api.post('/conversations/join', asyncHandler(async (req, res) => {
  const { token } = req.body || {};
  const invitation = await findValidInvitation(token);
  if (!invitation) return res.status(404).json({ error: 'Invitation is invalid, expired, or revoked.' });
  const conversation = await Conversation.findById(invitation.conversationId);
  if (!conversation) return res.status(404).json({ error: 'Conversation no longer exists.' });
  if (conversation.participantIds.some((id) => String(id) === req.user.id)) {
    return res.json({ conversationId: String(conversation._id), joined: false });
  }
  const joinedConversation = await Conversation.findOneAndUpdate({
    _id: conversation._id,
    $and: [
      { participantIds: { $size: 1 } },
      { participantIds: { $ne: req.user._id } }
    ]
  }, { $addToSet: { participantIds: req.user._id } }, { new: true });
  if (!joinedConversation) return res.status(409).json({ error: 'This private conversation is full.' });
  return res.json({ conversationId: String(joinedConversation._id), joined: true });
}));

api.post('/conversations/:id/invitations/revoke', asyncHandler(async (req, res) => {
  const conversation = await requireMember(req.params.id, req.user._id);
  if (String(conversation.createdBy) !== req.user.id) return res.status(403).json({ error: 'Only the creator can revoke the invitation.' });
  await Invitation.updateMany({ conversationId: conversation._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return res.json({ revoked: true });
}));

api.post('/conversations/:id/invitations', asyncHandler(async (req, res) => {
  const conversation = await requireMember(req.params.id, req.user._id);
  if (String(conversation.createdBy) !== req.user.id) return res.status(403).json({ error: 'Only the creator can issue an invitation.' });
  if (conversation.participantIds.length >= 2) return res.status(409).json({ error: 'This private conversation is full.' });
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.invitationTtlHours * 60 * 60 * 1000);
  await Invitation.create({
    tokenHash: hashInviteToken(token), conversationId: conversation._id,
    createdBy: req.user._id, expiresAt
  });
  return res.status(201).json({ inviteToken: token, expiresAt });
}));

api.get('/conversations', asyncHandler(async (req, res) => {
  const conversations = await Conversation.find({ participantIds: req.user._id })
    .sort({ lastMessageAt: -1 })
    .populate('participantIds', 'displayName username avatarUrl avatarKey avatarContentType about lastSeenAt updatedAt');
  const conversationIds = conversations.map((conversation) => conversation._id);
  const visibleMessageFilters = conversations.map((conversation) => ({
    conversationId: conversation._id,
    createdAt: { $gt: conversation.lastClearedAt?.get(req.user.id) || new Date(0) }
  }));
  const unreadFilters = conversations.map((conversation) => ({
    conversationId: conversation._id,
    senderId: { $ne: req.user._id },
    createdAt: { $gt: new Date(Math.max(
      conversation.lastReadAt?.get(req.user.id)?.getTime() || 0,
      conversation.lastClearedAt?.get(req.user.id)?.getTime() || 0
    )) }
  }));
  const [latestMessages, unreadCounts] = conversationIds.length ? await Promise.all([
    Message.aggregate([
      { $match: { $or: visibleMessageFilters } },
      { $sort: { conversationId: 1, createdAt: -1, _id: -1 } },
      { $group: { _id: '$conversationId', latest: { $first: '$$ROOT' } } },
      {
        $project: {
          _id: 1,
          latestMessage: {
            text: '$latest.text', attachments: '$latest.attachments',
            createdAt: '$latest.createdAt', deletedAt: '$latest.deletedAt'
          }
        }
      }
    ]),
    Message.aggregate([
      { $match: { $or: unreadFilters } },
      { $group: { _id: '$conversationId', count: { $sum: 1 } } }
    ])
  ]) : [[], []];
  const latestByConversation = new Map(latestMessages.map((item) => [String(item._id), item.latestMessage]));
  const unreadByConversation = new Map(unreadCounts.map((item) => [String(item._id), item.count]));
  const results = conversations.map((conversation) => {
    const latest = latestByConversation.get(String(conversation._id));
    const other = conversation.participantIds.find((user) => String(user._id) !== req.user.id);
    return {
      _id: String(conversation._id), participantIds: conversation.participantIds.map(publicUser),
      createdBy: String(conversation.createdBy),
      other: other ? publicUser(other) : null,
      lastMessage: latest ? { text: latest.deletedAt ? 'Message deleted' : (latest.text || (latest.attachments?.length ? 'Attachment' : '')), createdAt: latest.createdAt } : null,
      lastMessageAt: conversation.lastMessageAt, unreadCount: unreadByConversation.get(String(conversation._id)) || 0
    };
  });
  return res.json({ conversations: results });
}));

api.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const conversation = await requireMember(req.params.id, req.user._id);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
  const query = { conversationId: req.params.id };
  const filters = [];
  const clearedAt = conversation.lastClearedAt?.get(req.user.id);
  if (clearedAt) filters.push({ createdAt: { $gt: clearedAt } });
  if (typeof req.query.beforeAt === 'string' && !Number.isNaN(Date.parse(req.query.beforeAt))) {
    const beforeAt = new Date(req.query.beforeAt);
    if (typeof req.query.beforeId === 'string' && /^[a-f\d]{24}$/i.test(req.query.beforeId)) {
      filters.push({ $or: [
        { createdAt: { $lt: beforeAt } },
        { createdAt: beforeAt, _id: { $lt: req.query.beforeId } }
      ] });
    } else {
      filters.push({ createdAt: { $lt: beforeAt } });
    }
  }
  if (filters.length) query.$and = filters;
  const messages = await Message.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).select('conversationId senderId text attachments createdAt readBy deletedAt').populate('senderId', 'displayName username');
  return res.json({ messages: messages.reverse().map((message) => ({
    _id: String(message._id), conversationId: String(message.conversationId),
    sender: publicUser(message.senderId), text: message.deletedAt ? '' : message.text,
    attachments: message.deletedAt ? [] : message.attachments.map(({ attachmentId, fileName, contentType, size }) => ({
      attachmentId, fileName, contentType, size
    })),
    createdAt: message.createdAt, readBy: message.readBy.map(String), deleted: Boolean(message.deletedAt)
  })), hasMore: messages.length === limit });
}));

api.post('/conversations/:id/clear', asyncHandler(async (req, res) => {
  const conversation = await requireMember(req.params.id, req.user._id);
  const clearedAt = new Date();
  conversation.lastClearedAt.set(req.user.id, clearedAt);
  conversation.lastReadAt.set(req.user.id, clearedAt);
  await conversation.save();
  return res.json({ clearedAt });
}));

api.delete('/conversations/:id/messages/:messageId', asyncHandler(async (req, res) => {
  await requireMember(req.params.id, req.user._id);
  const message = await Message.findOne({
    _id: req.params.messageId, conversationId: req.params.id, senderId: req.user._id
  });
  if (!message) return res.status(404).json({ error: 'Message not found or not owned by you.' });
  message.text = '';
  message.deletedAt = new Date();
  await message.save();
  let cleanupWarning = false;
  if (message.attachments.length) {
    try {
      await deleteStoredAttachments(message.attachments.map((attachment) => attachment.key));
    } catch (error) {
      cleanupWarning = true;
      console.error(`Deleted message file cleanup failed (${error.name || 'Error'}).`);
    }
  }
  return res.json({ deleted: true, cleanupWarning, messageId: String(message._id) });
}));

api.post('/conversations/:id/leave', asyncHandler(async (req, res) => {
  const conversation = await requireMember(req.params.id, req.user._id);
  conversation.participantIds = conversation.participantIds.filter((id) => String(id) !== req.user.id);
  await conversation.save();
  await notifyConversationMemberLeft(conversation._id, req.user.id, conversation.participantIds);
  return res.json({ left: true });
}));

api.post('/conversations/:id/uploads', uploadLimit, asyncHandler(async (req, res) => {
  if (!isStorageConfigured()) return res.status(503).json({ error: 'File sharing is not configured. Set the Cloudinary environment variables on the server.' });
  await requireMember(req.params.id, req.user._id);
  const { fileName, contentType, size } = req.body || {};
  const safeFileName = sanitizeFileName(fileName);
  if (!safeFileName || !allowedAttachmentTypes.has(contentType) || !Number.isSafeInteger(size) ||
      size < 1 || size > config.maxUploadSizeBytes) {
    return res.status(400).json({ error: `Choose a supported file (up to ${Math.floor(config.maxUploadSizeBytes / 1024 / 1024)} MB).` });
  }
  const upload = await createUploadUrl({
    conversationId: String(req.params.id), userId: req.user.id, contentType, size
  });
  res.set('Cache-Control', 'no-store');
  return res.status(201).json({ ...upload, fileName: safeFileName, contentType, size });
}));

api.post('/conversations/:id/uploads/:attachmentId/send', uploadLimit, asyncHandler(async (req, res) => {
  if (!isStorageConfigured()) return res.status(503).json({ error: 'File sharing is not configured. Set the Cloudinary environment variables on the server.' });
  const conversation = await requireMember(req.params.id, req.user._id);
  const { fileName, contentType, size, clientMessageId } = req.body || {};
  const safeFileName = sanitizeFileName(fileName);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.attachmentId) ||
      !safeFileName || !allowedAttachmentTypes.has(contentType) || !Number.isSafeInteger(size) ||
      size < 1 || size > config.maxUploadSizeBytes ||
      typeof clientMessageId !== 'string' || !/^[\w-]{8,80}$/.test(clientMessageId)) {
    return res.status(400).json({ error: 'The attachment details are invalid.' });
  }
  const matchesRequest = (message) =>
    String(message.conversationId) === String(conversation._id) &&
    !message.deletedAt && message.text === '' && message.attachments.length === 1 &&
    message.attachments.some((attachment) =>
      attachment.attachmentId === req.params.attachmentId &&
      attachment.fileName === safeFileName &&
      attachment.contentType === contentType &&
      attachment.size === size
    );
  const payloadFor = (message) => ({
    _id: String(message._id),
    conversationId: String(message.conversationId),
    sender: { _id: req.user.id, displayName: req.user.displayName, username: req.user.username },
    text: message.deletedAt ? '' : message.text,
    attachments: message.deletedAt ? [] : message.attachments.map(({ attachmentId, fileName, contentType, size: attachmentSize }) => ({
      attachmentId, fileName, contentType, size: attachmentSize
    })),
    createdAt: message.createdAt,
    clientMessageId,
    readBy: message.readBy.map(String)
  });
  const findExisting = async () => {
    const message = await Message.findOne({ senderId: req.user._id, clientMessageId });
    if (!message) return null;
    if (!matchesRequest(message)) {
      const error = new Error('Message identifier has already been used.');
      error.status = 409;
      throw error;
    }
    return payloadFor(message);
  };
  const respondWithExisting = (payload) => {
    broadcastConversationMessage(conversation._id, payload);
    return res.json({ ok: true, message: payload });
  };

  const existingPayload = await findExisting();
  if (existingPayload) return respondWithExisting(existingPayload);

  const key = await storeUploadedAttachment({
    conversationId: String(conversation._id),
    userId: req.user.id,
    attachmentId: req.params.attachmentId,
    contentType,
    size
  });
  let message;
  try {
    message = await Message.create({
      conversationId: conversation._id,
      senderId: req.user._id,
      text: '',
      attachments: [{ attachmentId: req.params.attachmentId, fileName: safeFileName, contentType, size, key }],
      clientMessageId,
      readBy: [req.user._id]
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const duplicatePayload = await findExisting();
    if (duplicatePayload) return respondWithExisting(duplicatePayload);
    throw error;
  }
  await Conversation.updateOne(
    { _id: conversation._id },
    { $max: { lastMessageAt: message.createdAt } }
  );
  const payload = payloadFor(message);
  broadcastConversationMessage(conversation._id, payload);
  return res.status(201).json({ ok: true, message: payload });
}));

api.get('/conversations/:id/messages/:messageId/attachments/:attachmentId', asyncHandler(async (req, res) => {
  if (!isStorageConfigured()) return res.status(503).json({ error: 'File sharing is not configured.' });
  await requireMember(req.params.id, req.user._id);
  const message = await Message.findOne({
    _id: req.params.messageId, conversationId: req.params.id, deletedAt: null
  }).select('attachments');
  const attachment = message?.attachments.find((item) => item.attachmentId === req.params.attachmentId);
  if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });
  const url = await createDownloadUrl({
    key: attachment.key, fileName: attachment.fileName, contentType: attachment.contentType
  });
  const downloadUrl = await createDownloadUrl({
    key: attachment.key, fileName: attachment.fileName, contentType: attachment.contentType, download: true
  });
  res.set('Cache-Control', 'no-store');
  return res.json({ url, downloadUrl, expiresIn: 300 });
}));
