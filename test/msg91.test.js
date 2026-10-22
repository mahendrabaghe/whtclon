import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI = 'mongodb://127.0.0.1/connectx';
process.env.JWT_SECRET = 'test-only-secret-with-more-than-32-characters';
process.env.MSG91_AUTH_KEY = 'test-auth-key';
process.env.MSG91_TEMPLATE_ID = 'test-template-id';
process.env.MSG91_OTP_LENGTH = '6';

const { sendPhoneOtp, verifyPhoneOtp } = await import('../server/msg91.js');

test('MSG91 sends OTPs using the configured template and server-side auth header', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let requestOptions;
  globalThis.fetch = async (url, options) => {
    requestUrl = new URL(url);
    requestOptions = options;
    return new Response(JSON.stringify({ type: 'success' }), { status: 200 });
  };
  try {
    await sendPhoneOtp('+919876543210');
    assert.equal(requestUrl.pathname, '/api/v5/otp');
    assert.equal(requestUrl.searchParams.get('mobile'), '919876543210');
    assert.equal(requestUrl.searchParams.get('template_id'), 'test-template-id');
    assert.equal(requestUrl.searchParams.get('otp_length'), '6');
    assert.equal(requestOptions.headers.authkey, 'test-auth-key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('MSG91 rejects an invalid or expired verification code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ type: 'error', message: 'OTP does not match' }), { status: 200 });
  try {
    await assert.rejects(verifyPhoneOtp('+919876543210', '123456'), {
      status: 401, message: 'The verification code is invalid or expired. Request a new code and try again.'
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
