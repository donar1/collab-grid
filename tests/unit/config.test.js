// tests/unit/config.test.js
// Phase 9.1: config.js 单元测试
// 覆盖：默认值、环境变量覆盖、生产环境安全检查

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — expected "${expected}", got "${actual}"`); }
}

function assertThrows(fn, label) {
  try {
    fn();
    failed++;
    console.error(`  FAIL: ${label} — expected throw, but did not`);
  } catch (_) {
    passed++;
  }
}

function assertNotThrows(fn, label) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${label} — unexpected throw: ${e.message}`);
  }
}

// ---- 清除缓存，重新加载 config ----
// 注意：config.js 在模块顶层执行 require('dotenv').config()，
// 所以我们需要在设置好环境变量之后再 require。
// 为此，先删除缓存。

function resetConfig() {
  const key = require.resolve('../../config');
  delete require.cache[key];
}

// ---- 测试 1: 默认值 ----
console.log('\n--- config.test.js: 默认值 ---');

// 确保没有设置任何环境变量干扰
const originalEnv = {};
const envKeys = [
  'NODE_ENV', 'PORT', 'ALLOWED_ORIGINS', 'JWT_SECRET', 'JWT_EXPIRES_IN',
  'COOKIE_SECURE', 'COOKIE_SAMESITE', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX',
  'AUTH_RATE_LIMIT_MAX', 'SYNC_MAX_EVENTS', 'UPLOAD_MAX_SIZE', 'LOG_LEVEL',
  'LOG_TO_FILE', 'LOG_DIR', 'DB_ENGINE', 'DB_PATH', 'PUBLIC_DB_PATH',
  'DB_READ_POOL_SIZE', 'PG_HOST', 'PG_PORT', 'PG_DATABASE', 'PG_USER',
  'PG_PASSWORD', 'PG_POOL_MAX', 'PG_IDLE_TIMEOUT_MS', 'PG_CONNECTION_TIMEOUT_MS',
  'PG_READ_HOST', 'PG_READ_PORT', 'PG_READ_POOL_MAX',
  'SCHEDULER_ENABLED', 'SCHEDULER_INTERVAL_MINUTES',
];
for (const k of envKeys) {
  originalEnv[k] = process.env[k];
  delete process.env[k];
}

resetConfig();
const config = require('../../config');

assertEqual(config.env, 'development', '默认 env 为 development');
assertEqual(config.port, 3000, '默认 port 为 3000');
assert(!config.isProduction, '默认非生产环境');
assertEqual(config.jwtSecret, 'dev-secret-change-me', '默认 JWT_SECRET');
assertEqual(config.jwtExpiresIn, 3600, '默认 JWT_EXPIRES_IN');
assertEqual(config.dbEngine, 'sqlite', '默认 DB_ENGINE 为 sqlite');
assertEqual(config.dbPath, './data/collab-grid.db', '默认 DB_PATH');
assertEqual(config.rateLimitMax, 20, '默认 RATE_LIMIT_MAX');
assertEqual(config.authRateLimitMax, 10, '默认 AUTH_RATE_LIMIT_MAX');
assertEqual(config.uploadMaxSize, 10485760, '默认 UPLOAD_MAX_SIZE');
assertEqual(config.logLevel, 'info', '默认 LOG_LEVEL');
assertEqual(config.pg.host, 'localhost', '默认 PG_HOST');
assertEqual(config.pg.port, 5432, '默认 PG_PORT');
assertEqual(config.pg.database, 'collabgrid', '默认 PG_DATABASE');
assertEqual(config.pg.user, 'postgres', '默认 PG_USER');
assertEqual(config.pg.poolMax, 20, '默认 PG_POOL_MAX');
assertEqual(config.pg.idleTimeoutMs, 30000, '默认 PG_IDLE_TIMEOUT_MS');
assertEqual(config.pg.connectionTimeoutMs, 5000, '默认 PG_CONNECTION_TIMEOUT_MS');
assertEqual(config.schedulerEnabled, true, '默认 SCHEDULER_ENABLED');
assertEqual(config.schedulerIntervalMinutes, 1, '默认 SCHEDULER_INTERVAL_MINUTES');
assertDeepEqual(config.allowedOrigins, [], '默认 ALLOWED_ORIGINS 为空数组');

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// ---- 测试 2: 环境变量覆盖 ----
console.log('\n--- config.test.js: 环境变量覆盖 ---');

process.env.PORT = '8080';
process.env.DB_ENGINE = 'postgresql';
process.env.PG_HOST = 'pg-server';
process.env.PG_PORT = '5433';
process.env.JWT_SECRET = 'my-test-secret';
process.env.LOG_LEVEL = 'debug';
process.env.RATE_LIMIT_MAX = '50';
process.env.SCHEDULER_ENABLED = 'false';

resetConfig();
const config2 = require('../../config');

assertEqual(config2.port, 8080, '环境变量 PORT 覆盖');
assertEqual(config2.dbEngine, 'postgresql', '环境变量 DB_ENGINE 覆盖');
assertEqual(config2.pg.host, 'pg-server', '环境变量 PG_HOST 覆盖');
assertEqual(config2.pg.port, 5433, '环境变量 PG_PORT 覆盖');
assertEqual(config2.jwtSecret, 'my-test-secret', '环境变量 JWT_SECRET 覆盖');
assertEqual(config2.logLevel, 'debug', '环境变量 LOG_LEVEL 覆盖');
assertEqual(config2.rateLimitMax, 50, '环境变量 RATE_LIMIT_MAX 覆盖');
assertEqual(config2.schedulerEnabled, false, '环境变量 SCHEDULER_ENABLED=false 覆盖');

// ---- 测试 3: 生产环境安全检查 ----
console.log('\n--- config.test.js: 生产环境安全检查 ---');

// 3a: 生产环境 + 空 ALLOWED_ORIGINS → 抛异常
process.env.NODE_ENV = 'production';
delete process.env.ALLOWED_ORIGINS;
process.env.JWT_SECRET = 'some-secret';
resetConfig();
assertThrows(() => { require('../../config'); }, '生产环境无 ALLOWED_ORIGINS 应抛异常');

// 3b: 生产环境 + 默认 JWT_SECRET → 抛异常
process.env.NODE_ENV = 'production';
process.env.ALLOWED_ORIGINS = 'https://example.com';
process.env.JWT_SECRET = 'dev-secret-change-me';
resetConfig();
assertThrows(() => { require('../../config'); }, '生产环境默认 JWT_SECRET 应抛异常');

// 3c: 生产环境 + 正确配置 → 不抛异常
process.env.NODE_ENV = 'production';
process.env.ALLOWED_ORIGINS = 'https://example.com';
process.env.JWT_SECRET = 'a-very-strong-production-secret-32chars';
resetConfig();
assertNotThrows(() => { require('../../config'); }, '生产环境正确配置不抛异常');

// 3d: 验证生产环境 isProduction
const configProd = require('../../config');
assert(configProd.isProduction, '生产环境 isProduction 为 true');

// ---- 清理环境变量 ----
for (const k of envKeys) {
  if (originalEnv[k] !== undefined) {
    process.env[k] = originalEnv[k];
  } else {
    delete process.env[k];
  }
}
resetConfig();

// ---- 报告 ----
const total = passed + failed;
console.log(`\n config.test.js: ${total} tests, ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
