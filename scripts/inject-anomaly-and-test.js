// scripts/inject-anomaly-and-test.js
// P1-2: 注入一笔异常数据（完结区+有付款时间+未结算），验证诊断告警格式
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
  const data = await res.json();
  return [res.status, data];
}

async function main() {
  console.log('=== P1-2: Inject Anomaly + Verify Alert Format ===\n');

  const [sc, login] = await call('POST', '/api/login', {
    email: 'tester@frontend.local', password: 'FrontendTest123!',
  });
  if (sc !== 200) { console.error('❌ Login failed'); process.exit(1); }
  const token = login.token;

  const [, bases] = await call('GET', '/api/bases', undefined, token);
  const base = bases.bases?.[0];
  console.log('Base:', base.name);

  // 获取销售订单表
  const [, baseDetail] = await call('GET', `/api/bases/${base.id}`, undefined, token);
  const orderTable = (baseDetail.tables || []).find(t => t.name === '销售订单表');
  if (!orderTable) { console.error('❌ 销售订单表 not found'); process.exit(1); }

  // 获取字段
  const fields = orderTable.fields || [];
  const zoneField = fields.find(f => f.name === '分区');
  const paidField = fields.find(f => f.name === '财务付款时间');
  const statusField = fields.find(f => f.name === '订单状态');
  const commSettledField = fields.find(f => f.name === '佣金已结算');

  console.log('Fields found:');
  console.log('  分区:', zoneField?.id || 'NOT FOUND');
  console.log('  财务付款时间:', paidField?.id || 'NOT FOUND');
  console.log('  订单状态:', statusField?.id || 'NOT FOUND');
  console.log('  佣金已结算:', commSettledField?.id || 'NOT FOUND');

  if (!zoneField || !paidField || !commSettledField) {
    console.error('❌ Required fields not found, cannot inject anomaly');
    process.exit(1);
  }

  // 创建一笔异常订单
  const today = new Date().toISOString().slice(0, 10);
  const [, newRec] = await call('POST', `/api/tables/${orderTable.id}/records`, {}, token);
  const recId = newRec.id;
  console.log('\n✅ Created record:', recId);

  // 设置异常数据：分区=完结区, 财务付款时间=today, 佣金已结算≠true
  if (zoneField) {
    await call('PUT', `/api/records/${recId}/cells/${zoneField.id}`, { value: '完结区' }, token);
    console.log('  Set 分区 = 完结区');
  }
  if (paidField) {
    await call('PUT', `/api/records/${recId}/cells/${paidField.id}`, { value: today }, token);
    console.log('  Set 财务付款时间 =', today);
  }
  if (statusField) {
    await call('PUT', `/api/records/${recId}/cells/${statusField.id}`, { value: '已完成' }, token);
    console.log('  Set 订单状态 = 已完成');
  }
  if (commSettledField) {
    await call('PUT', `/api/records/${recId}/cells/${commSettledField.id}`, { value: 'false' }, token);
    console.log('  Set 佣金已结算 = false');
  }

  // 等待数据写入
  await new Promise(r => setTimeout(r, 500));

  // 调用诊断
  console.log('\nRunning diagnostics...');
  const [dc, diag] = await call('GET', `/api/bases/${base.id}/diagnostics?businessDate=${today}`, undefined, token);
  if (dc !== 200) { console.error('❌ Diagnostics failed:', diag); process.exit(1); }

  console.log(`Issues found: ${diag.issueCount}`);
  let hasUnsettled = false;
  let hasBadField = false;

  for (const issue of (diag.issues || [])) {
    console.log(`\n[${issue.severity}] ${issue.code}: ${issue.title}`);
    console.log(`  count: ${issue.count}`);
    console.log(`  message: ${issue.message}`);
    console.log(`  suggest: ${issue.suggest}`);
    if (issue.code === 'completed_unsettled_orders') {
      hasUnsettled = true;
      for (const sample of issue.samples || []) {
        console.log(`  sample:`, JSON.stringify(sample));
        for (const [k, v] of Object.entries(sample)) {
          if (v === '?' || v === '' || v === undefined || v === null) {
            console.warn(`  ⚠️ BAD FIELD: ${k}=${v}`);
            hasBadField = true;
          }
        }
      }
    }
  }

  // 清理：删除测试记录
  await call('DELETE', `/api/records/${recId}`, undefined, token);
  console.log('\n✅ Cleaned up test record');

  // 验证
  if (!hasUnsettled) {
    console.error('\n❌ Expected completed_unsettled_orders issue but not found');
    process.exit(1);
  }
  if (hasBadField) {
    console.error('\n❌ ALERT FORMAT ISSUE: fields contain "?" or empty values');
    process.exit(1);
  }
  console.log('\n✅ P1-2 PASSED: Alert format is correct, no "?" or empty fields');

  console.log('\n=== P1-2 Test Complete ===');
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
