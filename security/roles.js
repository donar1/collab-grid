// security/roles.js — 角色与新旧角色映射
// 设计原则：
//   1) 系统级角色（跨 base，写在 users 表 system_role 字段）：
//        sys_admin      管理员：全权，可配置其他角色权限矩阵
//        data_engineer  数据员（全局）：可触发底层维护/迁移/排障，能改底层数据
//        none           普通用户：仅在 base 内有 base 级角色
//   2) Base 级角色（写在 members.role）：
//        manager        管理（含财务）
//        business       业务
//        data_clerk     数据员（base 内数据修复/导入/任务）
//        support        客服
//        warehouse      库管
//   3) 外部角色（仅用于外部库查询）：
//        customer_query 客户查询
//   4) 兼容旧角色（owner/admin/approver/finance/editor/viewer）→ 自动映射到上方新角色。

const SYSTEM_ROLES = ['sys_admin', 'manager', 'data_engineer', 'data_clerk', 'none'];

const BASE_ROLES = ['manager', 'business', 'data_clerk', 'support', 'warehouse'];

const EXTERNAL_ROLES = ['customer_query'];

const ROLE_LABELS = {
  // 系统角色
  sys_admin: '系统管理员',
  manager: '管理（含财务）',
  data_engineer: '数据工程师',
  data_clerk: '数据员',
  none: '普通用户',
  // Base 角色
  business: '业务',
  support: '客服',
  warehouse: '库管',
  customer_query: '客户查询',
  // 旧角色（保留 label，便于审计）
  owner: '所有者（旧）',
  admin: '管理员（旧）',
  approver: '审批人（旧）',
  finance: '财务（旧）',
  editor: '编辑（旧）',
  viewer: '只读（旧）',
};

// 旧角色 → 新 base 角色（仅在 base 维度做兼容映射）
const LEGACY_BASE_ROLE_MAP = {
  owner: 'manager',
  admin: 'manager',
  approver: 'business',
  finance: 'manager',
  editor: 'business',
  viewer: 'support',
};

// 旧 owner / admin 在系统维度视为 sys_admin（首个所有者通常也是系统管理员）
// 但我们不主动把所有 owner 提权为系统管理员，由首次注册时显式设置 system_role。

function normalizeBaseRole(role, fallback = 'business') {
  const raw = String(role || '').trim();
  if (BASE_ROLES.includes(raw)) return raw;
  if (LEGACY_BASE_ROLE_MAP[raw]) return LEGACY_BASE_ROLE_MAP[raw];
  return fallback;
}

function normalizeSystemRole(role, fallback = 'none') {
  const raw = String(role || '').trim();
  return SYSTEM_ROLES.includes(raw) ? raw : fallback;
}

function publicRoleMeta(role) {
  const value = String(role || '').trim();
  return { value, label: ROLE_LABELS[value] || value };
}

// base 角色权重，用于"不能授予 ≥ 自身等级"的逻辑
const BASE_ROLE_RANK = {
  support: 1,
  warehouse: 1,
  business: 2,
  data_clerk: 3,
  manager: 4,
};

function baseRoleRank(role) {
  return BASE_ROLE_RANK[normalizeBaseRole(role, 'support')] || 0;
}

module.exports = {
  SYSTEM_ROLES,
  BASE_ROLES,
  EXTERNAL_ROLES,
  ROLE_LABELS,
  LEGACY_BASE_ROLE_MAP,
  normalizeBaseRole,
  normalizeSystemRole,
  publicRoleMeta,
  baseRoleRank,
};
