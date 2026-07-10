// auth.js — JWT helpers + middleware
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');

const SECRET = config.jwtSecret;
if (!SECRET) {
  throw new Error('JWT_SECRET 必须设置在环境变量中，禁止启动');
}

const COOKIE_NAME = 'cg_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: config.cookieSameSite || 'Strict',
  maxAge: 7 * 24 * 3600 * 1000, // 7 天，与 JWT expiresIn 一致
  path: '/',
};

// S-02: JWT blacklist (in-memory, for password change revocation)
const _tokenBlacklist = new Map(); // jti -> expiresAt
const BLACKLIST_TTL_MS = 7 * 24 * 3600 * 1000; // match JWT expiry

function blacklistToken(jti) {
  _tokenBlacklist.set(jti, Date.now() + BLACKLIST_TTL_MS);
}

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jti, expires] of _tokenBlacklist) {
    if (now > expires) _tokenBlacklist.delete(jti);
  }
}, 5 * 60 * 1000);

function sign(user) {
  return jwt.sign({ uid: user.id, jti: crypto.randomUUID() }, SECRET, { expiresIn: '7d' });
}

function verify(token) {
  try {
    const payload = jwt.verify(token, SECRET);
    if (_tokenBlacklist.has(payload.jti)) return null;
    return payload;
  } catch { return null; }
}

function setTokenCookie(res, token) {
  res.cookie(COOKIE_NAME, token, COOKIE_OPTIONS);
}

function clearTokenCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function authRequired(req, res, next) {
  // 优先从 Authorization 头读取（向后兼容），其次从 Cookie 读取
  const h = req.headers.authorization || '';
  const bearerToken = h.startsWith('Bearer ') ? h.slice(7) : '';
  const cookieToken = req.cookies ? req.cookies[COOKIE_NAME] : null;
  const token = bearerToken || cookieToken;
  const payload = token ? verify(token) : null;
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = { id: payload.uid, email: undefined, jti: payload.jti };
  next();
}

module.exports = { sign, verify, blacklistToken, authRequired, setTokenCookie, clearTokenCookie, COOKIE_NAME };
