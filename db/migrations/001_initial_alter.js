// db/migrations/001_initial_alter.js
// 初始迁移：从旧 schema 升级的 ALTER TABLE 语句
// 这些原本散落在 db.js 中，现在集中管理

exports.up = function(db) {
  const cellColumns = db.prepare('PRAGMA table_info(cells)').all().map(c => c.name);
  if (!cellColumns.includes('style_json')) {
    db.prepare('ALTER TABLE cells ADD COLUMN style_json TEXT').run();
  }

  const fieldColumns = db.prepare('PRAGMA table_info(fields)').all().map(c => c.name);
  if (!fieldColumns.includes('width')) {
    db.exec('ALTER TABLE fields ADD COLUMN width INTEGER NOT NULL DEFAULT 160');
  }

  const recordColumns = db.prepare('PRAGMA table_info(records)').all().map(c => c.name);
  if (!recordColumns.includes('height')) {
    db.exec('ALTER TABLE records ADD COLUMN height INTEGER NOT NULL DEFAULT 34');
  }
  if (!recordColumns.includes('locked')) {
    db.exec('ALTER TABLE records ADD COLUMN locked INTEGER NOT NULL DEFAULT 0');
  }
  if (!recordColumns.includes('updated_at')) {
    db.exec('ALTER TABLE records ADD COLUMN updated_at INTEGER');
  }

  const jobConfigColumns = db.prepare('PRAGMA table_info(job_configs)').all().map(c => c.name);
  if (!jobConfigColumns.includes('schedule_enabled')) {
    db.exec('ALTER TABLE job_configs ADD COLUMN schedule_enabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!jobConfigColumns.includes('schedule_time')) {
    db.exec('ALTER TABLE job_configs ADD COLUMN schedule_time TEXT');
  }
  if (!jobConfigColumns.includes('schedule_business_date_mode')) {
    db.exec('ALTER TABLE job_configs ADD COLUMN schedule_business_date_mode TEXT NOT NULL DEFAULT \'today\'');
  }
  if (!jobConfigColumns.includes('schedule_dry_run')) {
    db.exec('ALTER TABLE job_configs ADD COLUMN schedule_dry_run INTEGER NOT NULL DEFAULT 0');
  }
  if (!jobConfigColumns.includes('schedule_last_run_date')) {
    db.exec('ALTER TABLE job_configs ADD COLUMN schedule_last_run_date TEXT');
  }
  if (!jobConfigColumns.includes('schedule_last_run_at')) {
    db.exec('ALTER TABLE job_configs ADD COLUMN schedule_last_run_at INTEGER');
  }
  if (!jobConfigColumns.includes('schedule_last_run_status')) {
    db.exec('ALTER TABLE job_configs ADD COLUMN schedule_last_run_status TEXT');
  }
};
