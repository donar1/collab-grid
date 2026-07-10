// security/matrixStore.js — 权限矩阵的持久化 + 合并逻辑
//
// 数据模型：
//   permission_overrides(scope TEXT, role TEXT, permission TEXT, allow INTEGER, base_id TEXT NULL)
//     scope ∈ ('system','base','external')
//     - scope='system'   base_id 必须为 NULL，role ∈ SYSTEM_ROLES
//     - scope='base'     base_id 必须为非空，role ∈ BASE_ROLES，覆盖此 base
//     - scope='external' base_id 必须为 NULL，role ∈ EXTERNAL_ROLES
//   allow=1 表示授权，allow=0 表示显式拒绝（用于在默认矩阵基础上扣权限）
//
// 合并顺序（hasPermissionAsync）：
//   1. 默认矩阵（DEFAULT_*_MATRIX）
//   2. 系统级覆盖 → 影响所有 base
//   3. 具体 base 的 base 角色覆盖
// allow=0 的显式拒绝优先于 allow=1。

const {
  DEFAULT_BASE_MATRIX,
  DEFAULT_SYSTEM_MATRIX,
  DEFAULT_EXTERNAL_MATRIX,
  PERMISSIONS,
} = require('./permissions');
const { BASE_ROLES, SYSTEM_ROLES, EXTERNAL_ROLES } = require('./roles');

function validateInput(scope, role, baseId, permission) {
  if (!PERMISSIONS.includes(permission)) throw new Error(`unknown permission: ${permission}`);
  if (scope === 'system') {
    if (!SYSTEM_ROLES.includes(role)) throw new Error(`invalid system role: ${role}`);
    if (baseId) throw new Error('system scope must not carry baseId');
  } else if (scope === 'base') {
    if (!BASE_ROLES.includes(role)) throw new Error(`invalid base role: ${role}`);
    if (!baseId) throw new Error('base scope requires baseId');
  } else if (scope === 'external') {
    if (!EXTERNAL_ROLES.includes(role)) throw new Error(`invalid external role: ${role}`);
    if (baseId) throw new Error('external scope must not carry baseId');
  } else {
    throw new Error(`invalid scope: ${scope}`);
  }
}

// ──────────────────────────────────────────────
// 异步版本（PostgreSQL / 通用异步接口）
// ──────────────────────────────────────────────

async function ensureSchemaAsync() {
  const dbAdapter = require('../services/dbAdapter');
  const engine = dbAdapter.getEngine();
  if (engine === 'sqlite') {
    // SQLite 模式下需要同步建表，通过 dbAdapter.db 获取原始连接
    const db = dbAdapter.db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS permission_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        role TEXT NOT NULL,
        base_id TEXT,
        permission TEXT NOT NULL,
        allow INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_perm_override_unique
        ON permission_overrides(scope, role, COALESCE(base_id,''), permission);
    `);
    // 给 users 加系统安全相关列。
    const userCols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
    if (!userCols.includes('system_role')) {
      db.exec(`ALTER TABLE users ADD COLUMN system_role TEXT NOT NULL DEFAULT 'none'`);
    }
    if (!userCols.includes('must_change_password')) {
      db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`);
    }
    if (!userCols.includes('password_changed_at')) {
      db.exec(`ALTER TABLE users ADD COLUMN password_changed_at INTEGER`);
    }
  }
  // PG 模式下 schema 由 pgAdapter.initSchema() 处理，此处为 no-op
}

async function listOverridesAsync({ scope = null, baseId = null } = {}) {
  const dbAdapter = require('../services/dbAdapter');
  const where = [];
  const params = [];
  if (scope) { where.push('scope=$1'); params.push(scope); }
  if (baseId !== null && baseId !== undefined) {
    if (baseId === '') { where.push("(base_id IS NULL OR base_id='')"); }
    else { where.push('base_id=$' + (params.length + 1)); params.push(baseId); }
  }
  const sql = `SELECT scope, role, base_id, permission, allow FROM permission_overrides ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  return dbAdapter.queryAsync(sql, params);
}

async function setOverrideAsync({ scope, role, baseId = null, permission, allow, userId = null }) {
  validateInput(scope, role, baseId, permission);
  const dbAdapter = require('../services/dbAdapter');
  const ts = Date.now();
  await dbAdapter.writeQueryAsync(
    `INSERT INTO permission_overrides (scope, role, base_id, permission, allow, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(scope, role, COALESCE(base_id,''), permission)
     DO UPDATE SET allow=excluded.allow, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
    [scope, role, baseId || null, permission, allow ? 1 : 0, ts, userId]
  );
}

async function clearOverrideAsync({ scope, role, baseId = null, permission }) {
  validateInput(scope, role, baseId, permission);
  const dbAdapter = require('../services/dbAdapter');
  await dbAdapter.writeQueryAsync(
    `DELETE FROM permission_overrides
     WHERE scope=$1 AND role=$2 AND COALESCE(base_id,'')=COALESCE($3, '') AND permission=$4`,
    [scope, role, baseId || null, permission]
  );
}

async function computeEffectivePermissionsAsync({ systemRole, baseRole, baseId, externalRole = null }) {
  const dbAdapter = require('../services/dbAdapter');
  const grant = new Set();
  const deny = new Set();

  // 1-3) 默认矩阵（纯内存计算，与 db 无关）
  if (systemRole && DEFAULT_SYSTEM_MATRIX[systemRole]) {
    for (const p of DEFAULT_SYSTEM_MATRIX[systemRole]) grant.add(p);
  }
  if (externalRole && DEFAULT_EXTERNAL_MATRIX[externalRole]) {
    for (const p of DEFAULT_EXTERNAL_MATRIX[externalRole]) grant.add(p);
  }
  if (baseRole && DEFAULT_BASE_MATRIX[baseRole]) {
    for (const p of DEFAULT_BASE_MATRIX[baseRole]) grant.add(p);
  }

  // 4) 系统级覆盖
  if (systemRole && systemRole !== 'none') {
    const rows = await dbAdapter.queryAsync(
      "SELECT permission, allow FROM permission_overrides WHERE scope='system' AND role=$1", [systemRole]
    );
    for (const r of rows) {
      if (r.allow) grant.add(r.permission); else deny.add(r.permission);
    }
  }
  // 5) 外部覆盖
  if (externalRole) {
    const rows = await dbAdapter.queryAsync(
      "SELECT permission, allow FROM permission_overrides WHERE scope='external' AND role=$1", [externalRole]
    );
    for (const r of rows) {
      if (r.allow) grant.add(r.permission); else deny.add(r.permission);
    }
  }
  // 6) base 级覆盖
  if (baseId && baseRole) {
    const rows = await dbAdapter.queryAsync(
      "SELECT permission, allow FROM permission_overrides WHERE scope='base' AND role=$1 AND base_id=$2", [baseRole, baseId]
    );
    for (const r of rows) {
      if (r.allow) grant.add(r.permission); else deny.add(r.permission);
    }
  }

  for (const p of deny) grant.delete(p);
  return grant;
}

async function hasPermissionAsync(ctxRoles, permission) {
  const set = await computeEffectivePermissionsAsync(ctxRoles);
  return set.has(permission);
}

module.exports = {
  validateInput,
  ensureSchemaAsync,
  listOverridesAsync,
  setOverrideAsync,
  clearOverrideAsync,
  computeEffectivePermissionsAsync,
  hasPermissionAsync,
};
