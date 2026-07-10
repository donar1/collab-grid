// V0.3：第二层核心业务路由模块（纯异步版本）
const express = require('express');
const { asyncHandler } = require('../utils');
const dbAdapter = require('../../services/dbAdapter');

module.exports = function registerCoreBillRoutes(ctx) {
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

router.post('/api/bases/:baseId/templates/finance-reconciliation', authRequired, asyncHandler(async (req, res) => {
  const { baseId } = req.params;
  if (!(await canManageStructure(baseId, req.user.id))) return res.status(403).json({ error: 'only owner/admin can initialize templates' });
  const base = await dbAdapter.queryOneAsync('SELECT * FROM bases WHERE id=$1', [baseId]);
  if (!base) return res.status(404).json({ error: 'base not found' });
  const existingTables = await dbAdapter.queryAsync('SELECT * FROM tables WHERE base_id=$1', [baseId]);
  const existingNames = existingTables.map(r => r.name);
  const required = ['财务结算对象区', '应收结算明细区', '应付结算明细区', '应收结算单区', '应付结算单区', '收付款流水区', '财务红冲处理区', '退款处理区', '撤单处理区'];
  const conflicts = required.filter(name => existingNames.includes(name));
  if (conflicts.length) return res.status(400).json({ error: 'template tables already exist', conflicts });
  const archive = existingTables.find(t => t.name === '资源档案中心');
  const order = existingTables.find(t => t.name === '订单管理区');
  if (!archive || !order) return res.status(400).json({ error: '资源档案中心和订单管理区必须先创建' });
  const archiveDisplay = await fieldIdByName(archive.id, '企业名称') || await fieldIdByName(archive.id, '代码') || (await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 ORDER BY position LIMIT 1', [archive.id]))?.id;
  const orderDisplay = await fieldIdByName(order.id, '内部订单号') || (await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 ORDER BY position LIMIT 1', [order.id]))?.id;
  const payMethods = normalizeSelectOptions({ values: ['对公', '支付宝', '微信', '现金', '其他'] });
  await dbAdapter.transactionAsync(async () => {
    let pos = (await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM tables WHERE base_id=$1', [baseId])).c;
    const object = await createTableWithFields(baseId, '财务结算对象区', [
      { key: 'objectNo', name: '结算对象编号', type: 'autoNumber', options: { prefix: 'FIN-C-', start: 1, pad: 6 }, locked: true, width: 150 },
      { key: 'object', name: '结算对象', type: 'link', options: { tableId: archive.id, displayFieldId: archiveDisplay, multiple: false }, width: 220 },
      { key: 'objectName', name: '对象名称', type: 'text', locked: true, width: 220 },
      { key: 'objectType', name: '结算对象类型', type: 'select', options: normalizeSelectOptions({ values: ['客户', '供应商', '渠道', '自营', '其他'] }), width: 140 },
      { key: 'enabled', name: '是否启用结算', type: 'checkbox', width: 130 },
      { key: 'cycle', name: '默认结算周期', type: 'select', options: normalizeSelectOptions({ values: ['日结', '周结', '月结', '单笔结'] }), width: 130 },
      { key: 'receiveMethod', name: '默认收款方式', type: 'select', options: payMethods, width: 140 },
      { key: 'payMethod', name: '默认付款方式', type: 'select', options: payMethods, width: 140 },
      { key: 'invoice', name: '开票要求', type: 'select', options: normalizeSelectOptions({ values: ['不开发票', '普票', '专票', '待确认'] }), width: 130 },
      { key: 'remark', name: '财务备注', type: 'multiLineText', width: 260 },
    ], pos++);

    const ar = await createTableWithFields(baseId, '应收结算明细区', [
      { key: 'detailNo', name: '应收明细编号', type: 'autoNumber', options: { prefix: 'AR-D-', start: 1, pad: 6 }, locked: true, width: 150 },
      { key: 'object', name: '结算对象', type: 'link', options: { tableId: object.tableId, displayFieldId: object.fields.objectNo, multiple: false }, locked: true, width: 180 },
      { key: 'order', name: '来源订单', type: 'link', options: { tableId: order.id, displayFieldId: orderDisplay, multiple: false }, locked: true, width: 180 },
      { key: 'orderNo', name: '订单号', type: 'text', locked: true, width: 160 },
      { key: 'bizDate', name: '业务日期', type: 'date', locked: true, width: 130 },
      { key: 'productSnapshot', name: '产品快照', type: 'multiLineText', locked: true, width: 220 },
      { key: 'amount', name: '应收金额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'received', name: '已收金额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'reversed', name: '红冲金额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'unreceived', name: '未收金额', type: 'formula', options: { expression: '{应收金额} - {已收金额} - {红冲金额}' }, locked: true, width: 130 },
      { key: 'status', name: '明细状态', type: 'select', options: normalizeSelectOptions({ values: ['待结算', '已纳入结算', '部分收款', '已收齐', '已封账', '已红冲', '红冲明细'] }), width: 150 },
      { key: 'settlement', name: '结算单', type: 'link', options: { tableId: '', displayFieldId: '', multiple: false }, width: 180 },
      { key: 'sealed', name: '是否封账', type: 'checkbox', locked: true, width: 110 },
      { key: 'snapshot', name: '原始快照', type: 'multiLineText', locked: true, width: 260 },
      { key: 'exception', name: '异常说明', type: 'multiLineText', width: 240 },
      { key: 'seal', name: '封账', type: 'button', options: { label: '封账', action: 'seal_finance_record' }, width: 110 },
    ], pos++);

    const ap = await createTableWithFields(baseId, '应付结算明细区', [
      { key: 'detailNo', name: '应付明细编号', type: 'autoNumber', options: { prefix: 'AP-D-', start: 1, pad: 6 }, locked: true, width: 150 },
      { key: 'object', name: '结算对象', type: 'link', options: { tableId: object.tableId, displayFieldId: object.fields.objectNo, multiple: false }, locked: true, width: 180 },
      { key: 'order', name: '来源订单', type: 'link', options: { tableId: order.id, displayFieldId: orderDisplay, multiple: false }, locked: true, width: 180 },
      { key: 'orderNo', name: '订单号', type: 'text', locked: true, width: 160 },
      { key: 'bizDate', name: '业务日期', type: 'date', locked: true, width: 130 },
      { key: 'productSnapshot', name: '产品快照', type: 'multiLineText', locked: true, width: 220 },
      { key: 'amount', name: '应付金额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'paid', name: '已付金额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'reversed', name: '红冲金额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'unpaid', name: '未付金额', type: 'formula', options: { expression: '{应付金额} - {已付金额} - {红冲金额}' }, locked: true, width: 130 },
      { key: 'status', name: '明细状态', type: 'select', options: normalizeSelectOptions({ values: ['待结算', '已纳入结算', '部分付款', '已付清', '已封账', '已红冲', '红冲明细'] }), width: 150 },
      { key: 'settlement', name: '结算单', type: 'link', options: { tableId: '', displayFieldId: '', multiple: false }, width: 180 },
      { key: 'sealed', name: '是否封账', type: 'checkbox', locked: true, width: 110 },
      { key: 'snapshot', name: '原始快照', type: 'multiLineText', locked: true, width: 260 },
      { key: 'exception', name: '异常说明', type: 'multiLineText', width: 240 },
      { key: 'seal', name: '封账', type: 'button', options: { label: '封账', action: 'seal_finance_record' }, width: 110 },
    ], pos++);

    const arSet = await createTableWithFields(baseId, '应收结算单区', [
      { key: 'settlementNo', name: '应收结算单号', type: 'autoNumber', options: { prefix: 'AR-S-', start: 1, pad: 6 }, locked: true, width: 150 },
      { key: 'object', name: '结算对象', type: 'link', options: { tableId: object.tableId, displayFieldId: object.fields.objectNo, multiple: false }, width: 180 },
      { key: 'cycle', name: '结算周期', type: 'select', options: normalizeSelectOptions({ values: ['日结', '周结', '月结', '单笔结'] }), width: 120 },
      { key: 'start', name: '结算开始日', type: 'date', width: 130 },
      { key: 'end', name: '结算结束日', type: 'date', width: 130 },
      { key: 'amount', name: '应收总额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'received', name: '已收总额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'unreceived', name: '未收总额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'status', name: '结算状态', type: 'select', options: normalizeSelectOptions({ values: ['草稿', '待确认', '已确认', '部分收款', '已收齐', '已封账', '已红冲'] }), width: 130 },
      { key: 'sealed', name: '是否封账', type: 'checkbox', locked: true, width: 110 },
      { key: 'remark', name: '财务备注', type: 'multiLineText', width: 240 },
      { key: 'seal', name: '封账', type: 'button', options: { label: '封账', action: 'seal_finance_record' }, width: 110 },
    ], pos++);

    const apSet = await createTableWithFields(baseId, '应付结算单区', [
      { key: 'settlementNo', name: '应付结算单号', type: 'autoNumber', options: { prefix: 'AP-S-', start: 1, pad: 6 }, locked: true, width: 150 },
      { key: 'object', name: '结算对象', type: 'link', options: { tableId: object.tableId, displayFieldId: object.fields.objectNo, multiple: false }, width: 180 },
      { key: 'cycle', name: '结算周期', type: 'select', options: normalizeSelectOptions({ values: ['日结', '周结', '月结', '单笔结'] }), width: 120 },
      { key: 'start', name: '结算开始日', type: 'date', width: 130 },
      { key: 'end', name: '结算结束日', type: 'date', width: 130 },
      { key: 'amount', name: '应付总额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'paid', name: '已付总额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'unpaid', name: '未付总额', type: 'currency', options: { symbol: '¥', precision: 2 }, locked: true, width: 130 },
      { key: 'status', name: '结算状态', type: 'select', options: normalizeSelectOptions({ values: ['草稿', '待确认', '已确认', '部分付款', '已付清', '已封账', '已红冲'] }), width: 130 },
      { key: 'sealed', name: '是否封账', type: 'checkbox', locked: true, width: 110 },
      { key: 'remark', name: '财务备注', type: 'multiLineText', width: 240 },
      { key: 'seal', name: '封账', type: 'button', options: { label: '封账', action: 'seal_finance_record' }, width: 110 },
    ], pos++);
    await dbAdapter.writeQueryAsync('UPDATE fields SET options=$1 WHERE id=$2', [JSON.stringify({ tableId: arSet.tableId, displayFieldId: arSet.fields.settlementNo, multiple: false }), ar.fields.settlement]);
    await dbAdapter.writeQueryAsync('UPDATE fields SET options=$1 WHERE id=$2', [JSON.stringify({ tableId: apSet.tableId, displayFieldId: apSet.fields.settlementNo, multiple: false }), ap.fields.settlement]);

    await createTableWithFields(baseId, '收付款流水区', [
      { key: 'flowNo', name: '流水编号', type: 'autoNumber', options: { prefix: 'PAY-', start: 1, pad: 6 }, locked: true, width: 140 },
      { key: 'direction', name: '流水方向', type: 'select', options: normalizeSelectOptions({ values: ['收款', '付款'] }), width: 110 },
      { key: 'object', name: '结算对象', type: 'link', options: { tableId: object.tableId, displayFieldId: object.fields.objectNo, multiple: false }, width: 180 },
      { key: 'arSet', name: '关联应收结算单', type: 'link', options: { tableId: arSet.tableId, displayFieldId: arSet.fields.settlementNo, multiple: false }, width: 180 },
      { key: 'apSet', name: '关联应付结算单', type: 'link', options: { tableId: apSet.tableId, displayFieldId: apSet.fields.settlementNo, multiple: false }, width: 180 },
      { key: 'amount', name: '金额', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 120 },
      { key: 'date', name: '收付款日期', type: 'date', width: 130 },
      { key: 'method', name: '收付款方式', type: 'select', options: payMethods, width: 130 },
      { key: 'proof', name: '凭证', type: 'attachment', width: 220 },
      { key: 'status', name: '流水状态', type: 'select', options: normalizeSelectOptions({ values: ['待确认', '已确认', '已作废', '已封账', '已红冲'] }), width: 130 },
      { key: 'confirmAt', name: '财务确认时间', type: 'lastModifiedTime', locked: true, width: 140 },
      { key: 'remark', name: '备注', type: 'multiLineText', width: 220 },
      { key: 'seal', name: '封账', type: 'button', options: { label: '封账', action: 'seal_finance_record' }, width: 110 },
    ], pos++);

    await createTableWithFields(baseId, '财务红冲处理区', [
      { key: 'reversalNo', name: '红冲单号', type: 'autoNumber', options: { prefix: 'RC-', start: 1, pad: 6 }, locked: true, width: 130 },
      { key: 'source', name: '红冲来源', type: 'select', options: normalizeSelectOptions({ values: ['订单退款', '订单撤单', '金额错误', '对象错误', '重复结算', '其他'] }), width: 130 },
      { key: 'targetType', name: '红冲对象类型', type: 'select', options: normalizeSelectOptions({ values: ['应收明细', '应付明细', '应收结算单', '应付结算单', '收款流水', '付款流水'] }), width: 140 },
      { key: 'arDetail', name: '原应收明细', type: 'link', options: { tableId: ar.tableId, displayFieldId: ar.fields.detailNo, multiple: false }, width: 180 },
      { key: 'apDetail', name: '原应付明细', type: 'link', options: { tableId: ap.tableId, displayFieldId: ap.fields.detailNo, multiple: false }, width: 180 },
      { key: 'direction', name: '红冲方向', type: 'select', options: normalizeSelectOptions({ values: ['冲回应收', '冲回应付', '冲回收款', '冲回付款'] }), width: 130 },
      { key: 'amount', name: '红冲金额', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 120 },
      { key: 'reason', name: '红冲原因', type: 'select', options: normalizeSelectOptions({ values: ['退款', '撤单', '金额错误', '渠道错误', '重复结算', '其他'] }), width: 130 },
      { key: 'status', name: '红冲状态', type: 'select', options: normalizeSelectOptions({ values: ['待审核', '已通过', '已驳回'] }), width: 120 },
      { key: 'result', name: '处理结果', type: 'multiLineText', locked: true, width: 260 },
      { key: 'remark', name: '财务备注', type: 'multiLineText', width: 240 },
      { key: 'approve', name: '审核通过', type: 'button', options: { label: '审核通过', action: 'approve_finance_reversal' }, width: 130 },
    ], pos++);

    await createTableWithFields(baseId, '退款处理区', [
      { key: 'refundNo', name: '退款单号', type: 'autoNumber', options: { prefix: 'RF-', start: 1, pad: 6 }, locked: true, width: 130 },
      { key: 'order', name: '原订单', type: 'link', options: { tableId: order.id, displayFieldId: orderDisplay, multiple: false }, width: 180 },
      { key: 'amount', name: '退款金额', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 120 },
      { key: 'reason', name: '退款原因', type: 'select', options: normalizeSelectOptions({ values: ['客户退货', '多收退款', '无法发货', '价格调整', '其他'] }), width: 130 },
      { key: 'status', name: '退款状态', type: 'select', options: normalizeSelectOptions({ values: ['待审核', '已通过', '已驳回'] }), width: 120 },
      { key: 'needReversal', name: '需要财务红冲', type: 'checkbox', locked: true, width: 140 },
      { key: 'remark', name: '备注', type: 'multiLineText', width: 220 },
      { key: 'approve', name: '审核通过', type: 'button', options: { label: '审核通过', action: 'approve_order_refund' }, width: 130 },
    ], pos++);

    await createTableWithFields(baseId, '撤单处理区', [
      { key: 'cancelNo', name: '撤单编号', type: 'autoNumber', options: { prefix: 'CX-', start: 1, pad: 6 }, locked: true, width: 130 },
      { key: 'order', name: '原订单', type: 'link', options: { tableId: order.id, displayFieldId: orderDisplay, multiple: false }, width: 180 },
      { key: 'reason', name: '撤单原因', type: 'select', options: normalizeSelectOptions({ values: ['客户取消', '无法发货', '重复下单', '价格错误', '其他'] }), width: 130 },
      { key: 'status', name: '撤单状态', type: 'select', options: normalizeSelectOptions({ values: ['待审核', '已通过', '已驳回'] }), width: 120 },
      { key: 'needReversal', name: '需要财务红冲', type: 'checkbox', locked: true, width: 140 },
      { key: 'result', name: '处理结果', type: 'multiLineText', locked: true, width: 260 },
      { key: 'remark', name: '备注', type: 'multiLineText', width: 220 },
      { key: 'approve', name: '审核通过', type: 'button', options: { label: '审核通过', action: 'approve_order_cancel' }, width: 130 },
    ], pos++);
  });
  await audit(baseId, req.user.id, 'template.finance_reconciliation.create', { tables: required });
  res.json({ ok: true, tables: required });
}));

router.post('/api/bases/:baseId/finance/generate-details', authRequired, asyncHandler(async (req, res) => {
  const { baseId } = req.params;
  if (!(await canRunJobs(baseId, req.user.id))) return res.status(403).json({ error: 'only owner/admin/finance can generate finance details' });
  try {
    const result = await generateFinanceDetails(baseId, req.user.id);
    await audit(baseId, req.user.id, 'finance.details.generate', result);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}));



  return router;
};
