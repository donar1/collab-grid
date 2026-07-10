// services/orderService.js — 订单相关函数
// 从 server.js 提取的订单管理业务逻辑（仅异步/PostgreSQL 模式）

const dbAdapter = require('./dbAdapter');

const { nanoid, now, cellValue, cellValueByName, fieldsMap, fieldIdByName, broadcast,
        tableNameOfField, fieldName, tableNameOfRecord } = require('./helpers');

const ORDER_MANAGEMENT_LAYOUT = [
  ['内部订单号', 0, 130], ['分区', 1, 100], ['订单状态', 2, 110], ['事由', 3, 100],
  ['产品', 4, 240], ['产品ID', 5, 120], ['数量', 6, 80], ['付款方', 7, 160], ['收款方', 8, 160],
  ['地址', 9, 260], ['姓名', 10, 110], ['电话', 11, 140], ['订单ID', 12, 170],
  ['订单备注', 13, 220], ['下单备注', 14, 220], ['不能下单原因', 15, 240],
  ['接单日期', 16, 120], ['完结日期', 17, 120], ['财务付款时间', 18, 140],
  ['应收金额', 30, 120], ['付款差额', 31, 120], ['实收金额', 32, 120], ['应付金额', 33, 120],
  ['收款差额', 34, 120], ['实付金额', 35, 120], ['毛利', 36, 110], ['毛利率', 37, 110],
  ['付款差额说明', 38, 220], ['收款差额说明', 39, 220],
  ['物流单号', 50, 170], ['物流备注', 51, 220], ['物流更新日期', 52, 130], ['退货单号', 53, 170],
  ['售后说明', 54, 220], ['责任业务', 55, 140], ['订单', 56, 180], ['计划日期', 57, 120], ['完结状态', 58, 160],
  ['返利状态', 70, 120], ['返利日期', 71, 120], ['返利备注', 72, 220],
  ['快照毛利', 90, 120], ['快照实收', 91, 120], ['快照实付', 92, 120], ['快照产品名', 93, 200],
  ['快照付款方名', 94, 170], ['快照收款方名', 95, 170],
  ['佣金已结算', 110, 110], ['佣金结算批次', 111, 150], ['原订单', 112, 170],
  ['风险预警', 130, 160], ['下单复制区', 131, 260], ['单号预警', 132, 180], ['跟单复制区', 133, 260], ['钓鱼预警', 134, 160],
];

async function orderCompletionFieldProtected(recordId, fieldId) {
  const tblName = await tableNameOfField(fieldId);
  if (tblName !== '订单管理区') return false;
  const name = await fieldName(fieldId);
  const immutableWhenWritten = new Set(['快照毛利', '快照实收', '快照实付', '快照产品名', '快照付款方名', '快照收款方名', '佣金结算批次']);
  const r = await dbAdapter.queryOneAsync('SELECT table_id FROM records WHERE id=$1', [recordId]);
  if (!r) return false;
  const currentRow = await dbAdapter.queryOneAsync('SELECT value FROM cells WHERE record_id=$1 AND field_id=$2', [recordId, fieldId]);
  const current = currentRow?.value || '';
  if (immutableWhenWritten.has(name)) return current !== '';
  if (!['完结日期', '财务付款时间'].includes(name)) return false;
  const zone = await cellValueByName(recordId, r.table_id, '分区');
  return zone === '完结区' && current !== '';
}

async function applyOrderDefaults(recordId, tableId, userId, baseId) {
  const tableRow = await dbAdapter.queryOneAsync('SELECT name FROM tables WHERE id=$1', [tableId]);
  if (tableRow?.name !== '订单管理区') return;
  const ts = now();
  const defaults = [
    ['分区', '下单区'],
    ['事由', '订单'],
    ['佣金已结算', 'false'],
  ];
  for (const [name, value] of defaults) {
    const fid = await fieldIdByName(tableId, name);
    if (!fid) continue;
    await dbAdapter.writeQueryAsync(
      'INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT(record_id,field_id) DO NOTHING',
      [recordId, fid, value, ts, userId || null]
    );
  }
  if (baseId) broadcast(baseId, 'cell:update', { recordId, updatedAt: ts, updatedBy: userId || null });
}

