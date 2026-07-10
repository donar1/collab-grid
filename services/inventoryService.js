// services/inventoryService.js — 库存相关业务函数
// 从 server.js 提取（仅异步/PostgreSQL 模式）

const { nanoid, now, cellValue, fieldsMap, fieldIdByName, firstLinkedRecordId,
        addLinkIfMissing, createRecordRaw, displayValue, upsertCell,
        assertRecordWritable, broadcast, tableByName } = require('./helpers');
const dbAdapter = require('./dbAdapter');

async function linkedProductFromInventoryRecord(inventoryRecordId, inventoryFields) {
  return await firstLinkedRecordId(inventoryRecordId, inventoryFields['产品']?.id);
}

async function inventoryOperationPayerName(opRecordId, opFields) {
  const manual = (await cellValue(opRecordId, opFields['付款方文本']?.id)).trim();
  if (manual) return manual;
  const orderId = await firstLinkedRecordId(opRecordId, opFields['关联订单']?.id);
  if (!orderId) return '';
  const orderTableId = (await dbAdapter.queryOneAsync('SELECT table_id FROM records WHERE id=$1', [orderId]))?.table_id;
  if (!orderTableId) return '';
  const payerFieldId = await fieldIdByName(orderTableId, '付款方');
  const payerId = await firstLinkedRecordId(orderId, payerFieldId);
  return payerId ? await displayValue(payerId, ['企业名称', '代码', '名称']) : '';
}

