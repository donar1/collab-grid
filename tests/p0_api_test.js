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

async function run() {
  const email = `p0_${Date.now()}@test.local`;
  let sc, data;
  [sc, data] = await call('POST', '/api/register', { email, password: 'Pass123456!@', displayName: 'P0 Tester' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const token = data.token;

  [sc, data] = await call('POST', '/api/bases', { name: 'P0 验证空间' }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;

  [sc, data] = await call('POST', `/api/bases/${baseId}/templates/business-core`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.ok, true);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  assert.ok(tables['销售订单表']);
  assert.ok(tables['产品表']);
  assert.ok(tables['库存表']);

  const sales = tables['销售订单表'];
  const fields = Object.fromEntries(sales.fields.map(f => [f.name, f]));
  assert.strictEqual(fields['订单编号'].type, 'autoNumber');
  assert.strictEqual(fields['总金额'].type, 'formula');
  assert.strictEqual(fields['封账'].type, 'button');

  [sc, data] = await call('POST', `/api/tables/${sales.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const recordId = data.id;

  [sc] = await call('PUT', `/api/records/${recordId}/cells/${fields['数量'].id}`, { value: '3' }, token);
  assert.strictEqual(sc, 200);
  [sc] = await call('PUT', `/api/records/${recordId}/cells/${fields['单价'].id}`, { value: '20' }, token);
  assert.strictEqual(sc, 200);

  [sc, data] = await call('GET', `/api/tables/${sales.id}/page?offset=0&limit=20`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  assert.ok(cellMap.get(`${recordId}:${fields['订单编号'].id}`)?.startsWith('XS-'), `orderNo cell missing. keys: ${[...cellMap.keys()].filter(k => k.startsWith(recordId)).join(', ')}`);
  assert.strictEqual(cellMap.get(`${recordId}:${fields['总金额'].id}`), '60');

  [sc, data] = await call('POST', '/api/buttons/execute', { fieldId: fields['封账'].id, recordId }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.locked, true);

  [sc] = await call('PUT', `/api/records/${recordId}/cells/${fields['数量'].id}`, { value: '4' }, token);
  assert.strictEqual(sc, 423);

  console.log('P0 API tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
