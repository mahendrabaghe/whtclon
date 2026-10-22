import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import express from 'express';
import { createServer } from 'node:http';

process.env.MONGODB_URI = 'mongodb://127.0.0.1/connectx';
process.env.JWT_SECRET = 'test-only-secret-with-more-than-32-characters';

const [{ api }, { User }] = await Promise.all([
  import('../server/routes.js'),
  import('../server/models.js')
]);

test('login accepts either email or username with the account password', async (t) => {
  const passwordHash = await bcrypt.hash('correct-password', 4);
  const user = {
    _id: '507f1f77bcf86cd799439011',
    id: '507f1f77bcf86cd799439011',
    username: 'sample_user',
    displayName: 'Sample User',
    email: 'sample@gmail.com',
    passwordHash
  };
  const originalFindOne = User.findOne;
  let query;
  User.findOne = (filter) => {
    query = filter;
    return { select: async () => user };
  };

  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    User.findOne = originalFindOne;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const address = server.address();
  for (const [identifier, expectedQuery] of [
    ['SAMPLE@GMAIL.COM', { email: 'sample@gmail.com' }],
    ['SAMPLE_USER', { username: 'sample_user' }]
  ]) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: 'correct-password' })
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(typeof data.token, 'string');
    assert.equal(data.user.username, user.username);
    assert.deepEqual(query, expectedQuery);
  }
});
