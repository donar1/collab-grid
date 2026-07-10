// routes/bases.js — Base 管理路由
const express = require('express');
const { asyncHandler } = require('./utils');
const { validate } = require('../app/validate');
const { createBaseSchema, renameBaseSchema } = require('../app/validators');

module.exports = function registerBaseRoutes({
  authRequired,
  listBasesAsync,
  createBaseAsync,
  renameBaseAsync,
  deleteBaseAsync,
  getBaseDetailAsync,
  ctx,
}) {
  const router = express.Router();

  // 获取用户 base 列表
  router.get('/bases', authRequired, asyncHandler(async (req, res) => {
    const rows = await listBasesAsync(req.user.id);
    res.json({ bases: rows });
  }));

  // 创建 base
  router.post('/bases', authRequired, validate(createBaseSchema), asyncHandler(async (req, res) => {
    const { name } = req.body || {};
    const result = await createBaseAsync({ name, ownerId: req.user.id });
    if (result.error) return res.status(result.status).json({ error: result.error });
    await ctx.audit(result.id, req.user.id, 'base.create', { name });
    res.json(result);
  }));

  // 重命名 base
  router.patch('/bases/:id', authRequired, validate(renameBaseSchema), asyncHandler(async (req, res) => {
    const baseId = req.params.id;
    const { name } = req.body || {};
    const result = await renameBaseAsync({ baseId, userId: req.user.id, newName: name });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  }));

  // 删除 base
  router.delete('/bases/:id', authRequired, asyncHandler(async (req, res) => {
    const baseId = req.params.id;
    const result = await deleteBaseAsync({ baseId, userId: req.user.id });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  }));

  // 获取 base 详情
  router.get('/bases/:id', authRequired, asyncHandler(async (req, res) => {
    const baseId = req.params.id;
    const result = await getBaseDetailAsync({ baseId, userId: req.user.id, pageLimit: req.query.limit });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  }));

  return router;
};
