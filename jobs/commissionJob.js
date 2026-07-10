const { nanoid } = require('nanoid');
const { makeGrid, toDateString, toNumber } = require('./grid');
const dbAdapter = require('../services/dbAdapter');

const RATES = { '活跃': 0.005, '正常': 0.003, '沉淀': 0.001 };

function monthPrefix(date) {
  return String(date || '').slice(0, 7);
}

async function upsertLedger(row) {
  const id = nanoid();
  await dbAdapter.runAsync(`
    INSERT INTO commission_ledger
      (id,base_id,batch_no,business_date,order_record_id,lock_record_id,side,channel_record_id,product_record_id,snapshot_profit,rate,amount,type,original_ledger_id,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `, [id, row.baseId, row.batchNo, row.businessDate, row.orderRecordId, row.lockRecordId, row.side, row.channelRecordId, row.productRecordId || '', row.snapshotProfit, row.rate, row.amount, row.type, row.originalLedgerId || null, Date.now()]);
  return dbAdapter.queryOneAsync(`
    SELECT * FROM commission_ledger
    WHERE base_id=$1 AND batch_no=$2 AND order_record_id=$3 AND lock_record_id=$4 AND side=$5 AND type=$6
  `, [row.baseId, row.batchNo, row.orderRecordId, row.lockRecordId, row.side, row.type]);
}

async function recomputeBonuses(grid, baseId, lockIds, lf, businessDate, userId) {
  const month = monthPrefix(businessDate);
  for (const lockId of new Set(lockIds.filter(Boolean))) {
    const todayRow = await dbAdapter.queryOneAsync('SELECT COALESCE(SUM(amount),0) AS v FROM commission_ledger WHERE base_id=$1 AND lock_record_id=$2 AND business_date=$3', [baseId, lockId, businessDate]);
    const today = todayRow.v;
    const monthRow = await dbAdapter.queryOneAsync('SELECT COALESCE(SUM(amount),0) AS v FROM commission_ledger WHERE base_id=$1 AND lock_record_id=$2 AND business_date LIKE $3', [baseId, lockId, `${month}-%`]);
    const monthTotal = monthRow.v;
    const totalRow = await dbAdapter.queryOneAsync('SELECT COALESCE(SUM(amount),0) AS v FROM commission_ledger WHERE base_id=$1 AND lock_record_id=$2', [baseId, lockId]);
    const total = totalRow.v;
    const detailsRows = await dbAdapter.queryAsync(`
      SELECT order_record_id, side, amount, type FROM commission_ledger
      WHERE base_id=$1 AND lock_record_id=$2 AND business_date=$3
      ORDER BY created_at, id
    `, [baseId, lockId, businessDate]);
    const details = detailsRows.map(r => `${r.type}/${r.side}/${r.order_record_id}/${Math.round(r.amount * 100) / 100}`).join('\n');
    if (lf['今日奖金']) await grid.setCell(lockId, lf['今日奖金'].id, Math.round(today * 100) / 100, userId);
    if (lf['月度奖金']) await grid.setCell(lockId, lf['月度奖金'].id, Math.round(monthTotal * 100) / 100, userId);
    if (lf['累计奖金']) await grid.setCell(lockId, lf['累计奖金'].id, Math.round(total * 100) / 100, userId);
    if (lf['奖金明细']) await grid.setCell(lockId, lf['奖金明细'].id, details, userId);
  }
}

async function writeSnapshots(grid, order, of, userId) {
  const snapshotProfit = await grid.cell(order.id, of['快照毛利']?.id);
  const snapshotReceived = await grid.cell(order.id, of['快照实收']?.id);
  if (snapshotProfit !== '' || snapshotReceived !== '') return;
  const fs = Object.values(of);
  const profit = await grid.value(order, of['毛利'], fs);
  const received = await grid.value(order, of['实收金额'], fs);
  const paid = await grid.value(order, of['实付金额'], fs);
  const productId = await grid.firstLinked(order.id, of['产品']?.id);
  const payerId = await grid.firstLinked(order.id, of['付款方']?.id);
  const payeeId = await grid.firstLinked(order.id, of['收款方']?.id);
  if (of['快照毛利']) await grid.setCell(order.id, of['快照毛利'].id, profit, userId);
  if (of['快照实收']) await grid.setCell(order.id, of['快照实收'].id, received, userId);
  if (of['快照实付']) await grid.setCell(order.id, of['快照实付'].id, paid, userId);
  if (of['快照产品名']) await grid.setCell(order.id, of['快照产品名'].id, await grid.displayRecord(productId, ['标题', '产品ID']), userId);
  if (of['快照付款方名']) await grid.setCell(order.id, of['快照付款方名'].id, await grid.displayRecord(payerId, ['代码', '企业名称']), userId);
  if (of['快照收款方名']) await grid.setCell(order.id, of['快照收款方名'].id, await grid.displayRecord(payeeId, ['代码', '企业名称']), userId);
}

