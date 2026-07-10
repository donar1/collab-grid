// server.js — Express + Socket.IO 入口（Phase 1 简洁版）
const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const { Server } = require('socket.io');

const config = require('./config');
const logger = require('./logger');

// P2-3: 全局异常兜底，防止未捕获异常导致进程静默退出
process.on('uncaughtException', (e) => { logger.error('[FATAL] uncaughtException', { error: e.message, stack: e.stack }); });
process.on('unhandledRejection', (r) => { logger.error('[FATAL] unhandledRejection', { reason: r?.message || r }); });
const db = require('./db');
const dbAdapter = require('./services/dbAdapter');
const { sign, verify, authRequired, setTokenCookie, clearTokenCookie } = require('./auth');
const jobs = require('./jobs');
const { makeGrid } = require('./jobs/grid');
const diagnostics = require('./jobs/diagnostics');
const { FIELD_TYPES, READONLY_FIELD_TYPES } = require('./layers/tableLayer');
const { CORE_BUSINESS_OBJECTS, BUSINESS_CALL_CHAIN } = require('./layers/businessRelations');
const syncService = require('./services/syncService');
const helpers = require('./services/helpers');
const { setBroadcast, parseOptions } = helpers;
const inventoryService = require('./services/inventoryService');
const financeService = require('./services/financeService');
const orderService = require('./services/orderService');
const dashboardService = require('./services/dashboardService');
const { dashboardSummary } = dashboardService;
const { applyOrderManagementLayout } = orderService;
const { generateFinanceDetails } = financeService;

const registerGridTableRoutes = require('./routes/grid/tables');
const registerGridRecordRoutes = require('./routes/grid/records');
const registerGridCellRoutes = require('./routes/grid/cells');
const registerGridLinkRoutes = require('./routes/grid/links');
const registerGridButtonRoutes = require('./routes/grid/buttons');
const registerAttachmentRoutes = require('./routes/grid/attachments');
const registerGridBatchRoutes = require('./routes/grid/batch');
const registerCoreCustomerRoutes = require('./routes/core/customers');
const registerCoreProductRoutes = require('./routes/core/products');
const registerCoreOrderRoutes = require('./routes/core/orders');
const registerCoreInventoryRoutes = require('./routes/core/inventory');
const registerCoreBillRoutes = require('./routes/core/bills');
const registerSecurityMatrixRoutes = require('./routes/security/matrix');
const registerCustomerQueryRoutes = require('./routes/public/customerQuery');
const registerAuthRoutes = require('./routes/auth');
const registerBaseRoutes = require('./routes/bases');
const registerTemplateRoutes = require('./routes/templates');
const registerDashboardRoutes = require('./routes/dashboard');
const registerInviteRoutes = require('./routes/invites');
const registerNotificationRoutes = require('./routes/notifications');
const publicStore = require('./publicDb');
const notificationJob = require('./services/notificationJob');

const { buildMiddleware, createRateLimiter } = require('./app/middleware');
const { buildSocketHandlers, getConnectionStats } = require('./app/socket');
const { pushAlert, getAlerts, getStats: getAlertStats } = require('./app/alerts');
const ctx = require('./app/context');

const { isProduction, allowedOrigins, port: PORT } = config;

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: buildMiddleware({ isProduction, allowedOrigins }).corsOptions });

app.disable('x-powered-by');
app.set('trust proxy', 1);

const middleware = buildMiddleware({ isProduction, allowedOrigins });
app.use(middleware.securityHeaders);
app.use(middleware.cors);
app.use(middleware.csp);
app.use(middleware.json);
app.use('/api/attachments/upload', middleware.skipUploadJson);
app.use(middleware.cookieParser);
app.use(middleware.trace);
app.use(middleware.csrf);
app.use(middleware.static);

const now = ctx.now;

function generateRandomPassword(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  const crypto = require('crypto');
  let pwd = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    pwd += chars[bytes[i] % chars.length];
  }
  return pwd;
}

