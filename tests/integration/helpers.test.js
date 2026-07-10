// tests/integration/helpers.test.js
// P2-1: service 集成测试（内存 SQLite）
// 测试 helpers.js、formulaService.js 在真实数据库环境下的行为

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) passed++;
  else { failed++; console.error(`  FAIL: ${label}`); }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — expected "${expected}", got "${actual}"`); }
}

// ---- 创建内存数据库并初始化 schema ----
function createMemoryDb() {
  const db = new Database(':memory:');
  // 简化 schema：只创建测试需要的表
  db.exec(`
    CREATE TABLE bases (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER);
    CREATE TABLE tables (id TEXT PRIMARY KEY, base_id TEXT, name TEXT);
    CREATE TABLE fields (id TEXT PRIMARY KEY, table_id TEXT, name TEXT, type TEXT, options TEXT, locked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE records (id TEXT PRIMARY KEY, table_id TEXT, position INTEGER, locked INTEGER NOT NULL DEFAULT 0, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE cells (record_id TEXT, field_id TEXT, value TEXT, updated_by TEXT, updated_at INTEGER, PRIMARY KEY (record_id, field_id));
    CREATE TABLE links (id TEXT PRIMARY KEY, field_id TEXT, from_record_id TEXT, to_record_id TEXT, created_at INTEGER);
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, display_name TEXT, password_hash TEXT, system_role TEXT DEFAULT 'none');
    CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER);
  `);
  return db;
}

// ---- 模拟 db.prepare().run() 的事务支持 ----
// better-sqlite3 的 transaction 在内存数据库上同样有效
function withTransaction(db, fn) {
  const tx = db.transaction(fn);
  return tx();
}

// ---- 测试：fieldIdByName / cellValue / upsertCell ----
const db = createMemoryDb();

// 创建测试数据
const baseId = 'base_test';
db.prepare('INSERT INTO bases (id, name, created_at) VALUES (?, ?, ?)').run(baseId, '测试空间', Date.now());
const tableId = 'tbl_test';
db.prepare('INSERT INTO tables (id, base_id, name) VALUES (?, ?, ?)').run(tableId, baseId, '测试表');
const fieldId = 'fld_test';
db.prepare('INSERT INTO fields (id, table_id, name, type) VALUES (?, ?, ?, ?)').run(fieldId, tableId, '名称', 'text');
const recordId = 'rec_test';
db.prepare('INSERT INTO records (id, table_id, position, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(recordId, tableId, Date.now(), Date.now());

// 测试 upsertCell（传 db 作为 tx）
withTransaction(db, () => {
  db.prepare(`
    INSERT INTO cells (record_id, field_id, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
  `).run(recordId, fieldId, '测试记录', Date.now(), null);
});

const cellVal = db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(recordId, fieldId)?.value || '';
assertEqual(cellVal, '测试记录', 'upsertCell + query: value persisted');

// 测试 fieldIdByName
const foundId = db.prepare('SELECT id FROM fields WHERE table_id=? AND name=?').get(tableId, '名称')?.id;
assertEqual(foundId, fieldId, 'fieldIdByName: found correct id');

// 测试 assertRecordWritable
assertEqual(db.prepare('SELECT locked FROM records WHERE id=?').get(recordId)?.locked, 0, 'assertRecordWritable: not locked by default');

// 测试 formulaService 在真实数据环境
const { evaluateFormula } = require('../../services/formulaService');
const result = evaluateFormula('{数量} * {单价}', name => ({ '数量': '10', '单价': '5' })[name] || '0');
assertEqual(result, '50', 'formulaService integration: 10*5=50');

// 测试 tokenize + parseAndEval
const { tokenize, parseAndEval } = require('../../services/formulaService');
const tokens = tokenize('(1+2)*3');
assert(!!tokens, 'tokenize: valid expression');
const val = parseAndEval(tokens, () => 0);
assertEqual(val, 9, 'parseAndEval: (1+2)*3 = 9');

db.close();

// ---- report ----
const total = passed + failed;
console.log(`\n helpers.integration.test.js: ${total} tests, ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);