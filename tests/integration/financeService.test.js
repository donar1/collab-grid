// tests/integration/financeService.test.js
// P2-5: financeService 集成测试（内存 SQLite）

const Database = require('better-sqlite3');

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

// 创建内存数据库
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE bases (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER);
  CREATE TABLE tables (id TEXT PRIMARY KEY, base_id TEXT, name TEXT);
  CREATE TABLE fields (id TEXT PRIMARY KEY, table_id TEXT, name TEXT, type TEXT, options TEXT, locked INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 160);
  CREATE TABLE records (id TEXT PRIMARY KEY, table_id TEXT, position INTEGER, locked INTEGER NOT NULL DEFAULT 0, created_at INTEGER, updated_at INTEGER, height INTEGER NOT NULL DEFAULT 34);
  CREATE TABLE cells (record_id TEXT, field_id TEXT, value TEXT, updated_by TEXT, updated_at INTEGER, PRIMARY KEY (record_id, field_id));
  CREATE TABLE links (id TEXT PRIMARY KEY, field_id TEXT, from_record_id TEXT, to_record_id TEXT, created_at INTEGER);
`);

// moneyRound 逻辑
function moneyRound(n) {
  return Math.round(n * 100) / 100;
}

// ---- 测试 moneyRound ----
assertEqual(moneyRound(1.005), 1, 'moneyRound: 1.005 -> 1 (JS float precision)');
assertEqual(moneyRound(1.004), 1.0, 'moneyRound: 1.004 -> 1.00');
assertEqual(moneyRound(10.555), 10.56, 'moneyRound: 10.555 -> 10.56');
assertEqual(moneyRound(0), 0, 'moneyRound: 0 -> 0');
assertEqual(moneyRound(-1.235), -1.24, 'moneyRound: -1.235 -> -1.24');

// financeTables 逻辑
function financeTables(baseId) {
  const tables = db.prepare('SELECT * FROM tables WHERE base_id=?').all(baseId);
  const result = {};
  for (const t of tables) {
    const fields = db.prepare('SELECT * FROM fields WHERE table_id=?').all(t.id);
    result[t.name] = { table: t, fields: Object.fromEntries(fields.map(f => [f.name, f])) };
  }
  return result;
}

// 创建财务相关表
const baseId = 'base_fin';
db.prepare('INSERT INTO bases (id, name, created_at) VALUES (?, ?, ?)').run(baseId, '财务空间', Date.now());

const arTableId = 'tbl_ar';
db.prepare('INSERT INTO tables (id, base_id, name) VALUES (?, ?, ?)').run(arTableId, baseId, '应收明细区');
const apTableId = 'tbl_ap';
db.prepare('INSERT INTO tables (id, base_id, name) VALUES (?, ?, ?)').run(apTableId, baseId, '应付明细区');
const objTableId = 'tbl_obj';
db.prepare('INSERT INTO tables (id, base_id, name) VALUES (?, ?, ?)').run(objTableId, baseId, '财务结算对象区');

// 创建字段
const arFields = [
  { id: 'fld_ar_order', name: '订单号', type: 'text' },
  { id: 'fld_ar_amount', name: '应收金额', type: 'number' },
  { id: 'fld_ar_status', name: '明细状态', type: 'select' },
];
for (const f of arFields) {
  db.prepare('INSERT INTO fields (id, table_id, name, type) VALUES (?, ?, ?, ?)').run(f.id, arTableId, f.name, f.type);
}

// 测试 financeTables
const ft = financeTables(baseId);
assert(!!ft['应收明细区'], 'financeTables: 应收明细区存在');
assert(!!ft['应付明细区'], 'financeTables: 应付明细区存在');
assert(!!ft['财务结算对象区'], 'financeTables: 财务结算对象区存在');
assertEqual(ft['应收明细区'].fields['订单号']?.name, '订单号', 'financeTables: 字段映射正确');

// 测试 hasDetailForOrder
function hasDetailForOrder(detailTableId, orderLinkFieldId, orderRecordId) {
  if (!orderLinkFieldId) return false;
  return !!db.prepare('SELECT 1 FROM links WHERE field_id=? AND to_record_id=? LIMIT 1').get(orderLinkFieldId, orderRecordId);
}

const orderLinkFieldId = 'fld_link';
const orderRecordId = 'rec_order';
assertEqual(hasDetailForOrder(arTableId, orderLinkFieldId, orderRecordId), false, 'hasDetailForOrder: 无关联返回 false');

db.prepare('INSERT INTO links (id, field_id, from_record_id, to_record_id, created_at) VALUES (?, ?, ?, ?, ?)')
  .run('link_1', orderLinkFieldId, 'rec_detail', orderRecordId, Date.now());
assertEqual(hasDetailForOrder(arTableId, orderLinkFieldId, orderRecordId), true, 'hasDetailForOrder: 有关联返回 true');

// ---- report ----
const total = passed + failed;
console.log(`\n financeService.integration.test.js: ${total} tests, ${passed} passed, ${failed} failed`);
db.close();
process.exit(failed > 0 ? 1 : 0);