// ensureDefaultSysAdminAsync is defined below; init dbAdapter, context, and create admin
let _initPromise = (async () => {
  await dbAdapter.init();
  await ctx.ready;  // context.js lazy init: buildSecurity + matrixStore
  await ensureDefaultSysAdminAsync();
})();

const authRateLimit = createRateLimiter({
  windowMs: config.rateLimitWindowMs,
  max: config.authRateLimitMax,
  keyFn: req => `${req.ip}:${String(req.body?.email || '').toLowerCase().slice(0, 120)}`
});

// H-09: broadcast with accumulator — merge rapid broadcasts into single emit (50ms window)
const _broadcastAccum = new Map(); // key -> { timer, events: [{event, payload}] }
function broadcast(baseId, event, payload) {
  syncService.publish(baseId, event, payload);
  const key = 'base:' + baseId;
  if (_broadcastAccum.has(key)) {
    // Accumulate event; timer will emit all at once
    _broadcastAccum.get(key).events.push({ event, payload });
    return;
  }
  // First event: schedule flush after 50ms
  _broadcastAccum.set(key, { events: [{ event, payload }], timer: setTimeout(() => {
    const acc = _broadcastAccum.get(key);
    _broadcastAccum.delete(key);
    if (acc && acc.events.length) {
      // Emit the latest payload for each unique event type
      const latestByEvent = new Map();
      for (const e of acc.events) latestByEvent.set(e.event, e.payload);
      for (const [evt, pld] of latestByEvent) {
        io.to(key).emit(evt, pld);
      }
    }
  }, 50) });
}
setBroadcast(broadcast);

// Health check endpoint
app.get('/health', asyncHandler(async (req, res) => {
  res.json({ status: 'ok' });
}));

// -------- alerts endpoint (authenticated) --------
app.get('/api/alerts', authRequired, (req, res) => {
  const { level, source, since, limit } = req.query;
  res.json({
    alerts: getAlerts({
      level,
      source,
      since,
      limit: limit ? parseInt(limit, 10) : undefined,
    }),
    stats: getAlertStats(),
  });
});

// -------- auth routes --------
app.use('/api', registerAuthRoutes({
  authRateLimit,
  registerUserAsync,
  loginUserAsync,
  refreshUserAsync,
  changePasswordAsync,
  getMeAsync,
  setTokenCookie,
  clearTokenCookie,
  authRequired,
  middleware,
  isProduction,
}));

// -------- base routes --------
app.use('/api', registerBaseRoutes({
  authRequired,
  listBasesAsync,
  createBaseAsync,
  renameBaseAsync,
  deleteBaseAsync,
  getBaseDetailAsync,
  ctx,
}));

app.get('/api/system/business-relations', authRequired, asyncHandler(async (req, res) => {
  res.json({
    layers: {
      table: '第一层：操作界面与通用表格能力，负责字段、记录、关联、查找、筛选和实时同步',
      coreBusiness: '第二层：产品、客户、订单、账单、库存等核心业务对象及其调用链路',
      valueAdded: '第三层：数据大屏与增值计算，可采纳核心结果，后续逐步迭代',
    },
    objects: CORE_BUSINESS_OBJECTS,
    callChain: BUSINESS_CALL_CHAIN,
  });
}));

