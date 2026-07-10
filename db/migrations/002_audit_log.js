// db/migrations/002_audit_log.js
// P3: 审计日志表 — 记录 cell 变更的 before/after 值

exports.up = function(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      base_id TEXT NOT NULL,
      table_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      field_id TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      action TEXT NOT NULL DEFAULT 'cell.update',
      user_id TEXT,
      user_email TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_base ON audit_log(base_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log(record_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_field ON audit_log(field_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at)`);
};
