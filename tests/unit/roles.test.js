// tests/unit/roles.test.js
// Phase 9.1: security/roles.js 单元测试
// 覆盖：ROLES 数组完整性、normalizeRole、roleRank

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — expected "${expected}", got "${actual}"`); }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

const {
  SYSTEM_ROLES,
  BASE_ROLES,
  EXTERNAL_ROLES,
  ROLE_LABELS,
  LEGACY_BASE_ROLE_MAP,
  normalizeBaseRole,
  normalizeSystemRole,
  publicRoleMeta,
  baseRoleRank,
} = require('../../security/roles');

// ---- 测试 1: ROLES 数组完整性 ----
console.log('\n--- roles.test.js: ROLES 数组完整性 ---');

assertDeepEqual(SYSTEM_ROLES, ['sys_admin', 'data_engineer', 'none'], 'SYSTEM_ROLES 完整');
assertDeepEqual(BASE_ROLES, ['manager', 'business', 'data_clerk', 'support', 'warehouse'], 'BASE_ROLES 完整');
assertDeepEqual(EXTERNAL_ROLES, ['customer_query'], 'EXTERNAL_ROLES 完整');

// 所有角色在 ROLE_LABELS 中都有标签
for (const role of [...SYSTEM_ROLES, ...BASE_ROLES, ...EXTERNAL_ROLES]) {
  assert(ROLE_LABELS[role] !== undefined, `${role} 在 ROLE_LABELS 中有标签`);
}

// 旧角色也有标签
const legacyRoles = ['owner', 'admin', 'approver', 'finance', 'editor', 'viewer'];
for (const role of legacyRoles) {
  assert(ROLE_LABELS[role] !== undefined, `旧角色 ${role} 在 ROLE_LABELS 中有标签`);
}

// LEGACY_BASE_ROLE_MAP 覆盖所有旧角色
for (const role of legacyRoles) {
  assert(LEGACY_BASE_ROLE_MAP[role] !== undefined, `旧角色 ${role} 在 LEGACY_BASE_ROLE_MAP 中有映射`);
  assert(BASE_ROLES.includes(LEGACY_BASE_ROLE_MAP[role]), `旧角色 ${role} 映射到有效 base 角色 ${LEGACY_BASE_ROLE_MAP[role]}`);
}

// ---- 测试 2: normalizeBaseRole ----
console.log('\n--- roles.test.js: normalizeBaseRole ---');

// 直接返回有效角色
assertEqual(normalizeBaseRole('manager'), 'manager', 'normalizeBaseRole: manager');
assertEqual(normalizeBaseRole('business'), 'business', 'normalizeBaseRole: business');
assertEqual(normalizeBaseRole('data_clerk'), 'data_clerk', 'normalizeBaseRole: data_clerk');
assertEqual(normalizeBaseRole('support'), 'support', 'normalizeBaseRole: support');
assertEqual(normalizeBaseRole('warehouse'), 'warehouse', 'normalizeBaseRole: warehouse');

// 旧角色映射
assertEqual(normalizeBaseRole('owner'), 'manager', 'normalizeBaseRole: owner → manager');
assertEqual(normalizeBaseRole('admin'), 'manager', 'normalizeBaseRole: admin → manager');
assertEqual(normalizeBaseRole('approver'), 'business', 'normalizeBaseRole: approver → business');
assertEqual(normalizeBaseRole('finance'), 'manager', 'normalizeBaseRole: finance → manager');
assertEqual(normalizeBaseRole('editor'), 'business', 'normalizeBaseRole: editor → business');
assertEqual(normalizeBaseRole('viewer'), 'support', 'normalizeBaseRole: viewer → support');

// 无效角色 → fallback
assertEqual(normalizeBaseRole('nonexistent'), 'business', 'normalizeBaseRole: 无效角色 → business (默认)');
assertEqual(normalizeBaseRole(''), 'business', 'normalizeBaseRole: 空字符串 → business');
assertEqual(normalizeBaseRole(null), 'business', 'normalizeBaseRole: null → business');
assertEqual(normalizeBaseRole(undefined), 'business', 'normalizeBaseRole: undefined → business');

// 自定义 fallback
assertEqual(normalizeBaseRole('nonexistent', 'support'), 'support', 'normalizeBaseRole: 自定义 fallback');

// ---- 测试 3: normalizeSystemRole ----
console.log('\n--- roles.test.js: normalizeSystemRole ---');

assertEqual(normalizeSystemRole('sys_admin'), 'sys_admin', 'normalizeSystemRole: sys_admin');
assertEqual(normalizeSystemRole('data_engineer'), 'data_engineer', 'normalizeSystemRole: data_engineer');
assertEqual(normalizeSystemRole('none'), 'none', 'normalizeSystemRole: none');
assertEqual(normalizeSystemRole('invalid'), 'none', 'normalizeSystemRole: 无效 → none');
assertEqual(normalizeSystemRole(null), 'none', 'normalizeSystemRole: null → none');
assertEqual(normalizeSystemRole('invalid', 'data_engineer'), 'data_engineer', 'normalizeSystemRole: 自定义 fallback');

// ---- 测试 4: publicRoleMeta ----
console.log('\n--- roles.test.js: publicRoleMeta ---');

const meta = publicRoleMeta('manager');
assertEqual(meta.value, 'manager', 'publicRoleMeta: value 正确');
assertEqual(meta.label, '管理（含财务）', 'publicRoleMeta: label 正确');

const metaUnknown = publicRoleMeta('unknown_role');
assertEqual(metaUnknown.value, 'unknown_role', 'publicRoleMeta: 未知角色 value 保留');
assertEqual(metaUnknown.label, 'unknown_role', 'publicRoleMeta: 未知角色 label 等于 value');

// ---- 测试 5: baseRoleRank ----
console.log('\n--- roles.test.js: baseRoleRank ---');

assertEqual(baseRoleRank('support'), 1, 'baseRoleRank: support = 1');
assertEqual(baseRoleRank('warehouse'), 1, 'baseRoleRank: warehouse = 1');
assertEqual(baseRoleRank('business'), 2, 'baseRoleRank: business = 2');
assertEqual(baseRoleRank('data_clerk'), 3, 'baseRoleRank: data_clerk = 3');
assertEqual(baseRoleRank('manager'), 4, 'baseRoleRank: manager = 4');

// 旧角色映射后的 rank
assertEqual(baseRoleRank('owner'), 4, 'baseRoleRank: owner (→manager) = 4');
assertEqual(baseRoleRank('admin'), 4, 'baseRoleRank: admin (→manager) = 4');
assertEqual(baseRoleRank('editor'), 2, 'baseRoleRank: editor (→business) = 2');
assertEqual(baseRoleRank('viewer'), 1, 'baseRoleRank: viewer (→support) = 1');

// 排序验证：manager > data_clerk > business > support
assert(baseRoleRank('manager') > baseRoleRank('data_clerk'), 'manager > data_clerk');
assert(baseRoleRank('data_clerk') > baseRoleRank('business'), 'data_clerk > business');
assert(baseRoleRank('business') > baseRoleRank('support'), 'business > support');

// ---- 报告 ----
const total = passed + failed;
console.log(`\n roles.test.js: ${total} tests, ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
