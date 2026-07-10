#!/usr/bin/env node
// scripts/migrate-to-pg.js — SQLite → PostgreSQL 数据迁移工具
// 用法: node scripts/migrate-to-pg.js [--dry-run] [--table=users]

const path = require('path');
const Database = require('better-sqlite3');
const pg = require('../pgAdapter');

const TABLES = [
  'users', 'bases', 'members', 'tables', 'fields', 'records', 'cells',
  'links', 'invites', 'job_configs', 'job_runs', 'commission_ledger',
  'order_activity_daily', 'attachments', 'audit_log', 'permission_overrides',
];

// 按依赖顺序迁移
const MIGRATE_ORDER = [
  'users', 'bases', 'members', 'tables', 'fields', 'records', 'cells',
  'links', 'invites', 'job_configs', 'job_runs', 'commission_ledger',
  'order_activity_daily', 'attachments', 'audit_log', 'permission_overrides',
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

async function migrateTable(sqliteDb, pgPool, tableName, dryRun) {
  const cols = COLUMNS[tableName];
  if (!cols) {
    console.log(`  SKIP ${tableName}: no column mapping`);
    return { table: tableName, count: 0 };
  }

  const rows = sqliteDb.prepare(`SELECT ${cols.join(', ')} FROM ${tableName}`).all();
  if (!rows.length) {
    console.log(`  SKIP ${tableName}: 0 rows`);
    return { table: tableName, count: 0 };
  }

  if (dryRun) {
    console.log(`  DRY-RUN ${tableName}: ${rows.length} rows would be migrated`);
    return { table: tableName, count: rows.length, dryRun: true };
  }

  // 分批插入（每批 500 行）
  const BATCH_SIZE = 500;
  let totalInserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map((_, idx) => {
      const paramOffset = idx * cols.length;
      return `(${cols.map((_, c) => `$${paramOffset + c + 1}`).join(', ')})`;
    }).join(', ');

    const values = [];
    for (const row of batch) {
      for (const col of cols) {
        values.push(row[col] ?? null);
      }
    }

    const sql = `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`;
    const result = await pgPool.query(sql, values);
    totalInserted += result.rowCount;
  }

  console.log(`  OK ${tableName}: ${totalInserted}/${rows.length} rows migrated`);
  return { table: tableName, count: totalInserted };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const targetTable = args.find(a => a.startsWith('--table='))?.split('=')[1];

  console.log('=== SQLite → PostgreSQL 数据迁移 ===');
  console.log(`模式: ${dryRun ? 'DRY-RUN（不写入）' : '正式迁移'}`);
  console.log('');

  // 打开 SQLite
  const sqlitePath = path.join(__dirname, '..', 'data', 'collab-grid.db');
  let sqliteDb;
  try {
    sqliteDb = new Database(sqlitePath, { readonly: true });
    console.log(`SQLite: ${sqlitePath}`);
  } catch (e) {
    console.error('无法打开 SQLite 数据库:', e.message);
    process.exit(1);
  }

  // 连接 PostgreSQL
  try {
    pg.initPools();
    await pg.initSchema();
    console.log('PostgreSQL: schema initialized');
  } catch (e) {
    console.error('无法连接 PostgreSQL:', e.message);
    console.error('请确保 PostgreSQL 正在运行，并设置环境变量:');
    console.error('  PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD');
    sqliteDb.close();
    process.exit(1);
  }

  console.log('');

  const tables = targetTable ? [targetTable] : MIGRATE_ORDER;
  const results = [];

  for (const table of tables) {
    try {
      const result = await migrateTable(sqliteDb, pg.getWritePool(), table, dryRun);
      results.push(result);
    } catch (e) {
      console.error(`  ERROR ${table}: ${e.message}`);
      results.push({ table, error: e.message });
    }
  }

  console.log('');
  console.log('=== 迁移结果 ===');
  for (const r of results) {
    if (r.error) console.log(`  FAIL ${r.table}: ${r.error}`);
    else if (r.dryRun) console.log(`  DRY ${r.table}: ${r.count} rows`);
    else console.log(`  OK   ${r.table}: ${r.count} rows`);
  }

  const totalRows = results.reduce((sum, r) => sum + (r.count || 0), 0);
  console.log(`\n总计: ${totalRows} 行`);

  sqliteDb.close();
  await pg.closePools();
  console.log('\n✅ 迁移完成');
}

main().catch(e => {
  console.error('迁移失败:', e);
  process.exit(1);
});
