// routes/security/matrix.js — 权限矩阵的查看 / 修改 API（纯异步版本）
const express = require('express');
const { asyncHandler } = require('../utils');
const dbAdapter = require('../../services/dbAdapter');
const {
  listOverridesAsync,
  setOverrideAsync,
  clearOverrideAsync,
} = require('../../security/matrixStore');
const {
  PERMISSIONS,
  PERMISSION_LABELS,
  DEFAULT_BASE_MATRIX,
  DEFAULT_SYSTEM_MATRIX,
  DEFAULT_EXTERNAL_MATRIX,
  listPermissions,
} = require('../../security/permissions');
const {
  BASE_ROLES,
  SYSTEM_ROLES,
  EXTERNAL_ROLES,
  ROLE_LABELS,
  normalizeBaseRole,
  normalizeSystemRole,
} = require('../../security/roles');

function asMap(matrix) {
  const out = {};
  for (const [role, perms] of Object.entries(matrix)) {
    const m = {};
    for (const p of PERMISSIONS) m[p] = perms.includes(p);
    out[role] = m;
  }
  return out;
}

async function snapshotMatrixAsync(baseId = null) {
  const defaults = {
    system: asMap(DEFAULT_SYSTEM_MATRIX),
    external: asMap(DEFAULT_EXTERNAL_MATRIX),
    base: asMap(DEFAULT_BASE_MATRIX),
  };
  const effective = JSON.parse(JSON.stringify(defaults));
  const overrides = await listOverridesAsync();
  for (const o of overrides) {
    if (o.scope === 'system' && effective.system[o.role]) {
      effective.system[o.role][o.permission] = !!o.allow;
    } else if (o.scope === 'external' && effective.external[o.role]) {
      effective.external[o.role][o.permission] = !!o.allow;
    } else if (o.scope === 'base' && effective.base[o.role]) {
      if (!baseId || o.base_id === baseId) {
        if (baseId) effective.base[o.role][o.permission] = !!o.allow;
      }
    }
  }
  return { defaults, effective, overrides };
}

