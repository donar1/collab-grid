// scripts/smoke-test-diagnostics.js
// P1-2: 调用诊断 API，确认告警格式不含 ? 或空字段
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

async function smoke() {
  console.log('=== Smoke Test: Diagnostics Alert Format ===\n');

  // 1. 登录
  const [sc, login] = await call('POST', '/api/login', {
    email: 'tester@frontend.local',
    password: 'FrontendTest123!',
  });
  if (sc !== 200) { console.error('❌ Login failed'); process.exit(1); }
  const token = login.token;
  console.log('✅ Login');

  // 2. 获取 base
  const [, bases] = await call('GET', '/api/bases', undefined, token);
  const base = bases.bases?.[0];
  if (!base) { console.error('❌ No base'); process.exit(1); }
  console.log('✅ Base:', base.name);

  // 3. 调用诊断 API
  const [dc, diag] = await call('GET', `/api/bases/${base.id}/diagnostics`, undefined, token);
  if (dc !== 200) { console.error('❌ Diagnostics failed:', diag); process.exit(1); }
  console.log(`✅ Diagnostics: ${diag.issueCount} issues found`);

  // 4. 检查每个 issue 的格式
  let hasIssue = false;
  let hasBadField = false;
  for (const issue of diag.issues || []) {
    hasIssue = true;
    console.log(`\n  [${issue.severity}] ${issue.code}: ${issue.title}`);
    console.log(`    count: ${issue.count}`);
    console.log(`    suggest: ${issue.suggest}`);
    // 检查 samples 是否有 ? 或空字段
    if (issue.samples) {
      for (const sample of issue.samples) {
        for (const [k, v] of Object.entries(sample)) {
          if (v === '?' || v === '' || v === undefined || v === null) {
            console.warn(`    ⚠️ Bad field in sample: ${k}=${v}`);
            hasBadField = true;
          }
        }
      }
      if (issue.samples.length > 0) {
        console.log(`    sample[0]:`, JSON.stringify(issue.samples[0]));
      }
    }
  }

  if (!hasIssue) {
    console.log('\nℹ️ No issues found — all clean. To test alert format, inject anomaly data.');
    console.log('   Suggested: create an order with zone=完结区 + 付款时间=today + 佣金已结算≠true');
  }

  if (hasBadField) {
    console.error('\n❌ ALERT FORMAT ISSUE: some fields contain "?" or empty values');
    process.exit(1);
  } else if (hasIssue) {
    console.log('\n✅ All alert fields have valid values (no "?" or empty)');
  }

  // 5. 打印诊断元数据
  console.log('\nDiagnostics metadata:');
  console.log('  checkedAt:', diag.checkedAt);
  console.log('  counts:', JSON.stringify(diag.counts));

  console.log('\n=== Diagnostics Alert Format Test Complete ===');
}

smoke().catch(err => { console.error('Error:', err); process.exit(1); });
