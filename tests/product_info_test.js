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
  const email = `product_${Date.now()}@test.local`;
  let sc, data;
  [sc, data] = await call('POST', '/api/register', { email, password: 'Pass123456!@', displayName: 'Product Test' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const token = data.token;

  [sc, data] = await call('POST', '/api/bases', { name: '产品信息验证空间' }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;

  [sc, data] = await call('POST', `/api/bases/${baseId}/templates/product-info`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.deepStrictEqual(data.tables, ['产品名称数据源区', '产品信息区']);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const source = tables['产品名称数据源区'];
  const info = tables['产品信息区'];
  assert.ok(source);
  assert.ok(info);

  const sourceFields = Object.fromEntries(source.fields.map(f => [f.name, f]));
  const infoFields = Object.fromEntries(info.fields.map(f => [f.name, f]));
  assert.strictEqual(sourceFields['产品名称'].type, 'text');
  assert.strictEqual(sourceFields['货号'].type, 'text');
  assert.strictEqual(infoFields['标题'].type, 'textFormula');
  assert.strictEqual(infoFields['名称'].type, 'link');
  assert.strictEqual(infoFields['货号'].type, 'lookup');
  assert.strictEqual(infoFields['名称'].options.tableId, source.id);
  assert.strictEqual(infoFields['名称'].options.displayFieldId, sourceFields['产品名称'].id);
  assert.strictEqual(infoFields['货号'].options.linkFieldId, infoFields['名称'].id);
  assert.strictEqual(infoFields['货号'].options.sourceFieldId, sourceFields['货号'].id);
  assert.strictEqual(infoFields['税种'].type, 'select');
  assert.strictEqual(infoFields['产品分类'].type, 'select');

  [sc, data] = await call('POST', `/api/tables/${source.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const sourceRecordId = data.id;
  [sc] = await call('PUT', `/api/records/${sourceRecordId}/cells/${sourceFields['产品名称'].id}`, { value: '扫地机器人 X1' }, token);
  assert.strictEqual(sc, 200);
  [sc] = await call('PUT', `/api/records/${sourceRecordId}/cells/${sourceFields['货号'].id}`, { value: 'SKU-X1' }, token);
  assert.strictEqual(sc, 200);

  [sc, data] = await call('POST', `/api/tables/${info.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const infoRecordId = data.id;
  [sc] = await call('POST', '/api/links', { fieldId: infoFields['名称'].id, fromRecordId: infoRecordId, toRecordId: sourceRecordId }, token);
  assert.strictEqual(sc, 200);
  [sc] = await call('PUT', `/api/records/${infoRecordId}/cells/${infoFields['规格'].id}`, { value: '标准款' }, token);
  assert.strictEqual(sc, 200);
  [sc] = await call('PUT', `/api/records/${infoRecordId}/cells/${infoFields['地区'].id}`, { value: '全国' }, token);
  assert.strictEqual(sc, 200);
  [sc] = await call('PUT', `/api/records/${infoRecordId}/cells/${infoFields['销售规则'].id}`, { value: '渠道用款到发货' }, token);
  assert.strictEqual(sc, 200);
  [sc] = await call('PUT', `/api/records/${infoRecordId}/cells/${infoFields['产品状态'].id}`, { value: '正常' }, token);
  assert.strictEqual(sc, 200);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const info2 = data.tables.find(t => t.name === '产品信息区');
  assert.ok(info2.links.some(l => l.from_record_id === infoRecordId && l.field_id === infoFields['名称'].id && l.to_record_id === sourceRecordId));

  console.log('Product info tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