async function syncOrderProductDefaults(fromRecordId, productRecordId, productLinkFieldId, baseId, userId) {
  const fieldMeta = await dbAdapter.queryOneAsync(
    'SELECT f.name AS field_name, t.name AS table_name, f.table_id FROM fields f JOIN tables t ON t.id=f.table_id WHERE f.id=$1',
    [productLinkFieldId]
  );
  if (!fieldMeta || fieldMeta.table_name !== '订单管理区' || fieldMeta.field_name !== '产品') return;
  const productTable = await dbAdapter.queryOneAsync('SELECT table_id FROM records WHERE id=$1', [productRecordId]);
  if (!productTable) return;
  const mapping = [
    ['售价', '应收金额'],
    ['成本', '应付金额'],
  ];
  const ts = now();
  for (const [sourceName, targetName] of mapping) {
    const sourceFieldId = await fieldIdByName(productTable.table_id, sourceName);
    const targetFieldId = await fieldIdByName(fieldMeta.table_id, targetName);
    if (!sourceFieldId || !targetFieldId) continue;
    const sourceRow = await dbAdapter.queryOneAsync('SELECT value FROM cells WHERE record_id=$1 AND field_id=$2', [productRecordId, sourceFieldId]);
    const sourceValue = sourceRow?.value;
    if (sourceValue == null || sourceValue === '') continue;
    await dbAdapter.writeQueryAsync(
      `INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
      [fromRecordId, targetFieldId, sourceValue, ts, userId || null]
    );
    if (baseId) broadcast(baseId, 'cell:update', { recordId: fromRecordId, fieldId: targetFieldId, value: sourceValue, updatedAt: ts, updatedBy: userId || null });
  }
  const supplierFieldId = await fieldIdByName(productTable.table_id, '供应商');
  const payeeFieldId = await fieldIdByName(fieldMeta.table_id, '收款方');
  if (supplierFieldId && payeeFieldId) {
    const supplierLinks = await dbAdapter.queryAsync('SELECT to_record_id FROM links WHERE field_id=$1 AND from_record_id=$2', [supplierFieldId, productRecordId]);
    for (const supplierLink of supplierLinks.slice(0, 1)) {
      const exists = await dbAdapter.queryOneAsync('SELECT 1 FROM links WHERE field_id=$1 AND from_record_id=$2 AND to_record_id=$3', [payeeFieldId, fromRecordId, supplierLink.to_record_id]);
      if (exists) continue;
      const linkId = nanoid();
      await dbAdapter.writeQueryAsync('DELETE FROM links WHERE field_id=$1 AND from_record_id=$2', [payeeFieldId, fromRecordId]);
      await dbAdapter.writeQueryAsync('INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES ($1,$2,$3,$4,$5)',
        [linkId, payeeFieldId, fromRecordId, supplierLink.to_record_id, ts]);
      if (baseId) broadcast(baseId, 'link:add', { id: linkId, fieldId: payeeFieldId, fromRecordId, toRecordId: supplierLink.to_record_id });
    }
  }
}

async function applyOrderManagementLayout(tableId) {
  for (const [name, position, width] of ORDER_MANAGEMENT_LAYOUT) {
    await dbAdapter.writeQueryAsync('UPDATE fields SET position=$1, width=$2 WHERE table_id=$3 AND name=$4', [position, width, tableId, name]);
  }
}

module.exports = {
  tableNameOfRecord,
  orderCompletionFieldProtected,
  applyOrderDefaults,
  syncOrderProductDefaults,
  ORDER_MANAGEMENT_LAYOUT,
  applyOrderManagementLayout,
};