module.exports = function registerSecurityMatrixRoutes(ctx) {
  const { authRequired, security, audit, isMember, canManageStructure } = ctx;
  const router = express.Router();

  // 用户列表（仅 sys_admin / manager / data_clerk / data_engineer 可访问）
  router.get('/api/users', authRequired, asyncHandler(async (req, res) => {
    const u = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [req.user.id]);
    const role = u ? u.system_role : 'none';
    const allowed = ['sys_admin', 'manager', 'data_clerk', 'data_engineer'];
    if (!allowed.includes(role)) return res.status(403).json({ error: 'forbidden' });
    const rows = await dbAdapter.queryAsync(
      'SELECT id, email, display_name, system_role, must_change_password, created_at FROM users ORDER BY created_at ASC'
    );
    res.json({ users: rows });
  }));

  // 公共：列出权限码 + 角色字典
  router.get('/api/security/permissions', authRequired, asyncHandler(async (req, res) => {
    res.json({
      permissions: listPermissions(),
      systemRoles: SYSTEM_ROLES.map(r => ({ value: r, label: ROLE_LABELS[r] })),
      baseRoles: BASE_ROLES.map(r => ({ value: r, label: ROLE_LABELS[r] })),
      externalRoles: EXTERNAL_ROLES.map(r => ({ value: r, label: ROLE_LABELS[r] })),
    });
  }));

  // 当前用户的有效权限（含所有 base）
  router.get('/api/security/me', authRequired, asyncHandler(async (req, res) => {
    const u = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [req.user.id]);
    const systemRole = normalizeSystemRole(u && u.system_role, 'none');
    const memberships = await Promise.all((await dbAdapter.queryAsync(
      `SELECT m.base_id, m.role, b.name
       FROM members m JOIN bases b ON b.id=m.base_id
       WHERE m.user_id=$1`, [req.user.id]
    )).map(async m => ({
      baseId: m.base_id,
      baseName: m.name,
      role: m.role,
      permissions: await security.effectivePermissions(m.base_id, req.user.id),
    })));
    res.json({ userId: req.user.id, systemRole, memberships });
  }));

  // 系统级 + 外部 + 默认矩阵
  router.get('/api/security/matrix', authRequired, asyncHandler(async (req, res) => {
    if (!security.canManageMatrix(null, req.user.id) && !security.can(null, req.user.id, 'matrix.read')) {
      const u = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [req.user.id]);
      if (!u || (u.system_role !== 'sys_admin' && u.system_role !== 'data_engineer')) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }
    res.json(await snapshotMatrixAsync());
  }));

  // 单 base 矩阵 + 我自己的有效权限
  router.get('/api/bases/:baseId/security/matrix', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await security.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const snapshot = await snapshotMatrixAsync(baseId);
    res.json({
      ...snapshot,
      mine: {
        role: await security.getRole(baseId, req.user.id),
        permissions: security.effectivePermissions(baseId, req.user.id),
      },
    });
  }));

  // 通用 setter
  async function applyBatchAsync(req, res, { allowedScopes, baseIdFilter = null }) {
    const items = Array.isArray(req.body?.changes) ? req.body.changes : null;
    if (!items || items.length === 0) return res.status(400).json({ error: 'changes required' });
    const errors = [];
    const applied = [];
    await dbAdapter.transactionAsync(async () => {
      for (const item of items) {
        try {
          const scope = String(item.scope || '').trim();
          if (!allowedScopes.includes(scope)) throw new Error(`scope not allowed: ${scope}`);
          if (scope === 'base' && baseIdFilter && item.baseId !== baseIdFilter) {
            throw new Error(`base override out of current base scope`);
          }
          if (item.allow === null || item.allow === undefined) {
            await clearOverrideAsync({ scope, role: item.role, baseId: item.baseId || null, permission: item.permission });
          } else {
            await setOverrideAsync({
              scope,
              role: item.role,
              baseId: item.baseId || null,
              permission: item.permission,
              allow: !!item.allow,
              userId: req.user.id,
            });
          }
          applied.push(item);
        } catch (e) {
          errors.push({ item, error: e.message });
        }
      }
      if (errors.length) throw new Error('matrix update failed: ' + errors.map(e => e.error).join('; '));
    });
    await audit(baseIdFilter || 'system', req.user.id, 'security.matrix.update', { applied });
    res.json({ ok: true, applied: applied.length });
  }

  // 仅 sys_admin 可改系统/外部/全局 base 矩阵
  router.put('/api/security/matrix', authRequired, asyncHandler(async (req, res) => {
    const u = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [req.user.id]);
    if (!u || u.system_role !== 'sys_admin') return res.status(403).json({ error: 'only sys_admin can change global matrix' });
    return applyBatchAsync(req, res, { allowedScopes: ['system', 'external', 'base'] });
  }));

  // base 级矩阵
  router.put('/api/bases/:baseId/security/matrix', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await security.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const u = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [req.user.id]);
    const isSysAdmin = u && u.system_role === 'sys_admin';
    if (!isSysAdmin && !security.canManageMatrix(baseId, req.user.id)) {
      return res.status(403).json({ error: 'only sys_admin or matrix-capable manager can change base matrix' });
    }
    return applyBatchAsync(req, res, { allowedScopes: ['base'], baseIdFilter: baseId });
  }));

  // 系统角色修改（sys_admin / manager / data_clerk / data_engineer 可操作）
  router.patch('/api/security/users/:userId/system-role', authRequired, asyncHandler(async (req, res) => {
    const operator = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [req.user.id]);
    const opRole = operator ? operator.system_role : 'none';
    if (opRole !== 'sys_admin') return res.status(403).json({ error: 'forbidden: only sys_admin can change system roles' });

    const next = normalizeSystemRole(req.body?.systemRole, '');
    if (!next) return res.status(400).json({ error: 'invalid systemRole' });
    const target = await dbAdapter.queryOneAsync('SELECT id, system_role FROM users WHERE id=$1', [req.params.userId]);
    if (!target) return res.status(404).json({ error: 'user not found' });

    // 不能修改自己的角色
    if (req.user.id === req.params.userId) return res.status(403).json({ error: 'cannot change own system role' });

    // 非 sys_admin 不能修改 sys_admin
    if (target.system_role === 'sys_admin' && opRole !== 'sys_admin') {
      return res.status(403).json({ error: 'only sys_admin can modify sys_admin role' });
    }

    // manager 不可被降为普通用户（none），但可改为其他管理角色
    if (target.system_role === 'manager' && next === 'none') {
      return res.status(403).json({ error: 'manager role cannot be downgraded to none' });
    }

    // 最后一个 sys_admin 保护
    if (target.system_role === 'sys_admin' && next !== 'sys_admin') {
      const adminCount = (await dbAdapter.queryOneAsync("SELECT COUNT(*) AS c FROM users WHERE system_role='sys_admin'")).c;
      if (adminCount <= 1) {
        return res.status(403).json({ error: 'cannot downgrade the last sys_admin' });
      }
    }

    // 最后一个 manager 保护
    if (target.system_role === 'manager' && next !== 'manager') {
      const mgrCount = (await dbAdapter.queryOneAsync("SELECT COUNT(*) AS c FROM users WHERE system_role='manager'")).c;
      if (mgrCount <= 1) {
        return res.status(403).json({ error: 'cannot downgrade the last manager' });
      }
    }

    await dbAdapter.writeQueryAsync('UPDATE users SET system_role=$1 WHERE id=$2', [next, req.params.userId]);
    await audit('system', req.user.id, 'security.system_role.update', { userId: req.params.userId, from: target.system_role, to: next });
    res.json({ ok: true, userId: req.params.userId, systemRole: next });
  }));

  // 表级权限查看
  router.get('/api/bases/:baseId/tables/permissions', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const tables = await dbAdapter.queryAsync('SELECT id FROM tables WHERE base_id=$1 ORDER BY position', [baseId]);
    const perms = await dbAdapter.queryAsync('SELECT table_id, role, can_view, can_edit FROM table_permissions WHERE base_id=$1', [baseId]);
    const permMap = {};
    for (const p of perms) {
      if (!permMap[p.table_id]) permMap[p.table_id] = {};
      permMap[p.table_id][p.role] = { canView: !!p.can_view, canEdit: !!p.can_edit };
    }
    res.json({
      tables: tables.map(t => ({
        tableId: t.id,
        permissions: permMap[t.id] || {},
      })),
    });
  }));

  // 表级权限更新
  router.put('/api/bases/:baseId/tables/:tableId/permissions', authRequired, asyncHandler(async (req, res) => {
    const { baseId, tableId } = req.params;
    if (!(await isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    if (!(await canManageStructure(baseId, req.user.id))) {
      return res.status(403).json({ error: 'only owner/admin can update table permissions' });
    }
    // 验证 table 存在且属于此 base
    const tbl = await dbAdapter.queryOneAsync('SELECT id FROM tables WHERE id=$1 AND base_id=$2', [tableId, baseId]);
    if (!tbl) return res.status(404).json({ error: 'table not found' });

    const { permissions } = req.body || {};
    // permissions 格式: { role: { canView: bool, canEdit: bool } }
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'permissions object required' });
    }

    const ts = Date.now();
    await dbAdapter.transactionAsync(async () => {
      for (const [role, perms] of Object.entries(permissions)) {
        if (typeof perms.canView !== 'boolean' || typeof perms.canEdit !== 'boolean') continue;
        await dbAdapter.writeQueryAsync(
          `INSERT INTO table_permissions (base_id, table_id, role, can_view, can_edit, updated_at, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (base_id, table_id, role) DO UPDATE SET can_view=$4, can_edit=$5, updated_at=$6, updated_by=$7`,
          [baseId, tableId, role, perms.canView ? 1 : 0, perms.canEdit ? 1 : 0, ts, req.user.id]
        );
      }
    });
    await audit(baseId, req.user.id, 'table.permissions.update', { tableId, permissions });
    res.json({ ok: true, tableId, permissions });
  }));

  return router;
};
