import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { User } from './models.js';

export const sessionCookieName = 'connectx_session';

export function issueToken(user) {
  return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function getSessionToken(cookieHeader = '') {
  const cookie = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(sessionCookieName.length + 1));
  } catch {
    return null;
  }
}

function sessionCookieOptions(req) {
  const secure = Boolean(req.secure);
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/'
  };
}

export function setSessionCookie(req, res, token) {
  const payload = jwt.decode(token);
  if (!Number.isInteger(payload?.exp)) throw new Error('Session token has no expiration.');
  const maxAge = Math.max(0, payload.exp * 1000 - Date.now());
  res.cookie(sessionCookieName, token, { ...sessionCookieOptions(req), maxAge });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(sessionCookieName, sessionCookieOptions(req));
}

export async function authenticateToken(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  const bearerToken = scheme === 'Bearer' && token ? token : null;
  const cookieToken = getSessionToken(req.headers.cookie);
  const candidates = [...new Set([bearerToken, cookieToken].filter(Boolean))];
  if (!candidates.length) return res.status(401).json({ error: 'Authentication required.' });

  for (const candidate of candidates) {
    let payload;
    try {
      payload = jwt.verify(candidate, config.jwtSecret);
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') continue;
      return next(error);
    }
    const user = await User.findById(payload.sub);
    if (!user) continue;
    if (candidate === cookieToken &&
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        req.get('x-connectx-request') !== '1') {
      return res.status(403).json({ error: 'The request could not be verified. Refresh and try again.' });
    }
    req.user = user;
    if (candidate !== cookieToken) setSessionCookie(req, res, candidate);
    return next();
  }
  if (cookieToken) clearSessionCookie(req, res);
  return res.status(401).json({ error: 'Session expired. Please sign in again.' });
}

export function verifySocketToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  return User.findById(payload.sub);
}
