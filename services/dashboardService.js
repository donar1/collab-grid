// services/dashboardService.js — 大屏相关函数
// 从 server.js 提取的仪表盘/大屏业务逻辑

const dbAdapter = require('./dbAdapter');
const { cellValue, tableByName, fieldsMap, numValue, firstLinkedRecordId } = require('./helpers');

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function daysAgoDateString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateString(d);
}
function monthStartString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}
function moneyRound(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
async function safeRecords(table) {
  if (!table) return [];
  return dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1 ORDER BY position', [table.id]);
}

// 批量 displayValue — 一次性查询 records + fields + cells，避免 N+1
async function batchDisplayValue(recordIds, preferredNames) {
  const result = new Map();
  if (!recordIds?.length) return result;
  const uniqueIds = [...new Set(recordIds)];
  const placeholders = uniqueIds.map((_, i) => `$${i + 1}`).join(',');

  // 1. 批量查 records 取 table_id
  const records = await dbAdapter.queryAsync(
    `SELECT id, table_id FROM records WHERE id IN (${placeholders})`, uniqueIds
  );
  const recordTableMap = new Map(records.map(r => [r.id, r.table_id]));
  const tableIds = [...new Set(records.map(r => r.table_id))];
  if (!tableIds.length) {
    for (const rid of uniqueIds) result.set(rid, '');
    return result;
  }

  // 2. 批量查 fields
  const tPlaceholders = tableIds.map((_, i) => `$${i + 1}`).join(',');
  const fields = await dbAdapter.queryAsync(
    `SELECT table_id, name, id FROM fields WHERE table_id IN (${tPlaceholders})`, tableIds
  );
  const fieldMap = new Map();
  for (const f of fields) fieldMap.set(`${f.table_id}:${f.name}`, f.id);

  // 3. 批量查 cells
  const cells = await dbAdapter.queryAsync(
    `SELECT record_id, field_id, value FROM cells WHERE record_id IN (${placeholders})`, uniqueIds
  );
  const cellMap = new Map();
  for (const c of cells) cellMap.set(`${c.record_id}:${c.field_id}`, c.value);

  // 4. 组装结果
  for (const rid of uniqueIds) {
    const tableId = recordTableMap.get(rid);
    let value = '';
    if (tableId) {
      for (const name of preferredNames) {
        const fid = fieldMap.get(`${tableId}:${name}`);
        if (fid) {
          const val = cellMap.get(`${rid}:${fid}`);
          if (val) { value = val; break; }
        }
      }
    }
    result.set(rid, value);
  }
  return result;
}

async function dashboardSummary(baseId) {
  const today = localDateString();
  const monthStart = monthStartString();
  const start7 = daysAgoDateString(6);
  // P0-3 fix: 表名 fallback，兼容旧模板和新模板
  let orderTable = await tableByName(baseId, '订单管理区');
  if (!orderTable) orderTable = await tableByName(baseId, '销售订单表');
  const orderFields = orderTable ? await fieldsMap(orderTable.id) : {};
  const orderRows = await safeRecords(orderTable);
  const trendMap = new Map();
  for (let i = 6; i >= 0; i--) trendMap.set(daysAgoDateString(i), { date: daysAgoDateString(i), orders: 0, sales: 0, profit: 0 });
  const payerRank = new Map();
  const payeeRank = new Map();
  const orderStats = {
    todayOrders: 0, todayCompleted: 0, todaySales: 0, todayProfit: 0,
    monthOrders: 0, monthCompleted: 0, monthSales: 0, monthProfit: 0,
  };
  // Pre-load all cells for order table to eliminate N+1 queries
  const orderCellMap = new Map();
  const orderLinkMapByField = new Map();
  if (orderTable) {
    const allOrderCells = await dbAdapter.queryAsync(
      'SELECT record_id, field_id, value FROM cells WHERE record_id IN (SELECT id FROM records WHERE table_id=$1)',
      [orderTable.id]
    );
    for (const c of allOrderCells) {
      const key = `${c.record_id}:${c.field_id}`;
      if (!orderCellMap.has(key)) orderCellMap.set(key, c.value);
    }
    // Also pre-load all links for the order table
    const allOrderLinks = await dbAdapter.queryAsync(
      'SELECT field_id, from_record_id, to_record_id FROM links WHERE from_record_id IN (SELECT id FROM records WHERE table_id=$1) OR to_record_id IN (SELECT id FROM records WHERE table_id=$1)',
      [orderTable.id]
    );
    for (const l of allOrderLinks) {
      if (!orderLinkMapByField.has(l.field_id)) orderLinkMapByField.set(l.field_id, []);
      orderLinkMapByField.get(l.field_id).push(l);
    }
  }
  function getCellValueFast(recordId, fieldId) {
    return orderCellMap.get(`${recordId}:${fieldId}`) || '';
  }
  function getNumValueFast(recordId, fieldId) {
    return Number(getCellValueFast(recordId, fieldId)) || 0;
  }
  function getFirstLinkIdFast(recordId, fieldId) {
    const links = orderLinkMapByField.get(fieldId);
    if (!links) return null;
    const match = links.find(l => l.from_record_id === recordId);
    return match ? match.to_record_id : null;
  }

  // 批量收集付款方/收款方 ID，避免循环内 N+1
  const payerIds = [];
  const payeeIds = [];
  for (const r of orderRows) {
    const pid = getFirstLinkIdFast(r.id, orderFields['付款方']?.id);
    if (pid) payerIds.push(pid);
    const peid = getFirstLinkIdFast(r.id, orderFields['收款方']?.id);
    if (peid) payeeIds.push(peid);
  }
  const [payerNames, payeeNames] = await Promise.all([
    batchDisplayValue(payerIds, ['企业名称', '代码', '名称']),
    batchDisplayValue(payeeIds, ['企业名称', '代码', '名称']),
  ]);

  for (const r of orderRows) {
    const created = r.created_at ? localDateString(new Date(r.created_at)) : '';
    const done = getCellValueFast(r.id, orderFields['完结日期']?.id) || getCellValueFast(r.id, orderFields['财务付款时间']?.id) || created;
    const status = getCellValueFast(r.id, orderFields['订单状态']?.id);
    const canceled = status === '已取消' || getCellValueFast(r.id, orderFields['事由']?.id) === '已取消';
    if (created === today) orderStats.todayOrders++;
    if (created >= monthStart) orderStats.monthOrders++;
    if (canceled) continue;
    const receivable = getNumValueFast(r.id, orderFields['应收金额']?.id) - getNumValueFast(r.id, orderFields['付款差额']?.id);
    const payable = getNumValueFast(r.id, orderFields['应付金额']?.id) - getNumValueFast(r.id, orderFields['收款差额']?.id);
    const profit = receivable - payable;
    if (done === today) {
      orderStats.todayCompleted++;
      orderStats.todaySales += receivable;
      orderStats.todayProfit += profit;
    }
    if (done >= monthStart) {
      orderStats.monthCompleted++;
      orderStats.monthSales += receivable;
      orderStats.monthProfit += profit;
    }
    if (done >= start7 && trendMap.has(done)) {
      const t = trendMap.get(done);
      t.orders++;
      t.sales += receivable;
      t.profit += profit;
    }
    const payerId = getFirstLinkIdFast(r.id, orderFields['付款方']?.id);
    if (payerId) {
      const name = payerNames.get(payerId) || '未命名付款方';
      const item = payerRank.get(name) || { name, orders: 0, amount: 0, profit: 0 };
      item.orders++;
      item.amount += receivable;
      item.profit += profit;
      payerRank.set(name, item);
    }
    const payeeId = getFirstLinkIdFast(r.id, orderFields['收款方']?.id);
    if (payeeId) {
      const name = payeeNames.get(payeeId) || '未命名收款方';
      const item = payeeRank.get(name) || { name, orders: 0, amount: 0 };
      item.orders++;
      item.amount += payable;
      payeeRank.set(name, item);
    }
  }
  const finance = {
    receivable: { total: 0, received: 0, unreceived: 0, reversed: 0 },
    payable: { total: 0, paid: 0, unpaid: 0, reversed: 0 },
  };
  let arTable = await tableByName(baseId, '应收结算明细区');
  if (!arTable) arTable = await tableByName(baseId, '结算表');
  if (arTable) {
    const f = await fieldsMap(arTable.id);
    const arRows = await safeRecords(arTable);
    // Pre-load all cells for AR table
    const arCells = await dbAdapter.queryAsync(
      'SELECT record_id, field_id, value FROM cells WHERE record_id IN (SELECT id FROM records WHERE table_id=$1)',
      [arTable.id]
    );
    const arCellMap = new Map();
    for (const c of arCells) arCellMap.set(`${c.record_id}:${c.field_id}`, c.value);
    function arCell(rid, fid) { return arCellMap.get(`${rid}:${fid}`) || ''; }
    function arNum(rid, fid) { return Number(arCell(rid, fid)) || 0; }
    for (const r of arRows) {
      const status = arCell(r.id, f['明细状态']?.id);
      if (status === '红冲明细') continue; // 红冲明细不计入聚合，避免双计
      const amount = arNum(r.id, f['应收金额']?.id);
      const received = arNum(r.id, f['已收金额']?.id);
      const reversed = arNum(r.id, f['红冲金额']?.id);
      finance.receivable.total += amount > 0 ? amount : 0;
      finance.receivable.received += received;
      finance.receivable.reversed += Math.abs(reversed);
      finance.receivable.unreceived += Math.max(0, amount - received - reversed);
    }
  }
  let apTable = await tableByName(baseId, '应付结算明细区');
  if (!apTable) apTable = await tableByName(baseId, '结算表');
  if (apTable) {
    const f = await fieldsMap(apTable.id);
    const apRows = await safeRecords(apTable);
    // Pre-load all cells for AP table
    const apCells = await dbAdapter.queryAsync(
      'SELECT record_id, field_id, value FROM cells WHERE record_id IN (SELECT id FROM records WHERE table_id=$1)',
      [apTable.id]
    );
    const apCellMap = new Map();
    for (const c of apCells) apCellMap.set(`${c.record_id}:${c.field_id}`, c.value);
    function apCell(rid, fid) { return apCellMap.get(`${rid}:${fid}`) || ''; }
    function apNum(rid, fid) { return Number(apCell(rid, fid)) || 0; }
    for (const r of apRows) {
      const status = apCell(r.id, f['明细状态']?.id);
      if (status === '红冲明细') continue; // 红冲明细不计入聚合，避免双计
      const amount = apNum(r.id, f['应付金额']?.id);
      const paid = apNum(r.id, f['已付金额']?.id);
      const reversed = apNum(r.id, f['红冲金额']?.id);
      finance.payable.total += amount > 0 ? amount : 0;
      finance.payable.paid += paid;
      finance.payable.reversed += Math.abs(reversed);
      finance.payable.unpaid += Math.max(0, amount - paid - reversed);
    }
  }
  const inventoryWarnings = [];
  let invTable = await tableByName(baseId, '库存商品区');
  if (!invTable) invTable = await tableByName(baseId, '库存表');
  if (invTable) {
    const f = await fieldsMap(invTable.id);
    const invRows = await safeRecords(invTable);
    // Pre-load all cells and links for inventory table
    const invCells = await dbAdapter.queryAsync(
      'SELECT record_id, field_id, value FROM cells WHERE record_id IN (SELECT id FROM records WHERE table_id=$1)',
      [invTable.id]
    );
    const invCellMap = new Map();
    for (const c of invCells) invCellMap.set(`${c.record_id}:${c.field_id}`, c.value);
    const invLinks = await dbAdapter.queryAsync(
      'SELECT field_id, from_record_id, to_record_id FROM links WHERE from_record_id IN (SELECT id FROM records WHERE table_id=$1)',
      [invTable.id]
    );
    const invLinkMapByField = new Map();
    for (const l of invLinks) {
      if (!invLinkMapByField.has(l.field_id)) invLinkMapByField.set(l.field_id, []);
      invLinkMapByField.get(l.field_id).push(l);
    }
    function invCell(rid, fid) { return invCellMap.get(`${rid}:${fid}`) || ''; }
    function invNum(rid, fid) { return Number(invCell(rid, fid)) || 0; }
    function invFirstLink(rid, fid) {
      const links = invLinkMapByField.get(fid);
      return links ? (links.find(l => l.from_record_id === rid)?.to_record_id || null) : null;
    }
    // 批量收集库存预警所需 ID，避免循环内 N+1
    const productIds = [];
    const invRecordIds = [];
    for (const r of invRows) {
      const actual = invNum(r.id, f['当前实际库存']?.id);
      const virtualQty = invNum(r.id, f['当前虚拟库存']?.id);
      const warning = invNum(r.id, f['预警库存']?.id);
      if ((warning > 0 && actual <= warning) || actual === 0 || virtualQty > actual) {
        const productId = invFirstLink(r.id, f['产品']?.id);
        if (productId) productIds.push(productId);
        invRecordIds.push(r.id);
      }
    }
    const [productNames, invNumbers] = await Promise.all([
      batchDisplayValue(productIds, ['标题', '产品ID', '名称']),
      batchDisplayValue(invRecordIds, ['库存编号']),
    ]);
    let warnIdx = 0;
    for (const r of invRows) {
      const actual = invNum(r.id, f['当前实际库存']?.id);
      const virtualQty = invNum(r.id, f['当前虚拟库存']?.id);
      const warning = invNum(r.id, f['预警库存']?.id);
      if ((warning > 0 && actual <= warning) || actual === 0 || virtualQty > actual) {
        const productId = invFirstLink(r.id, f['产品']?.id);
        inventoryWarnings.push({
          name: productNames.get(productId) || invNumbers.get(r.id) || '',
          actual, virtual: virtualQty, warning,
          level: actual === 0 ? 'high' : (warning > 0 && actual <= warning ? 'medium' : 'low'),
        });
        warnIdx++;
      }
    }
  }
  const exceptions = [];
  const addPending = async (tableName, fieldName, statusName, label) => {
    const t = await tableByName(baseId, tableName);
    if (!t) return;
    const f = await fieldsMap(t.id);
    const rows = await safeRecords(t);
    // Pre-load cells for pending tables
    const pCells = await dbAdapter.queryAsync(
      'SELECT record_id, field_id, value FROM cells WHERE record_id IN (SELECT id FROM records WHERE table_id=$1)',
      [t.id]
    );
    const pCellMap = new Map();
    for (const c of pCells) pCellMap.set(`${c.record_id}:${c.field_id}`, c.value);
    function pCell(rid, fid) { return pCellMap.get(`${rid}:${fid}`) || ''; }
    // 批量查询标题，避免循环内 N+1
    const recordIds = rows.map(r => r.id);
    const titles = await batchDisplayValue(recordIds, [fieldName]);
    for (const r of rows) {
      const status = pCell(r.id, f[statusName]?.id);
      if (!status || status === '待审核' || status === '待确认' || status === 'failed') {
        exceptions.push({ type: label, title: titles.get(r.id) || label, status: status || '待处理' });
      }
    }
  };
  await addPending('退款处理区', '退款单号', '退款状态', '待审核退款');
  await addPending('撤单处理区', '撤单编号', '撤单状态', '待审核撤单');
  await addPending('财务红冲处理区', '红冲单号', '红冲状态', '待审核红冲');
  const jobConfigs = await tableByName(baseId, 'job_configs') ? [] : [];
  void jobConfigs;
  for (const k of Object.keys(orderStats)) orderStats[k] = moneyRound(orderStats[k]);
  for (const side of ['receivable', 'payable']) for (const k of Object.keys(finance[side])) finance[side][k] = moneyRound(finance[side][k]);
  return {
    date: today,
    cards: [
      { key: 'todayOrders', label: '今日订单数', value: orderStats.todayOrders, unit: '单' },
      { key: 'todayCompleted', label: '今日完结订单', value: orderStats.todayCompleted, unit: '单' },
      { key: 'todaySales', label: '今日销售额', value: moneyRound(orderStats.todaySales), unit: '¥' },
      { key: 'todayProfit', label: '今日毛利', value: moneyRound(orderStats.todayProfit), unit: '¥' },
      { key: 'monthSales', label: '本月销售额', value: moneyRound(orderStats.monthSales), unit: '¥' },
      { key: 'monthProfit', label: '本月毛利', value: moneyRound(orderStats.monthProfit), unit: '¥' },
      { key: 'unreceived', label: '待收金额', value: finance.receivable.unreceived, unit: '¥' },
      { key: 'unpaid', label: '待付金额', value: finance.payable.unpaid, unit: '¥' },
    ],
    trend: Array.from(trendMap.values()).map(x => ({ ...x, sales: moneyRound(x.sales), profit: moneyRound(x.profit) })),
    rankings: {
      payer: Array.from(payerRank.values()).sort((a, b) => b.amount - a.amount).slice(0, 8).map(x => ({ ...x, amount: moneyRound(x.amount), profit: moneyRound(x.profit) })),
      payee: Array.from(payeeRank.values()).sort((a, b) => b.amount - a.amount).slice(0, 8).map(x => ({ ...x, amount: moneyRound(x.amount) })),
    },
    finance,
    inventoryWarnings: inventoryWarnings.slice(0, 10),
    exceptions: exceptions.slice(0, 12),
  };
}

module.exports = {
  localDateString,
  daysAgoDateString,
  monthStartString,
  safeRecords,
  dashboardSummary,
};
