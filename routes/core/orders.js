// V0.3：第二层核心业务路由模块（纯异步版本）
const express = require('express');
const { asyncHandler } = require('../utils');
const dbAdapter = require('../../services/dbAdapter');

module.exports = function registerCoreOrderRoutes(ctx) {
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

router.post('/api/bases/:baseId/templates/order-management', authRequired, asyncHandler(async (req, res) => {
  const { baseId } = req.params;
  if (!(await canManageStructure(baseId, req.user.id))) return res.status(403).json({ error: 'only owner/admin can initialize templates' });
  const base = await dbAdapter.queryOneAsync('SELECT * FROM bases WHERE id=$1', [baseId]);
  if (!base) return res.status(404).json({ error: 'base not found' });
  const existingTables = await dbAdapter.queryAsync('SELECT * FROM tables WHERE base_id=$1', [baseId]);
  const existingNames = existingTables.map(r => r.name);
  if (existingNames.includes('订单管理区')) return res.status(400).json({ error: 'template tables already exist', conflicts: ['订单管理区'] });
  const archive = existingTables.find(t => t.name === '资源档案中心');
  const product = existingTables.find(t => t.name === '产品信息区');
  if (!archive || !product) return res.status(400).json({ error: '资源档案中心和产品信息区必须先创建' });
  const archiveDisplay = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [archive.id, '代码'])
    || await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [archive.id, '企业名称'])
    || await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 ORDER BY position LIMIT 1', [archive.id]);
  const productDisplay = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [product.id, '标题'])
    || await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 ORDER BY position LIMIT 1', [product.id]);
  const productId = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [product.id, '产品ID']) || productDisplay;
  const ts = now();

  await dbAdapter.transactionAsync(async () => {
    let pos = (await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM tables WHERE base_id=$1', [baseId])).c;
    const order = await createTableWithFields(baseId, '订单管理区', [
      { key: 'orderNo', name: '内部订单号', type: 'autoNumber', options: { prefix: 'SO-', start: 1, pad: 6 }, locked: true, width: 140 },
      { key: 'zone', name: '分区', type: 'select', options: normalizeSelectOptions({ values: ['下单区', '待办区', '完结区'] }), width: 120 },
      { key: 'orderStatus', name: '订单状态', type: 'select', options: normalizeSelectOptions({ values: ['正常', '争议', '售后中', '已取消'] }), width: 120 },
      { key: 'product', name: '产品', type: 'link', options: { tableId: product.id, displayFieldId: productDisplay.id, multiple: false }, width: 260 },
      { key: 'productId', name: '产品ID', type: 'lookup', options: { linkFieldId: null, sourceFieldId: productId.id, mode: 'live' }, locked: true, width: 140 },
      { key: 'payer', name: '付款方', type: 'link', options: { tableId: archive.id, displayFieldId: archiveDisplay.id, multiple: false }, width: 170 },
      { key: 'payee', name: '收款方', type: 'link', options: { tableId: archive.id, displayFieldId: archiveDisplay.id, multiple: false }, width: 170 },
      { key: 'qty', name: '数量', type: 'number', width: 90 },
      { key: 'address', name: '地址', type: 'multiLineText', width: 280 },
      { key: 'orderRemark', name: '订单备注', type: 'multiLineText', width: 220 },
      { key: 'placeRemark', name: '下单备注', type: 'multiLineText', width: 240 },
      { key: 'todoReason', name: '不能下单原因', type: 'multiLineText', width: 260 },
      { key: 'acceptedAt', name: '接单日期', type: 'createdTime', locked: true, width: 130 },
      { key: 'completedAt', name: '完结日期', type: 'date', width: 130 },
      { key: 'paidAt', name: '财务付款时间', type: 'date', width: 150 },
      { key: 'externalOrderId', name: '订单ID', type: 'multiLineText', width: 180 },
      { key: 'customerName', name: '姓名', type: 'multiLineText', width: 130 },
      { key: 'phone', name: '电话', type: 'multiLineText', width: 150 },
      { key: 'receivable', name: '应收金额', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 130 },
      { key: 'payable', name: '应付金额', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 130 },
      { key: 'payDiff', name: '付款差额', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 130 },
      { key: 'payDiffNote', name: '付款差额说明', type: 'multiLineText', width: 220 },
      { key: 'receiveDiff', name: '收款差额', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 130 },
      { key: 'receiveDiffNote', name: '收款差额说明', type: 'multiLineText', width: 220 },
      { key: 'actualReceived', name: '实收金额', type: 'formula', options: { expression: '{应收金额} - {付款差额}' }, locked: true, width: 130 },
      { key: 'actualPaid', name: '实付金额', type: 'formula', options: { expression: '{应付金额} - {收款差额}' }, locked: true, width: 130 },
      { key: 'grossProfit', name: '毛利', type: 'formula', options: { expression: '{应收金额} - {付款差额} - {应付金额} + {收款差额}' }, locked: true, width: 120 },
      { key: 'grossRate', name: '毛利率', type: 'formula', options: { expression: '({应收金额} - {付款差额} - {应付金额} + {收款差额}) / ({应收金额} - {付款差额})' }, locked: true, width: 120 },
      { key: 'trackingNo', name: '物流单号', type: 'multiLineText', width: 180 },
      { key: 'trackingNote', name: '物流备注', type: 'multiLineText', width: 220 },
      { key: 'trackingUpdatedAt', name: '物流更新日期', type: 'lastModifiedTime', locked: true, width: 130 },
      { key: 'returnTrackingNo', name: '退货单号', type: 'multiLineText', width: 180 },
      { key: 'afterSaleNote', name: '售后说明', type: 'multiLineText', width: 220 },
      { key: 'responsibleBiz', name: '责任业务', type: 'multiLineText', width: 150 },
      { key: 'orderInfo', name: '订单', type: 'multiLineText', width: 200 },
      { key: 'plannedAt', name: '计划日期', type: 'date', width: 130 },
      { key: 'completionStatus', name: '完结状态', type: 'multiLineText', width: 180 },
      { key: 'reason', name: '事由', type: 'select', options: normalizeSelectOptions({ values: ['订单', '押金返利', '退款', '已取消'] }), width: 120 },
      { key: 'rebateStatus', name: '返利状态', type: 'select', options: normalizeSelectOptions({ values: ['待返利', '客户待返利', '已完结'] }), width: 130 },
      { key: 'rebateNote', name: '返利备注', type: 'multiLineText', width: 220 },
      { key: 'rebateDate', name: '返利日期', type: 'date', width: 130 },
      { key: 'riskWarning', name: '风险预警', type: 'textFormula', options: { expression: '{分区} {订单状态} {完结日期}' }, locked: true, width: 180 },
      { key: 'placeCopy', name: '下单复制区', type: 'textFormula', options: { expression: '{地址} {产品} 数量:{数量} 应收:{应收金额}' }, locked: true, width: 300 },
      { key: 'trackingWarning', name: '单号预警', type: 'textFormula', options: { expression: '{物流单号} {计划日期} {完结状态}' }, locked: true, width: 220 },
      { key: 'trackingCopy', name: '跟单复制区', type: 'textFormula', options: { expression: '{物流单号} {物流备注} {产品}' }, locked: true, width: 300 },
      { key: 'phishingWarning', name: '钓鱼预警', type: 'multiLineText', width: 180 },
      { key: 'snapshotProfit', name: '快照毛利', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 130 },
      { key: 'snapshotReceived', name: '快照实收', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 130 },
      { key: 'snapshotPaid', name: '快照实付', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 130 },
      { key: 'snapshotProduct', name: '快照产品名', type: 'multiLineText', width: 220 },
      { key: 'snapshotPayer', name: '快照付款方名', type: 'multiLineText', width: 180 },
      { key: 'snapshotPayee', name: '快照收款方名', type: 'multiLineText', width: 180 },
      { key: 'commissionSettled', name: '佣金已结算', type: 'checkbox', width: 120 },
      { key: 'commissionBatch', name: '佣金结算批次', type: 'text', width: 160 },
    ], pos++);
    const originFieldId = nanoid();
    await dbAdapter.writeQueryAsync(
      'INSERT INTO fields (id,table_id,name,type,options,locked,width,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [originFieldId, order.tableId, '原订单', 'link', JSON.stringify({ tableId: order.tableId, displayFieldId: order.fields.orderNo, multiple: false }), 0, 180, 999, ts]
    );
    await dbAdapter.writeQueryAsync('UPDATE fields SET options=$1 WHERE id=$2',
      [JSON.stringify({ linkFieldId: order.fields.product, sourceFieldId: productId.id, mode: 'live' }), order.fields.productId]);
    await applyOrderManagementLayout(order.tableId);
  });
  await audit(baseId, req.user.id, 'template.order_management.create', { tables: ['订单管理区'] });
  res.json({ ok: true, tables: ['订单管理区'] });
}));


