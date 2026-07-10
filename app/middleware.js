// app/middleware.js — Express 中间件集合
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const express = require('express');
const logger = require('../logger');
const { parseCookies } = require('../services/helpers');

function csrfToken() { return crypto.randomBytes(32).toString('hex'); }

function buildMiddleware({ isProduction, allowedOrigins }) {
  function corsOrigin(origin, cb) {
    if (!origin || !isProduction || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS origin not allowed'));
  }
  const corsOptions = isProduction ? { origin: corsOrigin, credentials: true } : {};

  const securityHeaders = (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };

  const csp = (req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';");
    next();
  };

  const cookieParser = (req, res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    next();
  };

  const trace = (req, res, next) => {
    req.traceId = logger.generateTraceId();
    res.setHeader('X-Trace-Id', req.traceId);
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('HTTP request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip: req.ip,
      });
    });
    next();
  };

  const csrf = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.path.startsWith('/api/public/')) return next();
    if (req.path === '/api/login' || req.path === '/api/register') return next();
    if (!isProduction) return next(); // 开发环境跳过 CSRF
    const cookieToken = req.cookies ? req.cookies['csrf_token'] : null;
    const headerToken = req.headers['x-csrf-token'];
    if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length || !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
      return res.status(403).json({ error: 'CSRF token mismatch' });
    }
    next();
  };

  const skipUploadJson = (req, res, next) => { next(); };

  return {
    securityHeaders,
    cors: cors(corsOptions),
    csp,
    json: express.json({ limit: '10mb' }),
    skipUploadJson,
    cookieParser,
    trace,
    csrf,
    static: express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, etag: false, lastModified: false, setHeaders: function(res, p) { if (p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); } }),
    corsOptions,
    csrfToken,
  };
}

function createRateLimiter({ windowMs = 60_000, max = 20, keyFn } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json')) {
      return res.status(415).json({ error: 'unsupported media type, expected application/json' });
    }
    const key = keyFn ? keyFn(req) : req.ip;
    const ts = Date.now();
    const bucket = buckets.get(key) || { count: 0, resetAt: ts + windowMs };
    if (ts > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = ts + windowMs;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - ts) / 1000)));
      return res.status(429).json({ error: 'too many attempts, please retry later' });
    }
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (ts > v.resetAt) buckets.delete(k);
    }
    next();
  };
}

module.exports = { buildMiddleware, createRateLimiter };
