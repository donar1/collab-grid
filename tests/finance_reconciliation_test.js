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

async function page(tableId, token) {
  const [sc, data] = await call('GET', `/api/tables/${tableId}/page?offset=0&limit=100`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  return data;
}

function cell(data, recordId, fieldId) {
  return data.cells.find(c => c.record_id === recordId && c.field_id === fieldId)?.value || '';
}

async function run() {
  let sc, data;
  [sc, data] = await call('POST', '/api/register', { email: `finance_${Date.now()}@test.local`, password: 'Pass123456!@', displayName: 'Finance Test' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const token = data.token;

  [sc, data] = await call('POST', '/api/bases', { name: '财务对账验证空间' }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/resource-archive`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/product-info`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/order-management`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/finance-reconciliation`, {}, token))[0], 200);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const archive = tables['资源档案中心'];
  const source = tables['产品名称数据源区'];
  const product = tables['产品信息区'];
  const order = tables['订单管理区'];
  const object = tables['财务结算对象区'];
  const ar = tables['应收结算明细区'];
  const ap = tables['应付结算明细区'];
  const reversal = tables['财务红冲处理区'];
  const refund = tables['退款处理区'];
  const cancel = tables['撤单处理区'];
  assert.ok(object && ar && ap && reversal && refund && cancel);
  const af = fieldsByName(archive);
  const sf = fieldsByName(source);
  const pf = fieldsByName(product);
  const of = fieldsByName(order);
  const arf = fieldsByName(ar);
  const apf = fieldsByName(ap);
  const rf = fieldsByName(reversal);
  const cf = fieldsByName(cancel);
  assert.strictEqual(rf['审核通过'].options.action, 'approve_finance_reversal');
  assert.strictEqual(cf['审核通过'].options.action, 'approve_order_cancel');

  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const payerId = data.id;
  await setCell(payerId, af['企业名称'].id, '客户A', token);
  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const payeeId = data.id;
  await setCell(payeeId, af['企业名称'].id, '供应商A', token);

  [sc, data] = await call('POST', `/api/tables/${source.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const sourceId = data.id;
  await setCell(sourceId, sf['产品名称'].id, '对账测试产品', token);
  await setCell(sourceId, sf['货号'].id, 'FIN-SKU', token);
  [sc, data] = await call('POST', `/api/tables/${product.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const productId = data.id;
  await addLink(pf['名称'].id, productId, sourceId, token);
  await setCell(productId, pf['售价'].id, '100', token);
  await setCell(productId, pf['成本'].id, '60', token);

  [sc, data] = await call('POST', `/api/tables/${order.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const orderId = data.id;
  await addLink(of['产品'].id, orderId, productId, token);
  await addLink(of['付款方'].id, orderId, payerId, token);
  await addLink(of['收款方'].id, orderId, payeeId, token);
  await setCell(orderId, of['数量'].id, '1', token);
  await setCell(orderId, of['完结日期'].id, '2026-06-21', token);
  await setCell(orderId, of['财务付款时间'].id, '2026-06-21', token);
  await setCell(orderId, of['应收金额'].id, '100', token);
  await setCell(orderId, of['应付金额'].id, '60', token);

  [sc, data] = await call('POST', `/api/bases/${baseId}/finance/generate-details`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.arCreated, 1);
  assert.strictEqual(data.apCreated, 1);
  [sc, data] = await call('POST', `/api/bases/${baseId}/finance/generate-details`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.arCreated, 0);
  assert.strictEqual(data.apCreated, 0);

  let arPage = await page(ar.id, token);
  let apPage = await page(ap.id, token);
  assert.strictEqual(arPage.records.length, 1);
  assert.strictEqual(apPage.records.length, 1);
  const arId = arPage.records[0].id;
  const apId = apPage.records[0].id;
  assert.strictEqual(cell(arPage, arId, arf['应收金额'].id), '100');
  assert.strictEqual(cell(apPage, apId, apf['应付金额'].id), '60');

  [sc, data] = await call('POST', `/api/tables/${reversal.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const reversalId = data.id;
  await setCell(reversalId, rf['红冲对象类型'].id, '应收明细', token);
  await setCell(reversalId, rf['红冲方向'].id, '冲回应收', token);
  await setCell(reversalId, rf['红冲金额'].id, '40', token);
  await setCell(reversalId, rf['红冲原因'].id, '退款', token);
  await addLink(rf['原应收明细'].id, reversalId, arId, token);
  [sc, data] = await call('POST', '/api/buttons/execute', { fieldId: rf['审核通过'].id, recordId: reversalId }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.ok(data.createdDetailId);

  arPage = await page(ar.id, token);
  assert.strictEqual(arPage.records.length, 2);
  assert.strictEqual(cell(arPage, arId, arf['明细状态'].id), '已红冲');
  assert.ok(arPage.cells.some(c => c.field_id === arf['应收金额'].id && c.value === '-40'));

  [sc, data] = await call('POST', `/api/tables/${cancel.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const cancelId = data.id;
  await addLink(cf['原订单'].id, cancelId, orderId, token);
  await setCell(cancelId, cf['撤单原因'].id, '客户取消', token);
  [sc, data] = await call('POST', '/api/buttons/execute', { fieldId: cf['审核通过'].id, recordId: cancelId }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const orderPage = await page(order.id, token);
  assert.strictEqual(cell(orderPage, orderId, of['订单状态'].id), '已取消');
  const cancelPage = await page(cancel.id, token);
  assert.strictEqual(cell(cancelPage, cancelId, cf['需要财务红冲'].id), 'true');

  console.log('Finance reconciliation tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
