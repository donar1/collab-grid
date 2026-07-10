// scripts/auto-backup.js — 自动数据库备份
// Usage: node scripts/auto-backup.js [--schedule]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const config = require('../config');

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const MAX_AGE_DAYS = 30;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

function cleanupOld() {
  ensureDir(BACKUP_DIR);
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup_'));
  let removed = 0;
  for (const f of files) {
    const stat = fs.statSync(path.join(BACKUP_DIR, f));
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      removed++;
    }
  }
  return removed;
}

function backupSqlite() {
  const dbPath = config.dbPath || 'data/collabgrid.db';
  if (!fs.existsSync(dbPath)) {
    console.log(`SQLite DB not found: ${dbPath}`);
    return false;
  }
  const ext = 'db.gz';
  const dest = path.join(BACKUP_DIR, `backup_${timestamp()}.${ext}`);
  try {
    // Copy + gzip
    const content = fs.readFileSync(dbPath);
    execSync(`node -e "require('zlib').gzipSync(require('fs').readFileSync('/dev/stdin')).pipe(require('fs').createWriteStream('${dest}'))" `, { input: content, encoding: 'buffer' });
    console.log(`SQLite backup: ${dest} (${(fs.statSync(dest).size / 1024).toFixed(1)} KB)`);
    return true;
  } catch (e) {
    // Fallback: plain copy
    fs.copyFileSync(dbPath, dest.replace('.gz', ''));
    console.log(`SQLite backup (no gzip): ${dest.replace('.gz', '')}`);
    return true;
  }
}

function backupPostgres() {
  const { host, port, database, user, password } = config.pg;
  const dest = path.join(BACKUP_DIR, `backup_${timestamp()}.sql.gz`);
  try {
    const envPassword = password;
    execSync(`pg_dump -h ${host} -p ${port} -U ${user} -d ${database} | gzip > "${dest}"`, {
      env: { ...process.env, PGPASSWORD: envPassword },
      timeout: 60000,
    });
    console.log(`PostgreSQL backup: ${dest} (${(fs.statSync(dest).size / 1024).toFixed(1)} KB)`);
    return true;
  } catch (e) {
    console.error(`PostgreSQL backup failed: ${e.message}`);
    return false;
  }
}

// Main
const removed = cleanupOld();
if (removed > 0) console.log(`Cleaned up ${removed} old backup(s)`);

const engine = config.dbEngine || 'sqlite';
if (engine === 'postgresql') {
  backupPostgres();
} else {
  backupSqlite();
}
