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

async function run() {
  const email = `lock_${Date.now()}@test.local`;
  let sc, data;
  [sc, data] = await call('POST', '/api/register', { email, password: 'Pass123456!@', displayName: 'Lock Test' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const token = data.token;

  [sc, data] = await call('POST', '/api/bases', { name: '业务锁定验证空间' }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;

  [sc, data] = await call('POST', `/api/bases/${baseId}/templates/business-lock`, {}, token);
  assert.strictEqual(sc, 400);

  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/resource-archive`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/product-info`, {}, token))[0], 200);
  [sc, data] = await call('POST', `/api/bases/${baseId}/templates/business-lock`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.ok(data.tables.includes('业务锁定区'));
  assert.ok(data.tables.includes('员工档案中心'));
  assert.ok(data.tables.includes('状态变更日志'));

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const archive = tables['资源档案中心'];
  const source = tables['产品名称数据源区'];
  const product = tables['产品信息区'];
  const employee = tables['员工档案中心'];
  const lock = tables['业务锁定区'];
  const statusLog = tables['状态变更日志'];
  assert.ok(archive && source && product && employee && lock && statusLog);

  const lf = Object.fromEntries(lock.fields.map(f => [f.name, f]));
  assert.strictEqual(lf['合作渠道'].type, 'link');
  assert.strictEqual(lf['合作关系'].type, 'select');
  assert.strictEqual(lf['商品'].type, 'link');
  assert.strictEqual(lf['分组'].type, 'select');
  assert.strictEqual(lf['判断'].type, 'select');
  assert.strictEqual(lf['申请人'].type, 'link');
  assert.strictEqual(lf['资源状态'].type, 'select');
  assert.strictEqual(lf['审批结果'].type, 'select');
  assert.strictEqual(lf['申请日期'].type, 'createdTime');
  assert.strictEqual(lf['审批人'].type, 'lastModifiedBy');
  assert.strictEqual(lf['审批时间'].type, 'lastModifiedTime');
  assert.strictEqual(lf['粘贴凭证'].type, 'attachment');
  assert.strictEqual(lf['渠道负责人'].type, 'lookup');
  assert.strictEqual(lf['现有产品负责人'].type, 'lookup');
  assert.strictEqual(lf['产品ID'].type, 'lookup');
  assert.strictEqual(lf['今日奖金'].type, 'currency');
  assert.strictEqual(lf['月度奖金'].type, 'currency');
  assert.strictEqual(lf['累计奖金'].type, 'currency');
  assert.strictEqual(lf['奖金明细'].type, 'multiLineText');
  assert.strictEqual(lf['审批通过'].options.action, 'approve_business_lock');

  const af = Object.fromEntries(archive.fields.map(f => [f.name, f]));
  const sf = Object.fromEntries(source.fields.map(f => [f.name, f]));
  const pf = Object.fromEntries(product.fields.map(f => [f.name, f]));
  const ef = Object.fromEntries(employee.fields.map(f => [f.name, f]));
  assert.strictEqual(pf['产品ID'].type, 'autoNumber');
  assert.strictEqual(lf['产品ID'].options.linkFieldId, lf['商品'].id);
  assert.strictEqual(lf['产品ID'].options.sourceFieldId, pf['产品ID'].id);

  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const channelId = data.id;
  await setCell(channelId, af['企业名称'].id, '渠道A', token);

  [sc, data] = await call('POST', `/api/tables/${source.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const sourceId = data.id;
  await setCell(sourceId, sf['产品名称'].id, '测试产品A', token);
  await setCell(sourceId, sf['货号'].id, 'SKU-A', token);

  [sc, data] = await call('POST', `/api/tables/${product.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const productId = data.id;
  assert.strictEqual((await call('POST', '/api/links', { fieldId: pf['名称'].id, fromRecordId: productId, toRecordId: sourceId }, token))[0], 200);

  [sc, data] = await call('POST', `/api/tables/${employee.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const empId = data.id;
  await setCell(empId, ef['员工姓名'].id, '负责人甲', token);

  [sc, data] = await call('POST', `/api/tables/${lock.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const lockId = data.id;
  assert.strictEqual((await call('POST', '/api/links', { fieldId: lf['合作渠道'].id, fromRecordId: lockId, toRecordId: channelId }, token))[0], 200);
  assert.strictEqual((await call('POST', '/api/links', { fieldId: lf['商品'].id, fromRecordId: lockId, toRecordId: productId }, token))[0], 200);
  assert.strictEqual((await call('POST', '/api/links', { fieldId: lf['申请人'].id, fromRecordId: lockId, toRecordId: empId }, token))[0], 200);
  await setCell(lockId, lf['合作关系'].id, '客户', token);
  await setCell(lockId, lf['分组'].id, '单品合作区', token);
  await setCell(lockId, lf['判断'].id, '申请', token);
  await setCell(lockId, lf['资源状态'].id, '正常', token);
  await setCell(lockId, lf['审批结果'].id, '待审批', token);
  await setCell(lockId, lf['申请原因'].id, '首次合作', token);

  [sc, data] = await call('POST', `/api/tables/${lock.id}/records`, {}, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const missingProductLockId = data.id;
  assert.strictEqual((await call('POST', '/api/links', { fieldId: lf['合作渠道'].id, fromRecordId: missingProductLockId, toRecordId: channelId }, token))[0], 200);
  assert.strictEqual((await call('POST', '/api/links', { fieldId: lf['申请人'].id, fromRecordId: missingProductLockId, toRecordId: empId }, token))[0], 200);
  await setCell(missingProductLockId, lf['合作关系'].id, '客户', token);
  await setCell(missingProductLockId, lf['分组'].id, '单品合作区', token);
  await setCell(missingProductLockId, lf['判断'].id, '申请', token);
  await setCell(missingProductLockId, lf['审批结果'].id, '待审批', token);
  [sc, data] = await call('POST', '/api/buttons/execute', { fieldId: lf['审批通过'].id, recordId: missingProductLockId }, token);
  assert.strictEqual(sc, 400, JSON.stringify(data));

  [sc, data] = await call('POST', '/api/buttons/execute', { fieldId: lf['审批通过'].id, recordId: lockId }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.action, 'approve_business_lock');

  [sc, data] = await call('GET', `/api/tables/${lock.id}/page?offset=0&limit=20`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const pageData = data;
  const cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  assert.strictEqual(cellMap.get(`${lockId}:${lf['判断'].id}`), '关联');
  assert.strictEqual(cellMap.get(`${lockId}:${lf['审批结果'].id}`), '已通过');
  assert.ok(cellMap.get(`${lockId}:${lf['产品ID'].id}`).startsWith('P-'));
  assert.strictEqual(cellMap.get(`${lockId}:${lf['渠道负责人'].id}`), '负责人甲');

  [sc, data] = await call('PUT', `/api/records/${lockId}/cells/${lf['合作关系'].id}`, { value: '供应商' }, token);
  assert.strictEqual(sc, 423, JSON.stringify(data));
  const protectedProductLink = pageData.links.find(l => l.field_id === lf['商品'].id && l.from_record_id === lockId);
  assert.ok(protectedProductLink);
  [sc, data] = await call('DELETE', `/api/links/${protectedProductLink.id}`, undefined, token);
  assert.strictEqual(sc, 423, JSON.stringify(data));
  await setCell(lockId, lf['资源状态'].id, '活跃', token);
  await setCell(lockId, lf['今日奖金'].id, '12.34', token);
  await setCell(lockId, lf['奖金明细'].id, '2026-06-21 订单A 12.34', token);

  console.log('Business lock tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