// -------- route contexts --------
const gridRouteContext = {
  nanoid, now, authRequired,
  injectComputedCells: ctx.injectComputedCells,
  baseOfTable: ctx.baseOfTable,
  baseOfField: ctx.baseOfField,
  baseOfRecord: ctx.baseOfRecord,
  isMember: ctx.isMember,
  getRole: ctx.getRole,
  ROLES: ctx.ROLES,
  publicRoleMeta: ctx.publicRoleMeta,
  canManageStructure: ctx.canManageStructure,
  canEditData: ctx.canEditData,
  canSealRecord: ctx.canSealRecord,
  canApprove: ctx.canApprove,
  canRunJobs: ctx.canRunJobs,
  audit: ctx.audit,
  broadcast,
  FIELD_TYPES,
  READONLY_FIELD_TYPES,
  normalizeFieldOptions: ctx.normalizeFieldOptions,
  fieldWithBase: ctx.fieldWithBase,
  businessLockCoreProtected: ctx.businessLockCoreProtected,
  orderCompletionFieldProtected: orderService.orderCompletionFieldProtected,
  selectLabelsFromOptions: ctx.selectLabelsFromOptions,
  normalizeCellStyle: ctx.normalizeCellStyle,
  linkAllowsMultiple: ctx.linkAllowsMultiple,
  tableNameOfRecord: helpers.tableNameOfRecord,
  cellValueByName: ctx.cellValueByName,
  recomputeLookupSnapshots: ctx.recomputeLookupSnapshots,
  syncOrderProductDefaults: orderService.syncOrderProductDefaults,
  applyOrderDefaults: orderService.applyOrderDefaults,
  approveInventoryOperation: inventoryService.approveInventoryOperation,
  sealFinanceRecord: financeService.sealFinanceRecord,
  approveFinanceReversal: financeService.approveFinanceReversal,
  businessLockHasProduct: ctx.businessLockHasProduct,
  fieldsMap: ctx.fieldsMap,
  firstLinkedRecordId: ctx.firstLinkedRecordId,
  assertRecordWritable: ctx.assertRecordWritable,
  upsertCell: ctx.upsertCell,
  fieldIdByName: ctx.fieldIdByName,
};
app.use(registerGridTableRoutes(gridRouteContext));
app.use(registerGridRecordRoutes(gridRouteContext));
app.use(registerGridCellRoutes(gridRouteContext));
app.use(registerGridLinkRoutes(gridRouteContext));
app.use(registerGridButtonRoutes(gridRouteContext));
app.use(registerAttachmentRoutes(gridRouteContext));
app.use(registerGridBatchRoutes(gridRouteContext));

// -------- template routes --------
app.use('/api', registerTemplateRoutes({
  authRequired,
  ctx,
  dbAdapter,
  orderService,
  inventoryService,
  financeService,
}));

const coreRouteContext = {
  nanoid, now, authRequired,
  getRole: ctx.getRole,
  canManageStructure: ctx.canManageStructure,
  canRunJobs: ctx.canRunJobs,
  audit: ctx.audit,
  createTableWithFields: ctx.createTableWithFields,
  normalizeSelectOptions: ctx.normalizeSelectOptions,
  fieldIdByName: ctx.fieldIdByName,
  applyOrderManagementLayout: orderService.applyOrderManagementLayout,
  makeGrid,
  generateFinanceDetails: financeService.generateFinanceDetails,
  upsertCell: ctx.upsertCell,
  tableByName: ctx.tableByName,
  fieldsMap: ctx.fieldsMap,
  syncOrderProductDefaults: orderService.syncOrderProductDefaults,
  applyOrderDefaults: orderService.applyOrderDefaults,
};
app.use(registerCoreCustomerRoutes(coreRouteContext));
app.use(registerCoreProductRoutes(coreRouteContext));
app.use(registerCoreOrderRoutes(coreRouteContext));
app.use(registerCoreInventoryRoutes(coreRouteContext));
app.use(registerCoreBillRoutes(coreRouteContext));

const securityRouteContext = { authRequired, get security() { return ctx.security; }, audit: ctx.audit, isMember: ctx.isMember, canManageStructure: ctx.canManageStructure };

// -------- dashboard / jobs / diagnostics routes --------
app.use('/api', registerDashboardRoutes({
  authRequired,
  ctx,
  jobs,
  diagnostics,
  dashboardSummary,
}));

// -------- invite / member / audit routes --------
app.use('/api', registerInviteRoutes({
  authRequired,
  createInviteAsync,
  updateMemberRoleAsync,
  acceptInviteAsync,
  getAuditLogAsync,
  ctx,
}));

// -------- notification routes --------
app.use(registerNotificationRoutes({ authRequired }));

