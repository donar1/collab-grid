// tests/e2e_integration.js — 端到端集成测试
// 覆盖：登录 → 创建基地 → 初始化模板 → 录入数据 → 执行封账 → 诊断 → 运行任务 → 仪表盘 → 清理
const assert = require('assert');

const BASE = process.env.CG_BASE_URL || 'http://localhost:3001';

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return { status: res.status, data };
}

async function run() {
  let r, baseId, token;
  const ts = Date.now();

  // 1. 登录（使用现有测试账号）
  console.log('1. 登录...');
  r = await call('POST', '/api/login', { email: 'tester@frontend.local', password: 'FrontendTest123!' });
  assert.strictEqual(r.status, 200, 'Login failed: ' + JSON.stringify(r.data));
  token = r.data.token;
  assert.ok(token, 'No token returned');
  console.log('   ✅ 登录成功\n');

  // 2. 创建测试基地
  console.log('2. 创建测试基地...');
  r = await call('POST', '/api/bases', { name: 'E2E 测试 ' + ts }, token);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  baseId = r.data.id;
  assert.ok(baseId);
  console.log('   ✅ 基地创建成功, id:', baseId, '\n');

  try {
    // 3. 初始化业务模板
    console.log('3. 初始化业务模板...');
    r = await call('POST', `/api/bases/${baseId}/templates/business-core`, {}, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.ok, true);
    assert.ok(r.data.tables.includes('销售订单表'));
    assert.ok(r.data.tables.includes('产品表'));
    console.log('   ✅ 模板初始化成功, 表:', r.data.tables.join(', '), '\n');

    // 4. 获取表结构
    r = await call('GET', `/api/bases/${baseId}`, undefined, token);
    assert.strictEqual(r.status, 200);
    const tables = Object.fromEntries(r.data.tables.map(t => [t.name, t]));
    const productTable = tables['产品表'];
    const salesTable = tables['销售订单表'];
    const customerTable = tables['客户账户表'];
    const settlementTable = tables['结算表'];
    assert.ok(salesTable, '销售订单表不存在');
    assert.ok(productTable, '产品表不存在');
    assert.ok(customerTable, '客户账户表不存在');

    const pf = Object.fromEntries(productTable.fields.map(f => [f.name, f]));
    const sf = Object.fromEntries(salesTable.fields.map(f => [f.name, f]));
    const cf = Object.fromEntries(customerTable.fields.map(f => [f.name, f]));
    const setf = Object.fromEntries(settlementTable.fields.map(f => [f.name, f]));
    console.log('   ✅ 表结构验证通过\n');

    // 5. 创建产品记录
    console.log('5. 创建产品记录...');
    r = await call('POST', `/api/tables/${productTable.id}/records`, {}, token);
    assert.strictEqual(r.status, 200);
    const prodId = r.data.id;
    r = await call('PUT', `/api/records/${prodId}/cells/${pf['产品名称'].id}`, { value: '测试产品A' }, token);
    assert.strictEqual(r.status, 200);
    r = await call('PUT', `/api/records/${prodId}/cells/${pf['销售单价'].id}`, { value: '100' }, token);
    assert.strictEqual(r.status, 200);
    console.log('   ✅ 产品记录创建成功, id:', prodId, '\n');

    // 6. 创建客户账户记录
    console.log('6. 创建客户账户记录...');
    r = await call('POST', `/api/tables/${customerTable.id}/records`, {}, token);
    assert.strictEqual(r.status, 200);
    const custId = r.data.id;
    r = await call('PUT', `/api/records/${custId}/cells/${cf['客户名称'].id}`, { value: '测试客户X' }, token);
    assert.strictEqual(r.status, 200);
    console.log('   ✅ 客户记录创建成功, id:', custId, '\n');

    // 7. 创建销售订单（含链接字段）
    console.log('7. 创建销售订单...');
    r = await call('POST', `/api/tables/${salesTable.id}/records`, {}, token);
    assert.strictEqual(r.status, 200);
    const orderId = r.data.id;

    // 写入数量
    r = await call('PUT', `/api/records/${orderId}/cells/${sf['数量'].id}`, { value: '5' }, token);
    assert.strictEqual(r.status, 200);
    // 写入单价
    r = await call('PUT', `/api/records/${orderId}/cells/${sf['单价'].id}`, { value: '200' }, token);
    assert.strictEqual(r.status, 200);
    // 关联产品
    r = await call('POST', '/api/links', { fieldId: sf['产品'].id, fromRecordId: orderId, toRecordId: prodId }, token);
    assert.strictEqual(r.status, 200, 'Link product failed: ' + JSON.stringify(r.data));
    // 关联客户
    r = await call('POST', '/api/links', { fieldId: sf['客户'].id, fromRecordId: orderId, toRecordId: custId }, token);
    assert.strictEqual(r.status, 200, 'Link customer failed: ' + JSON.stringify(r.data));
    // 设置订单状态
    r = await call('PUT', `/api/records/${orderId}/cells/${sf['订单状态'].id}`, { value: '已完成' }, token);
    assert.strictEqual(r.status, 200);
    console.log('   ✅ 订单创建成功, id:', orderId, '\n');

    // 8. 验证公式计算（总金额 = 数量 * 单价 = 5 * 200 = 1000）
    console.log('8. 验证公式计算...');
    r = await call('GET', `/api/tables/${salesTable.id}/page?offset=0&limit=20`, undefined, token);
    assert.strictEqual(r.status, 200);
    const cellMap = new Map(r.data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
    const totalVal = cellMap.get(`${orderId}:${sf['总金额'].id}`);
    assert.strictEqual(totalVal, '1000', `总金额应为 1000，实际: ${totalVal}`);
    const orderNo = cellMap.get(`${orderId}:${sf['订单编号'].id}`);
    assert.ok(orderNo?.startsWith('XS-'), `订单编号格式错误: ${orderNo}`);
    console.log('   ✅ 总金额 = 1000, 订单编号 =', orderNo, '\n');

    // 9. 执行封账按钮
    console.log('9. 执行封账...');
    r = await call('POST', '/api/buttons/execute', { fieldId: sf['封账'].id, recordId: orderId }, token);
    assert.strictEqual(r.status, 200, 'Seal failed: ' + JSON.stringify(r.data));
    assert.strictEqual(r.data.locked, true);
    // 验证封账后无法修改
    r = await call('PUT', `/api/records/${orderId}/cells/${sf['数量'].id}`, { value: '10' }, token);
    assert.strictEqual(r.status, 423, '封账后应返回 423');
    console.log('   ✅ 封账成功, 修改已被拒绝 (423)\n');

    // 10. 运行诊断
    console.log('10. 运行诊断...');
    r = await call('GET', `/api/bases/${baseId}/diagnostics?businessDate=${new Date().toISOString().slice(0, 10)}`, undefined, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.issueCount >= 0, '诊断应返回 issueCount');
    // 至少应有订单表 + 结算表
    assert.ok(r.data.counts.orders >= 1, '应有至少1个订单');
    console.log('   ✅ 诊断完成, 问题数:', r.data.issueCount, '订单数:', r.data.counts.orders, '\n');

    // 11. 获取仪表盘摘要
    console.log('11. 获取仪表盘摘要...');
    r = await call('GET', `/api/bases/${baseId}/dashboard/summary`, undefined, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.data !== undefined, '仪表盘应返回数据');
    console.log('   ✅ 仪表盘摘要:', JSON.stringify(r.data).substring(0, 200), '\n');

    // 12. 运行佣金结算任务
    console.log('12. 运行佣金结算任务...');
    r = await call('POST', `/api/bases/${baseId}/jobs/commission/run`, { dryRun: true }, token);
    assert.strictEqual(r.status, 200, 'Commission job failed: ' + JSON.stringify(r.data));
    assert.ok(r.data.summary, '应返回 summary');
    console.log('   ✅ 佣金任务运行完成 (dryRun), summary:', JSON.stringify(r.data.summary).substring(0, 200), '\n');

    // 13. 运行状态更新任务
    console.log('13. 运行状态更新任务...');
    r = await call('POST', `/api/bases/${baseId}/jobs/status_update/run`, { dryRun: true }, token);
    assert.strictEqual(r.status, 200, 'Status job failed: ' + JSON.stringify(r.data));
    console.log('   ✅ 状态更新任务运行完成, summary:', JSON.stringify(r.data.summary).substring(0, 200), '\n');

    // 14. 获取任务运行历史
    console.log('14. 获取任务运行历史...');
    r = await call('GET', `/api/bases/${baseId}/jobs/runs?limit=10`, undefined, token);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.data.runs));
    // 至少应有 2 条（commission + status_update）
    assert.ok(r.data.runs.length >= 2, `应有至少2条运行记录，实际: ${r.data.runs.length}`);
    console.log('   ✅ 运行历史记录数:', r.data.runs.length, '\n');

    // 15. 跑现有的 P0 测试检查
    console.log('15. 验证审计日志API...');
    r = await call('GET', `/api/bases/${baseId}/audit`, undefined, token);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.data.logs));
    // 应该有 template.business_core.create、record.create、cell.update、link.create、job.run 等日志
    const actions = new Set(r.data.logs.map(l => l.action));
    const expected = ['template.business_core.create', 'job.run'];
    for (const act of expected) {
      assert.ok(actions.has(act), `审计日志应包含 ${act}`);
    }
    console.log('   ✅ 审计日志验证通过, 共', r.data.logs.length, '条\n');

    console.log('=== 全部 15 项 E2E 测试通过 ===');
  } finally {
    // 清理：删除测试基地
    console.log('清理: 删除测试基地...');
    r = await call('DELETE', `/api/bases/${baseId}`, undefined, token);
    assert.strictEqual(r.status, 200, '清理失败: ' + JSON.stringify(r.data));
    console.log('   ✅ 基地已删除\n');
  }
}

run().catch(err => {
  console.error('❌ E2E 测试失败:', err.message);
  process.exit(1);
});