router.post('/api/bases/:baseId/bulk/orders', authRequired, asyncHandler(async (req, res) => {
  const { baseId } = req.params;
  if (!(await canRunJobs(baseId, req.user.id))) return res.status(403).json({ error: 'only owner/admin/finance can bulk import orders' });
  const rows = Array.isArray(req.body?.orders) ? req.body.orders : [];
  if (!rows.length) return res.status(400).json({ error: 'orders required' });
  if (rows.length > 5000) return res.status(400).json({ error: 'single import limit is 5000 orders' });
  const grid = await makeGrid();
  const orderTable = await grid.table(baseId, '订单管理区');
  if (!orderTable) return res.status(400).json({ error: '订单管理区不存在' });
  const of = await grid.fieldsByName(orderTable.id);
  const ts = now();
  const created = [];
  const errors = [];
  const BATCH_SIZE = 500;
  for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
    const batch = rows.slice(batchStart, batchStart + BATCH_SIZE);
    await dbAdapter.transactionAsync(async () => {
      for (const [index, row] of batch.entries()) {
        const globalIndex = batchStart + index;
        try {
          const orderId = await grid.createRecord(orderTable.id, ts + globalIndex);
          created.push(orderId);
          const set = async (name, value) => {
            if (value === undefined || value === null || value === '') return;
            if (of[name]) await grid.setCell(orderId, of[name].id, value, req.user.id, ts);
          };
          await set('分区', row.zone || '下单区');
          await set('事由', row.reason || '订单');
          await set('佣金已结算', 'false');
          if (row.productId && of['产品']) {
            await grid.addLink(of['产品'].id, orderId, row.productId, ts);
            syncOrderProductDefaults(orderId, row.productId, of['产品'].id, null, req.user.id);
          }
          if (row.payerId && of['付款方']) await grid.addLink(of['付款方'].id, orderId, row.payerId, ts);
          if (row.payeeId && of['收款方']) await grid.addLink(of['收款方'].id, orderId, row.payeeId, ts);
          if (row.originalOrderId && of['原订单']) await grid.addLink(of['原订单'].id, orderId, row.originalOrderId, ts);
          await set('数量', row.quantity);
          await set('地址', row.address);
          await set('订单备注', row.orderRemark);
          await set('下单备注', row.placeRemark);
          await set('不能下单原因', row.todoReason);
          await set('订单状态', row.orderStatus);
          await set('完结日期', row.completedAt);
          await set('财务付款时间', row.paidAt);
          await set('订单ID', row.externalOrderId);
          await set('姓名', row.customerName);
          await set('电话', row.phone);
          await set('应收金额', row.receivable);
          await set('应付金额', row.payable);
          await set('付款差额', row.payDiff);
          await set('付款差额说明', row.payDiffNote);
          await set('收款差额', row.receiveDiff);
          await set('收款差额说明', row.receiveDiffNote);
          await set('返利状态', row.rebateStatus);
          await set('返利备注', row.rebateNote);
          await set('返利日期', row.rebateDate);
        } catch (e) {
          errors.push({ index: globalIndex, message: e.message });
        }
      }
    });
  }
  if (errors.length) throw new Error(`bulk import failed: ${JSON.stringify(errors.slice(0, 5))}`);
  await audit(baseId, req.user.id, 'bulk.orders.import', { count: created.length });
  res.json({ ok: true, createdCount: created.length, recordIds: created });
}));

// V0.3：按钮路由已迁移到 routes/grid/buttons.js
// V0.3：批量操作路由已迁移到 routes/grid/batch.js


  return router;
};
