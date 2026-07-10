// V0.3：从 server.js 拆出的表格通用路由模块
const express = require('express');
const { nanoid } = require('nanoid');
const { asyncHandler } = require('../utils');
const { validate } = require('../../app/validate');
const { createRecordSchema } = require('../../app/validators');
const dbAdapter = require('../../services/dbAdapter');

// ============================================================
// 异步版本的核心业务逻辑函数（使用 PG 风格 $1,$2... 占位符）
// ============================================================

/**
 * 创建记录（异步版本）
 * @param {string} tableId
 * @param {object} opts - { applyDefaultsFn } 可选的 applyOrderDefaults 回调
 * @returns {object} { id, position }
 */
async function createRecordAsync(tableId, opts = {}) {
  const id = nanoid();
  const maxRow = await dbAdapter.queryOneAsync(
    'SELECT MAX(position) AS m FROM records WHERE table_id=$1',
    [tableId]
  );
  const pos = (maxRow?.m || 0) + 1;
  const ts = Date.now();

  await dbAdapter.transactionAsync(async () => {
    await dbAdapter.writeQueryAsync(
      'INSERT INTO records (id,table_id,height,locked,position,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, tableId, 34, 0, pos, ts, ts]
    );
    // 如果提供了 applyDefaultsFn，在事务内调用
    if (opts.applyDefaultsFn) {
      await opts.applyDefaultsFn(id, tableId, opts.userId, opts.baseId);
    }
  });

  return { id, position: pos, height: 34, locked: false };
}

/**
 * 更新记录（异步版本）
 * @param {string} recordId
 * @param {object} updates - { height, locked }
 * @returns {object} { height, locked }
 */
async function updateRecordAsync(recordId, updates) {
  const r = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [recordId]);
  if (!r) throw new Error('record not found');

  const nextHeight = updates.height === undefined ? r.height : Math.max(28, Math.min(240, Math.round(Number(updates.height))));
  if (!Number.isFinite(nextHeight)) throw new Error('invalid height');
  const nextLocked = updates.locked === undefined ? !!r.locked : !!updates.locked;
  const ts = Date.now();

  await dbAdapter.writeQueryAsync(
    'UPDATE records SET height=$1, locked=$2, updated_at=$3 WHERE id=$4',
    [nextHeight, nextLocked ? 1 : 0, ts, recordId]
  );

  return { recordId, height: nextHeight, locked: nextLocked, updatedAt: ts };
}

/**
 * 删除记录（异步版本）
 * @param {string} recordId
 */
async function deleteRecordAsync(recordId) {
  const r = await dbAdapter.queryOneAsync('SELECT locked FROM records WHERE id=$1', [recordId]);
  if (r?.locked) throw new Error('record sealed');

  await dbAdapter.transactionAsync(async () => {
    await dbAdapter.writeQueryAsync('DELETE FROM cells WHERE record_id=$1', [recordId]);
    await dbAdapter.writeQueryAsync('DELETE FROM links WHERE from_record_id=$1 OR to_record_id=$2', [recordId, recordId]);
    await dbAdapter.writeQueryAsync('DELETE FROM records WHERE id=$1', [recordId]);
  });

  return { recordId };
}

// ============================================================
// 路由注册（仅异步版本）
// ============================================================

module.exports = function registerGridRecordRoutes(ctx) {
  const router = express.Router();
  const {
    nanoid,
    now,
    authRequired,
    baseOfTable,
    baseOfRecord,
    isMember,
    canEditData,
    canSealRecord,
    audit,
    broadcast,
    applyOrderDefaults,
  } = ctx;

// -------- records --------
router.post('/api/tables/:tableId/records', authRequired, validate(createRecordSchema), asyncHandler(async (req, res) => {
  const { tableId } = req.params;
  const t = await baseOfTable(tableId);
  if (!t || !(await isMember(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canEditData(t.base_id, req.user.id))) return res.status(403).json({ error: 'viewer cannot create records' });
  const id = nanoid();
  const maxPosRow = await dbAdapter.queryOneAsync('SELECT MAX(position) AS m FROM records WHERE table_id=$1', [tableId]);
  const pos = (maxPosRow?.m || 0) + 1;
  const ts = now();
  await dbAdapter.transactionAsync(async () => {
    await dbAdapter.writeQueryAsync(
      'INSERT INTO records (id,table_id,height,locked,position,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, tableId, 34, 0, pos, ts, ts]
    );
    if (applyOrderDefaults) {
      await applyOrderDefaults(id, tableId, req.user.id, t.base_id);
    }
  });
  await audit(t.base_id, req.user.id, 'record.create', { id, tableId });
  broadcast(t.base_id, 'record:add', { id, tableId, height: 34, locked: false, position: pos });
  res.json({ id });
}));

router.patch('/api/records/:recordId', authRequired, asyncHandler(async (req, res) => {
  const { recordId } = req.params;
  const b = await baseOfRecord(recordId);
  if (!b || !(await isMember(b.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const r = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [recordId]);
  if (!r) return res.status(404).json({ error: 'record not found' });
  const { height, locked } = req.body || {};
  if (height === undefined && locked === undefined) return res.status(400).json({ error: 'nothing to update' });
  if (locked !== undefined && !(await canSealRecord(b.base_id, req.user.id, !!locked))) return res.status(403).json({ error: locked ? 'no permission to seal record' : 'only owner/admin can unseal record' });
  const nextHeight = height === undefined ? r.height : Math.max(28, Math.min(240, Math.round(Number(height))));
  if (!Number.isFinite(nextHeight)) return res.status(400).json({ error: 'invalid height' });
  const nextLocked = locked === undefined ? !!r.locked : !!locked;
  const ts = now();
  await dbAdapter.writeQueryAsync('UPDATE records SET height=$1, locked=$2, updated_at=$3 WHERE id=$4',
    [nextHeight, nextLocked ? 1 : 0, ts, recordId]);
  await audit(b.base_id, req.user.id, 'record.update', { recordId, height: nextHeight, locked: nextLocked });
  broadcast(b.base_id, 'record:update', { recordId, height: nextHeight, locked: nextLocked, updatedAt: ts });
  res.json({ ok: true, height: nextHeight, locked: nextLocked });
}));

router.delete('/api/records/:recordId', authRequired, asyncHandler(async (req, res) => {
  const { recordId } = req.params;
  const b = await baseOfRecord(recordId);
  if (!b || !(await isMember(b.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canEditData(b.base_id, req.user.id))) return res.status(403).json({ error: 'viewer cannot delete records' });
  const r = await dbAdapter.queryOneAsync('SELECT locked FROM records WHERE id=$1', [recordId]);
  if (r?.locked) return res.status(423).json({ error: 'record sealed' });
  await dbAdapter.transactionAsync(async () => {
    await dbAdapter.writeQueryAsync('DELETE FROM cells WHERE record_id=$1', [recordId]);
    await dbAdapter.writeQueryAsync('DELETE FROM links WHERE from_record_id=$1 OR to_record_id=$2', [recordId, recordId]);
    await dbAdapter.writeQueryAsync('DELETE FROM records WHERE id=$1', [recordId]);
  });
  await audit(b.base_id, req.user.id, 'record.delete', { recordId });
  broadcast(b.base_id, 'record:delete', { recordId });
  res.json({ ok: true });
}));



  return router;
};

// ============================================================
// 导出异步函数
// ============================================================
module.exports.createRecordAsync = createRecordAsync;
module.exports.updateRecordAsync = updateRecordAsync;
module.exports.deleteRecordAsync = deleteRecordAsync;
