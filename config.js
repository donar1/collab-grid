// config.js — 统一配置层（Phase 1）
require('dotenv').config();

function getEnv(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return v;
}

function getInt(key, fallback) {
  const v = Number.parseInt(process.env[key], 10);
  return Number.isFinite(v) ? v : fallback;
}

function getBool(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function parseOrigins(raw) {
  return (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

const config = {
  env: getEnv('NODE_ENV', 'development'),
  get isProduction() { return this.env === 'production'; },
  port: getInt('PORT', 3000),

  // CORS
  allowedOrigins: parseOrigins(getEnv('ALLOWED_ORIGINS', '')),

  // Default admin
  defaultAdminEmail: getEnv('DEFAULT_ADMIN_EMAIL', 'admin@collabgrid.local'),
  defaultAdminDisplayName: getEnv('DEFAULT_ADMIN_DISPLAY_NAME', '系统管理员'),
  defaultAdminPassword: getEnv('DEFAULT_ADMIN_PASSWORD', ''),

  // Auth
  jwtSecret: getEnv('JWT_SECRET', ''),
  jwtExpiresIn: getInt('JWT_EXPIRES_IN', 3600),
  cookieSecure: getBool('COOKIE_SECURE', false),
  cookieSameSite: getEnv('COOKIE_SAMESITE', 'Strict'),

  // Rate limiting
  rateLimitWindowMs: getInt('RATE_LIMIT_WINDOW_MS', 60000),
  rateLimitMax: getInt('RATE_LIMIT_MAX', 20),
  authRateLimitMax: getInt('AUTH_RATE_LIMIT_MAX', 10),

  // Sync
  syncMaxEvents: getInt('SYNC_MAX_EVENTS', 500),

  // Upload
  uploadMaxSize: getInt('UPLOAD_MAX_SIZE', 10485760),

  // Logging
  logLevel: getEnv('LOG_LEVEL', 'info'),
  logToFile: getBool('LOG_TO_FILE', false),
  logDir: getEnv('LOG_DIR', './logs'),

  // DB Engine: sqlite | postgresql
  dbEngine: getEnv('DB_ENGINE', 'sqlite'),
  dbPath: getEnv('DB_PATH', './data/collab-grid.db'),
  publicDbPath: getEnv('PUBLIC_DB_PATH', './data/public.db'),
  dbReadPoolSize: getInt('DB_READ_POOL_SIZE', 4),

  // PostgreSQL
  pg: {
    host: getEnv('PG_HOST', 'localhost'),
    port: getInt('PG_PORT', 5432),
    database: getEnv('PG_DATABASE', 'collabgrid'),
    user: getEnv('PG_USER', 'postgres'),
    password: getEnv('PG_PASSWORD', ''),
    poolMax: getInt('PG_POOL_MAX', 20),
    idleTimeoutMs: getInt('PG_IDLE_TIMEOUT_MS', 30000),
    connectionTimeoutMs: getInt('PG_CONNECTION_TIMEOUT_MS', 5000),
    readHost: getEnv('PG_READ_HOST', ''),
    readPort: getInt('PG_READ_PORT', 5432),
    readPoolMax: getInt('PG_READ_POOL_MAX', 10),
  },

  // SMTP (optional - only for alert emails)
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
    recipients: (process.env.ALERT_RECIPIENTS || '').split(',').filter(Boolean),
  },

  // Scheduler
  schedulerEnabled: getBool('SCHEDULER_ENABLED', true),
  schedulerIntervalMinutes: getInt('SCHEDULER_INTERVAL_MINUTES', 1),
};

// P0: 强制校验 JWT_SECRET — 所有环境都必须设置，禁止默认值
if (!config.jwtSecret || config.jwtSecret.length < 32) {
  console.error('[FATAL] JWT_SECRET 必须设置为至少 32 位的强随机字符串，禁止留空或使用短密钥');
  console.error('请执行以下命令生成密钥并写入 .env 文件：');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

// 生产环境额外安全检查
if (config.isProduction) {
  if (config.allowedOrigins.length === 0) {
    throw new Error('生产环境必须设置 ALLOWED_ORIGINS，禁止 CORS 全开放');
  }
}

module.exports = config;
