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
  const businessDate = '2026-06-21';
  let sc, data;
  [sc, data] = await call('POST', '/api/register', { email: `diag_${Date.now()}@test.local`, password: 'Pass123456!@', displayName: 'Diag Test' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const token = data.token;
  [sc, data] = await call('POST', '/api/bases', { name: '诊断批量导入验证空间' }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/resource-archive`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/product-info`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/order-management`, {}, token))[0], 200);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const archive = tables['资源档案中心'];
  const source = tables['产品名称数据源区'];
  const product = tables['产品信息区'];
  const order = tables['订单管理区'];
  const af = fieldsByName(archive);
  const sf = fieldsByName(source);
  const pf = fieldsByName(product);
  const of = fieldsByName(order);

  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  const payerId = data.id;
  await setCell(payerId, af['企业名称'].id, '诊断客户', token);
  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  const supplierId = data.id;
  await setCell(supplierId, af['企业名称'].id, '诊断供应商', token);
  [sc, data] = await call('POST', `/api/tables/${source.id}/records`, {}, token);
  const sourceId = data.id;
  await setCell(sourceId, sf['产品名称'].id, '诊断产品', token);
  await setCell(sourceId, sf['货号'].id, 'DIAG-SKU', token);
  [sc, data] = await call('POST', `/api/tables/${product.id}/records`, {}, token);
  const productId = data.id;
  await addLink(pf['名称'].id, productId, sourceId, token);
  await addLink(pf['供应商'].id, productId, supplierId, token);
  await setCell(productId, pf['售价'].id, '1000', token);
  await setCell(productId, pf['成本'].id, '700', token);

  [sc, data] = await call('POST', `/api/bases/${baseId}/bulk/orders`, {
    orders: [
      { productId, payerId, quantity: 1, zone: '完结区', completedAt: businessDate, paidAt: businessDate, externalOrderId: 'BULK-001' },
      { productId, payerId, quantity: 1, zone: '完结区', completedAt: businessDate, externalOrderId: 'BULK-002' },
      { productId, payerId, quantity: 1, zone: '完结区', completedAt: businessDate, paidAt: businessDate, reason: '退款', externalOrderId: 'BULK-003' },
    ],
  }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.createdCount, 3);
  const [firstOrderId] = data.recordIds;

  [sc, data] = await call('GET', `/api/tables/${order.id}/page?offset=0&limit=20`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  assert.strictEqual(cellMap.get(`${firstOrderId}:${of['应收金额'].id}`), '1000');
  assert.strictEqual(cellMap.get(`${firstOrderId}:${of['应付金额'].id}`), '700');
  assert.ok(data.links.some(l => l.field_id === of['收款方'].id && l.from_record_id === firstOrderId && l.to_record_id === supplierId));

  await setCell(firstOrderId, of['佣金已结算'].id, 'true', token);
  [sc, data] = await call('GET', `/api/bases/${baseId}/diagnostics?businessDate=${businessDate}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const codes = new Set((data.issues || []).map(i => i.code));
  assert.ok(codes.has('completed_missing_paid_at'));
  assert.ok(codes.has('refund_missing_original_order'));
  assert.ok(codes.has('settled_missing_snapshot'));
  assert.ok(codes.has('settled_without_ledger'));
  assert.ok(codes.has('completed_unsettled_orders'));
  assert.ok(data.issueCount >= 5);
  console.log('Diagnostics and bulk import tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
