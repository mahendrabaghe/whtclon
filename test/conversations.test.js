import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';

process.env.MONGODB_URI = 'mongodb://127.0.0.1/connectx';
process.env.JWT_SECRET = 'test-only-secret-with-more-than-32-characters';

const [{ api }, { Conversation, Message, User }, { issueToken }] = await Promise.all([
  import('../server/routes.js'),
  import('../server/models.js'),
  import('../server/auth.js')
]);

test('clear chat only hides message history for the requesting participant', async (t) => {
  const userA = {
    _id: '507f1f77bcf86cd799439011',
    id: '507f1f77bcf86cd799439011',
    username: 'user_a',
    displayName: 'User A',
    email: 'a@example.com',
    about: '',
    avatarUrl: '',
    avatarKey: '',
    lastSeenAt: new Date(),
    updatedAt: new Date()
  };
  const userB = {
    ...userA,
    _id: '507f1f77bcf86cd799439012',
    id: '507f1f77bcf86cd799439012',
    username: 'user_b',
    displayName: 'User B',
    email: 'b@example.com'
  };
  const conversation = {
    _id: '507f1f77bcf86cd799439013',
    participantIds: [userA._id, userB._id],
    lastClearedAt: new Map(),
    lastReadAt: new Map(),
    async save() {}
  };
  const originalFindById = User.findById;
  const originalConversationFindOne = Conversation.findOne;
  const originalMessageFind = Message.find;
  const queries = [];

  User.findById = async (id) => [userA, userB].find((user) => user.id === String(id)) || null;
  Conversation.findOne = async ({ participantIds }) =>
    conversation.participantIds.includes(String(participantIds)) ? conversation : null;
  Message.find = (query) => {
    queries.push(query);
    const result = {
      sort() { return this; },
      limit() { return this; },
      select() { return this; },
      async populate() { return []; }
    };
    return result;
  };

  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    User.findById = originalFindById;
    Conversation.findOne = originalConversationFindOne;
    Message.find = originalMessageFind;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/conversations/${conversation._id}`;
  const requestMessages = async (user) => fetch(`${baseUrl}/messages`, {
    headers: { Authorization: `Bearer ${issueToken(user)}` }
  });
  const clearResponse = await fetch(`${baseUrl}/clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${issueToken(userA)}` }
  });

  assert.equal(clearResponse.status, 200);
  assert.ok(conversation.lastClearedAt.get(userA.id) instanceof Date);
  assert.equal(conversation.lastClearedAt.has(userB.id), false);
  assert.deepEqual(conversation.participantIds, [userA._id, userB._id]);

  const userAResponse = await requestMessages(userA);
  assert.equal(userAResponse.status, 200);
  assert.ok(queries[0].$and.some((filter) =>
    filter.createdAt?.$gt?.getTime() === conversation.lastClearedAt.get(userA.id).getTime()));

  const userBResponse = await requestMessages(userB);
  assert.equal(userBResponse.status, 200);
  assert.equal(queries[1].$and, undefined);
});
