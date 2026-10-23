import { Server } from 'socket.io';
import { getSessionToken, verifySocketToken } from './auth.js';
import { config } from './config.js';
import { Conversation, Message } from './models.js';
import { idString, requireMember } from './security.js';
import { storeUploadedAttachment } from './uploads.js';
import { allowedAttachmentTypes, sanitizeFileName } from './validation.js';

const userRoom = (id) => `user:${id}`;
const messageWindows = new Map();
const callSessions = new Map();
const CALL_SETUP_TTL_MS = 60_000;
const CALL_ACTIVE_TTL_MS = 4 * 60 * 60 * 1000;
let socketServer;

function setCallExpiry(callId, session, ttl) {
  clearTimeout(session.expiryTimer);
  session.expiryTimer = setTimeout(() => {
    if (callSessions.get(callId) === session) callSessions.delete(callId);
  }, ttl);
  session.expiryTimer.unref();
}

function clearCallSession(callId) {
  const session = callSessions.get(callId);
  if (!session) return;
  clearTimeout(session.expiryTimer);
  callSessions.delete(callId);
}

export async function notifyConversationMemberLeft(conversationId, userId, remainingMembers) {
  if (!socketServer) return;
  const canonicalConversationId = idString(conversationId);
  const room = `conversation:${canonicalConversationId}`;
  await socketServer.in(userRoom(userId)).socketsLeave(room);
  for (const [callId, session] of callSessions) {
    if (session.conversationId !== canonicalConversationId ||
        (session.callerId !== userId && session.calleeId !== userId)) continue;
    const targetUserId = session.callerId === userId ? session.calleeId : session.callerId;
    clearCallSession(callId);
    socketServer.to(userRoom(targetUserId)).emit('call:end', {
      conversationId: canonicalConversationId, callId, fromUserId: userId, targetUserId
    });
  }
  for (const memberId of remainingMembers) {
    socketServer.to(userRoom(idString(memberId))).emit('conversation:updated', {
      conversationId: canonicalConversationId
    });
  }
}

export function broadcastConversationMessage(conversationId, message) {
  socketServer?.to(`conversation:${idString(conversationId)}`).emit('message:new', message);
}