// ---------- 预加载辅助函数 ----------

/**
 * 预加载所有记录的 cells 到内存 Map
 * key: "recordId:fieldId" → value
 */
async function preloadCellMap(recordIds) {
  if (!recordIds.length) return new Map();
  const placeholders = recordIds.map((_, i) => `$${i + 1}`).join(',');
  const rows = await dbAdapter.queryAsync(
    `SELECT record_id, field_id, value FROM cells WHERE record_id IN (${placeholders})`,
    recordIds
  );
  const map = new Map();
  for (const r of rows) {
    map.set(`${r.record_id}:${r.field_id}`, r.value || '');
  }
  return map;
}

/**
 * 预加载所有记录的 links 到内存 Map
 * key: "recordId:fieldId" → 第一个关联记录 ID（空字符串 if none）
 */
async function preloadLinkMap(recordIds) {
  if (!recordIds.length) return new Map();
  const placeholders = recordIds.map((_, i) => `$${i + 1}`).join(',');
  const rows = await dbAdapter.queryAsync(
    `SELECT l1.from_record_id, l1.field_id, l1.to_record_id
     FROM links l1
     JOIN (SELECT from_record_id, field_id, MIN(created_at) AS min_created FROM links WHERE from_record_id IN (${placeholders}) GROUP BY from_record_id, field_id) l2
       ON l1.from_record_id = l2.from_record_id AND l1.field_id = l2.field_id AND l1.created_at = l2.min_created`,
    recordIds
  );
  const map = new Map();
  for (const r of rows) {
    const key = `${r.from_record_id}:${r.field_id}`;
    if (!map.has(key)) map.set(key, r.to_record_id);
  }
  return map;
}

function cellVal(cellMap, recordId, fieldId) {
  if (!fieldId) return '';
  return cellMap.get(`${recordId}:${fieldId}`) || '';
}

function firstLinkVal(linkMap, recordId, fieldId) {
  if (!fieldId) return '';
  return linkMap.get(`${recordId}:${fieldId}`) || '';
}

// ---------- 改造后的函数 ----------

/**
 * 基于预加载数据查询 latestEffectiveLock，避免 N+1
 */
function latestEffectiveLockFast(locks, lf, cellMap, lockLinkMap, { side, channelId, productId, singleProduct }) {
  const candidates = [];
  for (const lock of locks) {
    if (cellVal(cellMap, lock.id, lf['判断']?.id) !== '关联') continue;
    const approvalResult = cellVal(cellMap, lock.id, lf['审批结果']?.id);
    if (approvalResult && approvalResult !== '已通过') continue;
    if (cellVal(cellMap, lock.id, lf['合作关系']?.id) !== side) continue;
    if (cellVal(cellMap, lock.id, lf['资源状态']?.id) === '已解绑') continue;
    const group = cellVal(cellMap, lock.id, lf['分组']?.id);
    if (singleProduct && group !== '单品合作区') continue;
    if (!singleProduct && group !== '渠道负责区') continue;
    if (firstLinkVal(lockLinkMap, lock.id, lf['合作渠道']?.id) !== channelId) continue;
    if (group === '单品合作区' && firstLinkVal(lockLinkMap, lock.id, lf['商品']?.id) !== productId) continue;
    candidates.push(lock);
  }
  candidates.sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0));
  return candidates[0] || null;
}

