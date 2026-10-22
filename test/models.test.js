import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Message, User } from '../server/models.js';

const ids = () => ({
  conversationId: new mongoose.Types.ObjectId(),
  senderId: new mongoose.Types.ObjectId()
});

test('email/password user records validate', async () => {
  const user = new User({
    username: 'existing_user', displayName: 'Existing User',
    email: 'existing@example.com', passwordHash: 'stored-hash'
  });
  await assert.doesNotReject(user.validate());
});

test('message validation accepts text-only and attachment-only messages', async () => {
  const textMessage = new Message({ ...ids(), text: 'Existing text message', clientMessageId: 'message-text-1' });
  const fileMessage = new Message({
    ...ids(), text: '', clientMessageId: 'message-file-1',
    attachments: [{
      attachmentId: '550e8400-e29b-41d4-a716-446655440000',
      fileName: 'document.pdf', contentType: 'application/pdf', size: 12,
      key: 'attachments/conversation/user/file'
    }]
  });
  await assert.doesNotReject(textMessage.validate());
  await assert.doesNotReject(fileMessage.validate());
});

test('a message cannot be empty unless it is deleted', async () => {
  const emptyMessage = new Message({ ...ids(), text: '', clientMessageId: 'message-empty-1' });
  const deletedMessage = new Message({ ...ids(), text: '', deletedAt: new Date(), clientMessageId: 'message-deleted-1' });
  await assert.rejects(emptyMessage.validate());
  await assert.doesNotReject(deletedMessage.validate());
});
