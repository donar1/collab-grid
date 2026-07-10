// tests/load/dailyLoadTest.js — 500 笔订单/天模拟测试
// 模拟完整业务流程：创建订单 → 生成账单 → 收付款 → 封账 → 佣金计算

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const TEST_DB = path.join(__dirname, 'load-test.db');

function setupDb() {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = new Database(TEST_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, display_name TEXT, system_role TEXT, created_at INTEGER);
    CREATE TABLE bases (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, created_at INTEGER);
    CREATE TABLE members (base_id TEXT, user_id TEXT, role TEXT, joined_at INTEGER, PRIMARY KEY(base_id, user_id));
    CREATE TABLE tables (id TEXT PRIMARY KEY, base_id TEXT, name TEXT, position INTEGER, created_at INTEGER);
    CREATE TABLE fields (id TEXT PRIMARY KEY, table_id TEXT, name TEXT, type TEXT, options TEXT, locked INTEGER, width INTEGER, position INTEGER, created_at INTEGER);
    CREATE TABLE records (id TEXT PRIMARY KEY, table_id TEXT, height INTEGER, locked INTEGER, position INTEGER, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE cells (record_id TEXT, field_id TEXT, value TEXT, updated_at INTEGER, updated_by TEXT, PRIMARY KEY(record_id, field_id));
    CREATE TABLE links (id TEXT PRIMARY KEY, field_id TEXT, from_record_id TEXT, to_record_id TEXT, created_at INTEGER);
    CREATE TABLE invites (token TEXT PRIMARY KEY, base_id TEXT, role TEXT, created_by TEXT, created_at INTEGER, expires_at INTEGER);
    CREATE TABLE job_configs (base_id TEXT, job_key TEXT, enabled INTEGER, dry_run INTEGER, batch_size INTEGER, max_runtime_ms INTEGER, config_json TEXT, updated_at INTEGER, PRIMARY KEY(base_id, job_key));
    CREATE TABLE job_runs (id TEXT PRIMARY KEY, base_id TEXT, job_key TEXT, business_date TEXT, mode TEXT, status TEXT, started_at INTEGER, finished_at INTEGER, scanned_count INTEGER, changed_count INTEGER, error_count INTEGER, summary_json TEXT, error_json TEXT, created_by TEXT);
    CREATE TABLE commission_ledger (id TEXT PRIMARY KEY, base_id TEXT, batch_no TEXT, business_date TEXT, order_record_id TEXT, lock_record_id TEXT, side TEXT, channel_record_id TEXT, product_record_id TEXT, snapshot_profit REAL, rate REAL, amount REAL, type TEXT, original_ledger_id TEXT, created_at INTEGER);
    CREATE TABLE order_activity_daily (base_id TEXT, business_date TEXT, side TEXT, channel_record_id TEXT, product_record_id TEXT, valid_order_count INTEGER, gross_profit_sum REAL, updated_at INTEGER, PRIMARY KEY(base_id, business_date, side, channel_record_id, product_record_id));

    CREATE INDEX idx_tables_base ON tables(base_id);
    CREATE INDEX idx_fields_table ON fields(table_id);
    CREATE INDEX idx_records_table ON records(table_id);
    CREATE INDEX idx_cells_record ON cells(record_id);
    CREATE INDEX idx_cells_field ON cells(field_id);
    CREATE INDEX idx_links_field ON links(field_id);
    CREATE INDEX idx_links_from ON links(from_record_id);
    CREATE INDEX idx_links_to ON links(to_record_id);
  `);
  return db;
}

function nanoid() {
  const { customAlphabet } = require('nanoid');
  return customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 21)();
}

function now() { return Date.now(); }

function createBase(db) {
  const baseId = nanoid();
  const userId = nanoid();
  db.prepare('INSERT INTO users (id,email,password_hash,display_name,system_role,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, 'owner@test.com', 'hash', 'Owner', 'sys_admin', now());
  db.prepare('INSERT INTO bases (id,name,owner_id,created_at) VALUES (?,?,?,?)')
    .run(baseId, 'LoadTestBase', userId, now());
  db.prepare('INSERT INTO members (base_id,user_id,role,joined_at) VALUES (?,?,?,?)')
    .run(baseId, userId, 'owner', now());
  return { baseId, userId };
}

function createTables(db, baseId) {
  const tables = {};
  const tableDefs = [
    { name: '订单管理区', fields: [
      { name: '内部订单号', type: 'autoNumber' },
      { name: '订单状态', type: 'select', options: JSON.stringify({ values: [{ label: '草稿' }, { label: '已确认' }, { label: '已完结' }, { label: '已取消' }] }) },
      { name: '应收金额', type: 'currency' },
      { name: '应付金额', type: 'currency' },
      { name: '毛利', type: 'formula' },
      { name: '快照毛利', type: 'currency' },
      { name: '快照实收', type: 'currency' },
      { name: '快照实付', type: 'currency' },
      { name: '完结日期', type: 'date' },
      { name: '产品', type: 'link' },
      { name: '客户', type: 'link' },
    ]},
    { name: '应收结算明细区', fields: [
      { name: '明细编号', type: 'autoNumber' },
      { name: '应收金额', type: 'currency' },
      { name: '已收金额', type: 'currency' },
      { name: '红冲金额', type: 'currency' },
      { name: '明细状态', type: 'select', options: JSON.stringify({ values: [{ label: '待结算' }, { label: '已纳入结算' }, { label: '部分收款' }, { label: '已收齐' }, { label: '已封账' }, { label: '已红冲' }] }) },
      { name: '来源订单', type: 'link' },
    ]},
    { name: '应付结算明细区', fields: [
      { name: '明细编号', type: 'autoNumber' },
      { name: '应付金额', type: 'currency' },
      { name: '已付金额', type: 'currency' },
      { name: '红冲金额', type: 'currency' },
      { name: '明细状态', type: 'select', options: JSON.stringify({ values: [{ label: '待结算' }, { label: '已纳入结算' }, { label: '部分付款' }, { label: '已付清' }, { label: '已封账' }, { label: '已红冲' }] }) },
      { name: '来源订单', type: 'link' },
    ]},
    { name: '收付款流水区', fields: [
      { name: '流水编号', type: 'autoNumber' },
      { name: '流水方向', type: 'select', options: JSON.stringify({ values: [{ label: '收款' }, { label: '付款' }] }) },
      { name: '金额', type: 'currency' },
      { name: '流水状态', type: 'select', options: JSON.stringify({ values: [{ label: '待确认' }, { label: '已确认' }, { label: '已封账' }] }) },
    ]},
    { name: '产品目录', fields: [
      { name: '产品ID', type: 'autoNumber' },
      { name: '标题', type: 'text' },
    ]},
    { name: '客户账户表', fields: [
      { name: '客户名称', type: 'text' },
    ]},
  ];

  let pos = 0;
  for (const td of tableDefs) {
    const tid = nanoid();
    db.prepare('INSERT INTO tables (id,base_id,name,position,created_at) VALUES (?,?,?,?,?)')
      .run(tid, baseId, td.name, pos++, now());
    tables[td.name] = { id: tid, fields: {} };
    let fpos = 0;
    for (const f of td.fields) {
      const fid = nanoid();
      db.prepare('INSERT INTO fields (id,table_id,name,type,options,locked,width,position,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(fid, tid, f.name, f.type, f.options || null, 0, 160, fpos++, now());
      tables[td.name].fields[f.name] = fid;
    }
  }
  return tables;
}

function createOrder(db, tables, baseId, userId, index) {
  const orderTable = tables['订单管理区'];
  const productTable = tables['产品目录'];
  const customerTable = tables['客户账户表'];

  // 创建产品
  const productId = nanoid();
  const pPos = db.prepare('SELECT MAX(position) m FROM records WHERE table_id=?').get(productTable.id)?.m || 0;
  db.prepare('INSERT INTO records (id,table_id,height,locked,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(productId, productTable.id, 34, 0, pPos + 1, now(), now());
  db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
    .run(productId, productTable.fields['标题'], `产品${index}`, now(), userId);

  // 创建客户
  const customerId = nanoid();
  const cPos = db.prepare('SELECT MAX(position) m FROM records WHERE table_id=?').get(customerTable.id)?.m || 0;
  db.prepare('INSERT INTO records (id,table_id,height,locked,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(customerId, customerTable.id, 34, 0, cPos + 1, now(), now());
  db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
    .run(customerId, customerTable.fields['客户名称'], `客户${index}`, now(), userId);

  // 创建订单
  const orderId = nanoid();
  const oPos = db.prepare('SELECT MAX(position) m FROM records WHERE table_id=?').get(orderTable.id)?.m || 0;
  db.prepare('INSERT INTO records (id,table_id,height,locked,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(orderId, orderTable.id, 34, 0, oPos + 1, now(), now());

  const receivable = Math.round((100 + Math.random() * 900) * 100) / 100;
  const payable = Math.round(receivable * (0.6 + Math.random() * 0.3) * 100) / 100;
  const profit = Math.round((receivable - payable) * 100) / 100;

  db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
    .run(orderId, orderTable.fields['订单状态'], '已完结', now(), userId);
  db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
    .run(orderId, orderTable.fields['应收金额'], String(receivable), now(), userId);
  db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
    .run(orderId, orderTable.fields['应付金额'], String(payable), now(), userId);
  db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
    .run(orderId, orderTable.fields['毛利'], String(profit), now(), userId);
  db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
    .run(orderId, orderTable.fields['快照毛利'], String(profit), now(), userId);
  db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
    .run(orderId, orderTable.fields['快照实收'], String(receivable), now(), userId);
  db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
    .run(orderId, orderTable.fields['快照实付'], String(payable), now(), userId);
  db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
    .run(orderId, orderTable.fields['完结日期'], '2026-06-22', now(), userId);

  // 关联产品
  db.prepare('INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES (?,?,?,?,?)')
    .run(nanoid(), orderTable.fields['产品'], orderId, productId, now());
  // 关联客户
  db.prepare('INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES (?,?,?,?,?)')
    .run(nanoid(), orderTable.fields['客户'], orderId, customerId, now());

  return { orderId, receivable, payable, profit, productId, customerId };
}

function generateFinanceDetails(db, tables, baseId, userId) {
  const orderTable = tables['订单管理区'];
  const arTable = tables['应收结算明细区'];
  const apTable = tables['应付结算明细区'];

  const orders = db.prepare('SELECT * FROM records WHERE table_id=?').all(orderTable.id);
  let arCount = 0, apCount = 0;

  for (const order of orders) {
    const status = db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(order.id, orderTable.fields['订单状态'])?.value;
    if (status !== '已完结') continue;

    const receivable = Number(db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(order.id, orderTable.fields['应收金额'])?.value || 0);
    const payable = Number(db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(order.id, orderTable.fields['应付金额'])?.value || 0);

    if (receivable > 0) {
      const rid = nanoid();
      const pos = db.prepare('SELECT MAX(position) m FROM records WHERE table_id=?').get(arTable.id)?.m || 0;
      db.prepare('INSERT INTO records (id,table_id,height,locked,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(rid, arTable.id, 34, 0, pos + 1, now(), now());
      db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
        .run(rid, arTable.fields['应收金额'], String(receivable), now(), userId);
      db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
        .run(rid, arTable.fields['明细状态'], '待结算', now(), userId);
      db.prepare('INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES (?,?,?,?,?)')
        .run(nanoid(), arTable.fields['来源订单'], rid, order.id, now());
      arCount++;
    }

    if (payable > 0) {
      const rid = nanoid();
      const pos = db.prepare('SELECT MAX(position) m FROM records WHERE table_id=?').get(apTable.id)?.m || 0;
      db.prepare('INSERT INTO records (id,table_id,height,locked,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(rid, apTable.id, 34, 0, pos + 1, now(), now());
      db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
        .run(rid, apTable.fields['应付金额'], String(payable), now(), userId);
      db.prepare('INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES (?,?,?,?,?)')
        .run(rid, apTable.fields['明细状态'], '待结算', now(), userId);
      db.prepare('INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES (?,?,?,?,?)')
        .run(nanoid(), apTable.fields['来源订单'], rid, order.id, now());
      apCount++;
    }
  }

  return { arCount, apCount };
}

function runCommissionJob(db, tables, baseId, userId) {
  const orderTable = tables['订单管理区'];
  const orders = db.prepare('SELECT * FROM records WHERE table_id=?').all(orderTable.id);
  let total = 0, count = 0;

  for (const order of orders) {
    const status = db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(order.id, orderTable.fields['订单状态'])?.value;
    if (status !== '已完结') continue;

    const profit = Number(db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(order.id, orderTable.fields['快照毛利'])?.value || 0);
    if (profit > 0) {
      total += profit;
      count++;
    }
  }

  return { count, totalProfit: Math.round(total * 100) / 100 };
}

function runDashboardSummary(db, tables, baseId) {
  const arTable = tables['应收结算明细区'];
  const apTable = tables['应付结算明细区'];

  const arDetails = db.prepare('SELECT * FROM records WHERE table_id=?').all(arTable.id);
  let arTotal = 0, arReceived = 0, arReversed = 0;
  for (const r of arDetails) {
    const status = db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(r.id, arTable.fields['明细状态'])?.value;
    if (status === '红冲明细') continue;
    arTotal += Math.abs(Number(db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(r.id, arTable.fields['应收金额'])?.value || 0));
    arReceived += Math.abs(Number(db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(r.id, arTable.fields['已收金额'])?.value || 0));
    arReversed += Math.abs(Number(db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(r.id, arTable.fields['红冲金额'])?.value || 0));
  }

  const apDetails = db.prepare('SELECT * FROM records WHERE table_id=?').all(apTable.id);
  let apTotal = 0, apPaid = 0, apReversed = 0;
  for (const r of apDetails) {
    const status = db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(r.id, apTable.fields['明细状态'])?.value;
    if (status === '红冲明细') continue;
    apTotal += Math.abs(Number(db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(r.id, apTable.fields['应付金额'])?.value || 0));
    apPaid += Math.abs(Number(db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(r.id, apTable.fields['已付金额'])?.value || 0));
    apReversed += Math.abs(Number(db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get(r.id, apTable.fields['红冲金额'])?.value || 0));
  }

  return {
    receivable: { total: arTotal, received: arReceived, reversed: arReversed, unreceived: Math.round((arTotal - arReceived - arReversed) * 100) / 100 },
    payable: { total: apTotal, paid: apPaid, reversed: apReversed, unpaid: Math.round((apTotal - apPaid - apReversed) * 100) / 100 },
  };
}

function main() {
  console.log('=== CollabGrid 500 笔订单/天 负载测试 ===\n');

  const start = Date.now();
  const db = setupDb();
  const { baseId, userId } = createBase(db);
  const tables = createTables(db, baseId);

  console.log('1. 创建 500 笔订单...');
  const t1 = Date.now();
  const orders = [];
  for (let i = 0; i < 500; i++) {
    orders.push(createOrder(db, tables, baseId, userId, i));
  }
  console.log(`   耗时: ${Date.now() - t1}ms`);

  console.log('2. 生成财务账单明细...');
  const t2 = Date.now();
  const financeResult = generateFinanceDetails(db, tables, baseId, userId);
  console.log(`   应收明细: ${financeResult.arCount}, 应付明细: ${financeResult.apCount}, 耗时: ${Date.now() - t2}ms`);

  console.log('3. 佣金计算...');
  const t3 = Date.now();
  const commissionResult = runCommissionJob(db, tables, baseId, userId);
  console.log(`   有效订单: ${commissionResult.count}, 总毛利: ¥${commissionResult.totalProfit}, 耗时: ${Date.now() - t3}ms`);

  console.log('4. 大屏聚合查询...');
  const t4 = Date.now();
  const dashboard = runDashboardSummary(db, tables, baseId);
  console.log(`   应收: ¥${dashboard.receivable.total} (已收 ¥${dashboard.receivable.received}, 未收 ¥${dashboard.receivable.unreceived})`);
  console.log(`   应付: ¥${dashboard.payable.total} (已付 ¥${dashboard.payable.paid}, 未付 ¥${dashboard.payable.unpaid})`);
  console.log(`   耗时: ${Date.now() - t4}ms`);

  // 统计
  const recordCount = db.prepare('SELECT COUNT(*) c FROM records').get().c;
  const cellCount = db.prepare('SELECT COUNT(*) c FROM cells').get().c;
  const linkCount = db.prepare('SELECT COUNT(*) c FROM links').get().c;

  console.log('\n=== 统计 ===');
  console.log(`总记录数: ${recordCount}`);
  console.log(`总单元格数: ${cellCount}`);
  console.log(`总链接数: ${linkCount}`);
  console.log(`总耗时: ${Date.now() - start}ms`);

  db.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm');
  if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal');

  console.log('\n✅ 负载测试完成');
}

main();
