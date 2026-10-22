import crypto from 'node:crypto';
import { Conversation, Invitation } from './models.js';

export const idString = (id) => String(id);

export async function requireMember(conversationId, userId) {
  const conversation = await Conversation.findOne({
    _id: conversationId,
    participantIds: userId
  });
  if (!conversation) {
    const error = new Error('Conversation not found or access denied.');
    error.status = 404;
    throw error;
  }
  return conversation;
}

export const hashInviteToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function findValidInvitation(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
  const invitation = await Invitation.findOne({
    tokenHash: hashInviteToken(token),
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  });
  return invitation;
}
