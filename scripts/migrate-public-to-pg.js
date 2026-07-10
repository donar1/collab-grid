// scripts/migrate-public-to-pg.js — 将 publicDb (SQLite) 数据迁移到 PostgreSQL
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PG_HOST = process.env.PG_HOST || 'localhost';
const PG_PORT = parseInt(process.env.PG_PORT || '5432', 10);
const PG_DATABASE = process.env.PG_DATABASE || 'collabgrid';
const PG_USER = process.env.PG_USER || 'postgres';
const PG_PASSWORD = process.env.PG_PASSWORD || '';

const SQLITE_PATH = path.join(__dirname, '..', 'data', 'collab-grid-public.db');
const BATCH_SIZE = 500;

const TABLES = [
  {
    name: 'public_clients',
    columns: ['token', 'base_id', 'customer_key', 'display_name', 'role', 'created_at', 'expires_at', 'revoked', 'created_by'],
    pk: 'token',
  },
  {
    name: 'public_customer_snapshot',
    columns: ['base_id', 'customer_key', 'category', 'ref_id', 'data_json', 'updated_at'],
    pk: null, // composite
  },
  {
    name: 'public_access_log',
    columns: ['token', 'base_id', 'customer_key', 'path', 'status', 'ip', 'created_at'],
    pk: null, // auto-increment, skip id
  },
  {
    name: 'public_reconciliation',
    columns: ['id', 'base_id', 'customer_key', 'record_date', 'category', 'ref_id', 'description', 'debit', 'credit', 'balance', 'status', 'data_json', 'created_at', 'updated_at'],
    pk: 'id',
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // 连接 SQLite
  if (!require('fs').existsSync(SQLITE_PATH)) {
    console.log('SQLite publicDb not found:', SQLITE_PATH);
    console.log('No data to migrate.');
    process.exit(0);
  }
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  // 连接 PG
  const pg = new Pool({
    host: PG_HOST,
    port: PG_PORT,
    database: PG_DATABASE,
    user: PG_USER,
    password: PG_PASSWORD,
    max: 5,
  });

  // 确保 public 表存在（通过 pgAdapter initSchema）
  const pgAdapter = require('../pgAdapter');
  await pgAdapter.initPools();
  await pgAdapter.initSchema();
  console.log('[migrate-public] PG schema initialized (includes public tables)');

  let totalMigrated = 0;
  let totalFailed = 0;

  for (const table of TABLES) {
    const count = sqlite.prepare(`SELECT count(*) as cnt FROM ${table.name}`).get().cnt;
    if (count === 0) {
      console.log(`  ${table.name}: 0 rows, skip`);
      continue;
    }

    if (dryRun) {
      console.log(`  ${table.name}: ${count} rows (dry-run, skip)`);
      totalMigrated += count;
      continue;
    }

    const rows = sqlite.prepare(`SELECT ${table.columns.join(', ')} FROM ${table.name}`).all();
    let migrated = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      for (const row of batch) {
        const values = table.columns.map(c => row[c] ?? null);
        const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
        const sql = `INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
        try {
          await pg.query(sql, values);
          migrated++;
        } catch (e) {
          failed++;
          if (failed <= 3) console.error(`    FAIL ${table.name}: ${e.message}`);
        }
      }
    }

    console.log(`  ${table.name}: ${migrated}/${count} migrated${failed ? `, ${failed} failed` : ''}`);
    totalMigrated += migrated;
    totalFailed += failed;
  }

  console.log(`\n[migrate-public] Done: ${totalMigrated} migrated, ${totalFailed} failed`);

  await pg.end();
  sqlite.close();
  await pgAdapter.closePools();
}

main().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
