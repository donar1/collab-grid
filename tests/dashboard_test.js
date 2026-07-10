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
}

function fieldsByName(table) {
  return Object.fromEntries(table.fields.map(f => [f.name, f]));
}

async function run() {
  let sc, data;
  [sc, data] = await call('POST', '/api/register', { email: `dashboard_${Date.now()}@test.local`, password: 'Pass123456!@', displayName: 'Dashboard Test' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const token = data.token;

  [sc, data] = await call('POST', '/api/bases', { name: '数据大屏验证空间' }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/resource-archive`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/product-info`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/order-management`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/inventory`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/finance-reconciliation`, {}, token))[0], 200);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const archive = tables['资源档案中心'];
  const source = tables['产品名称数据源区'];
  const product = tables['产品信息区'];
  const order = tables['订单管理区'];
  const inventory = tables['库存商品区'];
  const af = fieldsByName(archive);
  const sf = fieldsByName(source);
  const pf = fieldsByName(product);
  const of = fieldsByName(order);
  const inf = fieldsByName(inventory);

  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  const payerId = data.id;
  await setCell(payerId, af['企业名称'].id, '大屏客户A', token);
  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  const payeeId = data.id;
  await setCell(payeeId, af['企业名称'].id, '大屏供应商A', token);
  [sc, data] = await call('POST', `/api/tables/${source.id}/records`, {}, token);
  const sourceId = data.id;
  await setCell(sourceId, sf['产品名称'].id, '大屏产品', token);
  await setCell(sourceId, sf['货号'].id, 'DASH-SKU', token);
  [sc, data] = await call('POST', `/api/tables/${product.id}/records`, {}, token);
  const productId = data.id;
  await addLink(pf['名称'].id, productId, sourceId, token);
  await setCell(productId, pf['售价'].id, '200', token);
  await setCell(productId, pf['成本'].id, '120', token);

  const today = new Date().toISOString().slice(0, 10);
  [sc, data] = await call('POST', `/api/tables/${order.id}/records`, {}, token);
  const orderId = data.id;
  await addLink(of['产品'].id, orderId, productId, token);
  await addLink(of['付款方'].id, orderId, payerId, token);
  await addLink(of['收款方'].id, orderId, payeeId, token);
  await setCell(orderId, of['数量'].id, '1', token);
  await setCell(orderId, of['完结日期'].id, today, token);
  await setCell(orderId, of['财务付款时间'].id, today, token);
  await setCell(orderId, of['应收金额'].id, '200', token);
  await setCell(orderId, of['应付金额'].id, '120', token);

  [sc, data] = await call('POST', `/api/tables/${inventory.id}/records`, {}, token);
  const stockId = data.id;
  await addLink(inf['产品'].id, stockId, productId, token);
  await setCell(stockId, inf['是否启用库存'].id, 'true', token);
  await setCell(stockId, inf['预警库存'].id, '3', token);

  [sc, data] = await call('POST', `/api/bases/${baseId}/finance/generate-details`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));

  [sc, data] = await call('GET', `/api/bases/${baseId}/dashboard/summary`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.ok(Array.isArray(data.cards) && data.cards.length === 8);
  assert.ok(Array.isArray(data.trend) && data.trend.length === 7);
  assert.ok(data.rankings.payer.some(x => x.name === '大屏客户A'));
  assert.ok(data.rankings.payee.some(x => x.name === '大屏供应商A'));
  assert.strictEqual(data.finance.receivable.total, 200);
  assert.strictEqual(data.finance.payable.total, 120);
  assert.ok(data.inventoryWarnings.length >= 1);
  console.log('Dashboard tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