async function approveInventoryOperation(recordId, operationTableId, baseId, userId) {
  await assertRecordWritable(recordId, '出入库操作已封账，不能重复审批或修改');
  const opFields = await fieldsMap(operationTableId);
  const status = await cellValue(recordId, opFields['审核状态']?.id);
  if (status.startsWith('已通过')) throw new Error('该出入库操作已审核通过，不能重复执行');
  const operationType = await cellValue(recordId, opFields['操作类型']?.id);
  const inboundKind = await cellValue(recordId, opFields['入库状态']?.id) || '实际入库';
  const qtyRaw = Number(await cellValue(recordId, opFields['数量']?.id));
  if (!operationType) throw new Error('请选择操作类型');
  if (!Number.isFinite(qtyRaw) || qtyRaw === 0) throw new Error('数量必须填写且不能为 0');
  const qty = operationType === '调整' ? qtyRaw : Math.abs(qtyRaw);
  const stockRecordId = await firstLinkedRecordId(recordId, opFields['库存商品']?.id);
  if (!stockRecordId) throw new Error('必须关联库存商品');
  await assertRecordWritable(stockRecordId, '库存商品已封账，不能通过出入库审批修改库存');
  const inventoryTable = await tableByName(baseId, '库存商品区');
  const ledgerTable = await tableByName(baseId, '库存流水区');
  if (!inventoryTable || !ledgerTable) throw new Error('库存系统表缺失');
  const invFields = await fieldsMap(inventoryTable.id);
  const ledgerFields = await fieldsMap(ledgerTable.id);
  const enabled = await cellValue(stockRecordId, invFields['是否启用库存']?.id);
  if (enabled && enabled !== 'true') throw new Error('该库存商品未启用库存');
  const warehouse = await cellValue(recordId, opFields['所属仓储']?.id) || await cellValue(stockRecordId, invFields['所属仓储']?.id);
  let flowType = operationType;
  let changedQty = 0;
  let noStockDeduct = false;

  const ts = now();
  await dbAdapter.transactionAsync(async () => {
    const actualBefore = Number(await cellValue(stockRecordId, invFields['当前实际库存']?.id)) || 0;
    const virtualBefore = Number(await cellValue(stockRecordId, invFields['当前虚拟库存']?.id)) || 0;
    let actualAfter = actualBefore;
    let virtualAfter = virtualBefore;

    if (operationType === '入库') {
      if (inboundKind === '虚拟入库') {
        virtualAfter += qty;
        flowType = '虚拟入库';
      } else {
        actualAfter += qty;
        flowType = '实际入库';
      }
      changedQty = qty;
    } else if (operationType === '出库') {
      const payerName = await inventoryOperationPayerName(recordId, opFields);
      if (payerName !== '自营') {
        noStockDeduct = true;
        flowType = '非自营出库';
        changedQty = 0;
      } else {
        if (actualBefore < qty) throw new Error(`实际库存不足：当前 ${actualBefore}，需要 ${qty}`);
        actualAfter -= qty;
        flowType = '自营出库';
        changedQty = -qty;
      }
    } else if (operationType === '调整') {
      if (inboundKind === '虚拟入库') {
        if (virtualBefore + qty < 0) throw new Error('虚拟库存调整后不能为负数');
        virtualAfter += qty;
      } else {
        if (actualBefore + qty < 0) throw new Error('实际库存调整后不能为负数');
        actualAfter += qty;
      }
      flowType = inboundKind === '虚拟入库' ? '虚拟调整' : '实际调整';
      changedQty = qty;
    } else {
      throw new Error('操作类型必须是入库、出库或调整');
    }

    if (!noStockDeduct) {
      await upsertCell(stockRecordId, invFields['当前实际库存']?.id, String(actualAfter), userId, ts);
      await upsertCell(stockRecordId, invFields['当前虚拟库存']?.id, String(virtualAfter), userId, ts);
    }
    const oldCost = Number(await cellValue(stockRecordId, invFields['当前成本']?.id)) || 0;
    const inboundCostRaw = await cellValue(recordId, opFields['入库成本']?.id);
    const inboundCost = inboundCostRaw === '' ? null : Number(inboundCostRaw);
    let costChanged = false;
    if (operationType === '入库' && inboundCost != null && Number.isFinite(inboundCost)) {
      costChanged = oldCost !== inboundCost;
      await upsertCell(stockRecordId, invFields['最近入库成本']?.id, String(inboundCost), userId, ts);
      await upsertCell(stockRecordId, invFields['当前成本']?.id, String(inboundCost), userId, ts);
      const productRecordId = await firstLinkedRecordId(stockRecordId, invFields['产品']?.id);
      const productTableId = productRecordId ? (await dbAdapter.queryOneAsync('SELECT table_id FROM records WHERE id=$1', [productRecordId]))?.table_id : null;
      const productCostFieldId = productTableId ? await fieldIdByName(productTableId, '成本') : null;
      if (productCostFieldId) await assertRecordWritable(productRecordId, '关联产品已封账，不能通过入库审批修改成本');
      if (productCostFieldId) await upsertCell(productRecordId, productCostFieldId, String(inboundCost), userId, ts);
    }

    await upsertCell(recordId, opFields['审核状态']?.id, noStockDeduct ? '已通过-非自营不扣库存' : '已通过', userId, ts);
    await upsertCell(recordId, opFields['库存变动结果']?.id, noStockDeduct ? '付款方不是自营，审核通过但不扣减库存' : `库存已更新：${changedQty}`, userId, ts);
    await dbAdapter.writeQueryAsync('UPDATE records SET updated_at=$1 WHERE id=$2', [ts, recordId]);

    if (!noStockDeduct) {
      const ledgerId = nanoid();
      const maxPos = (await dbAdapter.queryOneAsync('SELECT MAX(position) AS m FROM records WHERE table_id=$1', [ledgerTable.id]))?.m || 0;
      await dbAdapter.writeQueryAsync(
        'INSERT INTO records (id,table_id,position,locked,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [ledgerId, ledgerTable.id, maxPos + 1, 1, ts, ts]
      );
      await addLinkIfMissing(ledgerFields['库存商品']?.id, ledgerId, stockRecordId, ts);
      await addLinkIfMissing(ledgerFields['来源操作']?.id, ledgerId, recordId, ts);
      await upsertCell(ledgerId, ledgerFields['流水类型']?.id, flowType, userId, ts);
      await upsertCell(ledgerId, ledgerFields['变动数量']?.id, String(changedQty), userId, ts);
      await upsertCell(ledgerId, ledgerFields['变动前实际库存']?.id, String(actualBefore), userId, ts);
      await upsertCell(ledgerId, ledgerFields['变动后实际库存']?.id, String(actualAfter), userId, ts);
      await upsertCell(ledgerId, ledgerFields['变动前虚拟库存']?.id, String(virtualBefore), userId, ts);
      await upsertCell(ledgerId, ledgerFields['变动后虚拟库存']?.id, String(virtualAfter), userId, ts);
      await upsertCell(ledgerId, ledgerFields['所属仓储']?.id, warehouse, userId, ts);
      await upsertCell(ledgerId, ledgerFields['原成本']?.id, String(oldCost), userId, ts);
      if (inboundCost != null && Number.isFinite(inboundCost)) await upsertCell(ledgerId, ledgerFields['入库成本']?.id, String(inboundCost), userId, ts);
      await upsertCell(ledgerId, ledgerFields['成本是否变更']?.id, costChanged ? 'true' : 'false', userId, ts);
    }
  });
  return { ok: true, action: 'approve_inventory_operation', noStockDeduct, changedQty, actualBefore, actualAfter, virtualBefore, virtualAfter };
}

module.exports = {
  inventoryOperationPayerName,
  linkedProductFromInventoryRecord,
  approveInventoryOperation,
};
