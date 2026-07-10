// V0.3：第二层核心业务路由模块（纯异步版本）
const express = require('express');
const { asyncHandler } = require('../utils');
const dbAdapter = require('../../services/dbAdapter');

module.exports = function registerCoreCustomerRoutes(ctx) {
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

router.post('/api/bases/:baseId/templates/resource-archive', authRequired, asyncHandler(async (req, res) => {
  const { baseId } = req.params;
  if (!(await canManageStructure(baseId, req.user.id))) return res.status(403).json({ error: 'no permission to initialize templates' });
  const base = await dbAdapter.queryOneAsync('SELECT * FROM bases WHERE id=$1', [baseId]);
  if (!base) return res.status(404).json({ error: 'base not found' });
  const existing = (await dbAdapter.queryAsync('SELECT name FROM tables WHERE base_id=$1', [baseId])).map(r => r.name);
  const required = ['资源档案中心'];
  const conflicts = required.filter(name => existing.includes(name));
  if (conflicts.length) return res.status(400).json({ error: 'template tables already exist', conflicts });

  await dbAdapter.transactionAsync(async () => {
    let pos = (await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM tables WHERE base_id=$1', [baseId])).c;
    await createTableWithFields(baseId, '资源档案中心', [
      { key: 'code', name: '代码', type: 'autoNumber', options: { prefix: 'RES-', start: 1, pad: 6 }, locked: true, width: 150 },
      { key: 'created', name: '入档日期', type: 'createdTime', locked: true, width: 130 },
      { key: 'company', name: '企业名称', type: 'text', width: 220 },
      { key: 'contact', name: '对接人姓名', type: 'text', width: 150 },
      { key: 'phone', name: '电话', type: 'text', width: 150 },
      { key: 'address', name: '地址', type: 'text', width: 260 },
      { key: 'identity', name: '身份信息', type: 'text', width: 260 },
      { key: 'proof', name: '身份证明', type: 'attachment', width: 260 },
      { key: 'leader', name: '审批领导', type: 'select', options: normalizeSelectOptions({ values: [{ label: '待分配', color: '#94a3b8' }, { label: '张总', color: '#3b82f6' }, { label: '王总', color: '#8b5cf6' }, { label: '李总', color: '#10b981' }] }), width: 160 },
      { key: 'approvalNote', name: '审批意见', type: 'text', width: 240 },
      { key: 'status', name: '审批状态', type: 'select', options: normalizeSelectOptions({ values: [{ label: '待审批', color: '#f59e0b' }, { label: '已通过', color: '#10b981' }, { label: '已驳回', color: '#ef4444' }, { label: '需补充资料', color: '#6366f1' }] }) },
      { key: 'usable', name: '数据可使用', type: 'checkbox', locked: true },
      { key: 'group', name: '建群对接', type: 'select', options: normalizeSelectOptions({ values: [{ label: '未建群', color: '#94a3b8' }, { label: '已建群', color: '#3b82f6' }, { label: '已正常对接', color: '#10b981' }] }) },
      { key: 'remark', name: '业务备注', type: 'text', width: 260 },
      { key: 'todo', name: '待办', type: 'select', options: normalizeSelectOptions({ values: [{ label: '待审批', color: '#f59e0b' }, { label: '权限调整', color: '#8b5cf6' }, { label: '补充资料', color: '#6366f1' }, { label: '已完成', color: '#10b981' }] }) },
      { key: 'approve', name: '审批通过', type: 'button', options: { label: '审批通过', action: 'approve_resource' } },
    ], pos++);
  });
  await audit(baseId, req.user.id, 'template.resource_archive.create', { tables: required });
  res.json({ ok: true, tables: required });
}));


router.post('/api/bases/:baseId/templates/business-lock', authRequired, asyncHandler(async (req, res) => {
  const { baseId } = req.params;
  if (!(await canManageStructure(baseId, req.user.id))) return res.status(403).json({ error: 'only owner/admin can initialize templates' });
  const base = await dbAdapter.queryOneAsync('SELECT * FROM bases WHERE id=$1', [baseId]);
  if (!base) return res.status(404).json({ error: 'base not found' });
  const existingTables = await dbAdapter.queryAsync('SELECT * FROM tables WHERE base_id=$1', [baseId]);
  const existingNames = existingTables.map(r => r.name);
  if (existingNames.includes('业务锁定区')) return res.status(400).json({ error: 'template tables already exist', conflicts: ['业务锁定区'] });
  const archive = existingTables.find(t => t.name === '资源档案中心');
  const product = existingTables.find(t => t.name === '产品信息区');
  if (!archive || !product) return res.status(400).json({ error: '资源档案中心和产品信息区必须先创建' });
  const archiveCode = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [archive.id, '代码'])
    || await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 ORDER BY position LIMIT 1', [archive.id]);
  const productTitle = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [product.id, '标题'])
    || await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 ORDER BY position LIMIT 1', [product.id]);
  const productId = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [product.id, '产品ID'])
    || productTitle;

  await dbAdapter.transactionAsync(async () => {
    let pos = (await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM tables WHERE base_id=$1', [baseId])).c;
    let employee = existingTables.find(t => t.name === '员工档案中心');
    let employeeFields = {};
    if (!employee) {
      const created = await createTableWithFields(baseId, '员工档案中心', [
        { key: 'employeeNo', name: '员工编号', type: 'autoNumber', options: { prefix: 'EMP-', start: 1, pad: 4 }, locked: true, width: 130 },
        { key: 'name', name: '员工姓名', type: 'text', width: 160 },
        { key: 'role', name: '岗位', type: 'select', options: normalizeSelectOptions({ values: ['渠道负责人', '审批人', '财务', '运营', '其他'] }), width: 140 },
        { key: 'phone', name: '联系电话', type: 'text', width: 150 },
        { key: 'enabled', name: '在职', type: 'checkbox', width: 100 },
      ], pos++);
      employee = { id: created.tableId, name: '员工档案中心' };
      employeeFields = created.fields;
    } else {
      const nameField = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [employee.id, '员工姓名'])
        || await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 ORDER BY position LIMIT 1', [employee.id]);
      employeeFields.name = nameField.id;
    }
    const lock = await createTableWithFields(baseId, '业务锁定区', [
      { key: 'channel', name: '合作渠道', type: 'link', options: { tableId: archive.id, displayFieldId: archiveCode.id, multiple: false }, width: 180 },
      { key: 'relation', name: '合作关系', type: 'select', options: normalizeSelectOptions({ values: ['客户', '供应商'] }), width: 130 },
      { key: 'product', name: '商品', type: 'link', options: { tableId: product.id, displayFieldId: productTitle.id, multiple: false }, width: 220 },
      { key: 'group', name: '分组', type: 'select', options: normalizeSelectOptions({ values: ['渠道负责区', '单品合作区'] }), width: 150 },
      { key: 'judge', name: '判断', type: 'select', options: normalizeSelectOptions({ values: ['关联', '申请'] }), width: 110 },
      { key: 'applicant', name: '申请人', type: 'link', options: { tableId: employee.id, displayFieldId: employeeFields.name, multiple: false }, width: 160 },
      { key: 'resourceStatus', name: '资源状态', type: 'select', options: normalizeSelectOptions({ values: ['活跃', '正常', '沉淀', '已解绑'] }), width: 120 },
      { key: 'approvalResult', name: '审批结果', type: 'select', options: normalizeSelectOptions({ values: ['已通过', '待审批'] }), width: 120 },
      { key: 'reason', name: '申请原因', type: 'select', options: normalizeSelectOptions({ values: ['首次合作', '断货补充', '成本优化', '渠道调整', '其他'] }), width: 140 },
      { key: 'applyDate', name: '申请日期', type: 'createdTime', locked: true, width: 130 },
      { key: 'approver', name: '审批人', type: 'lastModifiedBy', locked: true, width: 140 },
      { key: 'approvalTime', name: '审批时间', type: 'lastModifiedTime', locked: true, width: 130 },
      { key: 'proof', name: '粘贴凭证', type: 'attachment', width: 220 },
      { key: 'channelOwner', name: '渠道负责人', type: 'lookup', options: { linkFieldId: null, sourceFieldId: employeeFields.name, mode: 'live' }, locked: true, width: 160 },
      { key: 'currentOwner', name: '现有产品负责人', type: 'lookup', options: { linkFieldId: null, sourceFieldId: employeeFields.name, mode: 'live' }, locked: true, width: 160 },
      { key: 'productId', name: '产品ID', type: 'lookup', options: { linkFieldId: null, sourceFieldId: productId.id, mode: 'live' }, locked: true, width: 150 },
      { key: 'todayBonus', name: '今日奖金', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 140 },
      { key: 'monthBonus', name: '月度奖金', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 140 },
      { key: 'totalBonus', name: '累计奖金', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 140 },
      { key: 'bonusDetail', name: '奖金明细', type: 'multiLineText', width: 260 },
      { key: 'approve', name: '审批通过', type: 'button', options: { label: '审批通过', action: 'approve_business_lock' }, width: 130 },
    ], pos++);
    await dbAdapter.writeQueryAsync('UPDATE fields SET options=$1 WHERE id=$2', [JSON.stringify({ linkFieldId: lock.fields.applicant, sourceFieldId: employeeFields.name, mode: 'live' }), lock.fields.channelOwner]);
    await dbAdapter.writeQueryAsync('UPDATE fields SET options=$1 WHERE id=$2', [JSON.stringify({ linkFieldId: lock.fields.applicant, sourceFieldId: employeeFields.name, mode: 'live' }), lock.fields.currentOwner]);
    await dbAdapter.writeQueryAsync('UPDATE fields SET options=$1 WHERE id=$2', [JSON.stringify({ linkFieldId: lock.fields.product, sourceFieldId: productId.id, mode: 'live' }), lock.fields.productId]);

    if (!existingNames.includes('状态变更日志')) {
      await createTableWithFields(baseId, '状态变更日志', [
        { key: 'logNo', name: '日志编号', type: 'autoNumber', options: { prefix: 'ST-', start: 1, pad: 6 }, locked: true, width: 130 },
        { key: 'lockRecord', name: '业务锁定记录', type: 'link', options: { tableId: lock.tableId, displayFieldId: lock.fields.channel, multiple: false }, width: 200 },
        { key: 'oldStatus', name: '原资源状态', type: 'select', options: normalizeSelectOptions({ values: ['活跃', '正常', '沉淀', '已解绑'] }), width: 130 },
        { key: 'newStatus', name: '新资源状态', type: 'select', options: normalizeSelectOptions({ values: ['活跃', '正常', '沉淀', '已解绑'] }), width: 130 },
        { key: 'reason', name: '变更原因', type: 'multiLineText', width: 260 },
        { key: 'created', name: '变更时间', type: 'createdTime', locked: true, width: 130 },
      ], pos++);
    }
  });
  await audit(baseId, req.user.id, 'template.business_lock.create', { tables: ['业务锁定区', '员工档案中心', '状态变更日志'] });
  res.json({ ok: true, tables: ['业务锁定区', '员工档案中心', '状态变更日志'] });
}));



  return router;
};
