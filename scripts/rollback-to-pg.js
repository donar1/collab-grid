#!/usr/bin/env node
// scripts/rollback-to-pg.js — PostgreSQL → SQLite 回滚迁移工具
// 用法: node scripts/rollback-to-pg.js [--dry-run] [--table=users]

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const pg = require('../pgAdapter');

const TABLES = [
  'users', 'bases', 'members', 'tables', 'fields', 'records', 'cells',
  'links', 'invites', 'job_configs', 'job_runs', 'commission_ledger',
  'order_activity_daily', 'attachments', 'audit_log', 'permission_overrides',
];

// 按反向依赖顺序回滚（permission_overrides first, users last）
const ROLLBACK_ORDER = [
  'permission_overrides', 'audit_log', 'attachments', 'order_activity_daily',
  'commission_ledger', 'job_runs', 'job_configs', 'invites', 'links',
  'cells', 'records', 'fields', 'tables', 'members', 'bases', 'users',
];

const COLUMNS = {
  users: ['id', 'email', 'password_hash', 'display_name', 'created_at'],
  bases: ['id', 'name', 'owner_id', 'created_at'],
  members: ['base_id', 'user_id', 'role', 'joined_at'],
  tables: ['id', 'base_id', 'name', 'position', 'created_at'],
  fields: ['id', 'table_id', 'name', 'type', 'options', 'locked', 'width', 'position', 'created_at'],
  records: ['id', 'table_id', 'height', 'locked', 'position', 'created_at', 'updated_at'],
  cells: ['record_id', 'field_id', 'value', 'style_json', 'updated_at', 'updated_by'],
  links: ['id', 'field_id', 'from_record_id', 'to_record_id', 'created_at'],
  invites: ['token', 'base_id', 'role', 'created_by', 'created_at', 'expires_at'],
  job_configs: ['base_id', 'job_key', 'enabled', 'dry_run', 'batch_size', 'max_runtime_ms', 'config_json', 'updated_at', 'schedule_enabled', 'schedule_time', 'schedule_business_date_mode', 'schedule_dry_run', 'schedule_last_run_date', 'schedule_last_run_at', 'schedule_last_run_status'],
  job_runs: ['id', 'base_id', 'job_key', 'business_date', 'mode', 'status', 'started_at', 'finished_at', 'scanned_count', 'changed_count', 'error_count', 'summary_json', 'error_json', 'created_by'],
  commission_ledger: ['id', 'base_id', 'batch_no', 'business_date', 'order_record_id', 'lock_record_id', 'side', 'channel_record_id', 'product_record_id', 'snapshot_profit', 'rate', 'amount', 'type', 'original_ledger_id', 'created_at'],
  order_activity_daily: ['base_id', 'business_date', 'side', 'channel_record_id', 'product_record_id', 'valid_order_count', 'gross_profit_sum', 'updated_at'],
  attachments: ['id', 'base_id', 'record_id', 'field_id', 'file_name', 'file_type', 'file_size', 'file_path', 'uploaded_by', 'created_at'],
  audit_log: ['id', 'base_id', 'table_id', 'record_id', 'field_id', 'old_value', 'new_value', 'action', 'user_id', 'user_email', 'created_at'],
  permission_overrides: ['scope', 'role', 'base_id', 'permission', 'allow', 'updated_at', 'updated_by'],
};

// SQLite DDL（与 db.js 中的 schema 一致，确保目标表存在）
const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (base_id, user_id)
);

CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS fields (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  options TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 160,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  height INTEGER NOT NULL DEFAULT 34,
  locked INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS cells (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value TEXT,
  style_json TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (record_id, field_id)
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  from_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  to_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (field_id, from_record_id, to_record_id)
);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS job_configs (
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  job_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  dry_run INTEGER NOT NULL DEFAULT 1,
  batch_size INTEGER NOT NULL DEFAULT 2000,
  max_runtime_ms INTEGER NOT NULL DEFAULT 120000,
  config_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (base_id, job_key)
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  job_key TEXT NOT NULL,
  business_date TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT,
  error_json TEXT,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS commission_ledger (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  batch_no TEXT NOT NULL,
  business_date TEXT NOT NULL,
  order_record_id TEXT NOT NULL,
  lock_record_id TEXT NOT NULL,
  side TEXT NOT NULL,
  channel_record_id TEXT,
  product_record_id TEXT,
  snapshot_profit REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'normal',
  original_ledger_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (base_id, batch_no, order_record_id, lock_record_id, side, type)
);

CREATE TABLE IF NOT EXISTS order_activity_daily (
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  side TEXT NOT NULL,
  channel_record_id TEXT NOT NULL,
  product_record_id TEXT,
  valid_order_count INTEGER NOT NULL DEFAULT 0,
  gross_profit_sum REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (base_id, business_date, side, channel_record_id, product_record_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL,
  table_id TEXT NOT NULL DEFAULT '',
  record_id TEXT NOT NULL DEFAULT '',
  field_id TEXT NOT NULL DEFAULT '',
  old_value TEXT,
  new_value TEXT,
  action TEXT NOT NULL DEFAULT 'cell.update',
  user_id TEXT,
  user_email TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  role TEXT NOT NULL,
  base_id TEXT,
  permission TEXT NOT NULL,
  allow INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  UNIQUE (scope, role, COALESCE(base_id, ''), permission)
);

CREATE INDEX IF NOT EXISTS idx_attachments_record ON attachments(record_id, field_id);
CREATE INDEX IF NOT EXISTS idx_attachments_base ON attachments(base_id);
CREATE INDEX IF NOT EXISTS idx_tables_base ON tables(base_id);
CREATE INDEX IF NOT EXISTS idx_tables_name ON tables(base_id, name);
CREATE INDEX IF NOT EXISTS idx_fields_table ON fields(table_id);
CREATE INDEX IF NOT EXISTS idx_fields_name ON fields(table_id, name);
CREATE INDEX IF NOT EXISTS idx_records_table ON records(table_id);
CREATE INDEX IF NOT EXISTS idx_records_table_position ON records(table_id, position, created_at);
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
`;

async function rollbackTable(sqliteDb, pgPool, tableName, dryRun) {
  const cols = COLUMNS[tableName];
  if (!cols) {
    console.log(`  SKIP ${tableName}: no column mapping`);
    return { table: tableName, count: 0 };
  }

  // 从 PostgreSQL 读取数据
  const result = await pgPool.query(`SELECT ${cols.join(', ')} FROM ${tableName}`);
  const rows = result.rows;

  if (!rows.length) {
    console.log(`  SKIP ${tableName}: 0 rows`);
    return { table: tableName, count: 0 };
  }

  if (dryRun) {
    console.log(`  DRY-RUN ${tableName}: ${rows.length} rows would be rolled back`);
    return { table: tableName, count: rows.length, dryRun: true };
  }

  // 分批插入 SQLite（每批 500 行）
  const BATCH_SIZE = 500;
  let totalInserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // 使用 SQLite 事务插入一批数据
    const insertOne = sqliteDb.transaction(() => {
      for (const row of batch) {
        const values = cols.map(col => row[col] ?? null);
        const placeholders = cols.map(() => '?').join(', ');

        try {
          sqliteDb.prepare(
            `INSERT OR IGNORE INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`
          ).run(...values);
          totalInserted++;
        } catch (e) {
          // 跳过因唯一约束冲突的行
          if (!e.message.includes('UNIQUE constraint')) {
            throw e;
          }
        }
      }
    });

    insertOne();
  }

  console.log(`  OK ${tableName}: ${totalInserted}/${rows.length} rows rolled back`);
  return { table: tableName, count: totalInserted };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetTable = args.find(a => a.startsWith('--table='))?.split('=')[1];

  console.log('=== PostgreSQL -> SQLite 回滚迁移 ===');
  console.log(`模式: ${dryRun ? 'DRY-RUN（不写入）' : '正式回滚'}`);
  console.log('');

  // 连接 PostgreSQL
  try {
    pg.initPools();
    console.log('PostgreSQL: 已连接');
  } catch (e) {
    console.error('无法连接 PostgreSQL:', e.message);
    console.error('请确保 PostgreSQL 正在运行，并设置环境变量:');
    console.error('  PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD');
    process.exit(1);
  }

  // 打开/创建 SQLite 数据库
  const sqlitePath = path.join(__dirname, '..', 'data', 'collab-grid.db');
  const dataDir = path.dirname(sqlitePath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  let sqliteDb;
  try {
    sqliteDb = new Database(sqlitePath);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = OFF'); // 回滚期间关闭外键检查，避免插入顺序问题
    console.log(`SQLite: ${sqlitePath}`);
  } catch (e) {
    console.error('无法打开 SQLite 数据库:', e.message);
    await pg.closePools();
    process.exit(1);
  }

  // 确保 SQLite 表结构存在
  try {
    sqliteDb.exec(SQLITE_DDL);
    console.log('SQLite: schema ensured');
  } catch (e) {
    console.error('SQLite schema 初始化失败:', e.message);
    sqliteDb.close();
    await pg.closePools();
    process.exit(1);
  }

  console.log('');

  const tables = targetTable ? [targetTable] : ROLLBACK_ORDER;
  const results = [];

  for (const table of tables) {
    try {
      const result = await rollbackTable(sqliteDb, pg.getReadPool(), table, dryRun);
      results.push(result);
    } catch (e) {
      console.error(`  ERROR ${table}: ${e.message}`);
      results.push({ table, error: e.message });
    }
  }

  console.log('');
  console.log('=== 回滚结果 ===');
  for (const r of results) {
    if (r.error) console.log(`  FAIL ${r.table}: ${r.error}`);
    else if (r.dryRun) console.log(`  DRY ${r.table}: ${r.count} rows`);
    else console.log(`  OK   ${r.table}: ${r.count} rows`);
  }

  const totalRows = results.reduce((sum, r) => sum + (r.count || 0), 0);
  console.log(`\n总计: ${totalRows} 行`);

  sqliteDb.close();
  await pg.closePools();
  console.log('\n回滚完成');
}

main().catch(e => {
  console.error('回滚失败:', e);
  process.exit(1);
});
