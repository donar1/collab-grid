// db.js — SQLite schema + helpers
// 读写分离：WAL 模式下，只读连接可以并发读取
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'collab-grid.db');

// 写连接（主连接）
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 只读连接池（WAL 模式下可并发读）
const readPoolSize = Number(process.env.DB_READ_POOL_SIZE) || 4;
const readPool = [];
for (let i = 0; i < readPoolSize; i++) {
  const ro = new Database(DB_PATH, { readonly: true });
  ro.pragma('journal_mode = WAL');
  readPool.push(ro);
}
let readPoolIndex = 0;
function getReadDb() {
  const ro = readPool[readPoolIndex];
  readPoolIndex = (readPoolIndex + 1) % readPool.length;
  return ro;
}

db.exec(`
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
  version INTEGER NOT NULL DEFAULT 1,
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
CREATE INDEX IF NOT EXISTS idx_attachments_record ON attachments(record_id, field_id);
CREATE INDEX IF NOT EXISTS idx_attachments_base ON attachments(base_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_base_created ON events(base_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_unprocessed ON events(processed, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_tables_base ON tables(base_id);
CREATE INDEX IF NOT EXISTS idx_tables_name ON tables(base_id, name); -- M-4: 按 base+name 查找
CREATE INDEX IF NOT EXISTS idx_fields_table ON fields(table_id);
CREATE INDEX IF NOT EXISTS idx_fields_name ON fields(table_id, name); -- M-4: 按 table+name 查找
CREATE INDEX IF NOT EXISTS idx_records_table ON records(table_id);
CREATE INDEX IF NOT EXISTS idx_records_table_position ON records(table_id, position, created_at);
CREATE INDEX IF NOT EXISTS idx_cells_record ON cells(record_id);
CREATE INDEX IF NOT EXISTS idx_cells_field ON cells(field_id);
CREATE INDEX IF NOT EXISTS idx_cells_field_value ON cells(field_id, value);
CREATE INDEX IF NOT EXISTS idx_cells_record_field ON cells(record_id, field_id); -- M-5: 覆盖单条记录所有字段查询
CREATE INDEX IF NOT EXISTS idx_links_field ON links(field_id);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_record_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_record_id);
CREATE INDEX IF NOT EXISTS idx_links_field_from ON links(field_id, from_record_id); -- M-5: 覆盖 link 字段+源记录查询
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_base ON members(base_id, user_id); -- M-5: 覆盖 base 成员查询
CREATE INDEX IF NOT EXISTS idx_job_runs_base_key ON job_runs(base_id, job_key, started_at);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_base_date ON commission_ledger(base_id, business_date);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_order ON commission_ledger(order_record_id);
CREATE INDEX IF NOT EXISTS idx_order_activity_lookup ON order_activity_daily(base_id, side, channel_record_id, product_record_id, business_date);

-- M-06/07: Missing indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_bases_owner ON bases(owner_id);
CREATE INDEX IF NOT EXISTS idx_invites_base ON invites(base_id);
CREATE INDEX IF NOT EXISTS idx_invites_expires ON invites(expires_at);
`);

// 运行数据库迁移（只在写连接上执行）
const runMigrations = require('./db/migrate');
runMigrations(db);

// S-07: Schema alignment — add columns present in PG but missing in SQLite
const SCHEMA_ALIGNMENT = [
  { table: 'users', sql: 'ALTER TABLE users ADD COLUMN system_role TEXT DEFAULT \'none\'' },
  { table: 'users', sql: 'ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0' },
  { table: 'users', sql: 'ALTER TABLE users ADD COLUMN password_changed_at INTEGER' },
  { table: 'tables', sql: 'ALTER TABLE tables ADD COLUMN hidden INTEGER DEFAULT 0' },
  { table: 'records', sql: 'ALTER TABLE records ADD COLUMN updated_at INTEGER' },
  { table: 'records', sql: 'ALTER TABLE records ADD COLUMN deleted_at INTEGER' },
  { table: 'audit_log', sql: 'ALTER TABLE audit_log ADD COLUMN user_email TEXT DEFAULT \'\'' },
  { table: 'cells', sql: 'ALTER TABLE cells ADD COLUMN version INTEGER NOT NULL DEFAULT 1' },
];
for (const item of SCHEMA_ALIGNMENT) {
  try { db.exec(item.sql); } catch (e) { /* column already exists */ }
}

try { db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_bases_owner ON bases(owner_id)'); } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_invites_base ON invites(base_id)'); } catch {}

function closePools() {
  for (const ro of readPool) {
    try { ro.close(); } catch (_) {}
  }
  readPool.length = 0;
  try { db.close(); } catch (_) {}
}

module.exports = db;
module.exports.getReadDb = getReadDb;
module.exports.closePools = closePools;
