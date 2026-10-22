import { Server } from 'socket.io';
import { verifySocketToken } from './auth.js';
import { config } from './config.js';
import { Conversation, Message } from './models.js';
import { idString, requireMember } from './security.js';

const userRoom = (id) => `user:${id}`;
const messageWindows = new Map();

export function configureSocket(server) {
  const io = new Server(server, {
    cors: { origin: config.origins, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 64 * 1024
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
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
        const canonicalConversationId = idString(conversation._id);
        await io.in(userRoom(userId)).socketsLeave(`conversation:${canonicalConversationId}`);
        for (const memberId of conversation?.participantIds || []) {
          io.to(userRoom(idString(memberId))).emit('conversation:updated', { conversationId: canonicalConversationId });
        }
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
        if (typeof text !== 'string' || !text.trim() || text.length > config.maxMessageLength) {
          return ack({ ok: false, error: `Message must be 1-${config.maxMessageLength} characters.` });
        }
        if (typeof clientMessageId !== 'string' || !/^[\w-]{8,80}$/.test(clientMessageId)) {
          return ack({ ok: false, error: 'Invalid message identifier.' });
        }
        const conversation = await requireMember(conversationId, userId);
        const canonicalConversationId = idString(conversation._id);
        let message;
        let created = true;
        try {
          message = await Message.create({
            conversationId: canonicalConversationId,
            senderId: socket.user._id,
            text: text.trim(),
            clientMessageId,
            readBy: [socket.user._id]
          });
        } catch (error) {
          if (error.code !== 11000) throw error;
          message = await Message.findOne({ senderId: socket.user._id, clientMessageId });
          created = false;
          if (!message || idString(message.conversationId) !== idString(conversation._id) ||
              (!message.deletedAt && message.text !== text.trim())) {
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
        const message = await Message.findOneAndUpdate(
          { _id: messageId, conversationId: canonicalConversationId, senderId: socket.user._id },
          { $set: { text: '', deletedAt: new Date() } },
          { new: true }
        );
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
        if (!['audio', 'video'].includes(callType) || typeof callId !== 'string') {
          return ack({ ok: false, error: 'Invalid call request.' });
        }
        const conversation = await requireMember(conversationId, userId);
        if (!conversation.participantIds.some((id) => idString(id) === targetUserId) || targetUserId === userId) {
          return ack({ ok: false, error: 'Call recipient is not a conversation member.' });
        }
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
          const { conversationId, targetUserId } = data;
          const conversation = await requireMember(conversationId, userId);
          if (!conversation.participantIds.some((id) => idString(id) === targetUserId) || targetUserId === userId) return;
          const signal = { ...data, conversationId: idString(conversation._id), fromUserId: userId };
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
