// dbFactory.js — 数据库工厂（Phase 3 升级版）
// 根据 config.dbEngine 选择 SQLite 或 PostgreSQL
// DB_ENGINE=sqlite（默认）| postgresql

const config = require('./config');
const logger = require('./logger');

const engine = config.dbEngine || 'sqlite';

let db = null;
let getReadDb = null;
let close = null;

async function initDb() {
  if (engine === 'postgresql') {
    const pg = require('./pgAdapter');
    pg.initPools();
    await pg.initSchema();

    db = {
      type: 'postgresql',
      getWritePool: pg.getWritePool,
      getReadPool: pg.getReadPool,
      pgAll: pg.pgAll,
      pgGet: pg.pgGet,
      pgRun: pg.pgRun,
      pgTransaction: pg.pgTransaction,
      healthCheck: pg.healthCheck,
    };
    getReadDb = () => pg.getReadPool();
    close = pg.closePools;

    logger.info('PostgreSQL initialized (read-write separated)');
  } else {
    // SQLite（默认）
    const sqliteDb = require('./db');
    db = sqliteDb;
    db.type = 'sqlite';
    getReadDb = require('./db').getReadDb;
    close = () => {
      try { sqliteDb.close(); } catch {}
    };

    logger.info('SQLite initialized (WAL mode)');
  }

  return { db, getReadDb, close, engine };
}

function getEngine() { return engine; }

module.exports = { initDb, getEngine };
