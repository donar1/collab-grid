// scripts/smoke-test-batch-paste.js
// 冒烟测试：验证 batch API 带 type 字段的粘贴通路
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
  console.log('=== Smoke Test: Batch Paste API ===\n');

  // 1. 登录
  const [sc, login] = await call('POST', '/api/login', {
    email: 'tester@frontend.local',
    password: 'FrontendTest123!'
  });
  if (sc !== 200) { console.error('❌ Login failed:', login.error || login); process.exit(1); }
  const token = login.token;
  console.log('✅ Login success');

  // 2. 获取表
  const [, bases] = await call('GET', '/api/bases', undefined, token);
  const base = bases.bases?.[0];
  const [, baseDetail] = await call('GET', `/api/bases/${base.id}`, undefined, token);
  const productTable = (baseDetail.tables || []).find(t => t.name === '产品表');
  if (!productTable) { console.error('❌ 产品表 not found'); process.exit(1); }
  console.log('✅ 产品表 found, records:', productTable.records?.length || 0);

  // 3. 获取字段
  const nameField = productTable.fields.find(f => f.name === '产品名称');
  const priceField = productTable.fields.find(f => f.name === '单价');
  if (!nameField) { console.error('❌ 产品名称 field not found'); process.exit(1); }
  console.log('✅ Fields found');

  // 4. 找到前2条记录，模拟粘贴2行数据
  const records = productTable.records || [];
  if (records.length < 2) { console.error('❌ Need at least 2 records'); process.exit(1); }
  const rec1 = records[0];
  const rec2 = records[1];

  // 5. 先读取原始值
  const [, pageData] = await call('GET', `/api/tables/${productTable.id}/page?offset=0&limit=500`, undefined, token);
  const origVal1 = (pageData.cells || []).find(c => c.record_id === rec1.id && c.field_id === nameField.id)?.value || '';

  // 6. 调用 batch API（模拟 clipboard.js 的 pasteIntoSelection）
  const updates = [
    { type: 'cell.update', recordId: rec1.id, fieldId: nameField.id, value: '批量粘贴测试_A' },
    { type: 'cell.update', recordId: rec2.id, fieldId: nameField.id, value: '批量粘贴测试_B' },
  ];
  if (priceField) {
    updates.push({ type: 'cell.update', recordId: rec1.id, fieldId: priceField.id, value: '999.99' });
  }

  console.log('📤 Sending batch update with', updates.length, 'items...');
  const [batchStatus, batchRes] = await call('POST', '/api/batch', { updates }, token);
  if (batchStatus !== 200) {
    console.error('❌ Batch API failed! Status:', batchStatus);
    console.error('❌ Response:', JSON.stringify(batchRes));
    process.exit(1);
  }
  console.log('✅ Batch API success:', batchRes.ok, 'count:', batchRes.count);

  // 7. 验证写入
  await new Promise(r => setTimeout(r, 300));
  const [, verifyPage] = await call('GET', `/api/tables/${productTable.id}/page?offset=0&limit=500`, undefined, token);
  const v1 = (verifyPage.cells || []).find(c => c.record_id === rec1.id && c.field_id === nameField.id)?.value;
  const v2 = (verifyPage.cells || []).find(c => c.record_id === rec2.id && c.field_id === nameField.id)?.value;
  if (v1 === '批量粘贴测试_A' && v2 === '批量粘贴测试_B') {
    console.log('✅ Verify: values match');
  } else {
    console.error('❌ Verify failed. Expected: 批量粘贴测试_A / 批量粘贴测试_B, Got:', v1, '/', v2);
  }

  // 8. 还原原始值
  const restore = [
    { type: 'cell.update', recordId: rec1.id, fieldId: nameField.id, value: origVal1 },
    { type: 'cell.update', recordId: rec2.id, fieldId: nameField.id, value: '' },
  ];
  await call('POST', '/api/batch', { updates: restore }, token);
  console.log('✅ Restored original values');

  console.log('\n=== All Batch Paste Tests Passed ===');
}

smoke().catch(err => { console.error('Smoke test error:', err); process.exit(1); });
