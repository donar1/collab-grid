const assert = require('assert');

const BASE = process.env.CG_BASE_URL || 'http://localhost:3000';

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return [res.status, data];
}

async function setCell(recordId, fieldId, value, token) {
  const [sc, data] = await call('PUT', `/api/records/${recordId}/cells/${fieldId}`, { value }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
}

async function addLink(fieldId, fromRecordId, toRecordId, token) {
  const [sc, data] = await call('POST', '/api/links', { fieldId, fromRecordId, toRecordId }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  return data.id;
}

function fieldsByName(table) {
  return Object.fromEntries(table.fields.map(f => [f.name, f]));
}

async function getCell(tableId, recordId, fieldId, token) {
  const [sc, data] = await call('GET', `/api/tables/${tableId}/page?offset=0&limit=100`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const c = data.cells.find(x => x.record_id === recordId && x.field_id === fieldId);
  return c ? c.value : '';
}

async function createOperation(operationTableId, of, stockId, patch, token) {
  let sc, data;
  [sc, data] = await call('POST', `/api/tables/${operationTableId}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const opId = data.id;
  await addLink(of['库存商品'].id, opId, stockId, token);
  for (const [name, value] of Object.entries(patch)) await setCell(opId, of[name].id, value, token);
  return opId;
}

async function approve(opId, approveFieldId, token) {
  return call('POST', '/api/buttons/execute', { fieldId: approveFieldId, recordId: opId }, token);
}

async function run() {
  let sc, data;
  [sc, data] = await call('POST', '/api/register', { email: `inventory_${Date.now()}@test.local`, password: 'Pass123456!@', displayName: 'Inventory Test' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const token = data.token;

  [sc, data] = await call('POST', '/api/bases', { name: '库存系统验证空间' }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/resource-archive`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/product-info`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/order-management`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/inventory`, {}, token))[0], 200);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const source = tables['产品名称数据源区'];
  const product = tables['产品信息区'];
  const inventory = tables['库存商品区'];
  const operation = tables['出入库操作区'];
  const ledger = tables['库存流水区'];
  assert.ok(inventory && operation && ledger);
  const sf = fieldsByName(source);
  const pf = fieldsByName(product);
  const inf = fieldsByName(inventory);
  const of = fieldsByName(operation);
  const lf = fieldsByName(ledger);
  assert.strictEqual(of['审核通过'].options.action, 'approve_inventory_operation');
  assert.strictEqual(of['所属仓储'].type, 'select');

  [sc, data] = await call('POST', `/api/tables/${source.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const sourceId = data.id;
  await setCell(sourceId, sf['产品名称'].id, '库存测试产品', token);
  await setCell(sourceId, sf['货号'].id, 'INV-SKU', token);

  [sc, data] = await call('POST', `/api/tables/${product.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const productId = data.id;
  await addLink(pf['名称'].id, productId, sourceId, token);
  await setCell(productId, pf['成本'].id, '70', token);

  [sc, data] = await call('POST', `/api/tables/${inventory.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const stockId = data.id;
  await addLink(inf['产品'].id, stockId, productId, token);
  await setCell(stockId, inf['是否启用库存'].id, 'true', token);
  await setCell(stockId, inf['入库类型'].id, '实际+虚拟', token);
  await setCell(stockId, inf['所属仓储'].id, '本部仓', token);

  const actualInId = await createOperation(operation.id, of, stockId, {
    操作类型: '入库',
    入库状态: '实际入库',
    数量: '10',
    所属仓储: '本部仓',
    入库成本: '88',
  }, token);
  [sc, data] = await approve(actualInId, of['审核通过'].id, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(await getCell(inventory.id, stockId, inf['当前实际库存'].id, token), '10');
  assert.strictEqual(await getCell(inventory.id, stockId, inf['当前成本'].id, token), '88');
  assert.strictEqual(await getCell(product.id, productId, pf['成本'].id, token), '88');

  [sc, data] = await approve(actualInId, of['审核通过'].id, token);
  assert.strictEqual(sc, 400, JSON.stringify(data));
  assert.ok(String(data.error).includes('不能重复执行'));

  const virtualInId = await createOperation(operation.id, of, stockId, {
    操作类型: '入库',
    入库状态: '虚拟入库',
    数量: '5',
    所属仓储: '客户预存仓',
  }, token);
  [sc, data] = await approve(virtualInId, of['审核通过'].id, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(await getCell(inventory.id, stockId, inf['当前虚拟库存'].id, token), '5');

  const selfOutId = await createOperation(operation.id, of, stockId, {
    操作类型: '出库',
    数量: '3',
    所属仓储: '本部仓',
    付款方文本: '自营',
  }, token);
  [sc, data] = await approve(selfOutId, of['审核通过'].id, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(await getCell(inventory.id, stockId, inf['当前实际库存'].id, token), '7');

  const otherOutId = await createOperation(operation.id, of, stockId, {
    操作类型: '出库',
    数量: '2',
    所属仓储: '本部仓',
    付款方文本: '客户A',
  }, token);
  [sc, data] = await approve(otherOutId, of['审核通过'].id, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.noStockDeduct, true);
  assert.strictEqual(await getCell(inventory.id, stockId, inf['当前实际库存'].id, token), '7');
  assert.strictEqual(await getCell(operation.id, otherOutId, of['审核状态'].id, token), '已通过-非自营不扣库存');

  [sc, data] = await call('GET', `/api/tables/${ledger.id}/page?offset=0&limit=100`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const ledgerRecords = data.records || [];
  assert.strictEqual(ledgerRecords.length, 3);
  assert.ok(data.cells.some(c => c.field_id === lf['流水类型'].id && c.value === '自营出库'));

  console.log('Inventory tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
