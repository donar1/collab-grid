// services/dbAdapter.js — 统一数据库接口层（Phase 2→3）
// 根据 config.dbEngine 自动选择 SQLite（同步）或 PostgreSQL（异步）
// SQLite 模式：同步接口 + 异步包装
// PostgreSQL 模式：全部异步接口

const config = require('../config');

let _engine = config.dbEngine || 'sqlite';
let _sqliteDb = null;
let _pgAdapter = null;

// -------- 初始化 --------
function init() {
  if (_engine === 'postgresql') {
    _pgAdapter = require('../pgAdapter');
    _pgAdapter.initPools();
    return _pgAdapter.initSchema().then(() => {
      console.log('[dbAdapter] PostgreSQL initialized');
    });
  } else {
    _sqliteDb = require('../db');
    console.log('[dbAdapter] SQLite initialized (WAL mode)');
    return Promise.resolve();
  }
}

function getEngine() { return _engine; }

// -------- SQLite 同步接口 --------
function _ensureSQLite() {
  if (_engine !== 'sqlite') throw new Error('当前为 PostgreSQL 模式，请使用异步接口');
  if (!_sqliteDb) _sqliteDb = require('../db');
}

// 将 PostgreSQL 风格 $1, $2 占位符转换为 SQLite ?
// 同时处理同一个 $N 在 SQL 中重复出现导致的参数数量不匹配问题：
//   按 $N 在 SQL 中出现的实际顺序构造 params 数组，例如：
//     $1, $1, $2  →  ?, ?, ?  +  params[0], params[0], params[1]
function _pgToSQLite(sql, params = []) {
  if (!params.length) return { sql: sql.replace(/\$\d+/g, '?'), params: [] };
  const indices = [];
  const newSql = sql.replace(/\$(\d+)/g, (match, num) => {
    indices.push(Number(num) - 1);
    return '?';
  });
  return { sql: newSql, params: indices.map(i => params[i]) };
}

function query(sql, params = []) {
  _ensureSQLite();
  const { sql: newSql, params: newParams } = _pgToSQLite(sql, params);
  const stmt = _sqliteDb.prepare(newSql);
  return newParams.length > 0 ? stmt.all(...newParams) : stmt.all();
}

function queryOne(sql, params = []) {
  _ensureSQLite();
  const { sql: newSql, params: newParams } = _pgToSQLite(sql, params);
  const stmt = _sqliteDb.prepare(newSql);
  return newParams.length > 0 ? stmt.get(...newParams) : stmt.get();
}

function run(sql, params = []) {
  _ensureSQLite();
  const { sql: newSql, params: newParams } = _pgToSQLite(sql, params);
  const stmt = _sqliteDb.prepare(newSql);
  return newParams.length > 0 ? stmt.run(...newParams) : stmt.run();
}

function transaction(fn) {
  _ensureSQLite();
  return _sqliteDb.transaction(fn);
}

// -------- 异步接口（SQLite 模式为同步包装，PG 模式为真异步） --------
async function queryAsync(sql, params = []) {
  if (_engine === 'postgresql') {
    return _pgAdapter.pgAll(_pgAdapter.getReadPool(), sql, params);
  }
  return query(sql, params);
}

async function queryOneAsync(sql, params = []) {
  if (_engine === 'postgresql') {
    return _pgAdapter.pgGet(_pgAdapter.getReadPool(), sql, params);
  }
  return queryOne(sql, params);
}

async function runAsync(sql, params = []) {
  if (_engine === 'postgresql') {
    return _pgAdapter.pgRun(_pgAdapter.getWritePool(), sql, params);
  }
  return run(sql, params);
}

async function writeQueryAsync(sql, params = []) {
  if (_engine === 'postgresql') {
    return _pgAdapter.pgRun(_pgAdapter.getWritePool(), sql, params);
  }
  return run(sql, params);
}

async function writeQueryOneAsync(sql, params = []) {
  if (_engine === 'postgresql') {
    return _pgAdapter.pgGet(_pgAdapter.getWritePool(), sql, params);
  }
  return queryOne(sql, params);
}

async function transactionAsync(fn) {
  if (_engine === 'postgresql') {
    return _pgAdapter.pgTransaction(_pgAdapter.getWritePool(), fn);
  }
  _ensureSQLite();
  // SQLite 手动 BEGIN/COMMIT/ROLLBACK：支持 async 函数
  // better-sqlite3 的 transaction() 不接受 async 函数，所以用显式事务控制
  _sqliteDb.exec('BEGIN');
  try {
    const result = await fn();
    _sqliteDb.exec('COMMIT');
    return result;
  } catch (e) {
    try { _sqliteDb.exec('ROLLBACK'); } catch (_) {}
    throw e;
  }
}

// -------- 关闭连接 --------
async function close() {
  if (_engine === 'postgresql' && _pgAdapter) {
    await _pgAdapter.closePools();
  } else if (_sqliteDb) {
    try { _sqliteDb.closePools(); } catch (_) { try { _sqliteDb.close(); } catch (_) {} }
  }
}

// -------- 健康检查 --------
async function healthCheck() {
  if (_engine === 'postgresql' && _pgAdapter) {
    return _pgAdapter.healthCheck();
  }
  return { status: 'healthy', engine: 'sqlite' };
}

module.exports = {
  init,
  getEngine,
  // 同步接口（仅 SQLite 模式可用）
  query,
  queryOne,
  run,
  transaction,
  // 异步接口（SQLite/PG 通用）
  queryAsync,
  queryOneAsync,
  runAsync,
  writeQueryAsync,
  writeQueryOneAsync,
  transactionAsync,
  // 管理
  close,
  healthCheck,
  // 原始实例（向后兼容）
  get db() { _ensureSQLite(); return _sqliteDb; },
};
