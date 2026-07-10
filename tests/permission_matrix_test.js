// tests/permission_matrix_test.js
// 端到端测试 V0.3.1 权限矩阵：
//   1. 启动时默认管理员可登录，并可修改密码
//   2. 默认 5 个 base 角色（manager / business / data_clerk / support / warehouse）
//      的开箱权限符合 DEFAULT_BASE_MATRIX
//   3. customer_query 外部 token 颁发 / 校验 / 撤销 / 仅能取自身 snapshot
//   4. matrix.write：sys_admin 改 matrix 后，普通成员立即生效
//   5. 数据库分离：外部库写不到内部表
//
// 运行前需 server.js 在 CG_BASE_URL（默认 http://localhost:3000）启动。

const assert = require('assert');

const BASE = process.env.CG_BASE_URL || 'http://localhost:3000';
const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@collabgrid.local';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'Admin@123456';

async function call(method, path, body, token, extraHeaders) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return [res.status, data];
}

async function reg(email) {
  const [sc, data] = await call('POST', '/api/register', { email, password: 'Pass123456!@', displayName: 'Test User' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  return { token: data.token, user: data.user };
}

async function run() {
  const suffix = Date.now();

  // ---------- A0. 默认管理员 ----------
  let [sc, data] = await call('POST', '/api/login', {
    email: DEFAULT_ADMIN_EMAIL,
    password: DEFAULT_ADMIN_PASSWORD,
  });
  assert.strictEqual(sc, 200, '默认管理员应可登录：' + JSON.stringify(data));
  assert.strictEqual(data.user.systemRole, 'sys_admin');
  assert.strictEqual(data.user.mustChangePassword, true);
  const admin = { token: data.token, user: data.user };

  // ---------- A. 注册三个角色用户 ----------
  const owner = await reg(`pm_owner_${suffix}@test.local`);
  const business = await reg(`pm_business_${suffix}@test.local`);
  const warehouse = await reg(`pm_warehouse_${suffix}@test.local`);
  const support = await reg(`pm_support_${suffix}@test.local`);

  // 普通登录用户也能修改自己的密码；改完旧密码失效，新密码可登录。
  [sc, data] = await call('POST', '/api/auth/change-password', {
    oldPassword: 'Pass123456!@',
    newPassword: 'NewPass123456!@',
  }, owner.token);
  assert.strictEqual(sc, 200, '用户应可修改自己的密码：' + JSON.stringify(data));
  [sc] = await call('POST', '/api/login', {
    email: owner.user.email,
    password: 'Pass123456!@',
  });
  assert.strictEqual(sc, 401, '旧密码应失效');
  [sc, data] = await call('POST', '/api/login', {
    email: owner.user.email,
    password: 'NewPass123456!@',
  });
  assert.strictEqual(sc, 200, '新密码应可登录：' + JSON.stringify(data));
  owner.token = data.token;

  // ---------- B. 权限字典可读 ----------
  [sc, data] = await call('GET', '/api/security/permissions', undefined, owner.token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.ok(Array.isArray(data.permissions) && data.permissions.length > 0);
  assert.ok(data.baseRoles.find(r => r.value === 'manager'));
  assert.ok(data.baseRoles.find(r => r.value === 'warehouse'));
  assert.ok(data.externalRoles.find(r => r.value === 'customer_query'));

  // ---------- C. 创建 base + 邀请三个角色 ----------
  [sc, data] = await call('POST', '/api/bases', { name: '权限矩阵验证' }, owner.token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const baseId = data.id;

  async function inviteAndAccept(role, user, userToken) {
    let [s, d] = await call('POST', `/api/bases/${baseId}/invites`, { email: user.email, role }, owner.token);
    assert.strictEqual(s, 200, `invite ${role}: ` + JSON.stringify(d));
    assert.strictEqual(d.role, role);
    [s] = await call('POST', `/api/invites/${d.token}/accept`, {}, userToken);
    assert.strictEqual(s, 200);
  }
  await inviteAndAccept('business', business.user, business.token);
  await inviteAndAccept('warehouse', warehouse.user, warehouse.token);
  await inviteAndAccept('support', support.user, support.token);

  // ---------- D. /api/security/me 返回每个 base 的有效权限 ----------
  [sc, data] = await call('GET', '/api/security/me', undefined, business.token);
  assert.strictEqual(sc, 200);
  const mem = data.memberships.find(m => m.baseId === baseId);
  assert.ok(mem, 'business 用户应是该 base 成员');
  assert.ok(mem.permissions.includes('record.write'), 'business 默认可写记录');
  assert.ok(!mem.permissions.includes('structure.write'), 'business 默认不可改结构');

  [sc, data] = await call('GET', '/api/security/me', undefined, support.token);
  const sm = data.memberships.find(m => m.baseId === baseId);
  assert.ok(!sm.permissions.includes('record.write'), 'support 默认不可写');
  assert.ok(sm.permissions.includes('record.read'), 'support 默认可读');
  assert.ok(sm.permissions.includes('customer.query'), 'support 默认带客户查询');

  [sc, data] = await call('GET', '/api/security/me', undefined, warehouse.token);
  const wm = data.memberships.find(m => m.baseId === baseId);
  assert.ok(wm.permissions.includes('inventory.approve'), 'warehouse 默认可库存审批');
  assert.ok(!wm.permissions.includes('finance.seal'), 'warehouse 默认不能封账');

  // ---------- E. 实际写操作：business 可写记录、support 不能 ----------
  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, owner.token);
  const defaultTable = data.tables.find(t => t.name === '表1');
  assert.ok(defaultTable);

  [sc, data] = await call('POST', `/api/tables/${defaultTable.id}/records`, {}, business.token);
  assert.strictEqual(sc, 200, '业务角色应可新增记录: ' + JSON.stringify(data));

  [sc, data] = await call('POST', `/api/tables/${defaultTable.id}/records`, {}, support.token);
  assert.strictEqual(sc, 403, '客服角色不应能新增记录');

  // ---------- F. sys_admin 修改 base 矩阵后，support 立刻获得 record.write ----------
  [sc, data] = await call('PUT', `/api/bases/${baseId}/security/matrix`, {
    changes: [
      { scope: 'base', role: 'support', baseId, permission: 'record.write', allow: true },
    ],
  }, admin.token);
  assert.strictEqual(sc, 200, JSON.stringify(data));

  [sc, data] = await call('POST', `/api/tables/${defaultTable.id}/records`, {}, support.token);
  assert.strictEqual(sc, 200, '矩阵改写后 support 应可写记录');

  // 撤回（allow=null）
  [sc] = await call('PUT', `/api/bases/${baseId}/security/matrix`, {
    changes: [{ scope: 'base', role: 'support', baseId, permission: 'record.write', allow: null }],
  }, admin.token);
  assert.strictEqual(sc, 200);
  [sc] = await call('POST', `/api/tables/${defaultTable.id}/records`, {}, support.token);
  assert.strictEqual(sc, 403, '撤回后 support 应恢复无写权');

  // ---------- G. 非 sys_admin 不能改全局矩阵 ----------
  [sc, data] = await call('PUT', '/api/security/matrix', {
    changes: [{ scope: 'system', role: 'data_engineer', permission: 'finance.seal', allow: true }],
  }, business.token);
  assert.strictEqual(sc, 403, 'business 不能改全局矩阵');

  // ---------- H. 客户查询：颁发 token + 外部访问隔离 ----------
  [sc, data] = await call('POST', `/api/bases/${baseId}/public/clients`, {
    customerKey: `CUST-${suffix}`,
    displayName: '测试客户',
    ttlDays: 7,
  }, owner.token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  const customerToken = data.token;
  assert.ok(customerToken && customerToken.length >= 20);

  // 用 X-Customer-Token 访问外部接口（不走 Authorization）
  [sc, data] = await call('GET', '/api/public/me', undefined, undefined, { 'X-Customer-Token': customerToken });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.customerKey, `CUST-${suffix}`);
  assert.strictEqual(data.role, 'customer_query');

  // 同步一条快照然后查
  [sc, data] = await call('POST', `/api/bases/${baseId}/public/snapshots/sync`, {
    items: [{ customerKey: `CUST-${suffix}`, category: 'order', refId: 'O-001', data: { amount: 123, status: 'paid' } }],
  }, owner.token);
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(data.written, 1);

  [sc, data] = await call('GET', '/api/public/snapshots?category=order', undefined, undefined, { 'X-Customer-Token': customerToken });
  assert.strictEqual(sc, 200);
  assert.strictEqual(data.total, 1);
  assert.strictEqual(data.snapshots[0].data.amount, 123);

  // 别的客户 token 拿不到该客户的快照
  [sc, data] = await call('POST', `/api/bases/${baseId}/public/clients`, {
    customerKey: `OTHER-${suffix}`,
  }, owner.token);
  const otherToken = data.token;
  [sc, data] = await call('GET', '/api/public/snapshots', undefined, undefined, { 'X-Customer-Token': otherToken });
  assert.strictEqual(sc, 200);
  assert.strictEqual(data.total, 0, '客户 token 只能看自己的快照');

  // 外部接口不接受内部 JWT
  [sc, data] = await call('GET', '/api/public/me', undefined, business.token);
  assert.strictEqual(sc, 401, '外部接口必须使用 X-Customer-Token');

  // 撤销后再访问
  [sc] = await call('DELETE', `/api/bases/${baseId}/public/clients/${customerToken}`, undefined, owner.token);
  assert.strictEqual(sc, 200);
  [sc] = await call('GET', '/api/public/me', undefined, undefined, { 'X-Customer-Token': customerToken });
  assert.strictEqual(sc, 401, '撤销后 token 失效');

  // ---------- I. 内部接口拒绝外部 token ----------
  [sc] = await call('GET', `/api/bases/${baseId}`, undefined, undefined, { Authorization: `Bearer ${otherToken}` });
  assert.strictEqual(sc, 401, '客户 token 不能假装内部 JWT');

  // ---------- J. 系统角色修改规则 ----------
  // 不能修改自己的系统角色
  [sc, data] = await call('PATCH', `/api/security/users/${admin.user.id}/system-role`, {
    systemRole: 'none',
  }, admin.token);
  assert.strictEqual(sc, 403, '不应能修改自己的系统角色：' + JSON.stringify(data));
  assert.ok(data.error && data.error.includes('cannot change own system role'), '错误提示应说明不能修改自己的角色');

  // 先创建第二个 sys_admin
  const deputy = await reg(`pm_deputy_${suffix}@test.local`);
  [sc] = await call('PATCH', `/api/security/users/${deputy.user.id}/system-role`, {
    systemRole: 'sys_admin',
  }, admin.token);
  assert.strictEqual(sc, 200, '应能把普通用户提升为 sys_admin');

  // 用 deputy 降级 admin（不是修改自己，应成功）
  [sc, data] = await call('PATCH', `/api/security/users/${admin.user.id}/system-role`, {
    systemRole: 'none',
  }, deputy.token);
  assert.strictEqual(sc, 200, '存在多个 sys_admin 时，降级其中一个应成功：' + JSON.stringify(data));

  // 确认 admin 已降级
  [sc, data] = await call('GET', '/api/security/me', undefined, admin.token);
  assert.strictEqual(data.systemRole, 'none', 'admin 应已被降级为 none');

  console.log('Permission matrix tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
