// services/financeService.js — 财务相关业务函数
// 从 server.js 提取（仅异步/PostgreSQL 模式）

const dbAdapter = require('./dbAdapter');

const { nanoid, now, cellValue, tableByName, fieldsMap, fieldIdByName, firstLinkedRecordId,
        addLinkIfMissing, createRecordRaw, displayValue, upsertCell,
        assertRecordWritable, broadcast } = require('./helpers');

function moneyRound(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function financeTables(baseId) {
  const names = ['财务结算对象区', '应收结算明细区', '应付结算明细区', '应收结算单区', '应付结算单区', '收付款流水区', '财务红冲处理区'];
  const out = {};
  for (const name of names) {
    const t = await tableByName(baseId, name);
    if (!t) throw new Error(`${name}不存在，请先初始化财务对账体系`);
    out[name] = { table: t, fields: await fieldsMap(t.id) };
  }
  return out;
}

async function financeObjectForResource(baseId, resourceRecordId, userId, ts) {
  ts = ts || now();
  const ft = await financeTables(baseId);
  const obj = ft['财务结算对象区'];
  const linkField = obj.fields['结算对象']?.id;
  const existing = await dbAdapter.queryOneAsync(
    'SELECT from_record_id FROM links WHERE field_id=$1 AND to_record_id=$2 LIMIT 1',
    [linkField, resourceRecordId]
  );
  if (existing) return existing.from_record_id;
  const objectId = await createRecordRaw(obj.table.id, userId, 0, ts);
  await addLinkIfMissing(linkField, objectId, resourceRecordId, ts);
  await dbAdapter.transactionAsync(async () => {
    await upsertCell(objectId, obj.fields['对象名称']?.id, await displayValue(resourceRecordId, ['企业名称', '代码', '名称']), userId, ts);
    await upsertCell(objectId, obj.fields['是否启用结算']?.id, 'true', userId, ts);
    await upsertCell(objectId, obj.fields['默认结算周期']?.id, '单笔结', userId, ts);
  });
  return objectId;
}

async function hasDetailForOrder(detailTableId, orderLinkFieldId, orderRecordId) {
  const row = await dbAdapter.queryOneAsync(`
    SELECT 1 FROM links l JOIN records r ON r.id=l.from_record_id
    WHERE l.field_id=$1 AND l.to_record_id=$2 AND r.table_id=$3 LIMIT 1
  `, [orderLinkFieldId, orderRecordId, detailTableId]);
  return !!row;
}

async function generateFinanceDetails(baseId, userId) {
  const orderTable = await tableByName(baseId, '订单管理区');
  if (!orderTable) throw new Error('订单管理区不存在');
  const of = await fieldsMap(orderTable.id);
  const ft = await financeTables(baseId);
  const ar = ft['应收结算明细区'];
  const ap = ft['应付结算明细区'];
  const ts = now();
  let arCreated = 0;
  let apCreated = 0;
  await dbAdapter.transactionAsync(async () => {
    const orders = await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1 ORDER BY position', [orderTable.id]);
    // Pre-load all order cells
    const orderRecordIds = orders.map(o => o.id);
    const placeholders = orderRecordIds.map((_, i) => `$${i + 1}`).join(',');
    const orderCells = await dbAdapter.queryAsync(
      `SELECT record_id, field_id, value FROM cells WHERE record_id IN (${placeholders})`,
      orderRecordIds
    );
    const cellMap = new Map();
    for (const c of orderCells) cellMap.set(`${c.record_id}:${c.field_id}`, c.value);

    // Pre-load all links for orders
    const orderLinks = await dbAdapter.queryAsync(
      `SELECT field_id, from_record_id, to_record_id FROM links WHERE from_record_id IN (${placeholders})`,
      orderRecordIds
    );
    const linkMapByField = new Map();
    for (const l of orderLinks) {
      if (!linkMapByField.has(l.field_id)) linkMapByField.set(l.field_id, []);
      linkMapByField.get(l.field_id).push(l);
    }

    function getCell(recordId, fieldId) { return cellMap.get(`${recordId}:${fieldId}`) || ''; }
    function getNumCell(recordId, fieldId) { return Number(getCell(recordId, fieldId)) || 0; }
    function getFirstLink(recordId, fieldId) {
      const links = linkMapByField.get(fieldId);
      return links ? (links.find(l => l.from_record_id === recordId)?.to_record_id || null) : null;
    }

    for (const order of orders) {
      const status = getCell(order.id, of['订单状态']?.id);
      const reason = getCell(order.id, of['事由']?.id);
      // H-11: 只允许为已完结订单生成账单明细
      if (status !== '已完结' && status !== '已完成') continue;
      if (reason === '已取消') continue;
      const businessDate = getCell(order.id, of['财务付款时间']?.id) || getCell(order.id, of['完结日期']?.id);
      // NOTE: displayValue queries another table — remaining N+1 for cross-table lookups
      const orderNo = await displayValue(order.id, ['内部订单号']);
      const productFirstId = getFirstLink(order.id, of['产品']?.id);
      const productName = await displayValue(productFirstId, ['标题', '产品ID', '名称']);
      const receivable = getNumCell(order.id, of['应收金额']?.id) - getNumCell(order.id, of['付款差额']?.id);
      const payable = getNumCell(order.id, of['应付金额']?.id) - getNumCell(order.id, of['收款差额']?.id);
      const payerId = getFirstLink(order.id, of['付款方']?.id);
      if (payerId && receivable !== 0 && !(await hasDetailForOrder(ar.table.id, ar.fields['来源订单']?.id, order.id))) {
        const objectId = await financeObjectForResource(baseId, payerId, userId, ts);
        const detailId = await createRecordRaw(ar.table.id, userId, 0, ts);
        await addLinkIfMissing(ar.fields['结算对象']?.id, detailId, objectId, ts);
        await addLinkIfMissing(ar.fields['来源订单']?.id, detailId, order.id, ts);
        await upsertCell(detailId, ar.fields['订单号']?.id, orderNo, userId, ts);
        await upsertCell(detailId, ar.fields['业务日期']?.id, businessDate, userId, ts);
        await upsertCell(detailId, ar.fields['产品快照']?.id, productName, userId, ts);
        await upsertCell(detailId, ar.fields['应收金额']?.id, String(receivable), userId, ts);
        await upsertCell(detailId, ar.fields['已收金额']?.id, '0', userId, ts);
        await upsertCell(detailId, ar.fields['红冲金额']?.id, '0', userId, ts);
        await upsertCell(detailId, ar.fields['明细状态']?.id, '待结算', userId, ts);
        await upsertCell(detailId, ar.fields['是否封账']?.id, 'false', userId, ts);
        await upsertCell(detailId, ar.fields['原始快照']?.id, JSON.stringify({ orderNo, businessDate, productName, receivable }), userId, ts);
        arCreated++;
      }
      const payeeId = getFirstLink(order.id, of['收款方']?.id);
      if (payeeId && payable !== 0 && !(await hasDetailForOrder(ap.table.id, ap.fields['来源订单']?.id, order.id))) {
        const objectId = await financeObjectForResource(baseId, payeeId, userId, ts);
        const detailId = await createRecordRaw(ap.table.id, userId, 0, ts);
        await addLinkIfMissing(ap.fields['结算对象']?.id, detailId, objectId, ts);
        await addLinkIfMissing(ap.fields['来源订单']?.id, detailId, order.id, ts);
        await upsertCell(detailId, ap.fields['订单号']?.id, orderNo, userId, ts);
        await upsertCell(detailId, ap.fields['业务日期']?.id, businessDate, userId, ts);
        await upsertCell(detailId, ap.fields['产品快照']?.id, productName, userId, ts);
        await upsertCell(detailId, ap.fields['应付金额']?.id, String(payable), userId, ts);
        await upsertCell(detailId, ap.fields['已付金额']?.id, '0', userId, ts);
        await upsertCell(detailId, ap.fields['红冲金额']?.id, '0', userId, ts);
        await upsertCell(detailId, ap.fields['明细状态']?.id, '待结算', userId, ts);
        await upsertCell(detailId, ap.fields['是否封账']?.id, 'false', userId, ts);
        await upsertCell(detailId, ap.fields['原始快照']?.id, JSON.stringify({ orderNo, businessDate, productName, payable }), userId, ts);
        apCreated++;
      }
    }
  });
  return { ok: true, arCreated, apCreated };
}

async function sealFinanceRecord(recordId, tableId, userId) {
  const tableRow = await dbAdapter.queryOneAsync('SELECT name FROM tables WHERE id=$1', [tableId]);
  const tableName = tableRow?.name || '';
  if (!['应收结算明细区', '应付结算明细区', '应收结算单区', '应付结算单区', '收付款流水区'].includes(tableName)) {
    throw new Error('该记录不是可封账的财务记录');
  }
  const fields = await fieldsMap(tableId);
  const ts = now();
  await dbAdapter.transactionAsync(async () => {
    await upsertCell(recordId, fields['是否封账']?.id, 'true', userId, ts);
    if (fields['明细状态']) await upsertCell(recordId, fields['明细状态'].id, '已封账', userId, ts);
    if (fields['结算状态']) await upsertCell(recordId, fields['结算状态'].id, '已封账', userId, ts);
    if (fields['流水状态']) await upsertCell(recordId, fields['流水状态'].id, '已封账', userId, ts);
    await dbAdapter.writeQueryAsync('UPDATE records SET locked=$1, updated_at=$2 WHERE id=$3', [1, ts, recordId]);

    // H-12: 收付款流水封账时，更新关联应收/应付明细的已收/已付金额
    if (tableName === '收付款流水区') {
      const direction = await cellValue(recordId, fields['流水方向']?.id);
      const flowAmount = Math.abs(Number(await cellValue(recordId, fields['金额']?.id)) || 0);
      if (flowAmount > 0) {
        if (direction === '收款') {
          const arSetId = await firstLinkedRecordId(recordId, fields['关联应收结算单']?.id);
          if (arSetId) await updateSettlementDetailsPaid(arSetId, flowAmount, 'received', userId, ts);
        } else if (direction === '付款') {
          const apSetId = await firstLinkedRecordId(recordId, fields['关联应付结算单']?.id);
          if (apSetId) await updateSettlementDetailsPaid(apSetId, flowAmount, 'paid', userId, ts);
        }
      }
    }
  });
  return { ok: true, action: 'seal_finance_record', locked: true };
}

/**
 * H-12: 更新结算单下所有明细的已收/已付金额和状态
 * @param {string} settlementId - 结算单记录 ID
 * @param {number} amount - 本次收/付款金额
 * @param {'received'|'paid'} type
 * @param {string} userId
 * @param {number} ts
 */
async function updateSettlementDetailsPaid(settlementId, amount, type, userId, ts) {
  const setRecord = await dbAdapter.queryOneAsync('SELECT table_id FROM records WHERE id=$1', [settlementId]);
  const setTableId = setRecord?.table_id;
  const setTable = await dbAdapter.queryOneAsync('SELECT name FROM tables WHERE id=$1', [setTableId]);
  const setTableName = setTable?.name;
  const isAR = setTableName === '应收结算单区';
  const detailTableName = isAR ? '应收结算明细区' : '应付结算明细区';
  const baseRow = await dbAdapter.queryOneAsync('SELECT base_id FROM tables WHERE id=$1', [setTableId]);
  const detailTable = await tableByName(baseRow.base_id, detailTableName);
  if (!detailTable) return;
  const df = await fieldsMap(detailTable.id);
  const setLinkFieldId = isAR ? df['所属应收单']?.id : df['所属应付单']?.id;
  if (!setLinkFieldId) return;

  // 查找该结算单下的所有明细
  const details = await dbAdapter.queryAsync(
    'SELECT r.id FROM records r JOIN links l ON l.from_record_id=r.id WHERE l.field_id=$1 AND l.to_record_id=$2',
    [setLinkFieldId, settlementId]
  );

  let remaining = amount;
  for (const detail of details) {
    if (remaining <= 0) break;
    const totalField = isAR ? df['应收金额']?.id : df['应付金额']?.id;
    const paidField = isAR ? df['已收金额']?.id : df['已付金额']?.id;
    const reversedField = df['红冲金额']?.id;
    const statusField = df['明细状态']?.id;

    const totalRow = await dbAdapter.queryOneAsync('SELECT value FROM cells WHERE record_id=$1 AND field_id=$2', [detail.id, totalField]);
    const total = Math.abs(Number(totalRow?.value || 0));
    const paidRow = await dbAdapter.queryOneAsync('SELECT value FROM cells WHERE record_id=$1 AND field_id=$2', [detail.id, paidField]);
    const paid = Math.abs(Number(paidRow?.value || 0));
    const reversedRow = await dbAdapter.queryOneAsync('SELECT value FROM cells WHERE record_id=$1 AND field_id=$2', [detail.id, reversedField]);
    const reversed = Math.abs(Number(reversedRow?.value || 0));

    const unpaid = Math.max(0, total - paid - reversed);
    if (unpaid <= 0) continue;

    const add = Math.min(remaining, unpaid);
    const newPaid = moneyRound(paid + add);
    await upsertCell(detail.id, paidField, String(newPaid), userId, ts);

    // 更新明细状态
    const newUnpaid = total - newPaid - reversed;
    if (statusField) {
      let newStatus = await cellValue(detail.id, statusField);
      if (newUnpaid <= 0.001) {
        newStatus = isAR ? '已收齐' : '已付清';
      } else if (newPaid > 0) {
        newStatus = isAR ? '部分收款' : '部分付款';
      }
      if (newStatus) await upsertCell(detail.id, statusField, newStatus, userId, ts);
    }

    remaining = moneyRound(remaining - add);
  }
}

async function approveFinanceReversal(recordId, tableId, baseId, userId) {
  await assertRecordWritable(recordId, '红冲处理单已封账，不能重复审批或修改');
  const tableRow = await dbAdapter.queryOneAsync('SELECT name FROM tables WHERE id=$1', [tableId]);
  if (tableRow?.name !== '财务红冲处理区') {
    throw new Error('只能在财务红冲处理区执行红冲');
  }
  const ft = await financeTables(baseId);
  const rf = await fieldsMap(tableId);
  const status = await cellValue(recordId, rf['红冲状态']?.id);
  if (status === '已通过') throw new Error('该红冲单已审核通过，不能重复执行');
  const objectType = await cellValue(recordId, rf['红冲对象类型']?.id);
  const amount = Math.abs(Number(await cellValue(recordId, rf['红冲金额']?.id)) || 0);
  if (!amount) throw new Error('红冲金额必须大于 0');
  const ts = now();
  let createdDetailId = null;
  await dbAdapter.transactionAsync(async () => {
    if (objectType === '应收明细') {
      const originalId = await firstLinkedRecordId(recordId, rf['原应收明细']?.id);
      if (!originalId) throw new Error('必须关联原应收明细');
      const ar = ft['应收结算明细区'];
      const objectId = await firstLinkedRecordId(originalId, ar.fields['结算对象']?.id);
      createdDetailId = await createRecordRaw(ar.table.id, userId, 0, ts);
      await addLinkIfMissing(ar.fields['结算对象']?.id, createdDetailId, objectId, ts);
      const origOrderId = await firstLinkedRecordId(originalId, ar.fields['来源订单']?.id);
      await addLinkIfMissing(ar.fields['来源订单']?.id, createdDetailId, origOrderId, ts);
      await upsertCell(createdDetailId, ar.fields['订单号']?.id, await cellValue(originalId, ar.fields['订单号']?.id), userId, ts);
      await upsertCell(createdDetailId, ar.fields['业务日期']?.id, new Date(ts).toISOString().slice(0, 10), userId, ts);
      await upsertCell(createdDetailId, ar.fields['产品快照']?.id, await cellValue(originalId, ar.fields['产品快照']?.id), userId, ts);
      await upsertCell(createdDetailId, ar.fields['应收金额']?.id, String(-amount), userId, ts);
      await upsertCell(createdDetailId, ar.fields['已收金额']?.id, '0', userId, ts);
      await upsertCell(createdDetailId, ar.fields['红冲金额']?.id, '0', userId, ts);
      await upsertCell(createdDetailId, ar.fields['明细状态']?.id, '红冲明细', userId, ts);
      await upsertCell(createdDetailId, ar.fields['异常说明']?.id, `红冲来源：${await displayValue(recordId, ['红冲单号'])}`, userId, ts);
      await upsertCell(originalId, ar.fields['红冲金额']?.id, String(amount), userId, ts);
      await upsertCell(originalId, ar.fields['明细状态']?.id, '已红冲', userId, ts);
    } else if (objectType === '应付明细') {
      const originalId = await firstLinkedRecordId(recordId, rf['原应付明细']?.id);
      if (!originalId) throw new Error('必须关联原应付明细');
      const ap = ft['应付结算明细区'];
      const objectId = await firstLinkedRecordId(originalId, ap.fields['结算对象']?.id);
      createdDetailId = await createRecordRaw(ap.table.id, userId, 0, ts);
      await addLinkIfMissing(ap.fields['结算对象']?.id, createdDetailId, objectId, ts);
      const origOrderId = await firstLinkedRecordId(originalId, ap.fields['来源订单']?.id);
      await addLinkIfMissing(ap.fields['来源订单']?.id, createdDetailId, origOrderId, ts);
      await upsertCell(createdDetailId, ap.fields['订单号']?.id, await cellValue(originalId, ap.fields['订单号']?.id), userId, ts);
      await upsertCell(createdDetailId, ap.fields['业务日期']?.id, new Date(ts).toISOString().slice(0, 10), userId, ts);
      await upsertCell(createdDetailId, ap.fields['产品快照']?.id, await cellValue(originalId, ap.fields['产品快照']?.id), userId, ts);
      await upsertCell(createdDetailId, ap.fields['应付金额']?.id, String(-amount), userId, ts);
      await upsertCell(createdDetailId, ap.fields['已付金额']?.id, '0', userId, ts);
      await upsertCell(createdDetailId, ap.fields['红冲金额']?.id, '0', userId, ts);
      await upsertCell(createdDetailId, ap.fields['明细状态']?.id, '红冲明细', userId, ts);
      await upsertCell(createdDetailId, ap.fields['异常说明']?.id, `红冲来源：${await displayValue(recordId, ['红冲单号'])}`, userId, ts);
      await upsertCell(originalId, ap.fields['红冲金额']?.id, String(amount), userId, ts);
      await upsertCell(originalId, ap.fields['明细状态']?.id, '已红冲', userId, ts);
    } else {
      throw new Error('第一版只支持应收明细和应付明细红冲');
    }
    await upsertCell(recordId, rf['红冲状态']?.id, '已通过', userId, ts);
    await upsertCell(recordId, rf['处理结果']?.id, `已生成红冲明细：${createdDetailId}`, userId, ts);
    await dbAdapter.writeQueryAsync('UPDATE records SET locked=$1, updated_at=$2 WHERE id=$3', [1, ts, recordId]);
  });
  return { ok: true, action: 'approve_finance_reversal', createdDetailId };
}

module.exports = {
  financeTables,
  financeObjectForResource,
  hasDetailForOrder,
  generateFinanceDetails,
  sealFinanceRecord,
  approveFinanceReversal,
  updateSettlementDetailsPaid,
  moneyRound,
};
