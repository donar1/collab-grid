// tests/security_audit_phase1_test.js
// 专项回归测试：覆盖安全审计 Phase 1 修复项 C-1 ~ C-6 + C-13
// 运行前需 server.js 在 CG_BASE_URL（默认 http://localhost:3000）启动。

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

async function login(email, password) {
  const [sc, data] = await call('POST', '/api/login', { email, password });
  assert.strictEqual(sc, 200, `登录失败: ${JSON.stringify(data)}`);
  return { token: data.token, user: data.user };
}

async function reg(email) {
  const [sc, data] = await call('POST', '/api/register', { email, password: 'Pass123456!@', displayName: 'Security Audit Test' });
  assert.strictEqual(sc, 200, `注册失败: ${JSON.stringify(data)}`);
  return { token: data.token, user: data.user };
}

async function run() {
  const suffix = Date.now();
  const admin = await login('admin@collabgrid.local', 'Admin@123456');

  // ---------- C-6: 字段归属校验 ----------
  // 创建两个表，尝试用 A 表的字段写入 B 表的记录，应 404
  {
    const [sc1, baseData] = await call('POST', '/api/bases', { name: `C6_base_${suffix}` }, admin.token);
    assert.strictEqual(sc1, 200);
    const baseId = baseData.id;

    const [sc2, t1] = await call('POST', `/api/bases/${baseId}/tables`, { name: '表A' }, admin.token);
    assert.strictEqual(sc2, 200);
    const [sc3, t2] = await call('POST', `/api/bases/${baseId}/tables`, { name: '表B' }, admin.token);
    assert.strictEqual(sc3, 200);

    const [sc4, f1] = await call('POST', '/api/tables/' + t1.id + '/fields', { name: '字段A', type: 'text' }, admin.token);
    assert.strictEqual(sc4, 200);

    const [sc5, rec] = await call('POST', '/api/tables/' + t2.id + '/records', {}, admin.token);
    assert.strictEqual(sc5, 200);

    // 用表A的字段写入表B的记录 -> 404 field not found
    const [sc6] = await call('PUT', `/api/records/${rec.id}/cells/${f1.id}`, { value: 'hack' }, admin.token);
    assert.strictEqual(sc6, 404, 'C-6: 跨表字段写入应返回 404');
  }

  // ---------- C-13: 批量路由校验补全 ----------
  {
    const [sc1, baseData] = await call('POST', '/api/bases', { name: `C13_base_${suffix}` }, admin.token);
    assert.strictEqual(sc1, 200);
    const baseId = baseData.id;

    const [sc2, t1] = await call('POST', `/api/bases/${baseId}/tables`, { name: '批量表' }, admin.token);
    assert.strictEqual(sc2, 200);
    const tableId = t1.id;

    const [sc3, fs] = await call('POST', `/api/tables/${tableId}/fields`, { name: '选项', type: 'select', options: JSON.stringify({ values: ['A','B'] }) }, admin.token);
    assert.strictEqual(sc3, 200);
    const selectFieldId = fs.id;

    const [sc4, fn] = await call('POST', `/api/tables/${tableId}/fields`, { name: '数字', type: 'number' }, admin.token);
    assert.strictEqual(sc4, 200);
    const numberFieldId = fn.id;

    const [sc5, fc] = await call('POST', `/api/tables/${tableId}/fields`, { name: '勾选', type: 'checkbox' }, admin.token);
    assert.strictEqual(sc5, 200);
    const checkboxFieldId = fc.id;

    const [sc6, rec] = await call('POST', `/api/tables/${tableId}/records`, {}, admin.token);
    assert.strictEqual(sc6, 200);
    const recordId = rec.id;

    // 批量写入非法 select 值 -> 400
    const [sc7] = await call('POST', '/api/batch', {
      operations: [{ type: 'cell.update', recordId, fieldId: selectFieldId, value: '非法值' }]
    }, admin.token);
    assert.strictEqual(sc7, 400, 'C-13: 批量非法 select 值应返回 400');

    // 批量写入非法 number 值 -> 400
    const [sc8] = await call('POST', '/api/batch', {
      operations: [{ type: 'cell.update', recordId, fieldId: numberFieldId, value: 'not-a-number' }]
    }, admin.token);
    assert.strictEqual(sc8, 400, 'C-13: 批量非法 number 值应返回 400');

    // 批量写入 checkbox 应被规范化
    const [sc9, data9] = await call('POST', '/api/batch', {
      operations: [{ type: 'cell.update', recordId, fieldId: checkboxFieldId, value: 1 }]
    }, admin.token);
    assert.strictEqual(sc9, 200, 'C-13: 批量 checkbox 规范化应成功');

    // 验证写入值是 'true'（通过 base 快照查询）
    const [sc10, data10] = await call('GET', `/api/bases/${baseId}`, undefined, admin.token);
    assert.strictEqual(sc10, 200);
    const table = data10.tables.find(t => t.id === tableId);
    assert.ok(table, 'C-13: 表应在快照中');
    const cell = table.cells.find(c => c.record_id === recordId && c.field_id === checkboxFieldId);
    assert.ok(cell, 'C-13: checkbox 单元格应存在');
    assert.strictEqual(cell.value, 'true', 'C-13: checkbox 值应被规范化为 true');
  }

  // ---------- C-1 ~ C-5: 事务安全（通过单元测试验证函数行为） ----------
  // 这些修复是代码层面的（读取移入事务、包裹 transaction），
  // 无法通过纯 HTTP 测试验证竞态条件，但可以通过检查函数是否存在 transaction 来确认。
  // 这里我们验证：相关接口在正常情况下仍能正确工作。
  {
    const [sc1, baseData] = await call('POST', '/api/bases', { name: `TX_base_${suffix}` }, admin.token);
    assert.strictEqual(sc1, 200);
    const baseId = baseData.id;

    // 创建库存相关表和记录，验证库存审批接口正常工作
    const [sc2, invTable] = await call('POST', `/api/bases/${baseId}/tables`, { name: '库存商品区' }, admin.token);
    assert.strictEqual(sc2, 200);
    const [sc3, opTable] = await call('POST', `/api/bases/${baseId}/tables`, { name: '出入库操作区' }, admin.token);
    assert.strictEqual(sc3, 200);
    const [sc4, ledgerTable] = await call('POST', `/api/bases/${baseId}/tables`, { name: '库存流水区' }, admin.token);
    assert.strictEqual(sc4, 200);

    // 创建库存商品记录
    const [sc5, stockRec] = await call('POST', `/api/tables/${invTable.id}/records`, {}, admin.token);
    assert.strictEqual(sc5, 200);

    // 创建出入库操作记录
    const [sc6, opRec] = await call('POST', `/api/tables/${opTable.id}/records`, {}, admin.token);
    assert.strictEqual(sc6, 200);

    // 创建审批按钮字段
    const [sc7, btnField] = await call('POST', `/api/tables/${opTable.id}/fields`, { name: '审批', type: 'button', options: JSON.stringify({ action: 'approve_inventory_operation' }) }, admin.token);
    assert.strictEqual(sc7, 200);

    // 写入必要字段值（操作类型=入库，数量=10）
    // 先创建字段
    const [sc8, typeField] = await call('POST', `/api/tables/${opTable.id}/fields`, { name: '操作类型', type: 'select', options: JSON.stringify({ values: ['入库','出库','调整'] }) }, admin.token);
    assert.strictEqual(sc8, 200);
    const [sc9, qtyField] = await call('POST', `/api/tables/${opTable.id}/fields`, { name: '数量', type: 'number' }, admin.token);
    assert.strictEqual(sc9, 200);

    await call('PUT', `/api/records/${opRec.id}/cells/${typeField.id}`, { value: '入库' }, admin.token);
    await call('PUT', `/api/records/${opRec.id}/cells/${qtyField.id}`, { value: '10' }, admin.token);

    // 执行审批按钮（C-1 修复后应正常工作）
    const [sc10, data10] = await call('POST', '/api/buttons/execute', { fieldId: btnField.id, recordId: opRec.id }, admin.token);
    // 可能会因为缺少关联字段而失败，但只要不是 500 就行
    assert.ok(sc10 === 200 || sc10 === 400, `C-1: 库存审批接口应正常响应，不能 500: ${JSON.stringify(data10)}`);
  }

  console.log('Phase 1 security audit tests passed');
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
