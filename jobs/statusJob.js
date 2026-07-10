const { nanoid } = require('nanoid');
const { makeGrid, toDateString, toNumber } = require('./grid');
const dbAdapter = require('../services/dbAdapter');

function dateRange(endDate, days) {
  const end = new Date(`${endDate}T00:00:00Z`);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function shiftDate(date, delta) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function hasEveryDay(activitySet, dates) {
  return dates.every(d => activitySet.has(d));
}

async function rebuildActivity(baseId, businessDate) {
  const grid = await makeGrid();
  let orderTable = await grid.table(baseId, '订单管理区');
  if (!orderTable) orderTable = await grid.table(baseId, '销售订单表');
  if (!orderTable) throw new Error('订单管理区或销售订单表不存在');
  const of = await grid.fieldsByName(orderTable.id);
  const allDates = dateRange(businessDate, 30);
  const startDate = allDates[0];
  const endDate = businessDate;
  const rows = await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1 ORDER BY created_at, id', [orderTable.id]);
  const bucket = new Map();
  for (const r of rows) {
    const paidDate = toDateString(await grid.cell(r.id, of['财务付款时间']?.id));
    if (!paidDate || paidDate < startDate || paidDate > endDate) continue;
    if (await grid.cell(r.id, of['分区']?.id) !== '完结区') continue;
    if (await grid.cell(r.id, of['事由']?.id) === '退款') continue;
    if (await grid.cell(r.id, of['订单状态']?.id) === '已取消') continue;
    const productId = await grid.firstLinked(r.id, of['产品']?.id);
    const profit = toNumber(await grid.value(r, of['毛利'], Object.values(of)));
    for (const side of ['客户', '供应商']) {
      const channel = side === '客户' ? await grid.firstLinked(r.id, of['付款方']?.id) : await grid.firstLinked(r.id, of['收款方']?.id);
      if (!channel) continue;
      const key = [paidDate, side, channel, productId || ''].join('|');
      const item = bucket.get(key) || { businessDate: paidDate, side, channel, productId: productId || '', count: 0, profit: 0 };
      item.count += 1;
      item.profit += profit;
      bucket.set(key, item);
    }
  }
  const ts = Date.now();
  await dbAdapter.transactionAsync(async () => {
    await dbAdapter.runAsync('DELETE FROM order_activity_daily WHERE base_id=$1 AND business_date BETWEEN $2 AND $3', [baseId, startDate, endDate]);
    for (const item of bucket.values()) {
      await dbAdapter.runAsync(`
        INSERT INTO order_activity_daily
          (base_id,business_date,side,channel_record_id,product_record_id,valid_order_count,gross_profit_sum,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(base_id,business_date,side,channel_record_id,product_record_id)
        DO UPDATE SET valid_order_count=excluded.valid_order_count, gross_profit_sum=excluded.gross_profit_sum, updated_at=excluded.updated_at
      `, [baseId, item.businessDate, item.side, item.channel, item.productId, item.count, item.profit, ts]);
    }
  });
  return { scannedOrders: rows.length, activityRows: bucket.size };
}

async function runStatusJob({ baseId, businessDate, dryRun = true, userId = null }) {
  const grid = await makeGrid();
  let lockTable = await grid.table(baseId, '业务锁定区');
  if (!lockTable) lockTable = await grid.table(baseId, '结算表');
  if (!lockTable) throw new Error('业务锁定区或结算表不存在');
  const statusLog = await grid.table(baseId, '状态变更日志');
  const lf = await grid.fieldsByName(lockTable.id);
  const logFields = statusLog ? await grid.fieldsByName(statusLog.id) : {};
  const activity = await rebuildActivity(baseId, businessDate);
  const locks = await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1 ORDER BY created_at, id', [lockTable.id]);
  const today = businessDate;
  const changes = [];
  for (const lock of locks) {
    if (await grid.cell(lock.id, lf['判断']?.id) !== '关联') continue;
    const approvalResult = await grid.cell(lock.id, lf['审批结果']?.id);
    if (approvalResult && approvalResult !== '已通过') continue;
    const currentStatus = await grid.cell(lock.id, lf['资源状态']?.id) || '正常';
    if (currentStatus === '已解绑') continue;
    const relation = await grid.cell(lock.id, lf['合作关系']?.id);
    const group = await grid.cell(lock.id, lf['分组']?.id);
    const channel = await grid.firstLinked(lock.id, lf['合作渠道']?.id);
    const product = await grid.firstLinked(lock.id, lf['商品']?.id);
    if (!channel || !relation || !group) continue;
    if (group === '单品合作区' && !product) continue;
    const windowDays = group === '单品合作区' ? 7 : 30;
    const rows = await dbAdapter.queryAsync(`
      SELECT business_date FROM order_activity_daily
      WHERE base_id=$1 AND side=$2 AND channel_record_id=$3 AND business_date BETWEEN $4 AND $5
      AND ($6='渠道负责区' OR product_record_id=$7)
      AND valid_order_count > 0
    `, [baseId, relation, channel, shiftDate(today, -(windowDays - 1)), today, group, product || '']);
    const activeDates = new Set(rows.map(r => r.business_date));
    const todayHasOrder = activeDates.has(today);
    const fullWindow = hasEveryDay(activeDates, dateRange(today, windowDays));
    let nextStatus;
    if (todayHasOrder && currentStatus === '活跃') nextStatus = '活跃';
    else if (fullWindow) nextStatus = '活跃';
    else if (todayHasOrder) nextStatus = '正常';
    else if (activeDates.size > 0) nextStatus = '正常';
    else nextStatus = '沉淀';
    if (nextStatus !== currentStatus) changes.push({ recordId: lock.id, from: currentStatus, to: nextStatus, group, relation, channel, product });
  }
  if (!dryRun && changes.length) {
    await dbAdapter.transactionAsync(async () => {
      const ts = Date.now();
      for (const c of changes) {
        await grid.setCell(c.recordId, lf['资源状态'].id, c.to, userId, ts);
        if (statusLog && logFields['业务锁定记录']) {
          const logId = await grid.createRecord(statusLog.id, ts);
          await grid.addLink(logFields['业务锁定记录'].id, logId, c.recordId, ts);
          if (logFields['原资源状态']) await grid.setCell(logId, logFields['原资源状态'].id, c.from, userId, ts);
          if (logFields['新资源状态']) await grid.setCell(logId, logFields['新资源状态'].id, c.to, userId, ts);
          if (logFields['变更原因']) await grid.setCell(logId, logFields['变更原因'].id, `状态作业 ${businessDate}：${c.from} -> ${c.to}`, userId, ts);
        }
      }
    });
  }
  return {
    scannedCount: locks.length + activity.scannedOrders,
    changedCount: changes.length,
    summary: { businessDate, dryRun, activity, changes },
  };
}

module.exports = { runStatusJob, rebuildActivity };