async function runCommissionJob({ baseId, businessDate, dryRun = true, userId = null }) {
  const grid = await makeGrid();
  let orderTable = await grid.table(baseId, '订单管理区');
  if (!orderTable) orderTable = await grid.table(baseId, '销售订单表');
  let lockTable = await grid.table(baseId, '业务锁定区');
  if (!lockTable) lockTable = await grid.table(baseId, '结算表');
  if (!orderTable) throw new Error('订单管理区或销售订单表不存在');
  if (!lockTable) throw new Error('业务锁定区或结算表不存在');
  const of = await grid.fieldsByName(orderTable.id);
  const lf = await grid.fieldsByName(lockTable.id);
  const orders = await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1 ORDER BY created_at, id', [orderTable.id]);
  const locks = await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1 ORDER BY updated_at, created_at, id', [lockTable.id]);
  const batchNo = `COMM-${businessDate.replace(/-/g, '')}`;

  // ========== 预加载：减少 N+1 ==========
  const orderIds = orders.map(o => o.id);
  const lockIds = locks.map(l => l.id);
  const orderCellMap = await preloadCellMap(orderIds);
  const orderLinkMap = await preloadLinkMap(orderIds);
  const lockCellMap = await preloadCellMap(lockIds);
  const lockLinkMap = await preloadLinkMap(lockIds);

  const generated = [];
  const touchedLocks = [];
  const skipped = [];
  for (const order of orders) {
    if (cellVal(orderCellMap, order.id, of['分区']?.id) !== '完结区') continue;
    if (toDateString(cellVal(orderCellMap, order.id, of['财务付款时间']?.id)) !== businessDate) continue;
    if (cellVal(orderCellMap, order.id, of['订单状态']?.id) === '已取消') continue;
    if (cellVal(orderCellMap, order.id, of['佣金已结算']?.id) === 'true') continue;
    const reason = cellVal(orderCellMap, order.id, of['事由']?.id);
    if (reason === '退款') {
      const originalId = firstLinkVal(orderLinkMap, order.id, of['原订单']?.id);
      if (!originalId) { skipped.push({ orderId: order.id, reason: '退款订单缺少原订单' }); continue; }
      const originals = await dbAdapter.queryAsync("SELECT * FROM commission_ledger WHERE base_id=$1 AND order_record_id=$2 AND type='normal'", [baseId, originalId]);
      for (const old of originals) {
        generated.push({ baseId, batchNo, businessDate, orderRecordId: order.id, lockRecordId: old.lock_record_id, side: old.side, channelRecordId: old.channel_record_id, productRecordId: old.product_record_id, snapshotProfit: old.snapshot_profit, rate: old.rate, amount: -old.amount, type: 'refund_reverse', originalLedgerId: old.id });
        touchedLocks.push(old.lock_record_id);
      }
      continue;
    }
    const productId = firstLinkVal(orderLinkMap, order.id, of['产品']?.id);
    const payerId = firstLinkVal(orderLinkMap, order.id, of['付款方']?.id);
    const payeeId = firstLinkVal(orderLinkMap, order.id, of['收款方']?.id);
    const profit = toNumber(cellVal(orderCellMap, order.id, of['快照毛利']?.id) || await grid.value(order, of['毛利'], Object.values(of)));
    if (!payerId && !payeeId) { skipped.push({ orderId: order.id, reason: '缺少付款方和收款方' }); continue; }
    for (const sideInfo of [{ side: '客户', channelId: payerId }, { side: '供应商', channelId: payeeId }]) {
      if (!sideInfo.channelId) continue;
      const single = latestEffectiveLockFast(locks, lf, lockCellMap, lockLinkMap, { side: sideInfo.side, channelId: sideInfo.channelId, productId, singleProduct: true });
      const channel = latestEffectiveLockFast(locks, lf, lockCellMap, lockLinkMap, { side: sideInfo.side, channelId: sideInfo.channelId, productId, singleProduct: false });
      for (const lock of [single, channel].filter(Boolean)) {
        const status = cellVal(lockCellMap, lock.id, lf['资源状态']?.id);
        const rate = RATES[status] || 0;
        if (!rate) continue;
        generated.push({ baseId, batchNo, businessDate, orderRecordId: order.id, lockRecordId: lock.id, side: sideInfo.side, channelRecordId: sideInfo.channelId, productRecordId: productId || '', snapshotProfit: profit, rate, amount: Math.round(profit * rate * 100) / 100, type: 'normal' });
        touchedLocks.push(lock.id);
      }
    }
  }
  if (!dryRun) {
    await dbAdapter.transactionAsync(async () => {
      const settledOrders = new Set(generated.map(r => r.orderRecordId));
      for (const orderId of settledOrders) {
        const order = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [orderId]);
        await writeSnapshots(grid, order, of, userId);
      }
      for (const row of generated) await upsertLedger(row);
      await recomputeBonuses(grid, baseId, touchedLocks, lf, businessDate, userId);
      for (const orderId of settledOrders) {
        if (of['佣金已结算']) await grid.setCell(orderId, of['佣金已结算'].id, 'true', userId);
        if (of['佣金结算批次']) await grid.setCell(orderId, of['佣金结算批次'].id, batchNo, userId);
      }
    });
  }
  return {
    scannedCount: orders.length,
    changedCount: generated.length,
    summary: { businessDate, batchNo, dryRun, generatedCount: generated.length, generated, skipped },
  };
}

module.exports = { runCommissionJob, upsertLedger, recomputeBonuses, writeSnapshots, latestEffectiveLock: latestEffectiveLockFast };