export function configureSocket(server) {
  const io = new Server(server, {
    cors: { origin: config.origins, methods: ['GET', 'POST'], credentials: true },
    maxHttpBufferSize: 64 * 1024
  });
  socketServer = io;

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token ||
        getSessionToken(socket.handshake.headers.cookie);
      if (typeof token !== 'string') return next(new Error('Authentication required.'));
      const user = await verifySocketToken(token);
      if (!user) return next(new Error('Account no longer exists.'));
      socket.user = user;
      return next();
    } catch {
      return next(new Error('Invalid or expired session.'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = idString(socket.user._id);
    socket.join(userRoom(userId));
    try {
      const conversations = await Conversation.find({ participantIds: socket.user._id }).select('_id');
      for (const conversation of conversations) {
        io.to(`conversation:${conversation._id}`).emit('presence', { userId, online: true });
      }
    } catch (error) {
      console.error(`Socket initialization failed (${error.name || 'Error'}).`);
      socket.disconnect(true);
      return;
    }

    socket.on('conversation:join', async ({ conversationId, announce } = {}, ack = () => {}) => {
      try {
        const conversation = await requireMember(conversationId, userId);
        const canonicalConversationId = idString(conversation._id);
        socket.join(`conversation:${canonicalConversationId}`);
        for (const memberId of conversation.participantIds) {
          const memberIdText = idString(memberId);
          if (memberIdText === userId) continue;
          const onlineSockets = await io.in(userRoom(memberIdText)).fetchSockets();
          socket.emit('presence', { userId: memberIdText, online: onlineSockets.length > 0 });
        }
        if (announce) {
          for (const memberId of conversation.participantIds) {
            if (idString(memberId) !== userId) {
              io.to(userRoom(idString(memberId))).emit('conversation:updated', { conversationId: canonicalConversationId });
            }
          }
        }
        ack({ ok: true });
      } catch {
        ack({ ok: false, error: 'Conversation access denied.' });
      }
    });

    socket.on('conversation:leave', async ({ conversationId } = {}) => {
      try {
        const stillMember = await Conversation.exists({ _id: conversationId, participantIds: socket.user._id });
        if (stillMember) return;
        const conversation = await Conversation.findById(conversationId).select('participantIds');
        if (!conversation) return;
        await notifyConversationMemberLeft(conversation._id, userId, conversation.participantIds);
      } catch { /* Leaving a room cannot grant access or send data. */ }
    });

    socket.on('message:send', async (data = {}, ack = () => {}) => {
      try {
        const now = Date.now();
        const recent = (messageWindows.get(userId) || []).filter((timestamp) => now - timestamp < 60_000);
        if (recent.length >= 40) return ack({ ok: false, error: 'You are sending messages too quickly. Try again in a minute.' });
        recent.push(now);
        messageWindows.set(userId, recent);
        const { conversationId, text, clientMessageId } = data;
        const normalizedText = typeof text === 'string' ? text.trim() : '';
        const requestedAttachments = Array.isArray(data.attachments) ? data.attachments : [];
        if (normalizedText.length > config.maxMessageLength || requestedAttachments.length > 5 ||
            (!normalizedText && !requestedAttachments.length)) {
          return ack({ ok: false, error: `Enter a message up to ${config.maxMessageLength} characters or attach up to 5 files.` });
        }
        if (typeof clientMessageId !== 'string' || !/^[\w-]{8,80}$/.test(clientMessageId)) {
          return ack({ ok: false, error: 'Invalid message identifier.' });
        }
        const conversation = await requireMember(conversationId, userId);
        const canonicalConversationId = idString(conversation._id);
        const attachmentDetails = requestedAttachments.map((attachment) => ({
          attachmentId: attachment?.attachmentId,
          fileName: sanitizeFileName(attachment?.fileName),
          contentType: attachment?.contentType,
          size: attachment?.size
        }));
        if (new Set(attachmentDetails.map((attachment) => attachment.attachmentId)).size !== attachmentDetails.length ||
            attachmentDetails.some((attachment) =>
          typeof attachment.attachmentId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attachment.attachmentId) ||
          !attachment.fileName || !allowedAttachmentTypes.has(attachment.contentType) ||
          !Number.isSafeInteger(attachment.size) || attachment.size < 1 || attachment.size > config.maxUploadSizeBytes
        )) {
          return ack({ ok: false, error: 'One or more attachments are invalid.' });
        }
        let message;
        let created = true;
        try {
          const attachments = await Promise.all(attachmentDetails.map(async (attachment) => ({
            ...attachment,
            key: await storeUploadedAttachment({
              conversationId: canonicalConversationId,
              userId,
              attachmentId: attachment.attachmentId,
              contentType: attachment.contentType,
              size: attachment.size
            })
          })));
          message = await Message.create({
            conversationId: canonicalConversationId,
            senderId: socket.user._id,
            text: normalizedText,
            attachments,
            clientMessageId,
            readBy: [socket.user._id]
          });
        } catch (error) {
          if (error.code !== 11000) throw error;
          message = await Message.findOne({ senderId: socket.user._id, clientMessageId });
          created = false;
          if (!message || idString(message.conversationId) !== idString(conversation._id) ||
              (!message.deletedAt && (message.text !== normalizedText ||
                message.attachments.length !== attachmentDetails.length ||
                message.attachments.some((attachment) => !attachmentDetails.some((candidate) =>
                  candidate.attachmentId === attachment.attachmentId &&
                  candidate.fileName === attachment.fileName &&
                  candidate.contentType === attachment.contentType &&
                  candidate.size === attachment.size
                ))))) {
            return ack({ ok: false, error: 'Message identifier has already been used.' });
          }
        }
        if (created) {
          await Conversation.updateOne(
            { _id: conversation._id },
            { $max: { lastMessageAt: message.createdAt } }
          );
        }
        const payload = {
          _id: idString(message._id),
          conversationId: canonicalConversationId,
          sender: { _id: userId, displayName: socket.user.displayName, username: socket.user.username },
          text: message.deletedAt ? '' : message.text,
          attachments: message.deletedAt ? [] : message.attachments.map(({ attachmentId, fileName, contentType, size }) => ({
            attachmentId, fileName, contentType, size
          })),
          createdAt: message.createdAt,
          clientMessageId,
          readBy: message.readBy.map(idString)
        };
        io.to(`conversation:${canonicalConversationId}`).emit('message:new', payload);
        return ack({ ok: true, message: payload });
      } catch (error) {
        return ack({ ok: false, error: error.status ? error.message : 'Unable to send message.' });
      }
    });

    socket.on('message:read', async ({ conversationId } = {}) => {
      try {
        const conversation = await requireMember(conversationId, userId);
        const canonicalConversationId = idString(conversation._id);
        await Message.updateMany(
          { conversationId: canonicalConversationId, senderId: { $ne: socket.user._id }, readBy: { $ne: socket.user._id } },
          { $addToSet: { readBy: socket.user._id } }
        );
        await Conversation.updateOne(
          { _id: canonicalConversationId },
          { $set: { [`lastReadAt.${userId}`]: new Date() } }
        );
        io.to(`conversation:${canonicalConversationId}`).emit('message:read-update', {
          conversationId: canonicalConversationId, userId, at: new Date()
        });
      } catch { /* Unauthorized read receipts are ignored. */ }
    });

    socket.on('message:delete', async ({ conversationId, messageId } = {}) => {
      try {
        const conversation = await requireMember(conversationId, userId);
        const canonicalConversationId = idString(conversation._id);
        const message = await Message.findOne({
          _id: messageId, conversationId: canonicalConversationId,
          senderId: socket.user._id, deletedAt: { $ne: null }
        });
        if (message) io.to(`conversation:${canonicalConversationId}`).emit('message:deleted', {
          conversationId: canonicalConversationId, messageId: idString(message._id), deletedAt: message.deletedAt
        });
      } catch { /* Only message authors in the conversation may delete. */ }
    });

    socket.on('typing', async ({ conversationId, isTyping } = {}) => {
      try {
        const conversation = await requireMember(conversationId, userId);
        const canonicalConversationId = idString(conversation._id);
        socket.to(`conversation:${canonicalConversationId}`).emit('typing', {
          conversationId: canonicalConversationId,
          userId,
          displayName: socket.user.displayName,
          isTyping: Boolean(isTyping)
        });
      } catch { /* Membership is checked before any broadcast. */ }
    });

    socket.on('call:invite', async (data = {}, ack = () => {}) => {
      try {
        const { conversationId, callId, callType, targetUserId } = data;
        if (!['audio', 'video'].includes(callType) ||
            typeof callId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(callId) ||
            callSessions.has(callId)) {
          return ack({ ok: false, error: 'Invalid call request.' });
        }
        const conversation = await requireMember(conversationId, userId);
        if (!conversation.participantIds.some((id) => idString(id) === targetUserId) || targetUserId === userId) {
          return ack({ ok: false, error: 'Call recipient is not a conversation member.' });
        }
        const session = {
          conversationId: idString(conversation._id),
          callerId: userId,
          calleeId: targetUserId,
          expiryTimer: null
        };
        callSessions.set(callId, session);
        setCallExpiry(callId, session, CALL_SETUP_TTL_MS);
        io.to(userRoom(targetUserId)).emit('call:incoming', {
          conversationId: idString(conversation._id), callId, callType,
          caller: { _id: userId, displayName: socket.user.displayName }
        });
        return ack({ ok: true });
      } catch {
        return ack({ ok: false, error: 'Unable to start call.' });
      }
    });

    for (const event of ['call:accept', 'call:reject', 'call:end', 'call:offer', 'call:answer', 'call:ice']) {
      socket.on(event, async (data = {}) => {
        try {
          const { conversationId, callId, targetUserId } = data;
          const session = callSessions.get(callId);
          if (!session || session.conversationId !== conversationId) return;
          const isCaller = userId === session.callerId;
          if ((!isCaller && userId !== session.calleeId) ||
              targetUserId !== (isCaller ? session.calleeId : session.callerId) ||
              ((event === 'call:accept' || event === 'call:reject') && isCaller)) return;
          if (event === 'call:accept') setCallExpiry(callId, session, CALL_ACTIVE_TTL_MS);
          if (event === 'call:reject' || event === 'call:end') clearCallSession(callId);
          const signal = { ...data, fromUserId: userId };
          delete signal.token;
          io.to(userRoom(targetUserId)).emit(event, signal);
        } catch { /* Invalid or unauthorized call signals are discarded. */ }
      });
    }

    socket.on('disconnect', async () => {
      try {
        const sockets = await io.in(userRoom(userId)).fetchSockets();
        if (sockets.length === 0) {
          messageWindows.delete(userId);
          await socket.user.updateOne({ lastSeenAt: new Date() });
          const conversations = await Conversation.find({ participantIds: socket.user._id }).select('_id');
          for (const conversation of conversations) {
            io.to(`conversation:${conversation._id}`).emit('presence', { userId, online: false, lastSeenAt: new Date() });
          }
        }
      } catch (error) {
        console.error(`Socket disconnect cleanup failed (${error.name || 'Error'}).`);
      }
    });
  });
  return io;
}