// -------- error handling --------
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    traceId: req.traceId,
    path: req.path,
    method: req.method,
    error: err.message,
    stack: config.isProduction ? undefined : err.stack,
  });
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    error: config.isProduction ? 'Internal server error' : err.message,
    ...(config.isProduction ? {} : { traceId: req.traceId }),
  });
});

// -------- Socket.IO --------
buildSocketHandlers({ io, isMember: ctx.isMember, syncService, getUserById: async (id) => dbAdapter.queryOneAsync('SELECT id, email FROM users WHERE id=$1', [id]) });

// -------- DB health check timer (every 60s) --------
setInterval(async () => {
  try {
    const health = await dbAdapter.healthCheck();
    if (health.status !== 'healthy') {
      pushAlert('error', 'db', `Database health check failed: ${JSON.stringify(health)}`);
      logger.error('Database health check unhealthy', health);
    }
  } catch (e) {
    pushAlert('error', 'db', `Database health check error: ${e.message}`);
    logger.error('Database health check error', { error: e.message });
  }
}, 60000);

// SPA fallback
app.get(/^\/(invite|app)(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let stopScheduler = null;

async function gracefulShutdown(signal) {
  logger.info('Graceful shutdown started', { signal });
  if (stopScheduler) { stopScheduler(); stopScheduler = null; }
  server.close(async () => {
    try { await dbAdapter.close(); } catch (_) {}
    try { publicStore.publicDb.close(); } catch (_) {}
    logger.info('Graceful shutdown complete');
    process.exit(0);
  });
  setTimeout(() => { logger.error('Forced exit after shutdown timeout'); process.exit(1); }, 10000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

_initPromise.then(() => {
  app.use(registerSecurityMatrixRoutes(securityRouteContext));
  app.use(registerCustomerQueryRoutes({ authRequired, security: ctx.security, audit: ctx.audit, publicStore }));

  server.listen(PORT, () => {
    const actualPort = server.address().port;
    logger.info('Server started', { port: actualPort, env: config.env });
    // Electron 模式：输出带端口的单行日志方便主进程正则匹配
    if (process.env.NODE_ENV === 'electron') {
      console.log(`COLLABGRID_SERVER_PORT=${actualPort}`);
    }
    // 如果被 Electron fork，通过 IPC 通知主进程实际端口
    if (process.send && process.env.NODE_ENV === 'electron') {
      process.send({ type: 'server-ready', port: actualPort });
    }
    try {
      stopScheduler = jobs.startScheduler(db, {
        logger: ({ baseId, jobKey, businessDate, status, error }) => {
          if (status === 'failed') {
            logger.error('Scheduler job failed', { baseId, jobKey, businessDate, error: error?.message || error });
          } else {
            logger.info('Scheduler job completed', { baseId, jobKey, businessDate, status });
          }
        }
      });
      logger.info('Job scheduler started');
    } catch (e) {
      logger.error('Failed to start scheduler', { error: e.message });
    }
    // 启动通知聚合定时任务
    try {
      notificationJob.start(60 * 1000, (_, info) => {
        io.emit('notification:new', info);
      });
    } catch (e) {
      logger.error('Failed to start notification job', { error: e.message });
    }
  });
}).catch(err => {
  logger.error('Failed to initialize database', { error: err.message });
  process.exit(1);
});

// ============================================================
// Async 版本 — 所有异步业务逻辑函数（使用 dbAdapter）
// SQL 占位符使用 PG 风格 $1, $2, ...
// ============================================================

/**
 * ensureDefaultSysAdminAsync — 异步版默认系统管理员初始化 */
async function ensureDefaultSysAdminAsync() {
  const email = config.defaultAdminEmail;
  const displayName = config.defaultAdminDisplayName;
  let password;
  if (isProduction && !config.defaultAdminPassword) {
    password = generateRandomPassword(16);
    logger.warn('Production default admin created (async)', { email });
  } else {
    password = config.defaultAdminPassword;
  }
  const existingUser = await dbAdapter.queryOneAsync('SELECT id, system_role FROM users WHERE email=$1', [email]);
  if (existingUser) {
    const hash = await bcrypt.hash(password, 10);
    await dbAdapter.writeQueryAsync(
      `UPDATE users SET system_role='sys_admin', password_hash=$1, must_change_password=1, password_changed_at=NULL WHERE id=$2`,
      [hash, existingUser.id]
    );
    if (existingUser.system_role !== 'sys_admin') {
      logger.warn('Default admin promoted to sys_admin (async)', { email });
    }
    return;
  }
  const id = nanoid();
  const hash = await bcrypt.hash(password, 10);
  await dbAdapter.writeQueryAsync(
    `INSERT INTO users (id,email,password_hash,display_name,system_role,must_change_password,password_changed_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, email, hash, displayName, 'sys_admin', 1, null, now()]
  );
  logger.info('Default sys_admin created (async)', { email });
}

/**
 * registerUserAsync — 异步版用户注册逻辑
 * @returns {{ user: object, token: string } | { error: string, status: number }}
 */
async function registerUserAsync({ email, password, displayName }) {
  if (!email || !password) return { error: 'email/password required', status: 400 };
  const exists = await dbAdapter.queryOneAsync('SELECT 1 AS one FROM users WHERE email=$1', [email]);
  if (exists) return { error: 'email already registered', status: 400 };
  const id = nanoid();
  const hash = await bcrypt.hash(password, 10);
  const isFirstUser = (await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM users')).c === 0;
  const systemRole = isFirstUser ? 'sys_admin' : 'none';
  await dbAdapter.writeQueryAsync(
    `INSERT INTO users (id,email,password_hash,display_name,system_role,must_change_password,password_changed_at,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, email, hash, displayName || email.split('@')[0], systemRole, 0, now(), now()]
  );
  const user = { id, email };
  const token = sign(user);
  return {
    token,
    user: { id, email, displayName: displayName || email.split('@')[0], systemRole, mustChangePassword: false },
  };
}

/**
 * loginUserAsync — 异步版用户登录逻辑
 * @returns {{ token: string, user: object } | { error: string, status: number }}
 */
async function loginUserAsync({ email, password }) {
  const u = await dbAdapter.queryOneAsync('SELECT * FROM users WHERE email=$1', [email || '']);
  if (!u || !(await bcrypt.compare(password || '', u.password_hash))) {
    return { error: 'invalid credentials', status: 401 };
  }
  const token = sign(u);
  return {
    token,
    user: {
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      systemRole: u.system_role || 'none',
      mustChangePassword: !!u.must_change_password,
    },
  };
}

/**
 * refreshUserAsync — 异步版 token 刷新逻辑
 * @returns {{ token: string } | { error: string, status: number }}
 */
async function refreshUserAsync({ currentToken }) {
  const payload = currentToken ? verify(currentToken) : null;
  if (!payload) return { error: 'invalid or expired token', status: 401 };
  const u = await dbAdapter.queryOneAsync('SELECT id, email FROM users WHERE id=$1', [payload.uid]);
  if (!u) return { error: 'user not found', status: 401 };
  const newToken = sign(u);
  return { token: newToken };
}

/**
 * changePasswordAsync — 异步版修改密码逻辑
 * @returns {{ ok: true } | { error: string, status: number }}
 */
async function changePasswordAsync({ userId, currentPassword, newPassword }) {
  if (!currentPassword || !newPassword) return { error: 'currentPassword/newPassword required', status: 400 };
  if (String(newPassword).length < 8) return { error: 'new password must be at least 8 characters', status: 400 };
  if (currentPassword === newPassword) return { error: 'new password must be different from current password', status: 400 };
  const u = await dbAdapter.queryOneAsync('SELECT * FROM users WHERE id=$1', [userId]);
  if (!u || !(await bcrypt.compare(currentPassword, u.password_hash))) {
    return { error: 'invalid current password', status: 401 };
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await dbAdapter.writeQueryAsync(
    'UPDATE users SET password_hash=$1, must_change_password=0, password_changed_at=$2 WHERE id=$3',
    [hash, now(), userId]
  );
  await ctx.audit('system', userId, 'auth.password.change', {});
  return { ok: true };
}

/**
 * getMeAsync — 异步版获取当前用户信息
 * @returns {{ user: object } | null }
 */
async function getMeAsync(userId) {
  const u = await dbAdapter.queryOneAsync(
    'SELECT id,email,display_name,system_role,must_change_password,password_changed_at FROM users WHERE id=$1',
    [userId]
  );
  return u ? {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    systemRole: u.system_role || 'none',
    mustChangePassword: !!u.must_change_password,
    passwordChangedAt: u.password_changed_at || null,
  } : null;
}

/**
 * listBasesAsync — 异步版获取用户 base 列表
 */
async function listBasesAsync(userId) {
  return dbAdapter.queryAsync(
    `SELECT b.*, m.role FROM bases b
     JOIN members m ON m.base_id=b.id
     WHERE m.user_id=$1 ORDER BY b.created_at DESC`,
    [userId]
  );
}

/**
 * createBaseAsync — 异步版创建 base（含默认表和字段）
 * @returns {{ id: string } | { error: string, status: number }}
 */
async function createBaseAsync({ name, ownerId }) {
  if (!name) return { error: 'name required', status: 400 };
  const id = nanoid();
  await dbAdapter.writeQueryAsync(
    'INSERT INTO bases (id,name,owner_id,created_at) VALUES ($1,$2,$3,$4)',
    [id, name, ownerId, now()]
  );
  await dbAdapter.writeQueryAsync(
    'INSERT INTO members (base_id,user_id,role,joined_at) VALUES ($1,$2,$3,$4)',
    [id, ownerId, 'owner', now()]
  );
  const tid = nanoid();
  await dbAdapter.writeQueryAsync(
    'INSERT INTO tables (id,base_id,name,position,created_at) VALUES ($1,$2,$3,$4,$5)',
    [tid, id, '表1', 0, now()]
  );
  const f1 = nanoid(), f2 = nanoid();
  await dbAdapter.writeQueryAsync(
    'INSERT INTO fields (id,table_id,name,type,options,locked,width,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [f1, tid, '名称', 'text', null, 0, 160, 0, now()]
  );
  await dbAdapter.writeQueryAsync(
    'INSERT INTO fields (id,table_id,name,type,options,locked,width,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [f2, tid, '备注', 'text', null, 0, 160, 1, now()]
  );
  return { id };
}

/**
 * renameBaseAsync — 异步版重命名 base
 */
async function renameBaseAsync({ baseId, userId, newName }) {
  const base = await dbAdapter.queryOneAsync('SELECT * FROM bases WHERE id=$1', [baseId]);
  if (!base) return { error: 'not found', status: 404 };
  if (!(await ctx.canManageBase(baseId, userId))) return { error: 'only owner/admin can rename base', status: 403 };
  const nextName = String(newName || '').trim();
  if (!nextName) return { error: 'name required', status: 400 };
  await dbAdapter.writeQueryAsync('UPDATE bases SET name=$1 WHERE id=$2', [nextName, baseId]);
  await ctx.audit(baseId, userId, 'base.rename', { from: base.name, to: nextName });
  broadcast(baseId, 'base:rename', { baseId, name: nextName });
  return { ok: true, id: baseId, name: nextName };
}

/**
 * deleteBaseAsync — 异步版删除 base
 */
async function deleteBaseAsync({ baseId, userId }) {
  const base = await dbAdapter.queryOneAsync('SELECT * FROM bases WHERE id=$1', [baseId]);
  if (!base) return { error: 'not found', status: 404 };
  const role = await ctx.getRole(baseId, userId);
  const sysRow = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [userId]);
  const isSysAdmin = sysRow && sysRow.system_role === 'sys_admin';
  if (role !== 'owner' && !isSysAdmin) return { error: 'only base owner or sys_admin can delete base', status: 403 };
  await ctx.audit(baseId, userId, 'base.delete', { name: base.name });
  broadcast(baseId, 'base:delete', { baseId, name: base.name });
  syncService.clear(baseId);
  await dbAdapter.writeQueryAsync('DELETE FROM bases WHERE id=$1', [baseId]);
  return { ok: true };
}

/**
 * getBaseDetailAsync — 异步版获取 base 详情（含 tables/fields/records/cells/links/members） */
async function getBaseDetailAsync({ baseId, userId, pageLimit }) {
  if (!(await ctx.isMember(baseId, userId))) return { error: 'forbidden', status: 403 };
  const base = await dbAdapter.queryOneAsync('SELECT * FROM bases WHERE id=$1', [baseId]);
  if (!base) return { error: 'not found', status: 404 };
  const limit = Math.max(20, Math.min(500, Number.parseInt(pageLimit || '200', 10) || 200));
  const tables = await dbAdapter.queryAsync('SELECT * FROM tables WHERE base_id=$1 ORDER BY position', [baseId]);
  const result = {
    id: base.id, name: base.name,
    role: await ctx.getRole(baseId, userId),
    roles: ctx.ROLES.map(ctx.publicRoleMeta),
    tables: [],
  };
  for (const t of tables) {
    const fields = (await dbAdapter.queryAsync('SELECT * FROM fields WHERE table_id=$1 ORDER BY position', [t.id]))
      .map(f => ({ ...f, locked: !!f.locked, options: parseOptions(f) }));
    const totalRecords = (await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM records WHERE table_id=$1', [t.id])).c;
    const records = (await dbAdapter.queryAsync(
      'SELECT * FROM records WHERE table_id=$1 ORDER BY position, created_at LIMIT $2 OFFSET 0',
      [t.id, limit]
    )).map(r => ({ ...r, locked: !!r.locked }));
    const recordIds = records.map(r => r.id);
    let cells = [];
    let links = [];
    if (recordIds.length) {
      const placeholders = recordIds.map((_, i) => `$${i + 1}`).join(',');
      cells = await dbAdapter.queryAsync(`SELECT * FROM cells WHERE record_id IN (${placeholders})`, recordIds);
      links = await dbAdapter.queryAsync(`SELECT * FROM links WHERE from_record_id IN (${placeholders})`, recordIds);
    }
    cells = await ctx.injectComputedCells(t, fields, records, cells);
    result.tables.push({
      id: t.id, name: t.name, fields, records, cells, links,
      hidden: !!t.hidden,
      page: { offset: 0, limit, total: totalRecords },
    });
  }
  const members = await dbAdapter.queryAsync(
    `SELECT u.id, u.email, u.display_name, m.role
     FROM members m JOIN users u ON u.id=m.user_id
     WHERE m.base_id=$1`,
    [baseId]
  );
  result.members = members.map(m => ({ id: m.id, email: m.email, displayName: m.display_name, role: m.role }));
  return result;
}

/**
 * createInviteAsync — 异步版创建邀请 */
async function createInviteAsync({ baseId, userId, role }) {
  if (!(await ctx.isMember(baseId, userId))) return { error: 'forbidden', status: 403 };
  if (!(await ctx.canManageBase(baseId, userId))) return { error: 'forbidden: member.role required', status: 403 };
  const normalizedRole = ctx.normalizeRole(role, 'business');
  const token = nanoid(20);
  await dbAdapter.writeQueryAsync(
    'INSERT INTO invites (token,base_id,role,created_by,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [token, baseId, normalizedRole, userId, now(), now() + 7 * 24 * 3600 * 1000]
  );
  await ctx.audit(baseId, userId, 'invite.create', { role: normalizedRole });
  return { token, url: `/invite/${token}`, role: normalizedRole };
}

/**
 * updateMemberRoleAsync — 异步版更新成员角色 */
async function updateMemberRoleAsync({ baseId, userId, targetUserId, newRole, actorUserId }) {
  if (!(await ctx.isMember(baseId, actorUserId))) return { error: 'forbidden', status: 403 };
  if (!(await ctx.canManageBase(baseId, actorUserId))) return { error: 'forbidden: member.role required', status: 403 };
  const current = await dbAdapter.queryOneAsync(
    'SELECT role FROM members WHERE base_id=$1 AND user_id=$2',
    [baseId, targetUserId]
  );
  if (!current) return { error: 'member not found', status: 404 };
  if (current.role === 'owner') return { error: 'owner role cannot be changed here', status: 400 };
  const nextRole = ctx.normalizeRole(newRole, '');
  if (!nextRole) return { error: 'invalid role', status: 400 };
  const actorRole = await ctx.getRole(baseId, actorUserId);
  const sysRow = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [actorUserId]);
  const isSysAdmin = sysRow && sysRow.system_role === 'sys_admin';
  if (!isSysAdmin && actorRole !== 'owner' && ctx.roleRank(nextRole) >= ctx.roleRank(actorRole)) {
    return { error: 'cannot grant role at or above your level', status: 403 };
  }
  await dbAdapter.writeQueryAsync(
    'UPDATE members SET role=$1 WHERE base_id=$2 AND user_id=$3',
    [nextRole, baseId, targetUserId]
  );
  await ctx.audit(baseId, actorUserId, 'member.role.update', { userId: targetUserId, from: current.role, to: nextRole });
  broadcast(baseId, 'member:role', { userId: targetUserId, role: nextRole });
  return { ok: true, userId: targetUserId, role: nextRole };
}

/**
 * acceptInviteAsync — 异步版接受邀请 */
async function acceptInviteAsync({ token, userId }) {
  const inv = await dbAdapter.queryOneAsync('SELECT * FROM invites WHERE token=$1', [token]);
  if (!inv) return { error: 'invalid invite', status: 404 };
  if (inv.expires_at && inv.expires_at < now()) return { error: 'expired', status: 400 };
  const exists = await dbAdapter.queryOneAsync(
    'SELECT 1 AS one FROM members WHERE base_id=$1 AND user_id=$2',
    [inv.base_id, userId]
  );
  if (!exists) {
    await dbAdapter.writeQueryAsync(
      'INSERT INTO members (base_id,user_id,role,joined_at) VALUES ($1,$2,$3,$4)',
      [inv.base_id, userId, inv.role, now()]
    );
    await ctx.audit(inv.base_id, userId, 'member.join', { via: 'invite' });
    broadcast(inv.base_id, 'member:join', { userId });
  }
  return { baseId: inv.base_id };
}

/**
 * getAuditLogAsync — 异步版获取审计日志 */
async function getAuditLogAsync({ baseId, recordId, fieldId, limit }) {
  let sql = `SELECT a.*, u.display_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE base_id=$1`;
  const params = [baseId];
  let paramIdx = 2;
  if (recordId) { sql += ` AND record_id=$${paramIdx++}`; params.push(recordId); }
  if (fieldId) { sql += ` AND field_id=$${paramIdx++}`; params.push(fieldId); }
  sql += ` ORDER BY created_at DESC LIMIT $${paramIdx}`;
  params.push(Math.min(parseInt(limit, 10) || 100, 500));
  return dbAdapter.queryAsync(sql, params);
}

// -------- server.js 异步函数导出 --------
module.exports = {
  // 异步业务逻辑函数
  ensureDefaultSysAdminAsync,
  registerUserAsync,
  loginUserAsync,
  refreshUserAsync,
  changePasswordAsync,
  getMeAsync,
  listBasesAsync,
  createBaseAsync,
  renameBaseAsync,
  deleteBaseAsync,
  getBaseDetailAsync,
  createInviteAsync,
  updateMemberRoleAsync,
  acceptInviteAsync,
  getAuditLogAsync,
  // 告警工具
  pushAlert,
};

