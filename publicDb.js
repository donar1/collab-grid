// publicDb.js — 外部展示 / 查询库（独立 SQLite 实例）
//
// 设计：内部库（collab-grid.db）保留完整业务数据；外部库（collab-grid-public.db）
// 只承载：
//   1) public_clients —— 外部访问凭证（客户查询令牌、有效期、限定 base / customer）
//   2) public_customer_snapshot —— 客户可见的订单 / 账单 / 库存快照（由内部任务推送）
//   3) public_access_log —— 外部访问审计
//
// 内外库通过显式"快照同步函数"交换数据，绝不在外部库执行内部写操作；外部 API 只查
// 外部库，永远拿不到内部记录的内部 ID 与隐私字段。
//
// 双模式支持：
//   - SQLite 模式：所有同步函数通过 better-sqlite3 直接操作
//   - PostgreSQL 模式：通过 dbAdapter 异步接口操作 PG 中的 4 张 public 表

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const dbAdapter = require('./services/dbAdapter');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const publicDb = new Database(path.join(DATA_DIR, 'collab-grid-public.db'));
publicDb.pragma('journal_mode = WAL');
publicDb.pragma('foreign_keys = ON');

publicDb.exec(`
CREATE TABLE IF NOT EXISTS public_clients (
  token TEXT PRIMARY KEY,
  base_id TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'customer_query',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS public_customer_snapshot (
  base_id TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  category TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (base_id, customer_key, category, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_public_snapshot_lookup
  ON public_customer_snapshot(base_id, customer_key, category);

CREATE TABLE IF NOT EXISTS public_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT,
  base_id TEXT,
  customer_key TEXT,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_access_token ON public_access_log(token, created_at);

CREATE TABLE IF NOT EXISTS public_reconciliation (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  record_date TEXT NOT NULL,
  category TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  description TEXT,
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  data_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recon_lookup ON public_reconciliation(base_id, customer_key, record_date, category);
CREATE INDEX IF NOT EXISTS idx_recon_ref ON public_reconciliation(base_id, customer_key, ref_id);
`);

// ============================================================
// 同步函数（SQLite 模式）—— 保持完全不变
// ============================================================

function issueClient({ baseId, customerKey, displayName = null, ttlMs = 30 * 24 * 3600 * 1000, createdBy = null }) {
  const token = require('crypto').randomBytes(18).toString('hex');
  const ts = Date.now();
  publicDb.prepare(`
    INSERT INTO public_clients (token, base_id, customer_key, display_name, role, created_at, expires_at, revoked, created_by)
    VALUES (?, ?, ?, ?, 'customer_query', ?, ?, 0, ?)
  `).run(token, baseId, String(customerKey), displayName, ts, ttlMs ? ts + ttlMs : null, createdBy);
  return { token, expiresAt: ttlMs ? ts + ttlMs : null };
}

function revokeClient(token) {
  publicDb.prepare('UPDATE public_clients SET revoked=1 WHERE token=?').run(token);
}

function verifyClient(token) {
  if (!token) return null;
  const row = publicDb.prepare('SELECT * FROM public_clients WHERE token=?').get(token);
  if (!row) return null;
  if (row.revoked) return null;
  if (row.expires_at && row.expires_at < Date.now()) return null;
  return row;
}

function listClientsForBase(baseId) {
  return publicDb.prepare(`
    SELECT token, customer_key, display_name, created_at, expires_at, revoked
    FROM public_clients WHERE base_id=? ORDER BY created_at DESC
  `).all(baseId);
}

