const { nanoid } = require('nanoid');
const { runStatusJob } = require('./statusJob');
const { runCommissionJob } = require('./commissionJob');
const { syncAllSnapshots, syncProductCatalog, syncStockAlerts } = require('./snapshotSyncJob');
const dbAdapter = require('../services/dbAdapter');
const config = require('../config');
const { pushAlert } = require('../app/alerts');

const DEFAULT_CONFIGS = {
  status_update: {
    enabled: true,
    dry_run: true,
    batch_size: 2000,
    max_runtime_ms: 120000,
    config: { channelWindowDays: 30, productWindowDays: 7 },
  },
  commission_settlement: {
    enabled: true,
    dry_run: true,
    batch_size: 2000,
    max_runtime_ms: 120000,
    config: { activeRate: 0.005, normalRate: 0.003, dormantRate: 0.001 },
  },
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidBusinessDateMode(value) {
  return value === 'today' || value === 'yesterday';
}

function parseRun(row) {
  return {
    ...row,
    summary: row.summary_json ? JSON.parse(row.summary_json) : null,
    error: row.error_json ? JSON.parse(row.error_json) : null,
  };
}

async function ensureJobConfig(baseId, jobKey) {
  const existing = await dbAdapter.queryOneAsync('SELECT * FROM job_configs WHERE base_id=$1 AND job_key=$2', [baseId, jobKey]);
  if (existing) return existing;
  const cfg = DEFAULT_CONFIGS[jobKey] || DEFAULT_CONFIGS.status_update;
  await dbAdapter.runAsync(`
    INSERT INTO job_configs (base_id,job_key,enabled,dry_run,batch_size,max_runtime_ms,config_json,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [baseId, jobKey, cfg.enabled ? 1 : 0, cfg.dry_run ? 1 : 0, cfg.batch_size, cfg.max_runtime_ms, JSON.stringify(cfg.config), Date.now()]);
  return dbAdapter.queryOneAsync('SELECT * FROM job_configs WHERE base_id=$1 AND job_key=$2', [baseId, jobKey]);
}

async function listJobConfigs(baseId) {
  for (const key of Object.keys(DEFAULT_CONFIGS)) await ensureJobConfig(baseId, key);
  const rows = await dbAdapter.queryAsync('SELECT * FROM job_configs WHERE base_id=$1 ORDER BY job_key', [baseId]);
  return rows.map(row => ({
    ...row,
    enabled: !!row.enabled,
    dry_run: !!row.dry_run,
    schedule_enabled: !!row.schedule_enabled,
    schedule_dry_run: !!row.schedule_dry_run,
    config: row.config_json ? JSON.parse(row.config_json) : {},
  }));
}

async function updateJobConfig(baseId, jobKey, patch) {
  await ensureJobConfig(baseId, jobKey);
  const current = await dbAdapter.queryOneAsync('SELECT * FROM job_configs WHERE base_id=$1 AND job_key=$2', [baseId, jobKey]);
  const next = {
    enabled: patch.enabled === undefined ? current.enabled : (patch.enabled ? 1 : 0),
    dry_run: patch.dry_run === undefined ? current.dry_run : (patch.dry_run ? 1 : 0),
    batch_size: Math.max(100, Math.min(10000, Number.parseInt(patch.batch_size || current.batch_size, 10) || current.batch_size)),
    max_runtime_ms: Math.max(10000, Math.min(600000, Number.parseInt(patch.max_runtime_ms || current.max_runtime_ms, 10) || current.max_runtime_ms)),
    config_json: patch.config ? JSON.stringify(patch.config) : current.config_json,
    schedule_enabled: patch.schedule_enabled === undefined ? current.schedule_enabled : (patch.schedule_enabled ? 1 : 0),
    schedule_time: patch.schedule_time === undefined ? current.schedule_time : (isValidTime(patch.schedule_time) ? patch.schedule_time : current.schedule_time),
    schedule_business_date_mode: patch.schedule_business_date_mode === undefined
      ? current.schedule_business_date_mode
      : (isValidBusinessDateMode(patch.schedule_business_date_mode) ? patch.schedule_business_date_mode : current.schedule_business_date_mode),
    schedule_dry_run: patch.schedule_dry_run === undefined ? current.schedule_dry_run : (patch.schedule_dry_run ? 1 : 0),
  };
  await dbAdapter.runAsync(`
    UPDATE job_configs SET enabled=$1, dry_run=$2, batch_size=$3, max_runtime_ms=$4, config_json=$5,
      schedule_enabled=$6, schedule_time=$7, schedule_business_date_mode=$8, schedule_dry_run=$9,
      updated_at=$10
    WHERE base_id=$11 AND job_key=$12
  `, [
    next.enabled, next.dry_run, next.batch_size, next.max_runtime_ms, next.config_json,
    next.schedule_enabled, next.schedule_time, next.schedule_business_date_mode, next.schedule_dry_run,
    Date.now(), baseId, jobKey
  ]);
  return ensureJobConfig(baseId, jobKey);
}

async function createRun({ baseId, jobKey, businessDate, mode, userId }) {
  const id = nanoid();
  await dbAdapter.runAsync(`
    INSERT INTO job_runs (id,base_id,job_key,business_date,mode,status,started_at,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [id, baseId, jobKey, businessDate, mode, 'running', Date.now(), userId || null]);
  return id;
}

async function finishRun(id, status, result, error = null) {
  await dbAdapter.runAsync(`
    UPDATE job_runs
    SET status=$1, finished_at=$2, scanned_count=$3, changed_count=$4, error_count=$5, summary_json=$6, error_json=$7
    WHERE id=$8
  `, [
    status,
    Date.now(),
    result?.scannedCount || 0,
    result?.changedCount || 0,
    error ? 1 : 0,
    result?.summary ? JSON.stringify(result.summary) : null,
    error ? JSON.stringify({ message: error.message, stack: error.stack }) : null,
    id
  ]);
  // 任务失败时推送告警
  if (status === 'failed') {
    try {
      pushAlert('error', 'scheduler', `Job run ${id} failed: ${error?.message || 'unknown error'}`);
    } catch (_) { /* noop */ }
  }
}

async function runJob({ baseId, jobKey, businessDate = today(), dryRun, userId = null, mode = 'manual' }) {
  const config = await ensureJobConfig(baseId, jobKey);
  const actualDryRun = dryRun === undefined ? !!config.dry_run : !!dryRun;
  if (!config.enabled && !actualDryRun) throw new Error('作业开关已关闭，只允许试算');
  const runId = await createRun({ baseId, jobKey, businessDate, mode: actualDryRun ? 'dry_run' : mode, userId });
  try {
    const result = jobKey === 'status_update'
      ? await runStatusJob({ baseId, businessDate, dryRun: actualDryRun, userId })
      : await runCommissionJob({ baseId, businessDate, dryRun: actualDryRun, userId });
    await finishRun(runId, 'success', result);
    return { runId, status: 'success', ...result };
  } catch (e) {
    await finishRun(runId, 'failed', null, e);
    throw e;
  }
}

function pickBusinessDate(mode, now) {
  const base = now ? new Date(now) : new Date();
  if (mode === 'yesterday') base.setDate(base.getDate() - 1);
  return base.toISOString().slice(0, 10);
}

function formatLocalTime(date) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function processSchedules({ now = new Date(), logger = null } = {}) {
  const currentTime = formatLocalTime(now);
  const currentLocalDate = formatLocalDate(now);
  const due = await dbAdapter.queryAsync(`
    SELECT * FROM job_configs
    WHERE schedule_enabled = 1
      AND schedule_time IS NOT NULL
      AND schedule_time <= $1
      AND (schedule_last_run_date IS NULL OR schedule_last_run_date <> $2)
  `, [currentTime, currentLocalDate]);
  const results = [];
  for (const cfg of due) {
    const businessDate = pickBusinessDate(cfg.schedule_business_date_mode || 'today', now);
    let status = 'success';
    let result = null;
    let error = null;
    try {
      result = await runJob({
        baseId: cfg.base_id,
        jobKey: cfg.job_key,
        businessDate,
        dryRun: !!cfg.schedule_dry_run,
        userId: null,
        mode: 'scheduled',
      });
    } catch (e) {
      status = 'failed';
      error = e;
    }
    await dbAdapter.runAsync(`
      UPDATE job_configs
      SET schedule_last_run_date=$1, schedule_last_run_at=$2, schedule_last_run_status=$3
      WHERE base_id=$4 AND job_key=$5
    `, [currentLocalDate, Date.now(), status, cfg.base_id, cfg.job_key]);
    results.push({ baseId: cfg.base_id, jobKey: cfg.job_key, businessDate, status, result, error });
    if (logger) {
      try { logger({ baseId: cfg.base_id, jobKey: cfg.job_key, businessDate, status, error }); } catch (_) { /* noop */ }
    }
  }
  return results;
}

function startScheduler({ logger = null, intervalMs = 60000, snapshotSyncIntervalMs = 300000 } = {}) {
  if (config.schedulerEnabled === false) {
    console.log('[scheduler] Disabled by configuration');
    return () => {};
  }

  let lastTick = '';
  let lastSnapshotSync = 0;
  const tick = () => {
    try {
      const now = new Date();
      const stamp = formatLocalTime(now);
      if (stamp === lastTick) return;
      lastTick = stamp;
      processSchedules({ now, logger }).catch(e => {
        if (logger) { try { logger({ status: 'failed', error: e }); } catch (_) { /* noop */ } }
      });
      // 快照同步：每 snapshotSyncIntervalMs（默认 5 分钟）执行一次
      const nowMs = Date.now();
      if (nowMs - lastSnapshotSync >= snapshotSyncIntervalMs) {
        lastSnapshotSync = nowMs;
        try {
          const publicDb = require('../publicDb');
          const clients = publicDb.publicDb.prepare(
            "SELECT base_id, customer_key FROM public_clients WHERE revoked=0 AND (expires_at IS NULL OR expires_at > ?)"
          ).all(Date.now());

          // 1. 同步订单快照
          const orderResult = syncAllSnapshots({ logger });
          if (orderResult.synced > 0 || orderResult.errors > 0) {
            if (logger) logger({ status: 'snapshot_sync_orders', ...orderResult });
          }

          // 2. 同步产品目录（特价商品、今日报价）
          let productTotal = 0;
          for (const c of clients) {
            const r = syncProductCatalog(c.base_id, c.customer_key);
            productTotal += r.synced;
          }
          if (productTotal > 0 && logger) logger({ status: 'snapshot_sync_products', synced: productTotal });

          // 3. 同步库存预警（断货求购）
          let alertTotal = { outOfStock: 0, lowStock: 0 };
          for (const c of clients) {
            const r = syncStockAlerts(c.base_id, c.customer_key);
            alertTotal.outOfStock += r.outOfStock;
            alertTotal.lowStock += r.lowStock;
          }
          if ((alertTotal.outOfStock > 0 || alertTotal.lowStock > 0) && logger) {
            logger({ status: 'snapshot_sync_alerts', ...alertTotal });
          }
        } catch (e) {
          if (logger) { try { logger({ status: 'failed', error: e }); } catch (_) { /* noop */ } }
        }
      }
    } catch (e) {
      if (logger) { try { logger({ status: 'failed', error: e }); } catch (_) { /* noop */ } }
    }
  };
  const handle = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(handle);
}

async function listRuns(baseId, limit = 30) {
  const rows = await dbAdapter.queryAsync('SELECT * FROM job_runs WHERE base_id=$1 ORDER BY started_at DESC LIMIT $2', [baseId, Math.max(1, Math.min(100, limit))]);
  return rows.map(parseRun);
}

async function getRun(baseId, id) {
  const row = await dbAdapter.queryOneAsync('SELECT * FROM job_runs WHERE base_id=$1 AND id=$2', [baseId, id]);
  return row ? parseRun(row) : null;
}

module.exports = {
  listJobConfigs, updateJobConfig,
  runJob,
  listRuns, getRun,
  processSchedules,
  startScheduler,
  ensureJobConfig, createRun, finishRun,
};
