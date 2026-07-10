// V0.3：从 server.js 拆出的表格通用路由模块
const express = require('express');
const { nanoid } = require('nanoid');
const { asyncHandler } = require('../utils');
const { validate } = require('../../app/validate');
const { createLinkSchema } = require('../../app/validators');
const dbAdapter = require('../../services/dbAdapter');
const { parseOptions } = require('../../services/helpers');

// ============================================================
// 异步版本的核心业务逻辑函数（使用 PG 风格 $1,$2... 占位符）
// ============================================================

/**
 * 创建关联链接（异步版本）
 * @param {string} fieldId
 * @param {string} fromRecordId
 * @param {string} toRecordId
 * @param {object} opts - { allowMultiple, linkOptions }
 * @returns {object} { id, replaced }
 */
async function createLinkAsync(fieldId, fromRecordId, toRecordId, opts = {}) {
  const { allowMultiple = false, linkOptions = {} } = opts;
  const ts = Date.now();

  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f || f.type !== 'link') throw new Error('not a link field');

  const fromRecord = await dbAdapter.queryOneAsync('SELECT table_id, locked FROM records WHERE id=$1', [fromRecordId]);
  if (!fromRecord || fromRecord.table_id !== f.table_id) throw new Error('from record does not belong to link field table');
  if (fromRecord.locked) throw new Error('record sealed');

  const toRecord = await dbAdapter.queryOneAsync('SELECT table_id FROM records WHERE id=$1', [toRecordId]);
  if (!toRecord || (linkOptions.tableId && toRecord.table_id !== linkOptions.tableId)) {
    throw new Error('target record does not belong to linked table');
  }

  const oldLinks = await dbAdapter.queryAsync(
    'SELECT * FROM links WHERE field_id=$1 AND from_record_id=$2',
    [fieldId, fromRecordId]
  );
  const same = oldLinks.find(l => l.to_record_id === toRecordId);

  // 如果不允许多重链接，先删除旧链接
  if (!allowMultiple) {
    for (const oldLink of oldLinks) {
      if (oldLink.id === same?.id) continue;
      await dbAdapter.writeQueryAsync('DELETE FROM links WHERE id=$1', [oldLink.id]);
    }
  }

  if (same) {
    return { id: same.id, replaced: !allowMultiple && oldLinks.length > 1 };
  }

  const id = nanoid();
  try {
    await dbAdapter.writeQueryAsync(
      'INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES ($1,$2,$3,$4,$5)',
      [id, fieldId, fromRecordId, toRecordId, ts]
    );
  } catch (e) {
    throw new Error('link already exists or invalid');
  }

  return { id };
}

/**
 * 删除关联链接（异步版本）
 * @param {string} linkId
 * @returns {object} { id, fieldId }
 */
async function deleteLinkAsync(linkId) {
  const link = await dbAdapter.queryOneAsync('SELECT * FROM links WHERE id=$1', [linkId]);
  if (!link) throw new Error('not found');

  const fromRecord = await dbAdapter.queryOneAsync('SELECT locked FROM records WHERE id=$1', [link.from_record_id]);
  if (fromRecord?.locked) throw new Error('record sealed');

  await dbAdapter.writeQueryAsync('DELETE FROM links WHERE id=$1', [linkId]);

  return { id: linkId, fieldId: link.field_id };
}

// ============================================================
// 路由注册（仅异步版本）
// ============================================================

