// V0.3：第二层核心业务路由模块（纯异步版本）
const express = require('express');
const { asyncHandler } = require('../utils');
const dbAdapter = require('../../services/dbAdapter');

module.exports = function registerCoreProductRoutes(ctx) {
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

router.post('/api/bases/:baseId/templates/product-info', authRequired, asyncHandler(async (req, res) => {
  const { baseId } = req.params;
  if (!(await canManageStructure(baseId, req.user.id))) return res.status(403).json({ error: 'no permission to initialize templates' });
  const base = await dbAdapter.queryOneAsync('SELECT * FROM bases WHERE id=$1', [baseId]);
  if (!base) return res.status(404).json({ error: 'base not found' });
  const existingTables = await dbAdapter.queryAsync('SELECT * FROM tables WHERE base_id=$1', [baseId]);
  const existingNames = existingTables.map(r => r.name);
  const required = ['产品名称数据源区', '产品信息区'];
  const conflicts = required.filter(name => existingNames.includes(name));
  if (conflicts.length) return res.status(400).json({ error: 'template tables already exist', conflicts });

  const archive = existingTables.find(t => t.name === '资源档案中心');
  let archiveDisplayField = null;
  if (archive) archiveDisplayField = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [archive.id, '企业名称']);

  await dbAdapter.transactionAsync(async () => {
    let pos = (await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM tables WHERE base_id=$1', [baseId])).c;
    const source = await createTableWithFields(baseId, '产品名称数据源区', [
      { key: 'productName', name: '产品名称', type: 'text', width: 220 },
      { key: 'sku', name: '货号', type: 'text', width: 160 },
      { key: 'status', name: '数据状态', type: 'select', options: normalizeSelectOptions({ values: [{ label: '启用', color: '#10b981' }, { label: '停用', color: '#ef4444' }] }) },
      { key: 'remark', name: '备注', type: 'text', width: 260 },
    ], pos++);
    const supplierField = archive && archiveDisplayField
      ? { key: 'supplier', name: '供应商', type: 'link', options: { tableId: archive.id, displayFieldId: archiveDisplayField.id, multiple: false }, width: 180 }
      : { key: 'supplier', name: '供应商', type: 'text', width: 180 };
    await createTableWithFields(baseId, '产品信息区', [
      { key: 'title', name: '标题', type: 'textFormula', options: { expression: '{名称} {规格} {地区} {销售规则} {产品状态} {货号}' }, locked: true, width: 340 },
      { key: 'productId', name: '产品ID', type: 'autoNumber', options: { prefix: 'P-', start: 1, pad: 6 }, locked: true, width: 140 },
      { key: 'updated', name: '更新时间', type: 'createdTime', locked: true, width: 130 },
      { key: 'name', name: '名称', type: 'link', options: { tableId: source.tableId, displayFieldId: source.fields.productName, multiple: false }, width: 180 },
      { key: 'spec', name: '规格', type: 'select', options: normalizeSelectOptions({ values: ['标准款', '升级款', '套装', '定制款', '其他'] }), width: 130 },
      { key: 'region', name: '地区', type: 'select', options: normalizeSelectOptions({ values: ['全国', '华东', '华南', '华北', '西南', '华中', '东北', '西北'] }), width: 130 },
      { key: 'sku', name: '货号', type: 'lookup', options: { linkFieldId: null, sourceFieldId: source.fields.sku, mode: 'live' }, locked: true, width: 150 },
      { key: 'rule', name: '销售规则', type: 'select', options: normalizeSelectOptions({ values: ['渠道用款到发货', '团购平台返利', '现款现货', '账期发货', '其他'] }), width: 180 },
      { key: 'orderMethod', name: '下单方式', type: 'select', options: normalizeSelectOptions({ values: ['渠道下单', '团购下单', '平台下单', '人工下单', '其他'] }), width: 150 },
      { key: 'productStatus', name: '产品状态', type: 'select', options: normalizeSelectOptions({ values: ['正常', '新品', '停用', '缺货', '特价处理'] }), width: 140 },
      { key: 'salesStatus', name: '销售状态', type: 'select', options: normalizeSelectOptions({ values: ['可售', '待上架', '停售', '清仓'] }), width: 140 },
      { key: 'detail', name: '详情', type: 'text', width: 360 },
      { key: 'price', name: '售价', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 130 },
      { key: 'taxFee', name: '税费', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 130 },
      { key: 'taxType', name: '税种', type: 'select', options: normalizeSelectOptions({ values: ['专票', '普票', '免税', '其他'] }), width: 130 },
      supplierField,
      { key: 'cost', name: '成本', type: 'currency', options: { symbol: '¥', precision: 2 }, width: 130 },
      { key: 'historySupplier', name: '历史供应商', type: 'text', width: 240 },
      { key: 'category', name: '产品分类', type: 'select', options: normalizeSelectOptions({ values: ['清洁家电', '品牌礼品', '清洁配件', '特价处理品'] }), width: 160 },
    ], pos++);
    const productInfoTable = await dbAdapter.queryOneAsync('SELECT id FROM tables WHERE base_id=$1 AND name=$2', [baseId, '产品信息区']);
    const nameField = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [productInfoTable.id, '名称']);
    const skuField = await dbAdapter.queryOneAsync('SELECT id FROM fields WHERE table_id=$1 AND name=$2', [productInfoTable.id, '货号']);
    await dbAdapter.writeQueryAsync('UPDATE fields SET options=$1 WHERE id=$2', [JSON.stringify({ linkFieldId: nameField.id, sourceFieldId: source.fields.sku, mode: 'live' }), skuField.id]);
  });
  await audit(baseId, req.user.id, 'template.product_info.create', { tables: required });
  res.json({ ok: true, tables: required });
}));



  return router;
};
