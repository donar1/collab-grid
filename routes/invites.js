// routes/invites.js — 邀请和成员管理路由
const express = require('express');
const { asyncHandler } = require('./utils');
const { validate } = require('../app/validate');
const { createInviteSchema, updateRoleSchema } = require('../app/validators');

module.exports = function registerInviteRoutes({
  authRequired,
  createInviteAsync,
  updateMemberRoleAsync,
  acceptInviteAsync,
  getAuditLogAsync,
  ctx,
}) {
  const router = express.Router();

  // 创建邀请
  router.post('/bases/:baseId/invites', authRequired, validate(createInviteSchema), asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    const role = req.body?.role;
    const result = await createInviteAsync({ baseId, userId: req.user.id, role });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  }));

  // 更新成员角色
  router.patch('/bases/:baseId/members/:userId', authRequired, validate(updateRoleSchema), asyncHandler(async (req, res) => {
    const { baseId, userId } = req.params;
    const result = await updateMemberRoleAsync({ baseId, userId, targetUserId: userId, newRole: req.body?.role, actorUserId: req.user.id });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  }));

  // 接受邀请
  router.post('/invites/:token/accept', authRequired, asyncHandler(async (req, res) => {
    const result = await acceptInviteAsync({ token: req.params.token, userId: req.user.id });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  }));

  // 审计日志
  router.get('/bases/:baseId/audit', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await ctx.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const { recordId, fieldId, limit = '100' } = req.query;
    const logs = await getAuditLogAsync({ baseId, recordId, fieldId, limit });
    res.json({ logs });
  }));

  return router;
};
