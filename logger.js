// logger.js — 结构化日志系统（零外部依赖）
// 输出格式: ISO时间 [级别] [追踪ID] 消息 {结构化数据}

const { inspect } = require('util');
const crypto = require('crypto');

const config = require('./config');
const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const LOG_LEVEL = LEVELS[config.logLevel?.toUpperCase()] ?? LEVELS.INFO;

// 敏感字段列表 — HIGH-12: 日志脱敏
const SENSITIVE_KEYS = new Set([
  'password', 'password_hash', 'token', 'secret', 'jwt', 'cookie',
  'authorization', 'api_key', 'apikey', 'access_token', 'refresh_token',
  'email', 'phone', 'id_card', 'ssn', 'credit_card',
]);

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const sanitized = {};
  for (const [key, value] of Object.entries(meta)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || SENSITIVE_KEYS.has(lowerKey.replace(/[_-]/g, ''))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeMeta(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// HIGH-11: 使用 crypto.randomUUID() 生成追踪 ID
function generateTraceId() {
  return crypto.randomUUID();
}

// AsyncLocalStorage 用于跨异步调用传递 traceId
const { AsyncLocalStorage } = require('async_hooks');
const asyncStorage = new AsyncLocalStorage();

function getTraceId() {
  return asyncStorage.getStore()?.traceId || generateTraceId();
}

function runWithTraceId(fn, traceId = generateTraceId()) {
  return asyncStorage.run({ traceId }, fn);
}

function formatLog(level, message, meta = {}) {
  const ts = new Date().toISOString();
  const traceId = getTraceId();
  const safeMeta = sanitizeMeta(meta);
  const metaStr = Object.keys(safeMeta).length ? ' ' + inspect(safeMeta, { depth: 3, breakLength: Infinity }) : '';
  return `[${ts}] [${level}] [${traceId}] ${message}${metaStr}`;
}

function log(level, message, meta) {
  if (LEVELS[level] < LOG_LEVEL) return;
  const line = formatLog(level, message, meta);
  if (level === 'ERROR') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

const logger = {
  debug: (msg, meta) => log('DEBUG', msg, meta),
  info: (msg, meta) => log('INFO', msg, meta),
  warn: (msg, meta) => log('WARN', msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta),
  getTraceId,
  runWithTraceId,
  generateTraceId,
};

module.exports = logger;
