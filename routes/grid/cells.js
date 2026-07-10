// V0.3：从 server.js 拆出的表格通用路由模块
const express = require('express');
const { nanoid } = require('nanoid');
const { asyncHandler } = require('../utils');
const { validate } = require('../../app/validate');
const { updateCellSchema } = require('../../app/validators');
const dbAdapter = require('../../services/dbAdapter');

// ============================================================
// 异步版本的核心业务逻辑函数（使用 PG 风格 $1,$2... 占位符）
// ============================================================

/**
 * 更新单元格值（异步版本）
 * @param {string} recordId
 * @param {string} fieldId
 * @param {string|null} value
 * @param {object} opts - { userId, userEmail, baseId, tableId }
 * @returns {object} { value, updatedAt }
 */
async function updateCellAsync(recordId, fieldId, value, opts = {}) {
  const { userId, userEmail, baseId, tableId } = opts;
  const r = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [recordId]);
  if (!r) throw new Error('record not found');
  if (r.locked) throw new Error('record sealed');

  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f || f.table_id !== r.table_id) throw new Error('field not found');

  let valStr = value == null ? null : String(value);
  const ts = Date.now();

  await dbAdapter.transactionAsync(async () => {
    const oldCell = await dbAdapter.queryOneAsync(
      'SELECT value FROM cells WHERE record_id=$1 AND field_id=$2',
      [recordId, fieldId]
    );

    await dbAdapter.writeQueryAsync(`
      INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
    `, [recordId, fieldId, valStr, ts, userId]);

    await dbAdapter.writeQueryAsync(
      'UPDATE records SET updated_at=$1 WHERE id=$2',
      [ts, recordId]
    );

    await dbAdapter.writeQueryAsync(`
      INSERT INTO audit_log (id,base_id,table_id,record_id,field_id,old_value,new_value,action,user_id,user_email,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [nanoid(), baseId, r.table_id, recordId, fieldId, oldCell?.value ?? null, valStr, 'cell.update', userId, userEmail, ts]);
  });

  return { recordId, fieldId, value: valStr, updatedAt: ts, updatedBy: userId };
}

/**
 * 更新单元格样式（异步版本）
 * @param {string} recordId
 * @param {string} fieldId
 * @param {object} style
 * @param {object} opts - { userId }
 * @returns {object} { styleJson, updatedAt }
 */
async function updateCellStyleAsync(recordId, fieldId, style, opts = {}) {
  const { userId } = opts;
  const r = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [recordId]);
  if (!r) throw new Error('record not found');

  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f || f.table_id !== r.table_id) throw new Error('field not found');

  const styleJson = Object.keys(style).length ? JSON.stringify(style) : null;
  const ts = Date.now();

  await dbAdapter.transactionAsync(async () => {
    const current = await dbAdapter.queryOneAsync(
      'SELECT value FROM cells WHERE record_id=$1 AND field_id=$2',
      [recordId, fieldId]
    );

    await dbAdapter.writeQueryAsync(`
      INSERT INTO cells (record_id,field_id,value,style_json,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(record_id,field_id) DO UPDATE SET style_json=excluded.style_json, updated_at=excluded.updated_at, updated_by=excluded.updated_by
    `, [recordId, fieldId, current?.value ?? null, styleJson, ts, userId]);

    await dbAdapter.writeQueryAsync(
      'UPDATE records SET updated_at=$1 WHERE id=$2',
      [ts, recordId]
    );
  });

  return { recordId, fieldId, styleJson, updatedAt: ts };
}

// ============================================================
// 路由注册（仅异步版本）
// ============================================================

module.exports = function registerGridCellRoutes(ctx) {
  const router = express.Router();
  const {
    nanoid,
    now,
    authRequired,
    baseOfRecord,
    isMember,
    canEditData,
    audit,
    broadcast,
    READONLY_FIELD_TYPES,
    businessLockCoreProtected,
    orderCompletionFieldProtected,
    selectLabelsFromOptions,
    normalizeCellStyle,
  } = ctx;

// -------- cells --------
router.put('/api/records/:recordId/cells/:fieldId', authRequired, validate(updateCellSchema), asyncHandler(async (req, res) => {
  const { recordId, fieldId } = req.params;
  const b = await baseOfRecord(recordId);
  if (!b || !(await isMember(b.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canEditData(b.base_id, req.user.id))) return res.status(403).json({ error: 'viewer cannot edit cells' });
  const r = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [recordId]);
  if (!r) return res.status(404).json({ error: 'record not found' });
  if (r.locked) return res.status(423).json({ error: 'record sealed' });
  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f || f.table_id !== r.table_id) return res.status(404).json({ error: 'field not found' });
  if (await businessLockCoreProtected(recordId, fieldId)) return res.status(423).json({ error: '业务锁定核心字段已审批保护' });
  if (await orderCompletionFieldProtected(recordId, fieldId)) return res.status(423).json({ error: '订单完结日期已锁定' });
  if (f.locked) return res.status(423).json({ error: 'field locked' });
  if (READONLY_FIELD_TYPES.has(f.type)) return res.status(400).json({ error: `${f.type} cells are read-only` });
  const { value, version } = req.body || {};
  let valStr = value == null ? null : String(value);
  if (f.type === 'select' && valStr) {
    const values = selectLabelsFromOptions(f.options);
    if (!values.includes(valStr)) return res.status(400).json({ error: 'value not in select options' });
  }
  if ((f.type === 'number' || f.type === 'currency') && valStr !== null && valStr !== '') {
    const n = Number(valStr);
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'number required' });
    valStr = String(n);
  }
  if (f.type === 'checkbox') valStr = (value === true || value === 'true' || value === '1' || value === 1) ? 'true' : 'false';
  // version=0 视为参数错误（应不传或不为 0）
  if (version === 0) return res.status(400).json({ error: 'version must be positive or omitted' });
  const ts = now();
  let newVersion = 1;
  // P1-1: 版本检查在事务外，避免 409 后仍执行 audit/broadcast
  const oldCell = await dbAdapter.queryOneAsync('SELECT value, version FROM cells WHERE record_id=$1 AND field_id=$2', [recordId, fieldId]);
  if (version != null && oldCell && oldCell.version !== version) {
    return res.status(409).json({
      error: 'version conflict',
      message: '该单元格已被其他人修改',
      currentValue: oldCell.value,
      currentVersion: oldCell.version,
      fieldId,
      recordId
    });
  }
  newVersion = (oldCell?.version || 0) + 1;
  const oldValue = oldCell?.value ?? null;
  await dbAdapter.transactionAsync(async () => {
    await dbAdapter.writeQueryAsync(`
      INSERT INTO cells (record_id,field_id,value,updated_at,updated_by,version) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by, version=excluded.version
    `, [recordId, fieldId, valStr, ts, req.user.id, newVersion]);
    await dbAdapter.writeQueryAsync('UPDATE records SET updated_at=$1 WHERE id=$2', [ts, recordId]);
    await dbAdapter.writeQueryAsync(`
      INSERT INTO audit_log (id,base_id,table_id,record_id,field_id,old_value,new_value,action,user_id,user_email,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [nanoid(), b.base_id, r.table_id, recordId, fieldId, oldValue, valStr, 'cell.update', req.user.id, req.user.email, ts]);
  });
  await audit(b.base_id, req.user.id, 'cell.update', { recordId, fieldId, value: valStr });
  broadcast(b.base_id, 'cell:update', { recordId, fieldId, value: valStr, updatedAt: ts, updatedBy: req.user.id, version: newVersion });

  // 更新 lastModifiedTime 字段：检查该表格的 lastModifiedTime 字段监控范围
  try {
    const timeFields = await dbAdapter.queryAsync(
      "SELECT id, options FROM fields WHERE table_id=$1 AND type='lastModifiedTime'",
      [r.table_id]
    );
    for (const tf of timeFields) {
      let opts = tf.options || {};
      if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch { opts = {}; } }
      const monitor = opts.monitor || 'all'; // 'all' 或 ['fieldId1', 'fieldId2']
      const shouldUpdate = monitor === 'all' || (Array.isArray(monitor) && monitor.includes(fieldId));
      if (shouldUpdate) {
        await dbAdapter.writeQueryAsync(
          'UPDATE records SET updated_at=$1 WHERE id=$2',
          [ts, recordId]
        );
        break; // 只需要更新一次 records.updated_at
      }
    }
  } catch (_e) { /* ignore lastModifiedTime update errors */ }

  // snapshot lookups intentionally do NOT recompute on source-cell change — that's the "lock" semantic.
  // live lookups are computed on the client at render time, so no server work needed either.
  res.json({ ok: true, version: newVersion });
}));

