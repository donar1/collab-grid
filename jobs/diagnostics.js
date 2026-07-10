const { makeGrid, toDateString } = require('./grid');
const dbAdapter = require('../services/dbAdapter');

function issue(code, severity, title, rows, suggest) {
  return {
    code,
    severity,
    title,
    message: title,
    type: code,
    count: rows.length,
    samples: rows.slice(0, 20),
    suggest,
  };
}

// Field name mapping: common field names used by different templates
// Each entry tries names in order, returns the first matching field ID or null
const FIELD_MAP = {
  // 销售订单表
  zone:       ['分区', '区域'],
  paidAt:     ['财务付款时间', '付款时间'],
  status:     ['订单状态'],
  reason:     ['事由', '原因'],
  settled:    ['佣金已结算', '已结算'],
  batch:      ['佣金结算批次', '结算批次'],
  snapshot:   ['快照毛利', '毛利快照', '订单毛利', '毛利'],
  snapshotReceived:  ['快照实收', '实收快照', '实收'],
  snapshotPaid:      ['快照实付', '实付快照', '实付'],
  snapshotProduct:   ['快照产品名', '产品快照', '产品名'],
  snapshotPayer:     ['快照付款方名', '付款方快照', '付款方'],
  snapshotPayee:     ['快照收款方名', '收款方快照', '收款方'],
  // 结算表
  resourceStatus: ['资源状态', '结算状态'],
  // 关联字段
  originalOrder: ['原订单', '关联订单', '原始订单'],
};

async function getFieldId(grid, fieldsByName, name) {
  const candidates = FIELD_MAP[name] || [name];
  for (const c of candidates) {
    const f = fieldsByName[c];
    if (f) return f.id;
  }
  return null;
}

