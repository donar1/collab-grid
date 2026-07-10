// security/guards.js — 把权限检查暴露成与 server.js 旧 API 兼容的形式
//
// 旧版散落在 server.js 的助手（canManageStructure / canEditData / canSealRecord /
// canApprove / canRunJobs / canManageBase）现在统一从这里产出。背后调用
// matrixStore.hasPermissionAsync，从而：
//   1) 默认行为与旧版一致（DEFAULT_BASE_MATRIX 设计参考了原 ROLES）
//   2) sys_admin 全权；data_engineer 拥有底层维护权
//   3) 矩阵被 admin 调整后，所有 can* 助手会立即生效，无需改业务代码

const dbAdapter = require('../services/dbAdapter');
const { hasPermissionAsync, computeEffectivePermissionsAsync } = require('./matrixStore');
const { normalizeBaseRole, normalizeSystemRole } = require('./roles');

// ---------------------------------------------------------------------------
// 异步版本 — 用于 PostgreSQL 模式
// 通过 dbAdapter.queryOneAsync 执行异步查询，所有方法返回 Promise。
// ---------------------------------------------------------------------------
async function buildSecurityAsync() {
  const engine = dbAdapter.getEngine();

  async function rolesOfAsync(baseId, userId) {
    const u = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [userId]);
    const m = baseId ? await dbAdapter.queryOneAsync('SELECT role FROM members WHERE base_id=$1 AND user_id=$2', [baseId, userId]) : null;
    return {
      systemRole: normalizeSystemRole(u && u.system_role, 'none'),
      baseRole: m ? normalizeBaseRole(m.role) : null,
      baseId: baseId || null,
    };
  }

  async function isMemberAsync(baseId, userId) {
    if (!baseId || !userId) return false;
    const roles = await rolesOfAsync(baseId, userId);
    if (roles.systemRole === 'sys_admin') return true;
    return !!roles.baseRole;
  }

  async function getRoleAsync(baseId, userId) {
    const m = await dbAdapter.queryOneAsync('SELECT role FROM members WHERE base_id=$1 AND user_id=$2', [baseId, userId]);
    return m ? m.role : null;
  }

  async function canAsync(baseId, userId, permission) {
    const roles = await rolesOfAsync(baseId, userId);
    return hasPermissionAsync(roles, permission);
  }

  return {
    rolesOf: rolesOfAsync,
    isMember: isMemberAsync,
    getRole: getRoleAsync,
    can: canAsync,
    canManageBase: (b, u) => canAsync(b, u, 'member.role'),
    canManageStructure: (b, u) => canAsync(b, u, 'structure.write'),
    canEditData: (b, u) => canAsync(b, u, 'record.write'),
    canApprove: (b, u) => canAsync(b, u, 'approval.business_lock'),
    canSealRecord: (b, u, nextLocked) => nextLocked ? canAsync(b, u, 'record.seal').then(r => r || canAsync(b, u, 'finance.seal')) : canAsync(b, u, 'record.seal'),
    canRunJobs: (b, u) => canAsync(b, u, 'jobs.run'),
    canManageMatrix: (b, u) => canAsync(b, u, 'matrix.write'),
    canMaintainDb: (b, u) => canAsync(b, u, 'db.maintenance'),
    effectivePermissions: async (baseId, userId) => {
      const roles = await rolesOfAsync(baseId, userId);
      return Array.from(await computeEffectivePermissionsAsync(roles));
    },
  };
}

module.exports = { buildSecurityAsync };
