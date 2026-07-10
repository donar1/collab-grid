#!/usr/bin/env node
// scripts/verify-migration.js — SQLite → PostgreSQL 迁移后数据验证
// 用法: node scripts/verify-migration.js [--table=users] [--sample=10]
// 功能：
//   1. 连接 SQLite 和 PostgreSQL
//   2. 对比每个表的行数
//   3. 抽样对比 N 条记录的数据一致性
//   4. 输出对比报告

const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

// 加载 .env 配置
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ---- 配置 ----
const SAMPLE_COUNT = parseInt(process.argv.find(a => a.startsWith('--sample='))?.split('=')[1] || '10', 10);
const TARGET_TABLE = process.argv.find(a => a.startsWith('--table='))?.split('=')[1] || null;

// 所有需要验证的表（与 migrate-to-pg.js 一致）
const ALL_TABLES = [
  'users', 'bases', 'members', 'tables', 'fields', 'records', 'cells',
  'links', 'invites', 'job_configs', 'job_runs', 'commission_ledger',
  'order_activity_daily', 'attachments', 'audit_log', 'permission_overrides',
];

// 每个表的主键列（用于抽样对比）
// 单主键用字符串，复合主键用数组
const PRIMARY_KEYS = {
  users: 'id',
  bases: 'id',
  members: ['base_id', 'user_id'],
  tables: 'id',
  fields: 'id',
  records: 'id',
  cells: ['record_id', 'field_id'],
  links: 'id',
  invites: 'token',
  job_configs: ['base_id', 'job_key'],
  job_runs: 'id',
  commission_ledger: 'id',
  order_activity_daily: ['base_id', 'business_date', 'side', 'channel_record_id', 'product_record_id'],
  attachments: 'id',
  audit_log: 'id',
  permission_overrides: ['scope', 'role', 'permission'],
};

// 每个表的列定义（与 migrate-to-pg.js 一致）
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

// ---- 辅助函数 ----
function normalizeValue(v) {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return v.toString('utf-8');
  return v;
}

function rowsEqual(sqliteRow, pgRow, cols) {
  for (const col of cols) {
    const sv = normalizeValue(sqliteRow[col]);
    const pv = normalizeValue(pgRow[col]);
    // 数值类型：SQLite 可能返回字符串，PG 返回数字
    if (typeof sv === 'string' && typeof pv === 'number') {
      if (parseFloat(sv) !== pv) return false;
      continue;
    }
    if (typeof pv === 'string' && typeof sv === 'number') {
      if (parseFloat(pv) !== sv) return false;
      continue;
    }
    if (sv !== pv) return false;
  }
  return true;
}

