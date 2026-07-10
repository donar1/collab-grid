// db/migrate.js — 轻量数据库迁移框架
// 用法：require('./db/migrate')(db)
// 约定：migrations/ 目录下放 001_xxx.js，每个导出 { up(db) }
// schema_version 表记录已执行的迁移版本号

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function runMigrations(db) {
  // 创建 schema_version 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      PRIMARY KEY (version)
    )
  `);

  // 扫描迁移文件
  if (!fs.existsSync(MIGRATIONS_DIR)) return;
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_\w+\.js$/.test(f))
    .sort();

  // 获取当前版本
  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
  const currentVersion = row?.v || 0;

  for (const file of files) {
    const match = file.match(/^(\d{3})_(\w+)\.js$/);
    if (!match) continue;
    const version = parseInt(match[1], 10);
    if (version <= currentVersion) continue;

    const migration = require(path.join(MIGRATIONS_DIR, file));
    if (typeof migration.up !== 'function') {
      console.warn(`[migrate] ${file}: 缺少 up(db) 函数，跳过`);
      continue;
    }

    const ts = Date.now();
    try {
      db.transaction(() => {
        migration.up(db);
        db.prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)')
          .run(version, match[2], ts);
      })();
      console.log(`[migrate] ${file} applied (v${version})`);
    } catch (e) {
      console.error(`[migrate] ${file} FAILED: ${e.message}`);
      throw e; // 迁移失败不应继续启动
    }
  }
}

module.exports = runMigrations;
