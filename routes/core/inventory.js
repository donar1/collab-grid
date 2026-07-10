// V0.3：第二层核心业务路由模块（纯异步版本）
const express = require('express');
const { asyncHandler } = require('../utils');
const dbAdapter = require('../../services/dbAdapter');

module.exports = function registerCoreInventoryRoutes(ctx) {
  const router = express.Router();
  const {
    nanoid,
    now,
    authRequired,
    getRole,
    canManageStructure,
    canRunJobs,
    audit,
    createTableWithFields,
    normalizeSelectOptions,
    fieldIdByName,
    applyOrderManagementLayout,
    makeGrid,
    generateFinanceDetails,
    upsertCell,
    tableByName,
    fieldsMap,
    syncOrderProductDefaults,
    applyOrderDefaults
  } = ctx;

router.post('/api/bases/:baseId/templates/inventory', authRequired, asyncHandler(async (req, res) => {
  const { baseId } = req.params;
  if (!(await canManageStructure(baseId, req.user.id))) return res.status(403).json({ error: 'only owner/admin can initialize templates' });
  const base = await dbAdapter.queryOneAsync('SELECT * FROM bases WHERE id=$1', [baseId]);
  if (!base) return res.status(404).json({ error: 'base not found' });
  const existingTables = await dbAdapter.queryAsync('SELECT * FROM tables WHERE base_id=$1', [baseId]);
  const existingNames = existingTables.map(r => r.name);
  const required = ['库存商品区', '出入库操作区', '库存流水区'];
  const conflicts = required.filter(name => existingNames.includes(name));
  if (conflicts.length) return res.status(400).json({ error: 'template tables already exist', conflicts });
  const product = existingTables.find(t => t.name === '产品信息区');
  if (!product) return res.status(400).json({ error: '产品信息区必须先创建' });
  const order = existingTables.find(t => t.name === '订单管理区');
  const productDisplay = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [product.id, '标题'])
    || await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 ORDER BY position LIMIT 1', [product.id]);
  const productId = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [product.id, '产品ID']) || productDisplay;
  const productSku = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [product.id, '货号']) || productDisplay;
  const productCost = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [product.id, '成本']) || productDisplay;
  const warehouseOptions = normalizeSelectOptions({ values: ['本部仓', '客户预存仓', '供应商仓', '临时仓', '其他'] });
  await dbAdapter.transactionAsync(async () => {
    let pos = (await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM tables WHERE base_id=$1', [baseId])).c;
    const inventory = await createTableWithFields(baseId, '库存商品区', [
      { key: 'stockNo', name: '库存编号', type: 'autoNumber', options: { prefix: 'INV-', start: 1, pad: 6 }, locked: true, width: 130 },
      { key: 'product', name: '产品', type: 'link', options: { tableId: product.id, displayFieldId: productDisplay.id, multiple: false }, width: 260 },
      { key: 'productId', name: '产品ID', type: 'lookup', options: { linkFieldId: null, sourceFieldId: productId.id, mode: 'live' }, locked: true, width: 140 },
      { key: 'sku', name: '货号', type: 'lookup', options: { linkFieldId: null, sourceFieldId: productSku.id, mode: 'live' }, locked: true, width: 150 },
      { key: 'enabled', name: '是否启用库存', type: 'checkbox', width: 120 },
      { key: 'stockMode', name: '入库类型', type: 'select', options: normalizeSelectOptions({ values: ['实际入库', '虚拟入库', '实际+虚拟'] }), width: 130 },
      { key: 'warehouse', name: '所属仓储', type: 'select', options: warehouseOptions, width: 140 },
      { key: 'actualQty', name: '当前实际库存', type: 'number', locked: true, width: 130 },
      { key: 'virtualQty', name: '当前虚拟库存', type: 'number', locked: true, width: 130 },
      { key: 'lockedQty', name: '锁定库存', type: 'number', locked: true, width: 110 },
      { key: 'availableQty', name: '可用库存', type: 'formula', options: { expression: '{当前实际库存} + {当前虚拟库存} - {锁定库存}' }, locked: true, width: 110 },
      { key: 'warningQty', name: '预警库存', type: 'number', width: 110 },
      { key: 'currentCost', name: '当前成本', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 120 },
      { key: 'lastCost', name: '最近入库成本', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'remark', name: '库存备注', type: 'multiLineText', width: 240 },
    ], pos++);
    await dbAdapter.writeQueryAsync('UPDATE fields SET options=$1 WHERE id=$2', [JSON.stringify({ linkFieldId: inventory.fields.product, sourceFieldId: productId.id, mode: 'live' }), inventory.fields.productId]);
    await dbAdapter.writeQueryAsync('UPDATE fields SET options=$1 WHERE id=$2', [JSON.stringify({ linkFieldId: inventory.fields.product, sourceFieldId: productSku.id, mode: 'live' }), inventory.fields.sku]);

    const operation = await createTableWithFields(baseId, '出入库操作区', [
      { key: 'opNo', name: '操作编号', type: 'autoNumber', options: { prefix: 'STK-', start: 1, pad: 6 }, locked: true, width: 130 },
      { key: 'opType', name: '操作类型', type: 'select', options: normalizeSelectOptions({ values: ['入库', '出库', '调整'] }), width: 110 },
      { key: 'inboundKind', name: '入库状态', type: 'select', options: normalizeSelectOptions({ values: ['实际入库', '虚拟入库'] }), width: 130 },
      { key: 'stockItem', name: '库存商品', type: 'link', options: { tableId: inventory.tableId, displayFieldId: inventory.fields.stockNo, multiple: false }, width: 180 },
      { key: 'order', name: '关联订单', type: order ? 'link' : 'text', options: order ? { tableId: order.id, displayFieldId: await fieldIdByName(order.id, '内部订单号') || productDisplay.id, multiple: false } : null, width: 180 },
      { key: 'qty', name: '数量', type: 'number', width: 90 },
      { key: 'warehouse', name: '所属仓储', type: 'select', options: warehouseOptions, width: 140 },
      { key: 'payerText', name: '付款方文本', type: 'text', width: 150 },
      { key: 'inboundCost', name: '入库成本', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 120 },
      { key: 'status', name: '审核状态', type: 'select', options: normalizeSelectOptions({ values: ['待审核', '已通过', '已通过-非自营不扣库存', '已驳回'] }), width: 180 },
      { key: 'result', name: '库存变动结果', type: 'multiLineText', locked: true, width: 260 },
      { key: 'approver', name: '审核人', type: 'lastModifiedBy', locked: true, width: 130 },
      { key: 'approvalTime', name: '审核时间', type: 'lastModifiedTime', locked: true, width: 130 },
      { key: 'note', name: '备注', type: 'multiLineText', width: 220 },
      { key: 'approve', name: '审核通过', type: 'button', options: { label: '审核通过', action: 'approve_inventory_operation' }, width: 130 },
    ], pos++);

    const ledger = await createTableWithFields(baseId, '库存流水区', [
      { key: 'ledgerNo', name: '流水编号', type: 'autoNumber', options: { prefix: 'STKL-', start: 1, pad: 6 }, locked: true, width: 140 },
      { key: 'flowType', name: '流水类型', type: 'select', options: normalizeSelectOptions({ values: ['实际入库', '虚拟入库', '自营出库', '实际调整', '虚拟调整'] }), locked: true, width: 130 },
      { key: 'stockItem', name: '库存商品', type: 'link', options: { tableId: inventory.tableId, displayFieldId: inventory.fields.stockNo, multiple: false }, locked: true, width: 180 },
      { key: 'sourceOp', name: '来源操作', type: 'link', options: { tableId: operation.tableId, displayFieldId: operation.fields.opNo, multiple: false }, locked: true, width: 180 },
      { key: 'changedQty', name: '变动数量', type: 'number', locked: true, width: 110 },
      { key: 'actualBefore', name: '变动前实际库存', type: 'number', locked: true, width: 140 },
      { key: 'actualAfter', name: '变动后实际库存', type: 'number', locked: true, width: 140 },
      { key: 'virtualBefore', name: '变动前虚拟库存', type: 'number', locked: true, width: 140 },
      { key: 'virtualAfter', name: '变动后虚拟库存', type: 'number', locked: true, width: 140 },
      { key: 'warehouse', name: '所属仓储', type: 'select', options: warehouseOptions, locked: true, width: 140 },
      { key: 'oldCost', name: '原成本', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 110 },
      { key: 'inboundCost', name: '入库成本', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 110 },
      { key: 'costChanged', name: '成本是否变更', type: 'checkbox', locked: true, width: 120 },
      { key: 'created', name: '创建时间', type: 'createdTime', locked: true, width: 130 },
    ], pos++);
    void ledger;
  });
  await audit(baseId, req.user.id, 'template.inventory.create', { tables: required });
  res.json({ ok: true, tables: required });
}));



  return router;
};