async function runDiagnostics({ baseId, businessDate = '' }) {
  const grid = await makeGrid();
  const issues = [];
  // Try legacy names first, then fallback to business-core template names
  let orderTable = await grid.table(baseId, '订单管理区');
  if (!orderTable) orderTable = await grid.table(baseId, '销售订单表');
  let lockTable = await grid.table(baseId, '业务锁定区');
  if (!lockTable) lockTable = await grid.table(baseId, '结算表');
  const of = orderTable ? await grid.fieldsByName(orderTable.id) : {};
  const lf = lockTable ? await grid.fieldsByName(lockTable.id) : {};
  const orders = orderTable ? await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1 ORDER BY created_at, id', [orderTable.id]) : [];
  const locks = lockTable ? await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1 ORDER BY created_at, id', [lockTable.id]) : [];

  // 预加载所有 cells（订单表 + 结算表），避免循环内 N+1
  const allRecordIds = [...orders.map(r => r.id), ...locks.map(r => r.id)];
  const cellMap = new Map();
  if (allRecordIds.length) {
    const placeholders = allRecordIds.map((_, i) => `$${i + 1}`).join(',');
    const allCells = await dbAdapter.queryAsync(
      `SELECT record_id, field_id, value FROM cells WHERE record_id IN (${placeholders})`,
      allRecordIds
    );
    for (const c of allCells) {
      if (!cellMap.has(c.record_id)) cellMap.set(c.record_id, {});
      cellMap.get(c.record_id)[c.field_id] = c.value;
    }
  }
  function cellVal(recordId, fieldId) {
    return (cellMap.get(recordId) || {})[fieldId] || '';
  }

  // 预加载所有 links（订单表），避免循环内 firstLinked 的 N+1
  const linkMap = new Map();
  if (orderTable) {
    const orderIds = orders.map(r => r.id);
    const linkFieldIds = Object.values(of).filter(f => f.type === 'link').map(f => f.id);
    if (orderIds.length && linkFieldIds.length) {
      const idPlaceholders = orderIds.map((_, i) => `$${i + 1}`).join(',');
      const fieldPlaceholders = linkFieldIds.map((_, i) => `$${i + 1}`).join(',');
      const allLinks = await dbAdapter.queryAsync(
        `SELECT from_record_id, field_id, to_record_id FROM links WHERE from_record_id IN (${idPlaceholders}) AND field_id IN (${fieldPlaceholders}) ORDER BY created_at`,
        [...orderIds, ...linkFieldIds]
      );
      for (const l of allLinks) {
        const key = `${l.from_record_id}:${l.field_id}`;
        if (!linkMap.has(key)) linkMap.set(key, l.to_record_id);
      }
    }
  }
  function firstLinkVal(recordId, fieldId) {
    return linkMap.get(`${recordId}:${fieldId}`) || '';
  }

  const lockStatus = new Map();
  for (const r of locks) {
    lockStatus.set(r.id, cellVal(r.id, await getFieldId(grid, lf, 'resourceStatus')));
  }

  // Only report missing tables if neither legacy nor fallback names exist
  const hasOrderTable = !!(await grid.table(baseId, '订单管理区') || await grid.table(baseId, '销售订单表'));
  const hasLockTable = !!(await grid.table(baseId, '业务锁定区') || await grid.table(baseId, '结算表'));
  if (!hasOrderTable) {
    issues.push(issue('missing_order_table', 'high', '缺少订单管理区或销售订单表', [{ baseId }], '先初始化订单管理区或 business-core 模板。'));
  }
  if (!hasLockTable) {
    issues.push(issue('missing_business_lock_table', 'high', '缺少业务锁定区或结算表', [{ baseId }], '先初始化业务锁定区或 business-core 模板。'));
  }

  const completedMissingPaid = [];
  const settledMissingSnapshot = [];
  const refundMissingOriginal = [];
  const completedUnsettled = [];
  const settledNoBatch = [];
  const settledWithoutLedger = [];

  for (const r of orders) {
    const zoneFieldId = await getFieldId(grid, of, 'zone');
    const paidAtFieldId = await getFieldId(grid, of, 'paidAt');
    const statusFieldId = await getFieldId(grid, of, 'status');
    const reasonFieldId = await getFieldId(grid, of, 'reason');
    const settledFieldId = await getFieldId(grid, of, 'settled');
    const batchFieldId = await getFieldId(grid, of, 'batch');
    const originalOrderFieldId = await getFieldId(grid, of, 'originalOrder');

    const zone = zoneFieldId ? cellVal(r.id, zoneFieldId) : '';
    const paidAt = paidAtFieldId ? toDateString(cellVal(r.id, paidAtFieldId)) : '';
    const status = statusFieldId ? cellVal(r.id, statusFieldId) : '';
    const reason = reasonFieldId ? cellVal(r.id, reasonFieldId) : '';
    const settled = settledFieldId ? cellVal(r.id, settledFieldId) === 'true' : false;
    const batch = batchFieldId ? cellVal(r.id, batchFieldId) : '';
    if (zone === '完结区' && !paidAt) completedMissingPaid.push({ orderId: r.id });
    if (reason === '退款' && !firstLinkVal(r.id, originalOrderFieldId)) refundMissingOriginal.push({ orderId: r.id });
    if (zone === '完结区' && status !== '已取消' && paidAt && (!businessDate || paidAt === businessDate) && !settled) {
      completedUnsettled.push({ orderId: r.id, paidAt, reason });
    }
    if (settled && !batch) settledNoBatch.push({ orderId: r.id });
    if (settled) {
      const missingNames = [];
      for (const key of ['snapshot', 'snapshotReceived', 'snapshotPaid', 'snapshotProduct', 'snapshotPayer', 'snapshotPayee']) {
        if (!cellVal(r.id, await getFieldId(grid, of, key))) missingNames.push(key);
      }
      if (missingNames.length) settledMissingSnapshot.push({ orderId: r.id, missing: missingNames });
      const ledgerCountRow = await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM commission_ledger WHERE base_id=$1 AND order_record_id=$2', [baseId, r.id]);
      if (!ledgerCountRow.c) settledWithoutLedger.push({ orderId: r.id });
    }
  }

  if (completedMissingPaid.length) issues.push(issue('completed_missing_paid_at', 'high', '完结区订单缺少财务付款时间', completedMissingPaid, '补齐财务付款时间，否则状态作业和佣金结算无法按业务日期归属。'));
  if (settledMissingSnapshot.length) issues.push(issue('settled_missing_snapshot', 'high', '已结算订单缺少快照字段', settledMissingSnapshot, '检查结算作业是否中断；必要时通过修正流程补写快照。'));
  if (refundMissingOriginal.length) issues.push(issue('refund_missing_original_order', 'high', '退款订单缺少原订单关联', refundMissingOriginal, '补齐原订单，否则退款冲回无法追溯历史佣金流水。'));
  if (completedUnsettled.length) issues.push(issue('completed_unsettled_orders', 'medium', '完结区存在未结算订单', completedUnsettled, '确认是否应执行佣金结算作业，或检查订单是否属于退款/取消/异常单。'));
  if (settledNoBatch.length) issues.push(issue('settled_missing_batch', 'medium', '已结算订单缺少佣金结算批次', settledNoBatch, '从佣金流水或作业记录中回填批次，避免重复执行判断失准。'));
  if (settledWithoutLedger.length) issues.push(issue('settled_without_ledger', 'high', '已结算订单没有佣金流水', settledWithoutLedger, '检查是否手动勾选了佣金已结算，或结算作业是否失败。'));

  const disabledLedger = (await dbAdapter.queryAsync('SELECT order_record_id, lock_record_id, amount FROM commission_ledger WHERE base_id=$1', [baseId]))
    .filter(r => lockStatus.get(r.lock_record_id) === '已解绑');
  if (disabledLedger.length) issues.push(issue('ledger_for_unbound_lock', 'high', '已解绑业务锁定记录存在佣金流水', disabledLedger, '确认佣金发生时的状态；如属错误，需要走冲正或修正流程。'));

  const duplicateLedger = await dbAdapter.queryAsync(`
    SELECT order_record_id, lock_record_id, side, type, COUNT(*) AS cnt
    FROM commission_ledger
    WHERE base_id=$1
    GROUP BY order_record_id, lock_record_id, side, type
    HAVING COUNT(*) > 1
  `, [baseId]);
  if (duplicateLedger.length) issues.push(issue('possible_duplicate_ledger', 'high', '同订单同绑定存在多批次重复佣金流水', duplicateLedger, '检查是否跨批次重复结算；必要时保留正确批次并冲回重复流水。'));

  const failedRuns = await dbAdapter.queryAsync(`
    SELECT id, job_key, business_date, error_json
    FROM job_runs
    WHERE base_id=$1 AND status='failed'
    ORDER BY started_at DESC LIMIT 20
  `, [baseId]);
  if (failedRuns.length) issues.push(issue('failed_job_runs', 'medium', '存在失败的作业执行记录', failedRuns, '查看错误详情，修复后重新试算再执行。'));

  const ledgerCountRow = await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM commission_ledger WHERE base_id=$1', [baseId]);
  const jobRunsCountRow = await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM job_runs WHERE base_id=$1', [baseId]);
  const counts = {
    orders: orders.length,
    locks: locks.length,
    ledgers: ledgerCountRow.c,
    jobRuns: jobRunsCountRow.c,
  };
  return {
    baseId,
    businessDate: businessDate || null,
    checkedAt: new Date().toISOString(),
    counts,
    issueCount: issues.reduce((n, x) => n + x.count, 0),
    issues,
  };
}

module.exports = { runDiagnostics };
