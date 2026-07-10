// routes/dashboard.js — 仪表盘、任务、诊断路由
const express = require('express');
const { asyncHandler } = require('./utils');
const { validate } = require('../app/validate');
const { updateJobConfigSchema } = require('../app/validators');

module.exports = function registerDashboardRoutes({
  authRequired,
  ctx,
  jobs,
  diagnostics,
  dashboardSummary,
}) {
  const router = express.Router();

  // 仪表盘摘要
  router.get('/bases/:baseId/dashboard/summary', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await ctx.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    try { res.json(await dashboardSummary(baseId)); } catch (e) { res.status(400).json({ error: e.message }); }
  }));

  // 任务配置列表
  router.get('/bases/:baseId/jobs/configs', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await ctx.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    res.json({ configs: await jobs.listJobConfigs(baseId) });
  }));

  // 更新任务配置
  router.patch('/bases/:baseId/jobs/configs/:jobKey', authRequired, validate(updateJobConfigSchema), asyncHandler(async (req, res) => {
    const { baseId, jobKey } = req.params;
    if (!(await ctx.canRunJobs(baseId, req.user.id))) return res.status(403).json({ error: 'only owner/admin/finance can manage jobs' });
    const row = await jobs.updateJobConfig(baseId, jobKey, req.body || {});
    await ctx.audit(baseId, req.user.id, 'job.config.update', { jobKey, patch: req.body || {} });
    res.json({ ok: true, config: row });
  }));

  // 运行任务
  router.post('/bases/:baseId/jobs/:jobKey/run', authRequired, asyncHandler(async (req, res) => {
    const { baseId, jobKey } = req.params;
    if (!(await ctx.canRunJobs(baseId, req.user.id))) return res.status(403).json({ error: 'only owner/admin/finance can run jobs' });
    const businessDate = String(req.body?.businessDate || '').trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return res.status(400).json({ error: 'businessDate must be YYYY-MM-DD' });
    const dryRun = req.body?.dryRun !== undefined ? !!req.body.dryRun : undefined;
    try {
      const result = await jobs.runJob({ baseId, jobKey, businessDate, dryRun, userId: req.user.id, mode: 'manual' });
      await ctx.audit(baseId, req.user.id, 'job.run', { jobKey, businessDate, dryRun: result.summary?.dryRun, runId: result.runId });
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  // 任务运行历史
  router.get('/bases/:baseId/jobs/runs', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await ctx.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    res.json({ runs: await jobs.listRuns(baseId, Number.parseInt(req.query.limit || '30', 10) || 30) });
  }));

  // 任务运行详情
  router.get('/bases/:baseId/jobs/runs/:runId', authRequired, asyncHandler(async (req, res) => {
    const { baseId, runId } = req.params;
    if (!(await ctx.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const run = await jobs.getRun(baseId, runId);
    if (!run) return res.status(404).json({ error: 'run not found' });
    res.json({ run });
  }));

  // 诊断
  router.get('/bases/:baseId/diagnostics', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await ctx.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    const businessDate = String(req.query.businessDate || '').trim();
    if (businessDate && !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return res.status(400).json({ error: 'businessDate must be YYYY-MM-DD' });
    try { res.json(await diagnostics.runDiagnostics({ baseId, businessDate })); } catch (e) { res.status(400).json({ error: e.message }); }
  }));

  return router;
};
