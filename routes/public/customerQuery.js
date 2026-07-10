// routes/public/customerQuery.js — 外部库客户查询入口（纯异步版本）
//
// 与内部 API 严格隔离：
//   - 不使用 authRequired（内部 JWT），改用 X-Customer-Token 头
//   - 不读 internal db，只查 publicDb
//   - 所有响应都过 logAccess，便于审计
//
// 同时给 base manager / sys_admin 提供 token 颁发 / 撤销入口（写在内部 API 命名空间下）。

const express = require('express');
const { asyncHandler } = require('../utils');
const dbAdapter = require('../../services/dbAdapter');

module.exports = function registerCustomerQueryRoutes(ctx) {
  const { authRequired, security, audit, publicStore } = ctx;
  const router = express.Router();

  // ---------- 内部入口：颁发 / 撤销 / 列举 客户查询 token ----------
  router.post('/api/bases/:baseId/public/clients', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await security.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    if (!security.canManageMatrix(baseId, req.user.id) && !security.can(baseId, req.user.id, 'member.invite')) {
      return res.status(403).json({ error: 'only manager/sys_admin can issue customer tokens' });
    }
    const customerKey = String(req.body?.customerKey || '').trim();
    if (!customerKey) return res.status(400).json({ error: 'customerKey required' });
    const displayName = req.body?.displayName ? String(req.body.displayName).slice(0, 80) : null;
    const ttlDays = Number.parseInt(req.body?.ttlDays || 30, 10);
    const ttlMs = (Number.isFinite(ttlDays) && ttlDays > 0) ? ttlDays * 24 * 3600 * 1000 : 0;
    const result = publicStore.issueClient({ baseId, customerKey, displayName, ttlMs, createdBy: req.user.id });
    await audit(baseId, req.user.id, 'public.client.issue', { customerKey, displayName, ttlDays, token: result.token });
    res.json(result);
  }));

  router.get('/api/bases/:baseId/public/clients', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await security.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    res.json({ clients: publicStore.listClientsForBase(baseId) });
  }));

  router.delete('/api/bases/:baseId/public/clients/:token', authRequired, asyncHandler(async (req, res) => {
    const { baseId, token } = req.params;
    if (!(await security.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    if (!security.canManageMatrix(baseId, req.user.id) && !security.can(baseId, req.user.id, 'member.invite')) {
      return res.status(403).json({ error: 'only manager/sys_admin can revoke customer tokens' });
    }
    publicStore.revokeClient(token);
    await audit(baseId, req.user.id, 'public.client.revoke', { token });
    res.json({ ok: true });
  }));

  // ---------- 外部入口：客户查询（无登录态，使用 X-Customer-Token） ----------
  function customerAuth(req, res, next) {
    const token = req.headers['x-customer-token'] || req.query.token;
    const client = publicStore.verifyClient(token);
    if (!client) {
      publicStore.logAccess({ token, path: req.path, status: 401, ip: req.ip });
      return res.status(401).json({ error: 'invalid customer token' });
    }
    req.customer = client;
    next();
  }

  router.get('/api/public/me', customerAuth, asyncHandler(async (req, res) => {
    publicStore.logAccess({
      token: req.customer.token, baseId: req.customer.base_id,
      customerKey: req.customer.customer_key, path: req.path, status: 200, ip: req.ip,
    });
    res.json({
      baseId: req.customer.base_id,
      customerKey: req.customer.customer_key,
      displayName: req.customer.display_name,
      role: req.customer.role,
      expiresAt: req.customer.expires_at,
    });
  }));

  // 外部查询限流：每客户每分钟 60 次
  const customerRateLimits = new Map();
  function checkCustomerRateLimit(customerKey) {
    const now = Date.now();
    const windowMs = 60000;
    const max = 60;
    const bucket = customerRateLimits.get(customerKey) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count++;
    customerRateLimits.set(customerKey, bucket);
    if (bucket.count > max) return false;
    return true;
  }

  router.get('/api/public/snapshots', customerAuth, asyncHandler(async (req, res) => {
    // 限流检查
    if (!checkCustomerRateLimit(req.customer.customer_key)) {
      publicStore.logAccess({
        token: req.customer.token, baseId: req.customer.base_id,
        customerKey: req.customer.customer_key, path: req.path, status: 429, ip: req.ip,
      });
      return res.status(429).json({ error: 'rate limit exceeded, max 60 requests per minute' });
    }

    const category = req.query.category ? String(req.query.category).slice(0, 32) : null;
    const limit = Number.parseInt(req.query.limit || '50', 10) || 50;
    const offset = Number.parseInt(req.query.offset || '0', 10) || 0;
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const status = req.query.status || null;
    const minAmount = req.query.minAmount != null ? Number(req.query.minAmount) : null;
    const maxAmount = req.query.maxAmount != null ? Number(req.query.maxAmount) : null;
    const keyword = req.query.keyword ? String(req.query.keyword).slice(0, 100) : null;

    const result = publicStore.querySnapshotsCached({
      baseId: req.customer.base_id,
      customerKey: req.customer.customer_key,
      category,
      limit,
      offset,
      dateFrom,
      dateTo,
      status,
      minAmount,
      maxAmount,
      keyword,
    });

    publicStore.logAccess({
      token: req.customer.token, baseId: req.customer.base_id,
      customerKey: req.customer.customer_key, path: req.path, status: 200, ip: req.ip,
    });

    res.json({
      customerKey: req.customer.customer_key,
      displayName: req.customer.display_name,
      category,
      total: result.total,
      offset: result.offset,
      limit: result.limit,
      cached: result.cached,
      snapshots: result.results,
    });
  }));

  // ---------- 对账系统 API ----------
  router.get('/api/public/reconciliation', customerAuth, asyncHandler(async (req, res) => {
    if (!checkCustomerRateLimit(req.customer.customer_key)) {
      publicStore.logAccess({
        token: req.customer.token, baseId: req.customer.base_id,
        customerKey: req.customer.customer_key, path: req.path, status: 429, ip: req.ip,
      });
      return res.status(429).json({ error: 'rate limit exceeded' });
    }

    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const category = req.query.category || null;
    const status = req.query.status || null;
    const limit = Number.parseInt(req.query.limit || '200', 10) || 200;
    const offset = Number.parseInt(req.query.offset || '0', 10) || 0;

    const result = publicStore.queryReconciliation({
      baseId: req.customer.base_id,
      customerKey: req.customer.customer_key,
      dateFrom, dateTo, category, status, limit, offset,
    });

    publicStore.logAccess({
      token: req.customer.token, baseId: req.customer.base_id,
      customerKey: req.customer.customer_key, path: req.path, status: 200, ip: req.ip,
    });

    res.json({
      customerKey: req.customer.customer_key,
      displayName: req.customer.display_name,
      ...result,
    });
  }));

  // ---------- 数据大屏 API ----------
  router.get('/api/public/dashboard', customerAuth, asyncHandler(async (req, res) => {
    if (!checkCustomerRateLimit(req.customer.customer_key)) {
      publicStore.logAccess({
        token: req.customer.token, baseId: req.customer.base_id,
        customerKey: req.customer.customer_key, path: req.path, status: 429, ip: req.ip,
      });
      return res.status(429).json({ error: 'rate limit exceeded' });
    }

    const baseId = req.customer.base_id;
    const customerKey = req.customer.customer_key;

    // 订单统计
    const orderStats = await dbAdapter.queryOneAsync(`
      SELECT COUNT(*) as count, SUM(COALESCE(json_extract(data_json, '$.receivable'), 0)) as receivable,
             SUM(COALESCE(json_extract(data_json, '$.payable'), 0)) as payable,
             SUM(COALESCE(json_extract(data_json, '$.snapshotProfit'), 0)) as profit
      FROM public_customer_snapshot
      WHERE base_id=$1 AND customer_key=$2 AND category='order'
    `, [baseId, customerKey]);

    // 产品统计
    const productStats = await dbAdapter.queryOneAsync(`
      SELECT COUNT(*) as count,
             SUM(CASE WHEN COALESCE(json_extract(data_json, '$.isSpecialOffer'), 'false') = 'true' THEN 1 ELSE 0 END) as specialCount,
             SUM(CASE WHEN COALESCE(json_extract(data_json, '$.availableQty'), 0) <= 0 THEN 1 ELSE 0 END) as outOfStock
      FROM public_customer_snapshot
      WHERE base_id=$1 AND customer_key=$2 AND category='product'
    `, [baseId, customerKey]);

    // 最近 30 天订单趋势
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const trend = await dbAdapter.queryAsync(`
      SELECT date(datetime(updated_at/1000, 'unixepoch')) as date, COUNT(*) as count,
             SUM(COALESCE(json_extract(data_json, '$.receivable'), 0)) as amount
      FROM public_customer_snapshot
      WHERE base_id=$1 AND customer_key=$2 AND category='order' AND updated_at>=$3
      GROUP BY date
      ORDER BY date
    `, [baseId, customerKey, thirtyDaysAgo.getTime()]);

    publicStore.logAccess({
      token: req.customer.token, baseId, customerKey, path: req.path, status: 200, ip: req.ip,
    });

    res.json({
      customerKey,
      displayName: req.customer.display_name,
      orders: {
        count: orderStats?.count || 0,
        receivable: Math.round((orderStats?.receivable || 0) * 100) / 100,
        payable: Math.round((orderStats?.payable || 0) * 100) / 100,
        profit: Math.round((orderStats?.profit || 0) * 100) / 100,
      },
      products: {
        count: productStats?.count || 0,
        specialCount: productStats?.specialCount || 0,
        outOfStock: productStats?.outOfStock || 0,
      },
      trend: trend.map(t => ({ date: t.date, count: t.count, amount: Math.round(t.amount * 100) / 100 })),
    });
  }));

  // ---------- 内部入口：手动同步快照到外部库（测试 / 数据修复用） ----------
  router.post('/api/bases/:baseId/public/snapshots/sync', authRequired, asyncHandler(async (req, res) => {
    const { baseId } = req.params;
    if (!(await security.isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
    if (!security.canMaintainDb(baseId, req.user.id) && !security.canManageBase(baseId, req.user.id)) {
      return res.status(403).json({ error: 'only data_engineer/sys_admin/manager can sync snapshots' });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) return res.status(400).json({ error: 'items required' });
    let written = 0;
    for (const it of items) {
      if (!it.customerKey || !it.category || !it.refId) continue;
      publicStore.upsertSnapshot({
        baseId, customerKey: it.customerKey, category: it.category, refId: it.refId, data: it.data || {},
      });
      written++;
    }
    await audit(baseId, req.user.id, 'public.snapshot.sync', { count: written });
    res.json({ ok: true, written });
  }));

  return router;
};
