// scripts/smoke-test-clipboard.js
// 冒烟测试：验证复制粘贴核心数据通路
const BASE = 'http://localhost:3001';

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

async function smoke() {
  console.log('=== Smoke Test: Clipboard Data Path ===\n');

  // 1. 登录
  const [sc, login] = await call('POST', '/api/login', {
    email: 'tester@frontend.local',
    password: 'FrontendTest123!'
  });
  if (sc !== 200) {
    console.error('❌ Login failed:', login.error || login);
    process.exit(1);
  }
  const token = login.token;
  console.log('✅ Login success');

  // 2. 获取 bases
  const [, bases] = await call('GET', '/api/bases', undefined, token);
  const base = bases.bases?.[0];
  if (!base) {
    console.error('❌ No base found');
    process.exit(1);
  }
  console.log('✅ Base found:', base.name, base.id);

  // 3. 获取表
  const [, baseDetail] = await call('GET', `/api/bases/${base.id}`, undefined, token);
  const tables = baseDetail.tables || [];
  const productTable = tables.find(t => t.name === '产品表');
  if (!productTable) {
    console.error('❌ 产品表 not found');
    process.exit(1);
  }
  console.log('✅ 产品表 found, records:', productTable.records?.length || 0);

  // 获取 cells 数据（通过 page API）
  const [, pageData] = await call('GET', `/api/tables/${productTable.id}/page?offset=0&limit=500`, undefined, token);
  const cells = pageData.cells || [];

  // 4. 找到第一个有"产品名称"值的记录（模拟复制）
  const nameField = productTable.fields.find(f => f.name === '产品名称');
  if (!nameField) {
    console.error('❌ 产品名称 field not found');
    process.exit(1);
  }
  let firstRecord = null;
  let originalValue = '';
  for (const r of productTable.records || []) {
    const c = cells.find(c => c.record_id === r.id && c.field_id === nameField.id);
    if (c?.value) { firstRecord = r; originalValue = c.value; break; }
  }
  if (!firstRecord) {
    console.error('❌ No record with 产品名称 value in 产品表');
    process.exit(1);
  }
  console.log('✅ Read cell value (copy):', originalValue, 'from record:', firstRecord.id);

  // 5. 创建新记录并写入该值（模拟粘贴）
  const [, newRec] = await call('POST', `/api/tables/${productTable.id}/records`, {}, token);
  const newRecordId = newRec.id;
  console.log('✅ Created new record:', newRecordId);

  const [, putRes] = await call('PUT', `/api/records/${newRecordId}/cells/${nameField.id}`, {
    value: originalValue + '_pasted'
  }, token);
  if (putRes.error) {
    console.error('❌ Paste (write) failed:', putRes.error);
    process.exit(1);
  }
  console.log('✅ Wrote value (paste):', originalValue + '_pasted');

  // 6. 验证写入（等待一小段时间确保数据持久化）
  await new Promise(r => setTimeout(r, 300));
  const [, verifyPage] = await call('GET', `/api/tables/${productTable.id}/page?offset=0&limit=500`, undefined, token);
  const verifyCell = verifyPage.cells?.find(c => c.record_id === newRecordId && c.field_id === nameField.id);
  const verifyValue = verifyCell?.value ?? '';
  if (verifyValue === originalValue + '_pasted') {
    console.log('✅ Verify: value matches');
  } else {
    console.error('❌ Verify failed. Expected:', originalValue + '_pasted', 'Got:', verifyValue);
    process.exit(1);
  }

  // 7. 清理测试记录
  await call('DELETE', `/api/records/${newRecordId}`, undefined, token);
  console.log('✅ Cleaned up test record');

  console.log('\n=== All Smoke Tests Passed ===');
}

smoke().catch(err => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
