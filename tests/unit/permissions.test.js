// tests/unit/permissions.test.js
// security/permissions.js 单元测试
// 覆盖：权限矩阵覆盖所有角色和操作类别、hasPermission 判断、旧角色映射

let passed = 0;
let failed = 0;

function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`FAIL: ${name}`, e.message); }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || 'assertion failed'} — expected "${expected}", got "${actual}"`);
}

const {
  PERMISSIONS,
  PERMISSION_LABELS,
  DEFAULT_BASE_MATRIX,
  DEFAULT_SYSTEM_MATRIX,
  DEFAULT_EXTERNAL_MATRIX,
  listPermissions,
} = require('../../security/permissions');

const {
  SYSTEM_ROLES,
  BASE_ROLES,
  EXTERNAL_ROLES,
  LEGACY_BASE_ROLE_MAP,
  normalizeBaseRole,
  normalizeSystemRole,
} = require('../../security/roles');

// ---- 测试 1: PERMISSIONS 数组完整性 ----
console.log('\n--- permissions.test.js: PERMISSIONS 数组 ---');

test('PERMISSIONS 非空', () => {
  assert(PERMISSIONS.length > 0);
});

test('PERMISSIONS 无重复', () => {
  assertEqual(PERMISSIONS.length, new Set(PERMISSIONS).size);
});

test('每个权限都有标签', () => {
  for (const p of PERMISSIONS) {
    assert(PERMISSION_LABELS[p] !== undefined, `权限 ${p} 缺少标签`);
  }
});

test('listPermissions 返回 code+label', () => {
  const listed = listPermissions();
  assertEqual(listed.length, PERMISSIONS.length);
  assert(listed.every(item => item.code && item.label));
});

// ---- 测试 2: 权限矩阵覆盖所有角色 ----
console.log('\n--- permissions.test.js: 矩阵覆盖所有角色 ---');

test('DEFAULT_BASE_MATRIX 覆盖所有 BASE_ROLES', () => {
  for (const role of BASE_ROLES) {
    assert(Array.isArray(DEFAULT_BASE_MATRIX[role]), `base 角色 "${role}" 未在 DEFAULT_BASE_MATRIX 中定义`);
  }
});

test('DEFAULT_SYSTEM_MATRIX 覆盖所有 SYSTEM_ROLES', () => {
  for (const role of SYSTEM_ROLES) {
    assert(Array.isArray(DEFAULT_SYSTEM_MATRIX[role]), `系统角色 "${role}" 未在 DEFAULT_SYSTEM_MATRIX 中定义`);
  }
});

test('DEFAULT_EXTERNAL_MATRIX 覆盖所有 EXTERNAL_ROLES', () => {
  for (const role of EXTERNAL_ROLES) {
    assert(Array.isArray(DEFAULT_EXTERNAL_MATRIX[role]), `外部角色 "${role}" 未在 DEFAULT_EXTERNAL_MATRIX 中定义`);
  }
});

// ---- 测试 3: 权限矩阵覆盖所有操作类别 ----
console.log('\n--- permissions.test.js: 矩阵覆盖所有操作类别 ---');

test('PERMISSIONS 覆盖 structure 操作类别', () => {
  const structurePerms = PERMISSIONS.filter(p => p.startsWith('structure.'));
  assert(structurePerms.length >= 2, `structure 类别至少应有 2 个权限，实际 ${structurePerms.length}`);
  assert(structurePerms.includes('structure.read'));
  assert(structurePerms.includes('structure.write'));
});

test('PERMISSIONS 覆盖 data (record) 操作类别', () => {
  const dataPerms = PERMISSIONS.filter(p => p.startsWith('record.'));
  assert(dataPerms.length >= 3, `record 类别至少应有 3 个权限，实际 ${dataPerms.length}`);
  assert(dataPerms.includes('record.read'));
  assert(dataPerms.includes('record.write'));
  assert(dataPerms.includes('record.seal'));
});

test('PERMISSIONS 覆盖 finance 操作类别', () => {
  const financePerms = PERMISSIONS.filter(p => p.startsWith('finance.'));
  assert(financePerms.length >= 2, `finance 类别至少应有 2 个权限，实际 ${financePerms.length}`);
  assert(financePerms.includes('finance.seal'));
  assert(financePerms.includes('finance.reversal'));
});

test('PERMISSIONS 覆盖 admin (member/jobs/matrix/db) 操作类别', () => {
  const adminDomains = ['member.', 'jobs.', 'matrix.', 'db.'];
  for (const domain of adminDomains) {
    const perms = PERMISSIONS.filter(p => p.startsWith(domain));
    assert(perms.length > 0, `${domain} 类别应有至少 1 个权限`);
  }
});

test('PERMISSIONS 覆盖 approval/inventory 操作类别', () => {
  assert(PERMISSIONS.some(p => p.startsWith('approval.')));
  assert(PERMISSIONS.some(p => p.startsWith('inventory.')));
});

// ---- 测试 4: 旧角色映射完整性 ----
console.log('\n--- permissions.test.js: 旧角色映射 ---');

const LEGACY_ROLES = ['owner', 'admin', 'approver', 'finance', 'editor', 'viewer'];

test('所有旧角色都有映射', () => {
  for (const role of LEGACY_ROLES) {
    assert(LEGACY_BASE_ROLE_MAP[role] !== undefined, `旧角色 "${role}" 未在 LEGACY_BASE_ROLE_MAP 中映射`);
  }
});

test('旧角色映射后都在 BASE_ROLES 中', () => {
  for (const role of LEGACY_ROLES) {
    const mapped = LEGACY_BASE_ROLE_MAP[role];
    assert(BASE_ROLES.includes(mapped), `旧角色 "${role}" 映射到 "${mapped}"，但不在 BASE_ROLES 中`);
  }
});

test('normalizeBaseRole 正确映射旧角色', () => {
  assertEqual(normalizeBaseRole('owner'), 'manager');
  assertEqual(normalizeBaseRole('admin'), 'manager');
  assertEqual(normalizeBaseRole('finance'), 'manager');
  assertEqual(normalizeBaseRole('editor'), 'business');
  assertEqual(normalizeBaseRole('approver'), 'business');
  assertEqual(normalizeBaseRole('viewer'), 'support');
  assertEqual(normalizeBaseRole('guest'), 'business'); // 未知角色 fallback
});

// ---- 测试 5: sys_admin 拥有全部权限 ----
console.log('\n--- permissions.test.js: sys_admin 全权 ---');

test('sys_admin 拥有全部 PERMISSIONS', () => {
  const sysAdminPerms = new Set(DEFAULT_SYSTEM_MATRIX.sys_admin);
  for (const p of PERMISSIONS) {
    assert(sysAdminPerms.has(p), `sys_admin 缺少权限 ${p}`);
  }
});

// ---- 测试 6: 各角色权限内容验证 ----
console.log('\n--- permissions.test.js: 各角色权限验证 ---');

test('manager: 拥有管理+财务权限', () => {
  const perms = new Set(DEFAULT_BASE_MATRIX.manager);
  assert(perms.has('structure.write'));
  assert(perms.has('record.write'));
  assert(perms.has('record.seal'));
  assert(perms.has('finance.seal'));
  assert(perms.has('finance.reversal'));
  assert(perms.has('member.invite'));
  assert(perms.has('member.role'));
  assert(!perms.has('matrix.write'), 'manager 不应有 matrix.write');
  assert(!perms.has('db.maintenance'), 'manager 不应有 db.maintenance');
  assert(!perms.has('customer.query'), 'manager 不应有 customer.query');
});

test('business: 拥有业务读写+审批权限', () => {
  const perms = new Set(DEFAULT_BASE_MATRIX.business);
  assert(perms.has('record.write'));
  assert(perms.has('approval.business_lock'));
  assert(perms.has('approval.order'));
  assert(!perms.has('structure.write'), 'business 不应有 structure.write');
  assert(!perms.has('record.seal'), 'business 不应有 record.seal');
  assert(!perms.has('member.invite'), 'business 不应有 member.invite');
});

test('data_clerk: 拥有数据修复+任务权限', () => {
  const perms = new Set(DEFAULT_BASE_MATRIX.data_clerk);
  assert(perms.has('structure.write'));
  assert(perms.has('record.write'));
  assert(perms.has('jobs.run'));
  assert(perms.has('jobs.config'));
  assert(!perms.has('approval.business_lock'), 'data_clerk 不应有 approval');
  assert(!perms.has('record.seal'), 'data_clerk 不应有 record.seal');
});

test('support: 只读+客户查询', () => {
  const perms = new Set(DEFAULT_BASE_MATRIX.support);
  assert(perms.has('structure.read'));
  assert(perms.has('record.read'));
  assert(perms.has('customer.query'));
  assert(!perms.has('record.write'), 'support 不应有 record.write');
  assert(!perms.has('structure.write'), 'support 不应有 structure.write');
});

test('warehouse: 库存相关权限', () => {
  const perms = new Set(DEFAULT_BASE_MATRIX.warehouse);
  assert(perms.has('record.write'));
  assert(perms.has('inventory.approve'));
  assert(!perms.has('structure.write'), 'warehouse 不应有 structure.write');
  assert(!perms.has('finance.seal'), 'warehouse 不应有 finance.seal');
});

test('data_engineer: 底层维护权限', () => {
  const perms = new Set(DEFAULT_SYSTEM_MATRIX.data_engineer);
  assert(perms.has('db.maintenance'));
  assert(perms.has('structure.write'));
  assert(!perms.has('matrix.write'), 'data_engineer 不应有 matrix.write');
  assert(!perms.has('record.seal'), 'data_engineer 不应有 record.seal');
});

test('none: 无任何权限', () => {
  assertEqual(DEFAULT_SYSTEM_MATRIX.none.length, 0);
});

test('customer_query: 仅 customer.query', () => {
  const perms = new Set(DEFAULT_EXTERNAL_MATRIX.customer_query);
  assert(perms.has('customer.query'));
  assertEqual(perms.size, 1);
});

// ---- 测试 7: hasPermission 模拟测试 ----
console.log('\n--- permissions.test.js: hasPermission 模拟 ---');

// 模拟 computeEffectivePermissions 的简化版本（不依赖数据库）
function simulateHasPermission(systemRole, baseRole, permission) {
  const grant = new Set();
  if (systemRole && DEFAULT_SYSTEM_MATRIX[systemRole]) {
    for (const p of DEFAULT_SYSTEM_MATRIX[systemRole]) grant.add(p);
  }
  if (baseRole && DEFAULT_BASE_MATRIX[baseRole]) {
    for (const p of DEFAULT_BASE_MATRIX[baseRole]) grant.add(p);
  }
  return grant.has(permission);
}

test('hasPermission: sys_admin + manager -> 全权', () => {
  assert(simulateHasPermission('sys_admin', 'manager', 'db.maintenance'));
  assert(simulateHasPermission('sys_admin', 'manager', 'matrix.write'));
  assert(simulateHasPermission('sys_admin', 'manager', 'customer.query'));
});

test('hasPermission: none + manager -> manager 权限', () => {
  assert(simulateHasPermission('none', 'manager', 'record.write'));
  assert(simulateHasPermission('none', 'manager', 'finance.seal'));
  assert(!simulateHasPermission('none', 'manager', 'db.maintenance'));
  assert(!simulateHasPermission('none', 'manager', 'matrix.write'));
});

test('hasPermission: none + business -> business 权限', () => {
  assert(simulateHasPermission('none', 'business', 'record.write'));
  assert(simulateHasPermission('none', 'business', 'approval.business_lock'));
  assert(!simulateHasPermission('none', 'business', 'structure.write'));
  assert(!simulateHasPermission('none', 'business', 'finance.seal'));
});

test('hasPermission: data_engineer + support -> 并集', () => {
  assert(simulateHasPermission('data_engineer', 'support', 'db.maintenance'));
  assert(simulateHasPermission('data_engineer', 'support', 'customer.query'));
});

test('hasPermission: none + support -> 只读', () => {
  assert(simulateHasPermission('none', 'support', 'record.read'));
  assert(!simulateHasPermission('none', 'support', 'record.write'));
});

// ---- 测试 8: hasPermission 对未知角色返回 false ----
console.log('\n--- permissions.test.js: 未知角色/操作 ---');

test('hasPermission: 未知系统角色 -> false', () => {
  assert(!simulateHasPermission('super_admin', null, 'record.read'));
  assert(!simulateHasPermission('hacker', null, 'record.write'));
  assert(!simulateHasPermission('', null, 'record.read'));
});

test('hasPermission: 未知 base 角色 -> false', () => {
  assert(!simulateHasPermission('none', 'superuser', 'record.read'));
  assert(!simulateHasPermission('none', 'root', 'record.write'));
  assert(!simulateHasPermission('none', '', 'record.read'));
});

test('hasPermission: 未知操作 -> false', () => {
  assert(!simulateHasPermission('none', 'manager', 'super.delete'));
  assert(!simulateHasPermission('sys_admin', null, 'nonexistent.action'));
  assert(!simulateHasPermission('none', 'business', ''));
});

test('hasPermission: 未知角色 + 未知操作 -> false', () => {
  assert(!simulateHasPermission('unknown_role', 'unknown_role', 'unknown.action'));
});

// ---- 测试 9: 旧角色通过 normalizeBaseRole 后 hasPermission 正确 ----
console.log('\n--- permissions.test.js: 旧角色 hasPermission ---');

test('旧角色 owner 映射后等同 manager', () => {
  const mapped = normalizeBaseRole('owner');
  assert(simulateHasPermission('none', mapped, 'structure.write'));
  assert(simulateHasPermission('none', mapped, 'finance.seal'));
  assert(!simulateHasPermission('none', mapped, 'matrix.write'));
});

test('旧角色 admin 映射后等同 manager', () => {
  const mapped = normalizeBaseRole('admin');
  assert(simulateHasPermission('none', mapped, 'member.role'));
  assert(simulateHasPermission('none', mapped, 'record.seal'));
});

test('旧角色 finance 映射后等同 manager', () => {
  const mapped = normalizeBaseRole('finance');
  assert(simulateHasPermission('none', mapped, 'finance.seal'));
  assert(simulateHasPermission('none', mapped, 'finance.reversal'));
});

test('旧角色 viewer 映射后等同 support', () => {
  const mapped = normalizeBaseRole('viewer');
  assert(simulateHasPermission('none', mapped, 'record.read'));
  assert(!simulateHasPermission('none', mapped, 'record.write'));
});

test('旧角色 guest 映射后 fallback 到 business', () => {
  const mapped = normalizeBaseRole('guest');
  assert(simulateHasPermission('none', mapped, 'record.write'));
});

// ---- 报告 ----
const total = passed + failed;
console.log(`\n permissions.test.js: ${total} tests, ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