module.exports = function registerGridLinkRoutes(ctx) {
  const router = express.Router();
  const {
    nanoid,
    now,
    authRequired,
    baseOfField,
    isMember,
    canEditData,
    audit,
    broadcast,
    businessLockCoreProtected,
    linkAllowsMultiple,
    tableNameOfRecord,
    cellValueByName,
    recomputeLookupSnapshots,
    syncOrderProductDefaults,
  } = ctx;

// -------- links (relation field) --------
router.post('/api/links', authRequired, validate(createLinkSchema), asyncHandler(async (req, res) => {
  const { fieldId, fromRecordId, toRecordId } = req.body || {};
  const b = await baseOfField(fieldId);
  if (!b || !(await isMember(b.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canEditData(b.base_id, req.user.id))) return res.status(403).json({ error: 'viewer cannot edit links' });
  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f || f.type !== 'link') return res.status(400).json({ error: 'not a link field' });
  if (await businessLockCoreProtected(fromRecordId, fieldId)) return res.status(423).json({ error: '业务锁定核心字段已审批保护' });
  if (f.locked) return res.status(423).json({ error: 'field locked' });
  const fromRecord = await dbAdapter.queryOneAsync('SELECT table_id, locked FROM records WHERE id=$1', [fromRecordId]);
  if (!fromRecord || fromRecord.table_id !== f.table_id) return res.status(400).json({ error: 'from record does not belong to link field table' });
  if (await tableNameOfRecord(fromRecordId) === '订单管理区' && await cellValueByName(fromRecordId, fromRecord.table_id, '佣金已结算') === 'true') {
    return res.status(423).json({ error: '订单已结算，关联字段不可修改' });
  }
  if (fromRecord.locked) return res.status(423).json({ error: 'record sealed' });
  const linkOptions = parseOptions(f) || {};
  const toRecord = await dbAdapter.queryOneAsync('SELECT table_id FROM records WHERE id=$1', [toRecordId]);
  if (!toRecord || (linkOptions.tableId && toRecord.table_id !== linkOptions.tableId)) {
    return res.status(400).json({ error: 'target record does not belong to linked table' });
  }
  const oldLinks = await dbAdapter.queryAsync('SELECT * FROM links WHERE field_id=$1 AND from_record_id=$2', [fieldId, fromRecordId]);
  const same = oldLinks.find(l => l.to_record_id === toRecordId);
  if (!linkAllowsMultiple(f)) {
    for (const oldLink of oldLinks) {
      if (oldLink.id === same?.id) continue;
      await dbAdapter.writeQueryAsync('DELETE FROM links WHERE id=$1', [oldLink.id]);
      await audit(b.base_id, req.user.id, 'link.delete', { id: oldLink.id, replacedBy: toRecordId });
      broadcast(b.base_id, 'link:delete', { id: oldLink.id, fieldId });
    }
  }
  if (same) {
    try { await recomputeLookupSnapshots(fromRecordId, fieldId, b.base_id, req.user.id); } catch (e) { /* best-effort */ }
    return res.json({ id: same.id, replaced: !linkAllowsMultiple(f) && oldLinks.length > 1 });
  }
  const id = nanoid();
  try {
    await dbAdapter.writeQueryAsync(
      'INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES ($1,$2,$3,$4,$5)',
      [id, fieldId, fromRecordId, toRecordId, now()]
    );
  } catch (e) {
    return res.status(400).json({ error: 'link already exists or invalid' });
  }
  await audit(b.base_id, req.user.id, 'link.create', { fieldId, fromRecordId, toRecordId });
  broadcast(b.base_id, 'link:add', { id, fieldId, fromRecordId, toRecordId });
  try { await recomputeLookupSnapshots(fromRecordId, fieldId, b.base_id, req.user.id); } catch (e) { /* best-effort */ }
  try { await syncOrderProductDefaults(fromRecordId, toRecordId, fieldId, b.base_id, req.user.id); } catch (e) { /* best-effort */ }
  res.json({ id });
}));

router.delete('/api/links/:id', authRequired, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const link = await dbAdapter.queryOneAsync('SELECT * FROM links WHERE id=$1', [id]);
  if (!link) return res.status(404).json({ error: 'not found' });
  const b = await baseOfField(link.field_id);
  if (!b || !(await isMember(b.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canEditData(b.base_id, req.user.id))) return res.status(403).json({ error: 'viewer cannot edit links' });
  if (await businessLockCoreProtected(link.from_record_id, link.field_id)) return res.status(423).json({ error: '业务锁定核心字段已审批保护' });
  const fromRecord = await dbAdapter.queryOneAsync('SELECT locked FROM records WHERE id=$1', [link.from_record_id]);
  if (fromRecord?.locked) return res.status(423).json({ error: 'record sealed' });
  await dbAdapter.writeQueryAsync('DELETE FROM links WHERE id=$1', [id]);
  await audit(b.base_id, req.user.id, 'link.delete', { id });
  broadcast(b.base_id, 'link:delete', { id, fieldId: link.field_id });
  try { await recomputeLookupSnapshots(link.from_record_id, link.field_id, b.base_id, req.user.id); } catch (e) { /* best-effort */ }
  res.json({ ok: true });
}));



  return router;
};

// ============================================================
// 导出异步函数
// ============================================================
module.exports.createLinkAsync = createLinkAsync;
module.exports.deleteLinkAsync = deleteLinkAsync;
