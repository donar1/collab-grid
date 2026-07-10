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

async function register(email) {
  const [sc, data] = await call('POST', '/api/register', { email, password: 'Pass123456!@', displayName: 'Team Scale Test' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  return data.token;
}

async function run() {
  const suffix = Date.now();
  const ownerToken = await register(`team_owner_${suffix}@test.local`);
  const viewerToken = await register(`team_viewer_${suffix}@test.local`);

  let sc, data;
  [sc, data] = await call('POST', '/api/bases', { name: '团队权限与大数据验证' }, ownerToken);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;

  [sc] = await call('POST', `/api/bases/${baseId}/templates/resource-archive`, {}, ownerToken);
  assert.strictEqual(sc, 200);
  [sc] = await call('POST', `/api/bases/${baseId}/templates/product-info`, {}, ownerToken);
  assert.strictEqual(sc, 200);

  [sc, data] = await call('POST', `/api/bases/${baseId}/invites`, { role: 'viewer' }, ownerToken);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.role, 'viewer');
  const inviteToken = data.token;

  [sc] = await call('POST', `/api/invites/${inviteToken}/accept`, {}, viewerToken);
  assert.strictEqual(sc, 200);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, viewerToken);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.role, 'viewer');
  const defaultTable = data.tables.find(t => t.name === '表 1');
  assert.ok(defaultTable);

  [sc] = await call('POST', `/api/tables/${defaultTable.id}/records`, {}, viewerToken);
  assert.strictEqual(sc, 403);

  const viewerId = data.members.find(m => m.email === `team_viewer_${suffix}@test.local`).id;
  [sc, data] = await call('PATCH', `/api/bases/${baseId}/members/${viewerId}`, { role: 'approver' }, ownerToken);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.role, 'approver');

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, ownerToken);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const archive = data.tables.find(t => t.name === '资源档案中心');
  const af = Object.fromEntries(archive.fields.map(f => [f.name, f]));
  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, ownerToken);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const archiveRecordId = data.id;
  [sc] = await call('PUT', `/api/records/${archiveRecordId}/cells/${af['企业名称'].id}`, { value: '审批权限测试企业' }, ownerToken);
  assert.strictEqual(sc, 200);
  [sc, data] = await call('POST', '/api/buttons/execute', { fieldId: af['审批通过'].id, recordId: archiveRecordId }, viewerToken);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.action, 'approve_resource');

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, ownerToken);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const source = data.tables.find(t => t.name === '产品名称数据源区');
  const sf = Object.fromEntries(source.fields.map(f => [f.name, f]));
  for (let i = 0; i < 130; i++) {
    const [rsc, rec] = await call('POST', `/api/tables/${source.id}/records`, {}, ownerToken);
    assert.strictEqual(rsc, 200, JSON.stringify(rec));
    const name = `压力测试产品-${String(i).padStart(3, '0')}`;
    const sku = `SKU-STRESS-${String(i).padStart(3, '0')}`;
    assert.strictEqual((await call('PUT', `/api/records/${rec.id}/cells/${sf['产品名称'].id}`, { value: name }, ownerToken))[0], 200);
    assert.strictEqual((await call('PUT', `/api/records/${rec.id}/cells/${sf['货号'].id}`, { value: sku }, ownerToken))[0], 200);
  }

  [sc, data] = await call('GET', `/api/tables/${source.id}/search?q=${encodeURIComponent('压力测试产品-129')}&displayFieldId=${sf['产品名称'].id}&limit=20`, undefined, ownerToken);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.page.total, 1);
  const foundId = data.records[0].id;
  const cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  assert.strictEqual(cellMap.get(`${foundId}:${sf['货号'].id}`), 'SKU-STRESS-129');

  console.log('Team permission and scale tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
