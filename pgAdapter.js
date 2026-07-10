// pgAdapter.js — PostgreSQL 适配层
// 提供与 better-sqlite3 兼容的 API，内部使用 pg 连接池
// Phase 3: 使用 config.js 统一配置，支持读写分离

const { Pool } = require('pg');
const logger = require('./logger');
const config = require('./config');

// PostgreSQL 连接配置（从 config.js 读取）
const PG_CONFIG = {
  host: config.pg.host,
  port: config.pg.port,
  database: config.pg.database,
  user: config.pg.user,
  password: config.pg.password,
  max: config.pg.poolMax,
  idleTimeoutMillis: config.pg.idleTimeoutMs,
  connectionTimeoutMillis: config.pg.connectionTimeoutMs,
};

// 读写分离：主库 + 只读副本
const READ_REPLICA_CONFIG = config.pg.readHost ? {
  host: config.pg.readHost,
  port: config.pg.readPort,
  database: config.pg.database,
  user: config.pg.user,
  password: config.pg.password,
  max: config.pg.readPoolMax,
  idleTimeoutMillis: config.pg.idleTimeoutMs,
} : null;

let writePool = null;
let readPool = null;

function initPools() {
  writePool = new Pool(PG_CONFIG);
  readPool = READ_REPLICA_CONFIG ? new Pool(READ_REPLICA_CONFIG) : writePool;

  // ---- 连接池事件监听 ----
  writePool.on('connect', (client) => {
    logger.info('PostgreSQL write pool: new client connected', { pid: client.processID });
  });
  writePool.on('remove', (client) => {
    logger.info('PostgreSQL write pool: client removed', { pid: client.processID });
  });
  writePool.on('error', (err) => {
    logger.error('PostgreSQL write pool error', { error: err.message });
  });

  if (readPool !== writePool) {
    readPool.on('connect', (client) => {
      logger.info('PostgreSQL read pool: new client connected', { pid: client.processID });
    });
    readPool.on('remove', (client) => {
      logger.info('PostgreSQL read pool: client removed', { pid: client.processID });
    });
    readPool.on('error', (err) => {
      logger.error('PostgreSQL read pool error', { error: err.message });
    });
  }

  logger.info('PostgreSQL pools initialized', {
    writePool: { host: PG_CONFIG.host, port: PG_CONFIG.port, max: PG_CONFIG.max },
    readPool: READ_REPLICA_CONFIG ? { host: READ_REPLICA_CONFIG.host, port: READ_REPLICA_CONFIG.port, max: READ_REPLICA_CONFIG.max } : 'same as write',
  });
}

function getWritePool() { return writePool; }
function getReadPool() { return readPool; }

// -------- Schema DDL（PostgreSQL 语法） --------
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(21) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  system_role VARCHAR(50) DEFAULT 'editor',
  must_change_password INTEGER DEFAULT 0,
  password_changed_at BIGINT,
  created_at BIGINT NOT NULL,
  deleted_at BIGINT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS bases (
  id VARCHAR(21) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  owner_id VARCHAR(21) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  base_id VARCHAR(21) NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  user_id VARCHAR(21) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'editor',
  joined_at BIGINT NOT NULL,
  PRIMARY KEY (base_id, user_id)
);

