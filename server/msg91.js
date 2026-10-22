import { config } from './config.js';

const endpoint = 'https://control.msg91.com/api/v5/otp';

async function callMsg91(url, options, verification = false) {
  if (!config.msg91AuthKey || !config.msg91TemplateId) {
    const error = new Error('MSG91 OTP is not configured. Set MSG91_AUTH_KEY and MSG91_TEMPLATE_ID.');
    error.status = 503;
    throw error;
  }
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { authkey: config.msg91AuthKey, 'Content-Type': 'application/json', ...options?.headers },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    const error = new Error('The verification provider could not be reached. Please try again.');
    error.status = 502;
    throw error;
  }
  let result;
  try {
    result = await response.json();
  } catch {
    console.error(`MSG91 returned an unreadable response (status ${response.status}).`);
    const error = new Error('The verification provider returned an invalid response.');
    error.status = 502;
    throw error;
  }
  if (!response.ok || result.type !== 'success') {
    if (verification && (response.ok || [400, 401, 422].includes(response.status))) {
      const error = new Error('The verification code is invalid or expired. Request a new code and try again.');
      error.status = 401;
      throw error;
    }
    console.error(`MSG91 request failed (status ${response.status}).`);
    const error = new Error('The verification provider could not complete the request. Check its configuration and try again.');
    error.status = response.ok ? 502 : 503;
    throw error;
  }
  return result;
}

export async function sendPhoneOtp(phoneNumber) {
  const url = new URL(endpoint);
  url.searchParams.set('template_id', config.msg91TemplateId);
  url.searchParams.set('mobile', phoneNumber.slice(1));
  url.searchParams.set('otp_length', String(config.msg91OtpLength));
  url.searchParams.set('otp_expiry', String(config.msg91OtpExpiryMinutes));
  await callMsg91(url, { method: 'GET' });
}

export async function verifyPhoneOtp(phoneNumber, otp) {
  const url = new URL(`${endpoint}/verify`);
  url.searchParams.set('mobile', phoneNumber.slice(1));
  url.searchParams.set('otp', otp);
  await callMsg91(url, { method: 'GET' }, true);
}
