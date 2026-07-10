// routes/templates.js — 业务模板路由
const express = require('express');
const { asyncHandler } = require('./utils');

module.exports = function registerTemplateRoutes({
  authRequired,
  ctx,
  dbAdapter,
  orderService,
  inventoryService,
  financeService,
}) {
  const router = express.Router();

  // 核心业务模板初始化
  router.post('/bases/:baseId/templates/business-core', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await ctx.canManageStructure(baseId, req.user.id))) return res.status(403).json({ error: 'only roles with structure.write can initialize templates' });
    const base = await dbAdapter.queryOneAsync('SELECT * FROM bases WHERE id=$1', [baseId]);
    if (!base) return res.status(404).json({ error: 'base not found' });
    const existing = (await dbAdapter.queryAsync('SELECT name FROM tables WHERE base_id=$1', [baseId])).map(r => r.name);
    const required = ['产品表', '销售订单表', '采购订单表', '库存表', '结算表', '退款表', '客户账户表', '资金流水表', '预存设备表', '设备使用记录表'];
    const conflicts = required.filter(name => existing.includes(name));
    if (conflicts.length) return res.status(400).json({ error: 'template tables already exist', conflicts });

    let pos = (await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM tables WHERE base_id=$1', [baseId])).c;
      const product = await ctx.createTableWithFields(baseId, '产品表', [
        { key: 'productNo', name: '产品ID', type: 'autoNumber', options: { prefix: 'PRO-', start: 1, pad: 4 }, locked: true, width: 140 },
        { key: 'name', name: '产品名称', type: 'text', width: 220 },
        { key: 'spec', name: '规格', type: 'text' },
        { key: 'price', name: '销售单价', type: 'currency', options: { symbol: '¥', precision: 2 } },
        { key: 'cost', name: '成本单价', type: 'currency', options: { symbol: '¥', precision: 2 } },
        { key: 'warn', name: '库存预警下限', type: 'number' },
        { key: 'created', name: '创建时间', type: 'createdTime', locked: true },
      ], pos++);
      const customer = await ctx.createTableWithFields(baseId, '客户账户表', [
        { key: 'accountNo', name: '账户编号', type: 'autoNumber', options: { prefix: 'ZH-', start: 1, pad: 4 }, locked: true },
        { key: 'name', name: '客户名称', type: 'text' },
        { key: 'phone', name: '联系电话', type: 'text' },
        { key: 'balance', name: '账户余额', type: 'currency', options: { symbol: '¥', precision: 2 } },
        { key: 'status', name: '状态', type: 'select', options: ctx.normalizeSelectOptions({ values: [{ label: '正常', color: '#10b981' }, { label: '冻结', color: '#ef4444' }] }) },
      ], pos++);
      const sales = await ctx.createTableWithFields(baseId, '销售订单表', [
        { key: 'orderNo', name: '订单编号', type: 'autoNumber', options: { prefix: 'XS-', start: 1, pad: 6 }, locked: true, width: 150 },
        { key: 'customer', name: '客户', type: 'link', options: { tableId: customer.tableId, displayFieldId: customer.fields.name, multiple: false }, width: 180 },
        { key: 'product', name: '产品', type: 'link', options: { tableId: product.tableId, displayFieldId: product.fields.name, multiple: false }, width: 180 },
        { key: 'qty', name: '数量', type: 'number' },
        { key: 'unitPrice', name: '单价', type: 'currency', options: { symbol: '¥', precision: 2 } },
        { key: 'total', name: '总金额', type: 'formula', options: { expression: '{数量} * {单价}' }, locked: true },
        { key: 'status', name: '订单状态', type: 'select', options: ctx.normalizeSelectOptions({ values: [{ label: '待发货', color: '#f59e0b' }, { label: '已发货', color: '#3b82f6' }, { label: '已完成', color: '#10b981' }, { label: '已红冲', color: '#ef4444' }] }) },
        { key: 'seal', name: '封账', type: 'button', options: { label: '封账', action: 'seal_record' } },
      ], pos++);
      await ctx.createTableWithFields(baseId, '采购订单表', [
        { name: '采购编号', type: 'autoNumber', options: { prefix: 'CG-', start: 1, pad: 6 }, locked: true },
        { name: '供应商', type: 'text' },
        { name: '产品', type: 'link', options: { tableId: product.tableId, displayFieldId: product.fields.name, multiple: false } },
        { name: '数量', type: 'number' },
        { name: '采购单价', type: 'currency', options: { symbol: '¥', precision: 2 } },
        { name: '入库状态', type: 'select', options: ctx.normalizeSelectOptions({ values: ['待入库', '已入库'] }) },
      ], pos++);
      await ctx.createTableWithFields(baseId, '库存表', [
        { name: '库存编号', type: 'autoNumber', options: { prefix: 'KC-', start: 1, pad: 4 }, locked: true },
        { name: '产品', type: 'link', options: { tableId: product.tableId, displayFieldId: product.fields.name, multiple: false } },
        { name: '当前库存', type: 'number' },
        { name: '入库总量', type: 'number' },
        { name: '出库总量', type: 'number' },
        { name: '最后更新时间', type: 'createdTime', locked: true },
      ], pos++);
      await ctx.createTableWithFields(baseId, '结算表', [
        { name: '结算编号', type: 'autoNumber', options: { prefix: 'SET-', start: 1, pad: 4 }, locked: true },
        { name: '销售订单', type: 'link', options: { tableId: sales.tableId, displayFieldId: sales.fields.orderNo, multiple: false } },
        { name: '应收金额', type: 'currency', options: { symbol: '¥', precision: 2 } },
        { name: '实收金额', type: 'currency', options: { symbol: '¥', precision: 2 } },
        { name: '结算状态', type: 'select', options: ctx.normalizeSelectOptions({ values: ['待结算', '部分结算', '已结算'] }) },
        { name: '封账', type: 'button', options: { label: '封账', action: 'seal_record' } },
      ], pos++);
      await ctx.createTableWithFields(baseId, '退款表', [
        { name: '退款单号', type: 'autoNumber', options: { prefix: 'TK-', start: 1, pad: 4 }, locked: true },
        { name: '销售订单', type: 'link', options: { tableId: sales.tableId, displayFieldId: sales.fields.orderNo, multiple: false } },
        { name: '退款金额', type: 'currency', options: { symbol: '¥', precision: 2 } },
        { name: '原因', type: 'text' },
      ], pos++);
      await ctx.createTableWithFields(baseId, '资金流水表', [
        { name: '流水号', type: 'autoNumber', options: { prefix: 'LS-', start: 1, pad: 6 }, locked: true },
        { name: '客户账户', type: 'link', options: { tableId: customer.tableId, displayFieldId: customer.fields.name, multiple: false } },
        { name: '交易类型', type: 'select', options: ctx.normalizeSelectOptions({ values: ['充值', '消费', '退款', '红冲'] }) },
        { name: '交易金额', type: 'currency', options: { symbol: '¥', precision: 2 } },
        { name: '余额快照', type: 'currency', options: { symbol: '¥', precision: 2 } },
        { name: '封账', type: 'button', options: { label: '封账', action: 'seal_record' } },
      ], pos++);
      const device = await ctx.createTableWithFields(baseId, '预存设备表', [
        { key: 'deviceNo', name: '设备编号', type: 'autoNumber', options: { prefix: 'DEV-', start: 1, pad: 4 }, locked: true },
        { key: 'customer', name: '客户账户', type: 'link', options: { tableId: customer.tableId, displayFieldId: customer.fields.name, multiple: false } },
        { key: 'total', name: '预存总量', type: 'number' },
        { key: 'used', name: '已使用量', type: 'number' },
        { key: 'remain', name: '剩余量', type: 'formula', options: { expression: '{预存总量} - {已使用量}' }, locked: true },
      ], pos++);
      await ctx.createTableWithFields(baseId, '设备使用记录表', [
        { name: '使用记录号', type: 'autoNumber', options: { prefix: 'USE-', start: 1, pad: 6 }, locked: true },
        { name: '设备', type: 'link', options: { tableId: device.tableId, displayFieldId: device.fields.deviceNo, multiple: false } },
        { name: '使用量', type: 'number' },
        { name: '使用金额', type: 'currency', options: { symbol: '¥', precision: 2 } },
      ], pos++);
    await ctx.audit(baseId, req.user.id, 'template.business_core.create', { tables: required });
    res.json({ ok: true, tables: required });
  }));

  return router;
};
