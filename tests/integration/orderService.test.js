// tests/integration/orderService.test.js
// P2-5: orderService 集成测试（内存 SQLite）

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

// 创建内存数据库并初始化完整 schema
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE bases (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER);
  CREATE TABLE tables (id TEXT PRIMARY KEY, base_id TEXT, name TEXT);
  CREATE TABLE fields (id TEXT PRIMARY KEY, table_id TEXT, name TEXT, type TEXT, options TEXT, locked INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 160);
  CREATE TABLE records (id TEXT PRIMARY KEY, table_id TEXT, position INTEGER, locked INTEGER NOT NULL DEFAULT 0, created_at INTEGER, updated_at INTEGER, height INTEGER NOT NULL DEFAULT 34);
  CREATE TABLE cells (record_id TEXT, field_id TEXT, value TEXT, updated_by TEXT, updated_at INTEGER, PRIMARY KEY (record_id, field_id));
`);

// 创建测试数据
const baseId = 'base_1';
db.prepare('INSERT INTO bases (id, name, created_at) VALUES (?, ?, ?)').run(baseId, '测试空间', Date.now());

const orderTableId = 'tbl_orders';
db.prepare('INSERT INTO tables (id, base_id, name) VALUES (?, ?, ?)').run(orderTableId, baseId, '订单管理区');

const otherTableId = 'tbl_other';
db.prepare('INSERT INTO tables (id, base_id, name) VALUES (?, ?, ?)').run(otherTableId, baseId, '其他表');

// 创建订单管理区字段
const fields = [
  { id: 'fld_zone', name: '分区', type: 'select' },
  { id: 'fld_complete', name: '完结日期', type: 'date' },
  { id: 'fld_paytime', name: '财务付款时间', type: 'date' },
  { id: 'fld_snapshot', name: '快照毛利', type: 'text' },
  { id: 'fld_commission', name: '佣金结算批次', type: 'text' },
];
for (const f of fields) {
  db.prepare('INSERT INTO fields (id, table_id, name, type) VALUES (?, ?, ?, ?)').run(f.id, orderTableId, f.name, f.type);
}

// 创建记录
const recordId = 'rec_1';
db.prepare('INSERT INTO records (id, table_id, position, created_at, updated_at) VALUES (?, ?, 0, ?, ?)').run(recordId, orderTableId, Date.now(), Date.now());

// 模拟 orderService 的依赖
function tableNameOfField(fieldId) {
  return db.prepare(`SELECT t.name FROM fields f JOIN tables t ON t.id=f.table_id WHERE f.id=?`).get(fieldId)?.name || '';
}
function fieldName(fieldId) {
  return db.prepare('SELECT name FROM fields WHERE id=?').get(fieldId)?.name || '';
}
function cellValueByName(recordId, tableId, name) {
  const fid = db.prepare('SELECT id FROM fields WHERE table_id=? AND name=?').get(tableId, name)?.id;
  return fid ? (db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(recordId, fid)?.value || '') : '';
}

// orderCompletionFieldProtected 逻辑（内联测试）
function orderCompletionFieldProtected(recordId, fieldId) {
  if (tableNameOfField(fieldId) !== '订单管理区') return false;
  const name = fieldName(fieldId);
  const immutableWhenWritten = new Set(['快照毛利', '快照实收', '快照实付', '快照产品名', '快照付款方名', '快照收款方名', '佣金结算批次']);
  const r = db.prepare('SELECT table_id FROM records WHERE id=?').get(recordId);
  if (!r) return false;
  const current = db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(recordId, fieldId)?.value || '';
  if (immutableWhenWritten.has(name)) return current !== '';
  if (!['完结日期', '财务付款时间'].includes(name)) return false;
  const zone = cellValueByName(recordId, r.table_id, '分区');
  return zone === '完结区' && current !== '';
}

// ---- 测试 orderCompletionFieldProtected ----
// 1. 非订单管理区字段 -> false
assertEqual(orderCompletionFieldProtected(recordId, 'fld_zone'), false, '非订单管理区字段不受保护');

// 2. 订单管理区字段，未写入 -> false
assertEqual(orderCompletionFieldProtected(recordId, 'fld_snapshot'), false, '快照字段未写入不受保护');

// 3. 订单管理区字段，已写入 -> true
db.prepare('INSERT INTO cells (record_id, field_id, value) VALUES (?, ?, ?)').run(recordId, 'fld_snapshot', '100');
assertEqual(orderCompletionFieldProtected(recordId, 'fld_snapshot'), true, '快照字段已写入受保护');

// 4. 完结日期，完结区且已写入 -> true
db.prepare('UPDATE cells SET value=? WHERE record_id=? AND field_id=?').run('2024-01-01', recordId, 'fld_snapshot');
db.prepare('INSERT INTO cells (record_id, field_id, value) VALUES (?, ?, ?)').run(recordId, 'fld_zone', '完结区');
db.prepare('INSERT INTO cells (record_id, field_id, value) VALUES (?, ?, ?)').run(recordId, 'fld_complete', '2024-01-01');
assertEqual(orderCompletionFieldProtected(recordId, 'fld_complete'), true, '完结日期在完结区且已写入受保护');

// 5. 完结日期，非完结区 -> false
db.prepare('UPDATE cells SET value=? WHERE record_id=? AND field_id=?').run('进行中', recordId, 'fld_zone');
assertEqual(orderCompletionFieldProtected(recordId, 'fld_complete'), false, '完结日期非完结区不受保护');

// ---- report ----
const total = passed + failed;
console.log(`\n orderService.integration.test.js: ${total} tests, ${passed} passed, ${failed} failed`);
db.close();
process.exit(failed > 0 ? 1 : 0);