function logAccess({ token, baseId, customerKey, path, status, ip }) {
  publicDb.prepare(`
    INSERT INTO public_access_log (token, base_id, customer_key, path, status, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(token || null, baseId || null, customerKey || null, path, status, ip || null, Date.now());
}

function upsertSnapshot({ baseId, customerKey, category, refId, data }) {
  publicDb.prepare(`
    INSERT INTO public_customer_snapshot (base_id, customer_key, category, ref_id, data_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(base_id, customer_key, category, ref_id) DO UPDATE SET
      data_json=excluded.data_json, updated_at=excluded.updated_at
  `).run(baseId, String(customerKey), category, String(refId), JSON.stringify(data || {}), Date.now());
}

function deleteSnapshot({ baseId, customerKey, category, refId }) {
  publicDb.prepare(`
    DELETE FROM public_customer_snapshot
    WHERE base_id=? AND customer_key=? AND category=? AND ref_id=?
  `).run(baseId, String(customerKey), category, String(refId));
}

// 查询结果缓存（TTL 30 秒）
const _queryCache = new Map();
const QUERY_CACHE_TTL = 30000;

function _cacheKey(baseId, customerKey, filters) {
  return `${baseId}:${customerKey}:${JSON.stringify(filters)}`;
}

function querySnapshots({ baseId, customerKey, category = null, limit = 200, offset = 0, dateFrom = null, dateTo = null, status = null, minAmount = null, maxAmount = null, keyword = null }) {
  const params = [baseId, customerKey];
  let sql = `SELECT category, ref_id, data_json, updated_at FROM public_customer_snapshot WHERE base_id=? AND customer_key=?`;

  if (category) { sql += ' AND category=?'; params.push(category); }

  // 日期范围筛选（data_json 中的 completedDate 或 updated_at）
  if (dateFrom) { sql += ' AND updated_at>=?'; params.push(new Date(dateFrom).getTime()); }
  if (dateTo) { sql += ' AND updated_at<=?'; params.push(new Date(dateTo).getTime()); }

  const rows = publicDb.prepare(sql).all(...params);

  // 在内存中做金额/状态/关键词筛选（因为 data_json 是结构化数据）
  let results = rows.map(r => ({
    category: r.category,
    refId: r.ref_id,
    data: r.data_json ? JSON.parse(r.data_json) : {},
    updatedAt: r.updated_at,
  }));

  if (status) {
    results = results.filter(r => r.data.status === status || r.data.orderStatus === status);
  }
  if (minAmount != null) {
    results = results.filter(r => {
      const amt = Number(r.data.receivable || r.data.amount || r.data.payable || 0);
      return amt >= Number(minAmount);
    });
  }
  if (maxAmount != null) {
    results = results.filter(r => {
      const amt = Number(r.data.receivable || r.data.amount || r.data.payable || 0);
      return amt <= Number(maxAmount);
    });
  }
  if (keyword) {
    const kw = String(keyword).toLowerCase();
    results = results.filter(r => {
      const text = JSON.stringify(r.data).toLowerCase();
      return text.includes(kw);
    });
  }

  const total = results.length;
  const pageSize = Math.max(1, Math.min(1000, limit));
  const pageOffset = Math.max(0, offset);
  results = results.slice(pageOffset, pageOffset + pageSize);

  return { total, offset: pageOffset, limit: pageSize, results };
}

function querySnapshotsCached(filters) {
  const key = _cacheKey(filters.baseId, filters.customerKey, filters);
  const now = Date.now();
  const cached = _queryCache.get(key);
  if (cached && now - cached.ts < QUERY_CACHE_TTL) {
    return { ...cached.data, cached: true };
  }
  const data = querySnapshots(filters);
  _queryCache.set(key, { data, ts: now });
  // 清理过期缓存
  if (_queryCache.size > 5000) {
    for (const [k, v] of _queryCache) {
      if (now - v.ts > QUERY_CACHE_TTL) _queryCache.delete(k);
    }
  }
  return { ...data, cached: false };
}

// -------- 对账系统 --------

function upsertReconciliation({ baseId, customerKey, recordDate, category, refId, description, debit, credit, balance, status, data }) {
  const id = `${baseId}:${customerKey}:${category}:${refId}`;
  const ts = Date.now();
  publicDb.prepare(`
    INSERT INTO public_reconciliation (id, base_id, customer_key, record_date, category, ref_id, description, debit, credit, balance, status, data_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      record_date=excluded.record_date,
      description=excluded.description,
      debit=excluded.debit,
      credit=excluded.credit,
      balance=excluded.balance,
      status=excluded.status,
      data_json=excluded.data_json,
      updated_at=excluded.updated_at
  `).run(id, baseId, customerKey, recordDate, category, refId, description || '', debit || 0, credit || 0, balance || 0, status || 'pending', data ? JSON.stringify(data) : null, ts, ts);
  return id;
}

function queryReconciliation({ baseId, customerKey, dateFrom, dateTo, category, status, limit = 200, offset = 0 }) {
  let sql = 'SELECT * FROM public_reconciliation WHERE base_id=? AND customer_key=?';
  const params = [baseId, customerKey];
  if (dateFrom) { sql += ' AND record_date>=?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND record_date<=?'; params.push(dateTo); }
  if (category) { sql += ' AND category=?'; params.push(category); }
  if (status) { sql += ' AND status=?'; params.push(status); }
  sql += ' ORDER BY record_date DESC, created_at DESC';

  const rows = publicDb.prepare(sql).all(...params);

  // 汇总统计
  let totalDebit = 0, totalCredit = 0;
  for (const r of rows) {
    totalDebit += r.debit;
    totalCredit += r.credit;
  }

  const pageSize = Math.max(1, Math.min(1000, limit));
  const pageOffset = Math.max(0, offset);
  const paged = rows.slice(pageOffset, pageOffset + pageSize);

  return {
    total: rows.length,
    offset: pageOffset,
    limit: pageSize,
    summary: {
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      netBalance: Math.round((totalDebit - totalCredit) * 100) / 100,
    },
    results: paged.map(r => ({
      id: r.id,
      recordDate: r.record_date,
      category: r.category,
      refId: r.ref_id,
      description: r.description,
      debit: r.debit,
      credit: r.credit,
      balance: r.balance,
      status: r.status,
      data: r.data_json ? JSON.parse(r.data_json) : null,
      updatedAt: r.updated_at,
    })),
  };
}

// ============================================================
// 异步函数（PostgreSQL 模式）—— 通过 dbAdapter 异步接口操作
// ============================================================

async function issueClientAsync({ baseId, customerKey, displayName = null, ttlMs = 30 * 24 * 3600 * 1000, createdBy = null }) {
  const token = require('crypto').randomBytes(18).toString('hex');
  const ts = Date.now();
  await dbAdapter.writeQueryAsync(`
    INSERT INTO public_clients (token, base_id, customer_key, display_name, role, created_at, expires_at, revoked, created_by)
    VALUES ($1, $2, $3, $4, 'customer_query', $5, $6, 0, $7)
  `, [token, baseId, String(customerKey), displayName, ts, ttlMs ? ts + ttlMs : null, createdBy]);
  return { token, expiresAt: ttlMs ? ts + ttlMs : null };
}

async function revokeClientAsync(token) {
  await dbAdapter.writeQueryAsync('UPDATE public_clients SET revoked=1 WHERE token=$1', [token]);
}

async function verifyClientAsync(token) {
  if (!token) return null;
  const row = await dbAdapter.queryOneAsync('SELECT * FROM public_clients WHERE token=$1', [token]);
  if (!row) return null;
  if (row.revoked) return null;
  if (row.expires_at && row.expires_at < Date.now()) return null;
  return row;
}

async function listClientsForBaseAsync(baseId) {
  return dbAdapter.queryAsync(`
    SELECT token, customer_key, display_name, created_at, expires_at, revoked
    FROM public_clients WHERE base_id=$1 ORDER BY created_at DESC
  `, [baseId]);
}

async function logAccessAsync({ token, baseId, customerKey, path, status, ip }) {
  await dbAdapter.writeQueryAsync(`
    INSERT INTO public_access_log (token, base_id, customer_key, path, status, ip, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [token || null, baseId || null, customerKey || null, path, status, ip || null, Date.now()]);
}

async function upsertSnapshotAsync({ baseId, customerKey, category, refId, data }) {
  await dbAdapter.writeQueryAsync(`
    INSERT INTO public_customer_snapshot (base_id, customer_key, category, ref_id, data_json, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(base_id, customer_key, category, ref_id) DO UPDATE SET
      data_json=EXCLUDED.data_json, updated_at=EXCLUDED.updated_at
  `, [baseId, String(customerKey), category, String(refId), JSON.stringify(data || {}), Date.now()]);
}

async function deleteSnapshotAsync({ baseId, customerKey, category, refId }) {
  await dbAdapter.writeQueryAsync(`
    DELETE FROM public_customer_snapshot
    WHERE base_id=$1 AND customer_key=$2 AND category=$3 AND ref_id=$4
  `, [baseId, String(customerKey), category, String(refId)]);
}

async function querySnapshotsAsync({ baseId, customerKey, category = null, limit = 200, offset = 0, dateFrom = null, dateTo = null, status = null, minAmount = null, maxAmount = null, keyword = null }) {
  const params = [baseId, customerKey];
  let sql = `SELECT category, ref_id, data_json, updated_at FROM public_customer_snapshot WHERE base_id=$1 AND customer_key=$2`;

  if (category) { sql += ' AND category=$3'; params.push(category); }

  // 日期范围筛选（data_json 中的 completedDate 或 updated_at）
  if (dateFrom) { sql += ` AND updated_at>=$${params.length + 1}`; params.push(new Date(dateFrom).getTime()); }
  if (dateTo) { sql += ` AND updated_at<=$${params.length + 1}`; params.push(new Date(dateTo).getTime()); }

  const rows = await dbAdapter.queryAsync(sql, params);

  // 在内存中做金额/状态/关键词筛选（因为 data_json 是结构化数据）
  let results = rows.map(r => ({
    category: r.category,
    refId: r.ref_id,
    data: r.data_json ? JSON.parse(r.data_json) : {},
    updatedAt: r.updated_at,
  }));

  if (status) {
    results = results.filter(r => r.data.status === status || r.data.orderStatus === status);
  }
  if (minAmount != null) {
    results = results.filter(r => {
      const amt = Number(r.data.receivable || r.data.amount || r.data.payable || 0);
      return amt >= Number(minAmount);
    });
  }
  if (maxAmount != null) {
    results = results.filter(r => {
      const amt = Number(r.data.receivable || r.data.amount || r.data.payable || 0);
      return amt <= Number(maxAmount);
    });
  }
  if (keyword) {
    const kw = String(keyword).toLowerCase();
    results = results.filter(r => {
      const text = JSON.stringify(r.data).toLowerCase();
      return text.includes(kw);
    });
  }

  const total = results.length;
  const pageSize = Math.max(1, Math.min(1000, limit));
  const pageOffset = Math.max(0, offset);
  results = results.slice(pageOffset, pageOffset + pageSize);

  return { total, offset: pageOffset, limit: pageSize, results };
}

async function querySnapshotsCachedAsync(filters) {
  const key = _cacheKey(filters.baseId, filters.customerKey, filters);
  const now = Date.now();
  const cached = _queryCache.get(key);
  if (cached && now - cached.ts < QUERY_CACHE_TTL) {
    return { ...cached.data, cached: true };
  }
  const data = await querySnapshotsAsync(filters);
  _queryCache.set(key, { data, ts: now });
  // 清理过期缓存
  if (_queryCache.size > 5000) {
    for (const [k, v] of _queryCache) {
      if (now - v.ts > QUERY_CACHE_TTL) _queryCache.delete(k);
    }
  }
  return { ...data, cached: false };
}

async function upsertReconciliationAsync({ baseId, customerKey, recordDate, category, refId, description, debit, credit, balance, status, data }) {
  const id = `${baseId}:${customerKey}:${category}:${refId}`;
  const ts = Date.now();
  await dbAdapter.writeQueryAsync(`
    INSERT INTO public_reconciliation (id, base_id, customer_key, record_date, category, ref_id, description, debit, credit, balance, status, data_json, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT(id) DO UPDATE SET
      record_date=EXCLUDED.record_date,
      description=EXCLUDED.description,
      debit=EXCLUDED.debit,
      credit=EXCLUDED.credit,
      balance=EXCLUDED.balance,
      status=EXCLUDED.status,
      data_json=EXCLUDED.data_json,
      updated_at=EXCLUDED.updated_at
  `, [id, baseId, customerKey, recordDate, category, refId, description || '', debit || 0, credit || 0, balance || 0, status || 'pending', data ? JSON.stringify(data) : null, ts, ts]);
  return id;
}

async function queryReconciliationAsync({ baseId, customerKey, dateFrom, dateTo, category, status, limit = 200, offset = 0 }) {
  let sql = 'SELECT * FROM public_reconciliation WHERE base_id=$1 AND customer_key=$2';
  const params = [baseId, customerKey];
  if (dateFrom) { sql += ` AND record_date>=$${params.length + 1}`; params.push(dateFrom); }
  if (dateTo) { sql += ` AND record_date<=$${params.length + 1}`; params.push(dateTo); }
  if (category) { sql += ` AND category=$${params.length + 1}`; params.push(category); }
  if (status) { sql += ` AND status=$${params.length + 1}`; params.push(status); }
  sql += ' ORDER BY record_date DESC, created_at DESC';

  const rows = await dbAdapter.queryAsync(sql, params);

  // 汇总统计
  let totalDebit = 0, totalCredit = 0;
  for (const r of rows) {
    totalDebit += r.debit;
    totalCredit += r.credit;
  }

  const pageSize = Math.max(1, Math.min(1000, limit));
  const pageOffset = Math.max(0, offset);
  const paged = rows.slice(pageOffset, pageOffset + pageSize);

  return {
    total: rows.length,
    offset: pageOffset,
    limit: pageSize,
    summary: {
      totalDebit: Math.round(totalDebit * 100) / 100,
      totalCredit: Math.round(totalCredit * 100) / 100,
      netBalance: Math.round((totalDebit - totalCredit) * 100) / 100,
    },
    results: paged.map(r => ({
      id: r.id,
      recordDate: r.record_date,
      category: r.category,
      refId: r.ref_id,
      description: r.description,
      debit: r.debit,
      credit: r.credit,
      balance: r.balance,
      status: r.status,
      data: r.data_json ? JSON.parse(r.data_json) : null,
      updatedAt: r.updated_at,
    })),
  };
}

module.exports = {
  // 同步版本（SQLite 模式）
  publicDb,
  issueClient,
  revokeClient,
  verifyClient,
  listClientsForBase,
  logAccess,
  upsertSnapshot,
  deleteSnapshot,
  querySnapshots,
  querySnapshotsCached,
  upsertReconciliation,
  queryReconciliation,
  // 异步版本（PG 模式）
  issueClientAsync,
  revokeClientAsync,
  verifyClientAsync,
  listClientsForBaseAsync,
  logAccessAsync,
  upsertSnapshotAsync,
  deleteSnapshotAsync,
  querySnapshotsAsync,
  querySnapshotsCachedAsync,
  upsertReconciliationAsync,
  queryReconciliationAsync,
};