router.patch('/api/records/:recordId/cells/:fieldId/style', authRequired, asyncHandler(async (req, res) => {
  const { recordId, fieldId } = req.params;
  const b = await baseOfRecord(recordId);
  if (!b || !(await isMember(b.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canEditData(b.base_id, req.user.id))) return res.status(403).json({ error: 'viewer cannot format cells' });
  const r = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [recordId]);
  if (!r) return res.status(404).json({ error: 'record not found' });
  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f || f.table_id !== r.table_id) return res.status(404).json({ error: 'field not found' });
  const style = normalizeCellStyle(req.body?.style || {});
  const styleJson = Object.keys(style).length ? JSON.stringify(style) : null;
  const ts = now();
  await dbAdapter.transactionAsync(async () => {
    const current = await dbAdapter.queryOneAsync('SELECT value FROM cells WHERE record_id=$1 AND field_id=$2', [recordId, fieldId]);
    await dbAdapter.writeQueryAsync(`
      INSERT INTO cells (record_id,field_id,value,style_json,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(record_id,field_id) DO UPDATE SET style_json=excluded.style_json, updated_at=excluded.updated_at, updated_by=excluded.updated_by
    `, [recordId, fieldId, current?.value ?? null, styleJson, ts, req.user.id]);
    await dbAdapter.writeQueryAsync('UPDATE records SET updated_at=$1 WHERE id=$2', [ts, recordId]);
  });
  broadcast(b.base_id, 'cell:style', { recordId, fieldId, styleJson, updatedAt: ts });
  res.json({ ok: true });
}));



  return router;
};

// ============================================================
// 导出异步函数
// ============================================================
module.exports.updateCellAsync = updateCellAsync;
module.exports.updateCellStyleAsync = updateCellStyleAsync;