// ---- 主流程 ----
async function main() {
  console.log('=== SQLite → PostgreSQL 迁移验证 ===');
  console.log(`抽样数量: ${SAMPLE_COUNT} 条/表`);
  console.log('');

  // 1. 连接 SQLite
  const sqlitePath = path.join(__dirname, '..', 'data', 'collab-grid.db');
  let sqliteDb;
  try {
    sqliteDb = new Database(sqlitePath, { readonly: true });
    console.log(`SQLite: ${sqlitePath}`);
  } catch (e) {
    console.error('无法打开 SQLite 数据库:', e.message);
    process.exit(1);
  }

  // 2. 连接 PostgreSQL
  const pgConfig = {
    host: process.env.PG_HOST || 'localhost',
    port: parseInt(process.env.PG_PORT || '5432', 10),
    database: process.env.PG_DATABASE || 'collabgrid',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || '',
    max: 5,
  };
  let pgPool;
  try {
    pgPool = new Pool(pgConfig);
    // 测试连接
    await pgPool.query('SELECT 1');
    console.log(`PostgreSQL: ${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`);
  } catch (e) {
    console.error('无法连接 PostgreSQL:', e.message);
    sqliteDb.close();
    process.exit(1);
  }

  console.log('');

  const tables = TARGET_TABLE ? [TARGET_TABLE] : ALL_TABLES;
  const report = [];

  // ---- 阶段 1: 行数对比 ----
  console.log('--- 阶段 1: 行数对比 ---');
  for (const table of tables) {
    const cols = COLUMNS[table];
    if (!cols) {
      report.push({ table, status: 'SKIP', reason: 'no column mapping' });
      console.log(`  SKIP ${table}: no column mapping`);
      continue;
    }

    try {
      const sqliteCount = sqliteDb.prepare(`SELECT count(*) as cnt FROM ${table}`).get().cnt;
      const pgResult = await pgPool.query(`SELECT count(*) as cnt FROM ${table}`);
      const pgCount = parseInt(pgResult.rows[0].cnt, 10);

      const match = sqliteCount === pgCount;
      const status = match ? 'MATCH' : 'MISMATCH';
      report.push({
        table,
        status,
        sqliteCount,
        pgCount,
      });

      const icon = match ? 'OK' : 'FAIL';
      console.log(`  ${icon} ${table}: SQLite=${sqliteCount}, PG=${pgCount}`);
    } catch (e) {
      report.push({ table, status: 'ERROR', error: e.message });
      console.log(`  ERROR ${table}: ${e.message}`);
    }
  }

  // ---- 阶段 2: 抽样数据对比 ----
  console.log('');
  console.log('--- 阶段 2: 抽样数据对比 ---');
  const sampleReport = [];

  for (const table of tables) {
    const cols = COLUMNS[table];
    const pk = PRIMARY_KEYS[table];
    if (!cols) continue;

    try {
      // 获取 SQLite 中的样本行
      const sqliteRows = sqliteDb.prepare(`SELECT ${cols.join(', ')} FROM ${table} LIMIT ?`).all(SAMPLE_COUNT);
      if (sqliteRows.length === 0) {
        sampleReport.push({ table, status: 'EMPTY', sampled: 0 });
        console.log(`  SKIP ${table}: 0 rows (empty)`);
        continue;
      }

      let mismatches = 0;
      let matched = 0;
      const mismatchDetails = [];

      for (const sRow of sqliteRows) {
        let pgRow;
        const pkCols = Array.isArray(pk) ? pk : [pk];
        const conditions = pkCols.map((c, i) => `${c} = $${i + 1}`).join(' AND ');
        const pkValues = pkCols.map(c => sRow[c] ?? null);
        const pgResult = await pgPool.query(`SELECT ${cols.join(', ')} FROM ${table} WHERE ${conditions}`, pkValues);
        pgRow = pgResult.rows[0] || null;

        if (!pgRow) {
          mismatches++;
          mismatchDetails.push({ key: pkCols.join('='), issue: 'missing in PG' });
        } else if (!rowsEqual(sRow, pgRow, cols)) {
          mismatches++;
          const diffs = cols.filter(c => {
            const sv = normalizeValue(sRow[c]);
            const pv = normalizeValue(pgRow[c]);
            return sv !== pv;
          });
          mismatchDetails.push({ key: pkCols.join('='), issue: `column mismatch: ${diffs.join(', ')}` });
        } else {
          matched++;
        }
      }

      const status = mismatches === 0 ? 'MATCH' : 'MISMATCH';
      sampleReport.push({
        table,
        status,
        sampled: sqliteRows.length,
        matched,
        mismatches,
      });

      const icon = mismatches === 0 ? 'OK' : 'FAIL';
      console.log(`  ${icon} ${table}: sampled=${sqliteRows.length}, matched=${matched}, mismatches=${mismatches}`);
      if (mismatchDetails.length > 0) {
        for (const d of mismatchDetails.slice(0, 3)) {
          console.log(`       key=${d.key}: ${d.issue}`);
        }
        if (mismatchDetails.length > 3) {
          console.log(`       ... and ${mismatchDetails.length - 3} more mismatches`);
        }
      }
    } catch (e) {
      sampleReport.push({ table, status: 'ERROR', error: e.message });
      console.log(`  ERROR ${table}: ${e.message}`);
    }
  }

  // ---- 汇总报告 ----
  console.log('');
  console.log('=== 验证汇总 ===');
  const rowMatches = report.filter(r => r.status === 'MATCH').length;
  const rowMismatches = report.filter(r => r.status === 'MISMATCH').length;
  const rowErrors = report.filter(r => r.status === 'ERROR').length;
  const sampleMatches = sampleReport.filter(r => r.status === 'MATCH').length;
  const sampleMismatches = sampleReport.filter(r => r.status === 'MISMATCH').length;

  console.log(`行数对比: ${rowMatches} MATCH, ${rowMismatches} MISMATCH, ${rowErrors} ERROR`);
  console.log(`抽样对比: ${sampleMatches} MATCH, ${sampleMismatches} MISMATCH`);

  if (rowMismatches === 0 && sampleMismatches === 0 && rowErrors === 0) {
    console.log('\n验证通过: 所有表数据一致');
  } else {
    console.log('\n验证发现问题: 请检查上方详细输出');
  }

  // 清理
  sqliteDb.close();
  await pgPool.end();

  if (rowMismatches > 0 || sampleMismatches > 0) {
    process.exit(1);
  }
}

main().catch(e => {
  console.error('验证脚本失败:', e);
  process.exit(1);
});
