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

async function run() {
  const businessDate = '2026-06-21';
  let sc, data;
  [sc, data] = await call('POST', '/api/register', { email: `jobs_${Date.now()}@test.local`, password: 'Pass123456!@', displayName: 'Jobs Test' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const token = data.token;

  [sc, data] = await call('POST', '/api/bases', { name: '作业中心验证空间' }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/resource-archive`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/product-info`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/business-lock`, {}, token))[0], 200);
  assert.strictEqual((await call('POST', `/api/bases/${baseId}/templates/order-management`, {}, token))[0], 200);

  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const archive = tables['资源档案中心'];
  const source = tables['产品名称数据源区'];
  const product = tables['产品信息区'];
  const employee = tables['员工档案中心'];
  const lock = tables['业务锁定区'];
  const order = tables['订单管理区'];
  const af = fieldsByName(archive);
  const sf = fieldsByName(source);
  const pf = fieldsByName(product);
  const ef = fieldsByName(employee);
  const lf = fieldsByName(lock);
  const of = fieldsByName(order);

  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  const payerId = data.id;
  await setCell(payerId, af['企业名称'].id, '佣金客户A', token);
  [sc, data] = await call('POST', `/api/tables/${archive.id}/records`, {}, token);
  const supplierId = data.id;
  await setCell(supplierId, af['企业名称'].id, '佣金供应商A', token);

  [sc, data] = await call('POST', `/api/tables/${source.id}/records`, {}, token);
  const sourceId = data.id;
  await setCell(sourceId, sf['产品名称'].id, '佣金测试产品', token);
  await setCell(sourceId, sf['货号'].id, 'JOB-SKU', token);
  [sc, data] = await call('POST', `/api/tables/${product.id}/records`, {}, token);
  const productId = data.id;
  await addLink(pf['名称'].id, productId, sourceId, token);
  await addLink(pf['供应商'].id, productId, supplierId, token);
  await setCell(productId, pf['售价'].id, '1000', token);
  await setCell(productId, pf['成本'].id, '700', token);

  [sc, data] = await call('POST', `/api/tables/${employee.id}/records`, {}, token);
  const employeeId = data.id;
  await setCell(employeeId, ef['员工姓名'].id, '作业负责人', token);

  [sc, data] = await call('POST', `/api/tables/${lock.id}/records`, {}, token);
  const lockId = data.id;
  await addLink(lf['合作渠道'].id, lockId, payerId, token);
  await addLink(lf['申请人'].id, lockId, employeeId, token);
  await setCell(lockId, lf['合作关系'].id, '客户', token);
  await setCell(lockId, lf['分组'].id, '渠道负责区', token);
  await setCell(lockId, lf['资源状态'].id, '沉淀', token);
  await setCell(lockId, lf['判断'].id, '申请', token);
  await setCell(lockId, lf['审批结果'].id, '待审批', token);
  [sc, data] = await call('POST', '/api/buttons/execute', { fieldId: lf['审批通过'].id, recordId: lockId }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));

  [sc, data] = await call('POST', `/api/tables/${order.id}/records`, {}, token);
  const orderId = data.id;
  await addLink(of['产品'].id, orderId, productId, token);
  await addLink(of['付款方'].id, orderId, payerId, token);
  await setCell(orderId, of['数量'].id, '1', token);
  await setCell(orderId, of['分区'].id, '完结区', token);
  await setCell(orderId, of['完结日期'].id, businessDate, token);
  await setCell(orderId, of['财务付款时间'].id, businessDate, token);

  [sc, data] = await call('POST', `/api/bases/${baseId}/jobs/status_update/run`, { businessDate, dryRun: true }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.changedCount, 1);
  [sc, data] = await call('GET', `/api/tables/${lock.id}/page?offset=0&limit=10`, undefined, token);
  let cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  assert.strictEqual(cellMap.get(`${lockId}:${lf['资源状态'].id}`), '沉淀');

  [sc, data] = await call('POST', `/api/bases/${baseId}/jobs/status_update/run`, { businessDate, dryRun: false }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.changedCount, 1);
  [sc, data] = await call('GET', `/api/tables/${lock.id}/page?offset=0&limit=10`, undefined, token);
  cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  assert.strictEqual(cellMap.get(`${lockId}:${lf['资源状态'].id}`), '正常');

  [sc, data] = await call('POST', `/api/bases/${baseId}/jobs/commission_settlement/run`, { businessDate, dryRun: true }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.changedCount, 1);
  [sc, data] = await call('POST', `/api/bases/${baseId}/jobs/commission_settlement/run`, { businessDate, dryRun: false }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.changedCount, 1);

  [sc, data] = await call('GET', `/api/tables/${lock.id}/page?offset=0&limit=10`, undefined, token);
  cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  assert.strictEqual(cellMap.get(`${lockId}:${lf['今日奖金'].id}`), '0.9');
  assert.strictEqual(cellMap.get(`${lockId}:${lf['月度奖金'].id}`), '0.9');
  assert.strictEqual(cellMap.get(`${lockId}:${lf['累计奖金'].id}`), '0.9');

  [sc, data] = await call('GET', `/api/tables/${order.id}/page?offset=0&limit=10`, undefined, token);
  cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  assert.strictEqual(cellMap.get(`${orderId}:${of['佣金已结算'].id}`), 'true');
  assert.strictEqual(cellMap.get(`${orderId}:${of['佣金结算批次'].id}`), 'COMM-20260621');
  assert.strictEqual(cellMap.get(`${orderId}:${of['快照毛利'].id}`), '300');

  [sc, data] = await call('POST', `/api/bases/${baseId}/jobs/commission_settlement/run`, { businessDate, dryRun: false }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.changedCount, 0);

  [sc, data] = await call('GET', `/api/bases/${baseId}/jobs/runs`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.ok(data.runs.length >= 5);

  // 定时调度设置：自主选择执行时间
  [sc, data] = await call('GET', `/api/bases/${baseId}/jobs/configs`, undefined, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.ok(Array.isArray(data.configs) && data.configs.length >= 2);
  for (const cfg of data.configs) {
    assert.strictEqual(typeof cfg.schedule_enabled, 'boolean');
    assert.strictEqual(typeof cfg.schedule_dry_run, 'boolean');
  }

  // 保存定时
  [sc, data] = await call('PATCH', `/api/bases/${baseId}/jobs/configs/status_update`, {
    schedule_enabled: true,
    schedule_time: '08:30',
    schedule_business_date_mode: 'yesterday',
    schedule_dry_run: true,
  }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.config.schedule_enabled, 1);
  assert.strictEqual(data.config.schedule_time, '08:30');
  assert.strictEqual(data.config.schedule_business_date_mode, 'yesterday');
  assert.strictEqual(data.config.schedule_dry_run, 1);

  // 非法时间应被忽略，保持原值
  [sc, data] = await call('PATCH', `/api/bases/${baseId}/jobs/configs/status_update`, {
    schedule_time: '25:99',
  }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.config.schedule_time, '08:30');

  // 关闭定时
  [sc, data] = await call('PATCH', `/api/bases/${baseId}/jobs/configs/status_update`, {
    schedule_enabled: false,
  }, token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.config.schedule_enabled, 0);

  console.log('Jobs tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
