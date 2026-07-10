// db/migrations/003_fix_null_keys.js
// C-10: 修复 NULL 主键问题
// 1. order_activity_daily.product_record_id 改为 NOT NULL DEFAULT ''
// 2. commission_ledger.original_ledger_id 加 UNIQUE 约束

function up(db) {
  // SQLite 不支持 ALTER COLUMN，需要重建表

  // 1. 重建 order_activity_daily
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_activity_daily_new (
      base_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      side TEXT NOT NULL,
      channel_record_id TEXT NOT NULL,
      product_record_id TEXT NOT NULL DEFAULT '',
      valid_order_count INTEGER NOT NULL DEFAULT 0,
      gross_profit_sum REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (base_id, business_date, side, channel_record_id, product_record_id)
    )
  `);

  // 迁移数据，将 NULL product_record_id 替换为 ''
  db.exec(`
    INSERT OR REPLACE INTO order_activity_daily_new
      (base_id, business_date, side, channel_record_id, product_record_id, valid_order_count, gross_profit_sum, updated_at)
    SELECT
      base_id, business_date, side, channel_record_id,
      COALESCE(product_record_id, ''),
      valid_order_count, gross_profit_sum, updated_at
    FROM order_activity_daily
  `);

  db.exec('DROP TABLE order_activity_daily');
  db.exec('ALTER TABLE order_activity_daily_new RENAME TO order_activity_daily');

  // 重建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_order_activity_lookup
      ON order_activity_daily(base_id, side, channel_record_id, product_record_id, business_date)
  `);

  // 2. commission_ledger.original_ledger_id 加 UNIQUE 约束
  // 先清理可能的重复 NULL 值（将 NULL 改为 '' 只对有值的行加约束）
  db.exec(`
    UPDATE commission_ledger SET original_ledger_id = '' WHERE original_ledger_id IS NULL
  `);

  // SQLite 不支持 ADD CONSTRAINT，需要重建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS commission_ledger_new (
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
      original_ledger_id TEXT UNIQUE,
      created_at INTEGER NOT NULL,
      UNIQUE (base_id, batch_no, order_record_id, lock_record_id, side, type)
    )
  `);

  db.exec(`
    INSERT OR REPLACE INTO commission_ledger_new
      (id, base_id, batch_no, business_date, order_record_id, lock_record_id, side,
       channel_record_id, product_record_id, snapshot_profit, rate, amount, type,
       original_ledger_id, created_at)
    SELECT
      id, base_id, batch_no, business_date, order_record_id, lock_record_id, side,
      channel_record_id, product_record_id, snapshot_profit, rate, amount, type,
      original_ledger_id, created_at
    FROM commission_ledger
  `);

  db.exec('DROP TABLE commission_ledger');
  db.exec('ALTER TABLE commission_ledger_new RENAME TO commission_ledger');

  // 重建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_commission_ledger_base_date ON commission_ledger(base_id, business_date)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_commission_ledger_order ON commission_ledger(order_record_id)
  `);
}

module.exports = { up };
