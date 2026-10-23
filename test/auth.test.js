import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import express from 'express';
import { createServer } from 'node:http';

process.env.MONGODB_URI = 'mongodb://127.0.0.1/connectx';
process.env.JWT_SECRET = 'test-only-secret-with-more-than-32-characters';

const [{ api }, { User }, { issueToken, setSessionCookie }] = await Promise.all([
  import('../server/routes.js'),
  import('../server/models.js'),
  import('../server/auth.js')
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
  const originalFindById = User.findById;
  let query;
  User.findOne = (filter) => {
    query = filter;
    return { select: async () => user };
  };
  User.findById = async () => user;

  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    User.findOne = originalFindOne;
    User.findById = originalFindById;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const address = server.address();
  const unauthenticatedResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`);
  assert.equal(unauthenticatedResponse.status, 401);
  let lastCookie = '';

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
    const setCookie = response.headers.get('set-cookie') || '';
    assert.match(setCookie, /connectx_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Max-Age=/i);

    const cookie = setCookie.split(';', 1)[0];
    lastCookie = cookie;
    const sessionResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: { Cookie: cookie }
    });
    assert.equal(sessionResponse.status, 200);
    assert.equal((await sessionResponse.json()).user.username, user.username);

    const bearerResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
      headers: { Authorization: `Bearer ${data.token}` }
    });
    assert.equal(bearerResponse.status, 200);
    assert.equal((await bearerResponse.json()).user.username, user.username);

    const logoutResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie, 'X-ConnectX-Request': '1' }
    });
    assert.equal(logoutResponse.status, 200);
    assert.match(logoutResponse.headers.get('set-cookie') || '', /Expires=Thu, 01 Jan 1970/i);
  }

  User.findById = async () => null;
  const revokedSessionResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/me`, {
    headers: { Cookie: lastCookie }
  });
  assert.equal(revokedSessionResponse.status, 401);
  assert.match(revokedSessionResponse.headers.get('set-cookie') || '', /Expires=Thu, 01 Jan 1970/i);
});

test('HTTPS sessions use Secure, HttpOnly, cross-site-compatible cookies', () => {
  let savedCookie;
  const user = { id: '507f1f77bcf86cd799439011' };
  setSessionCookie({ secure: true }, {
    cookie(name, value, options) {
      savedCookie = { name, value, options };
    }
  }, issueToken(user));

  assert.equal(savedCookie.name, 'connectx_session');
  assert.equal(savedCookie.options.httpOnly, true);
  assert.equal(savedCookie.options.secure, true);
  assert.equal(savedCookie.options.sameSite, 'none');
  assert.ok(savedCookie.options.maxAge > 0);
});

test('profile about can be updated independently and is validated', async (t) => {
  const user = {
    _id: '507f1f77bcf86cd799439011',
    id: '507f1f77bcf86cd799439011',
    username: 'sample_user',
    displayName: 'Sample User',
    email: 'sample@example.com',
    about: '',
    avatarUrl: '',
    avatarKey: '',
    lastSeenAt: new Date(),
    updatedAt: new Date(),
    get(name) { return this[name]; },
    async save() { this.updatedAt = new Date(); }
  };
  const originalFindById = User.findById;
  User.findById = async () => user;

  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    User.findById = originalFindById;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const address = server.address();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${issueToken(user)}`
  };
  const response = await fetch(`http://127.0.0.1:${address.port}/api/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ about: '  Happy chatting  ' })
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.user.about, 'Happy chatting');
  assert.match(response.headers.get('set-cookie') || '', /connectx_session=.*HttpOnly/i);

  const invalidResponse = await fetch(`http://127.0.0.1:${address.port}/api/profile`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ about: 'a'.repeat(241) })
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal(user.about, 'Happy chatting');
});
