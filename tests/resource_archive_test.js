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
  const email = `resource_${Date.now()}@test.local`;
  let sc, data;
  [sc, data] = await call('POST', '/api/register', { email, password: 'Pass123456!@', displayName: 'Archive Test' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const token = data.token;

  [sc, data] = await call('POST', '/api/bases', { name: '资源档案验证空间' }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;

  [sc, data] = await call('POST', `/api/bases/${baseId}/templates/resource-archive`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.deepStrictEqual(data.tables, ['资源档案中心']);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const archive = tables['资源档案中心'];
  assert.ok(archive);
  assert.strictEqual(data.tables.filter(t => ['审批领导账户', '资源审批待办'].includes(t.name)).length, 0);

  const fields = Object.fromEntries(archive.fields.map(f => [f.name, f]));
  assert.strictEqual(fields['代码'].type, 'autoNumber');
  assert.strictEqual(fields['入档日期'].type, 'createdTime');
  assert.strictEqual(fields['身份证明'].type, 'attachment');
  assert.strictEqual(fields['审批领导'].type, 'select');
  assert.strictEqual(fields['审批意见'].type, 'text');
  assert.strictEqual(fields['审批通过'].type, 'button');

  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const recordId = data.id;

  [sc] = await call('PUT', `/api/records/${recordId}/cells/${fields['企业名称'].id}`, { value: '测试企业' }, token);
  assert.strictEqual(sc, 200);
  [sc] = await call('PUT', `/api/records/${recordId}/cells/${fields['审批领导'].id}`, { value: '张总' }, token);
  assert.strictEqual(sc, 200);
  [sc] = await call('PUT', `/api/records/${recordId}/cells/${fields['审批状态'].id}`, { value: '待审批' }, token);
  assert.strictEqual(sc, 200);
  [sc] = await call('PUT', `/api/records/${recordId}/cells/${fields['身份证明'].id}`, { value: 'https://example.com/license.png' }, token);
  assert.strictEqual(sc, 200);

  [sc, data] = await call('POST', '/api/buttons/execute', { fieldId: fields['审批通过'].id, recordId }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.action, 'approve_resource');
  assert.strictEqual(data.locked, true);

  [sc, data] = await call('GET', `/api/tables/${archive.id}/page?offset=0&limit=20`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  assert.ok(cellMap.get(`${recordId}:${fields['代码'].id}`).startsWith('RES-'));
  assert.strictEqual(cellMap.get(`${recordId}:${fields['审批状态'].id}`), '已通过');
  assert.strictEqual(cellMap.get(`${recordId}:${fields['数据可使用'].id}`), 'true');
  assert.strictEqual(cellMap.get(`${recordId}:${fields['待办'].id}`), '已完成');
  assert.strictEqual(cellMap.get(`${recordId}:${fields['建群对接'].id}`), '已正常对接');

  console.log('Resource archive tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
