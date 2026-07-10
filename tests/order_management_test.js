const assert = require('assert');

const BASE = process.env.CG_BASE_URL || 'http://localhost:3000';

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

function fieldsByName(table) {
  return Object.fromEntries(table.fields.map(f => [f.name, f]));
}

async function run() {
  const email = `order_${Date.now()}@test.local`;
  let sc, data;
  [sc, data] = await call('POST', '/api/register', { email, password: 'Pass123456!@', displayName: 'Order Test' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const token = data.token;

  [sc, data] = await call('POST', '/api/bases', { name: '订单管理验证空间' }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;

  [sc] = await call('POST', `/api/bases/${baseId}/templates/order-management`, {}, token);
  assert.strictEqual(sc, 400);

  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/resource-archive`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/product-info`, {}, token))[0], 200);
  [sc, data] = await call('POST', `/api/bases/${baseId}/templates/order-management`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.deepStrictEqual(data.tables, ['订单管理区']);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const archive = tables['资源档案中心'];
  const source = tables['产品名称数据源区'];
  const product = tables['产品信息区'];
  const order = tables['订单管理区'];
  assert.ok(archive && source && product && order);

  const af = fieldsByName(archive);
  const sf = fieldsByName(source);
  const pf = fieldsByName(product);
  const of = fieldsByName(order);
  assert.strictEqual(of['内部订单号'].type, 'autoNumber');
  assert.strictEqual(of['分区'].type, 'select');
  assert.strictEqual(of['订单状态'].type, 'select');
  assert.strictEqual(of['产品'].type, 'link');
  assert.strictEqual(of['付款方'].type, 'link');
  assert.strictEqual(of['收款方'].type, 'link');
  assert.strictEqual(of['实收金额'].type, 'formula');
  assert.strictEqual(of['实付金额'].type, 'formula');
  assert.strictEqual(of['毛利'].type, 'formula');
  assert.strictEqual(of['产品ID'].type, 'lookup');
  assert.strictEqual(of['佣金已结算'].type, 'checkbox');
  assert.strictEqual(of['佣金结算批次'].type, 'text');
  assert.strictEqual(of['原订单'].type, 'link');

  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const payerId = data.id;
  await setCell(payerId, af['企业名称'].id, '付款方客户A', token);

  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const supplierId = data.id;
  await setCell(supplierId, af['企业名称'].id, '默认供应商A', token);

  [sc, data] = await call('POST', `/api/tables/${source.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const sourceId = data.id;
  await setCell(sourceId, sf['产品名称'].id, '订单测试产品A', token);
  await setCell(sourceId, sf['货号'].id, 'ORDER-SKU-A', token);

  [sc, data] = await call('POST', `/api/tables/${product.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const productId = data.id;
  assert.strictEqual((await call('POST', '/api/links', { fieldId: pf['名称'].id, fromRecordId: productId, toRecordId: sourceId }, token))[0], 200);
  assert.strictEqual((await call('POST', '/api/links', { fieldId: pf['供应商'].id, fromRecordId: productId, toRecordId: supplierId }, token))[0], 200);
  await setCell(productId, pf['售价'].id, '1000', token);
  await setCell(productId, pf['成本'].id, '700', token);

  [sc, data] = await call('POST', `/api/tables/${order.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const orderId = data.id;
  assert.strictEqual((await call('POST', '/api/links', { fieldId: of['付款方'].id, fromRecordId: orderId, toRecordId: payerId }, token))[0], 200);
  assert.strictEqual((await call('POST', '/api/links', { fieldId: of['产品'].id, fromRecordId: orderId, toRecordId: productId }, token))[0], 200);
  await setCell(orderId, of['数量'].id, '2', token);
  await setCell(orderId, of['付款差额'].id, '100', token);
  await setCell(orderId, of['收款差额'].id, '50', token);

  [sc, data] = await call('GET', `/api/tables/${order.id}/page?offset=0&limit=20`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  let cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  assert.strictEqual(cellMap.get(`${orderId}:${of['分区'].id}`), '下单区');
  assert.strictEqual(cellMap.get(`${orderId}:${of['事由'].id}`), '订单');
  assert.strictEqual(cellMap.get(`${orderId}:${of['佣金已结算'].id}`), 'false');
  assert.strictEqual(cellMap.get(`${orderId}:${of['应收金额'].id}`), '1000');
  assert.strictEqual(cellMap.get(`${orderId}:${of['应付金额'].id}`), '700');
  assert.strictEqual(cellMap.get(`${orderId}:${of['实收金额'].id}`), '900');
  assert.strictEqual(cellMap.get(`${orderId}:${of['实付金额'].id}`), '650');
  assert.strictEqual(cellMap.get(`${orderId}:${of['毛利'].id}`), '250');
  assert.ok(cellMap.get(`${orderId}:${of['产品ID'].id}`).startsWith('P-'));
  assert.ok(data.links.some(l => l.field_id === of['收款方'].id && l.from_record_id === orderId && l.to_record_id === supplierId));

  await setCell(orderId, of['完结日期'].id, '2026-06-21', token);
  await setCell(orderId, of['财务付款时间'].id, '2026-06-21', token);
  await setCell(orderId, of['分区'].id, '完结区', token);
  [sc, data] = await call('PUT', `/api/records/${orderId}/cells/${of['完结日期'].id}`, { value: '2026-06-22' }, token);
  assert.strictEqual(sc, 423, JSON.stringify(data));

  await setCell(orderId, of['快照毛利'].id, '250', token);
  [sc, data] = await call('PUT', `/api/records/${orderId}/cells/${of['快照毛利'].id}`, { value: '251' }, token);
  assert.strictEqual(sc, 423, JSON.stringify(data));

  await setCell(orderId, of['佣金已结算'].id, 'true', token);
  [sc, data] = await call('POST', '/api/links', { fieldId: of['产品'].id, fromRecordId: orderId, toRecordId: productId }, token);
  assert.strictEqual(sc, 423, JSON.stringify(data));

  console.log('Order management tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