CREATE TABLE IF NOT EXISTS tables (
  id VARCHAR(21) PRIMARY KEY,
  base_id VARCHAR(21) NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS fields (
  id VARCHAR(21) PRIMARY KEY,
  table_id VARCHAR(21) NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  options TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 160,
  position INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id VARCHAR(21) PRIMARY KEY,
  table_id VARCHAR(21) NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  height INTEGER NOT NULL DEFAULT 34,
  locked INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT,
  deleted_at BIGINT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS cells (
  record_id VARCHAR(21) NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  field_id VARCHAR(21) NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value TEXT,
  style_json TEXT,
  updated_at BIGINT NOT NULL,
  updated_by VARCHAR(21),
  PRIMARY KEY (record_id, field_id)
);

CREATE TABLE IF NOT EXISTS links (
  id VARCHAR(21) PRIMARY KEY,
  field_id VARCHAR(21) NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  from_record_id VARCHAR(21) NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  to_record_id VARCHAR(21) NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  UNIQUE (field_id, from_record_id, to_record_id)
);

CREATE TABLE IF NOT EXISTS invites (
  token VARCHAR(255) PRIMARY KEY,
  base_id VARCHAR(21) NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'editor',
  created_by VARCHAR(21) NOT NULL,
  created_at BIGINT NOT NULL,
  expires_at BIGINT
);

CREATE TABLE IF NOT EXISTS job_configs (
  base_id VARCHAR(21) NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  job_key VARCHAR(100) NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  dry_run INTEGER NOT NULL DEFAULT 1,
  batch_size INTEGER NOT NULL DEFAULT 2000,
  max_runtime_ms INTEGER NOT NULL DEFAULT 120000,
  config_json TEXT,
  updated_at BIGINT NOT NULL,
  schedule_enabled INTEGER NOT NULL DEFAULT 0,
  schedule_time TEXT,
  schedule_business_date_mode TEXT NOT NULL DEFAULT 'today',
  schedule_dry_run INTEGER NOT NULL DEFAULT 0,
  schedule_last_run_date TEXT,
  schedule_last_run_at INTEGER,
  schedule_last_run_status TEXT,
  PRIMARY KEY (base_id, job_key)
);

CREATE TABLE IF NOT EXISTS job_runs (
  id VARCHAR(21) PRIMARY KEY,
  base_id VARCHAR(21) NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  job_key VARCHAR(100) NOT NULL,
  business_date VARCHAR(10) NOT NULL,
  mode VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  started_at BIGINT NOT NULL,
  finished_at BIGINT,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  error_json TEXT,
  created_by VARCHAR(21)
);

CREATE TABLE IF NOT EXISTS commission_ledger (
  id VARCHAR(21) PRIMARY KEY,
  base_id VARCHAR(21) NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  batch_no VARCHAR(50) NOT NULL,
  business_date VARCHAR(10) NOT NULL,
  order_record_id VARCHAR(21) NOT NULL,
  lock_record_id VARCHAR(21) NOT NULL,
  side VARCHAR(10) NOT NULL,
  channel_record_id VARCHAR(21),
  product_record_id VARCHAR(21) NOT NULL DEFAULT '',
  snapshot_profit DOUBLE PRECISION NOT NULL DEFAULT 0,
  rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  type VARCHAR(20) NOT NULL DEFAULT 'normal',
  original_ledger_id VARCHAR(21) UNIQUE,
  created_at BIGINT NOT NULL,
  UNIQUE (base_id, batch_no, order_record_id, lock_record_id, side, type)
);

CREATE TABLE IF NOT EXISTS order_activity_daily (
  base_id VARCHAR(21) NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  business_date VARCHAR(10) NOT NULL,
  side VARCHAR(10) NOT NULL,
  channel_record_id VARCHAR(21) NOT NULL,
  product_record_id VARCHAR(21),
  valid_order_count INTEGER NOT NULL DEFAULT 0,
  gross_profit_sum DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (base_id, business_date, side, channel_record_id, product_record_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id VARCHAR(21) PRIMARY KEY,
  base_id VARCHAR(21) NOT NULL,
  record_id VARCHAR(21) NOT NULL,
  field_id VARCHAR(21) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  uploaded_by VARCHAR(21),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id VARCHAR(21) PRIMARY KEY,
  base_id VARCHAR(21) NOT NULL,
  table_id VARCHAR(21) NOT NULL DEFAULT '',
  record_id VARCHAR(21) NOT NULL DEFAULT '',
  field_id VARCHAR(21) NOT NULL DEFAULT '',
  old_value TEXT,
  new_value TEXT,
  action VARCHAR(100) NOT NULL DEFAULT 'cell.update',
  user_id VARCHAR(21),
  user_email VARCHAR(255),
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_overrides (
  id SERIAL PRIMARY KEY,
  scope VARCHAR(50) NOT NULL,
  role VARCHAR(50) NOT NULL,
  base_id VARCHAR(21),
  permission VARCHAR(100) NOT NULL,
  allow INTEGER NOT NULL,
  updated_at BIGINT NOT NULL,
  updated_by VARCHAR(21)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_perm_override_unique
  ON permission_overrides(scope, role, COALESCE(base_id,''), permission);

CREATE TABLE IF NOT EXISTS table_permissions (
  id SERIAL PRIMARY KEY,
  base_id VARCHAR(21) NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  table_id VARCHAR(21) NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  can_view INTEGER NOT NULL DEFAULT 1,
  can_edit INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  updated_by VARCHAR(21),
  UNIQUE (base_id, table_id, role)
);
CREATE INDEX IF NOT EXISTS idx_table_perms_base ON table_permissions(base_id);
CREATE INDEX IF NOT EXISTS idx_table_perms_table ON table_permissions(table_id);

-- 索引
CREATE INDEX IF NOT EXISTS idx_attachments_record ON attachments(record_id, field_id);
CREATE INDEX IF NOT EXISTS idx_attachments_base ON attachments(base_id);
CREATE INDEX IF NOT EXISTS idx_tables_base ON tables(base_id);
CREATE INDEX IF NOT EXISTS idx_tables_name ON tables(base_id, name);
CREATE INDEX IF NOT EXISTS idx_fields_table ON fields(table_id);
CREATE INDEX IF NOT EXISTS idx_fields_name ON fields(table_id, name);
CREATE INDEX IF NOT EXISTS idx_records_table ON records(table_id);
CREATE INDEX IF NOT EXISTS idx_records_table_position ON records(table_id, position, created_at);
CREATE INDEX IF NOT EXISTS idx_records_table_active ON records(table_id, position, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cells_record ON cells(record_id);
CREATE INDEX IF NOT EXISTS idx_cells_field ON cells(field_id);
CREATE INDEX IF NOT EXISTS idx_cells_field_value ON cells(field_id, value);
CREATE INDEX IF NOT EXISTS idx_cells_record_field ON cells(record_id, field_id);
CREATE INDEX IF NOT EXISTS idx_links_field ON links(field_id);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_record_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_record_id);
CREATE INDEX IF NOT EXISTS idx_links_field_from ON links(field_id, from_record_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_base ON members(base_id, user_id);
CREATE INDEX IF NOT EXISTS idx_job_runs_base_key ON job_runs(base_id, job_key, started_at);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_base_date ON commission_ledger(base_id, business_date);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_order ON commission_ledger(order_record_id);
CREATE INDEX IF NOT EXISTS idx_order_activity_lookup ON order_activity_daily(base_id, side, channel_record_id, product_record_id, business_date);
CREATE INDEX IF NOT EXISTS idx_audit_log_base ON audit_log(base_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log(record_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_field ON audit_log(field_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);

-- ====== 外部展示库（public schema） ======
CREATE TABLE IF NOT EXISTS public_clients (
  token VARCHAR(36) PRIMARY KEY,
  base_id VARCHAR(21) NOT NULL,
  customer_key VARCHAR(100) NOT NULL,
  display_name VARCHAR(200),
  role VARCHAR(50) NOT NULL DEFAULT 'customer_query',
  created_at BIGINT NOT NULL,
  expires_at BIGINT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(21)
);

CREATE TABLE IF NOT EXISTS public_customer_snapshot (
  base_id VARCHAR(21) NOT NULL,
  customer_key VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  ref_id VARCHAR(21) NOT NULL,
  data_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (base_id, customer_key, category, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_public_snapshot_lookup
  ON public_customer_snapshot(base_id, customer_key, category);

CREATE TABLE IF NOT EXISTS public_access_log (
  id SERIAL PRIMARY KEY,
  token VARCHAR(36),
  base_id VARCHAR(21),
  customer_key VARCHAR(100),
  path VARCHAR(500) NOT NULL,
  status INTEGER NOT NULL,
  ip VARCHAR(45),
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_access_token ON public_access_log(token, created_at);

CREATE TABLE IF NOT EXISTS public_reconciliation (
  id VARCHAR(200) PRIMARY KEY,
  base_id VARCHAR(21) NOT NULL,
  customer_key VARCHAR(100) NOT NULL,
  record_date VARCHAR(10) NOT NULL,
  category VARCHAR(50) NOT NULL,
  ref_id VARCHAR(21) NOT NULL,
  description TEXT,
  debit DOUBLE PRECISION NOT NULL DEFAULT 0,
  credit DOUBLE PRECISION NOT NULL DEFAULT 0,
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  data_json TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recon_lookup ON public_reconciliation(base_id, customer_key, record_date, category);
CREATE INDEX IF NOT EXISTS idx_recon_ref ON public_reconciliation(base_id, customer_key, ref_id);

-- M-06/07: Missing indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_bases_owner ON bases(owner_id);
CREATE INDEX IF NOT EXISTS idx_invites_base ON invites(base_id);
CREATE INDEX IF NOT EXISTS idx_invites_expires ON invites(expires_at);

-- ====== 软删除迁移 ======
DO $$ BEGIN
  -- 确保唯一索引是部分索引（兼容已有数据库）
  DROP INDEX IF EXISTS users_email_key;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_active ON users(email) WHERE deleted_at IS NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
`;

async function initSchema() {
  if (!writePool) initPools();
  await writePool.query(SCHEMA_SQL);
  logger.info('PostgreSQL schema initialized');
}

// -------- 异步查询 API --------
// 这些是 PostgreSQL 版本的查询函数，返回 Promise

async function pgQuery(pool, sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result;
  } finally {
    client.release();
  }
}

async function pgAll(pool, sql, params = []) {
  const result = await pgQuery(pool, sql, params);
  return result.rows;
}

async function pgGet(pool, sql, params = []) {
  const result = await pgQuery(pool, sql, params);
  const row = result.rows[0] || null;
  // PostgreSQL 返回的列名是小写的，将 count(*) 别名统一映射为 .c
  if (row && 'c' in row === false && 'C' in row) row.c = row.C;
  return row;
}

async function pgRun(pool, sql, params = []) {
  const result = await pgQuery(pool, sql, params);
  return result.rowCount;
}

// -------- 事务 API --------
async function pgTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    // HIGH-13: 设置事务超时（30秒）
    await client.query('SET LOCAL statement_timeout = 30000');
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// -------- 连接池统计 --------
function getPoolStats() {
  if (!writePool) return null;
  return {
    write: {
      total: writePool.totalCount,
      idle: writePool.idleCount,
      waiting: writePool.waitingCount,
    },
    read: {
      total: readPool.totalCount,
      idle: readPool.idleCount,
      waiting: readPool.waitingCount,
    },
    readReplica: !!READ_REPLICA_CONFIG,
  };
}

// -------- 健康检查 --------
async function healthCheck() {
  if (!writePool) return { status: 'not_initialized' };
  try {
    const start = Date.now();
    await writePool.query('SELECT 1');
    const writeLatency = Date.now() - start;

    const rStart = Date.now();
    await readPool.query('SELECT 1');
    const readLatency = Date.now() - rStart;

    return {
      status: 'healthy',
      writeLatency,
      readLatency,
      poolStats: getPoolStats(),
      readReplica: !!READ_REPLICA_CONFIG,
    };
  } catch (e) {
    return { status: 'unhealthy', error: e.message };
  }
}

// -------- 关闭连接池 --------
async function closePools() {
  if (writePool) await writePool.end();
  if (readPool && readPool !== writePool) await readPool.end();
  logger.info('PostgreSQL pools closed');
}

module.exports = {
  initPools,
  initSchema,
  getWritePool,
  getReadPool,
  getPoolStats,
  pgQuery,
  pgAll,
  pgGet,
  pgRun,
  pgTransaction,
  healthCheck,
  closePools,
  SCHEMA_SQL,
};
