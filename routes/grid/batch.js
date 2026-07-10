// V0.3：从 server.js 拆出的表格通用路由模块
const express = require('express');
const { nanoid } = require('nanoid');
const { asyncHandler } = require('../utils');
const { validate } = require('../../app/validate');
const { batchUpdateSchema } = require('../../app/validators');
const dbAdapter = require('../../services/dbAdapter');

// ============================================================
// 异步版本的核心业务逻辑函数（使用 PG 风格 $1,$2... 占位符）
// ============================================================

/**
 * 批量更新单元格（异步版本）
 * @param {Array} operations - [{ type, recordId, fieldId, value }]
 * @param {object} opts - { userId, userEmail, baseIdFn, isMemberFn, canEditDataFn,
 *                          businessLockCoreProtectedFn, orderCompletionFieldProtectedFn,
 *                          selectLabelsFromOptionsFn }
 * @returns {object} { ok: true, count }
 */
async function batchUpdateCellsAsync(operations, opts = {}) {
  const {
    userId,
    userEmail,
    baseIdFn,
    isMemberFn,
    canEditDataFn,
    businessLockCoreProtectedFn,
    orderCompletionFieldProtectedFn,
    selectLabelsFromOptionsFn,
  } = opts;

  const touchedBases = new Set();

  await dbAdapter.transactionAsync(async () => {
    for (const op of operations) {
      if (op.type !== 'cell.update') throw new Error('unsupported operation');

      const b = baseIdFn ? baseIdFn(op.recordId) : null;
      if (!b) throw new Error('forbidden');

      const r = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [op.recordId]);
      if (!r) throw new Error('record not found');
      if (r.locked) throw new Error('record sealed');

      const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [op.fieldId]);
      if (!f || f.table_id !== r.table_id) throw new Error('field not writable');

      let val = op.value == null ? null : String(op.value);
      const ts = Date.now();

      const oldCell = await dbAdapter.queryOneAsync(
        'SELECT value FROM cells WHERE record_id=$1 AND field_id=$2',
        [op.recordId, op.fieldId]
      );
      const oldValue = oldCell?.value ?? null;

      await dbAdapter.writeQueryAsync(`
        INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
      `, [op.recordId, op.fieldId, val, ts, userId]);

      await dbAdapter.writeQueryAsync(
        'UPDATE records SET updated_at=$1 WHERE id=$2',
        [ts, op.recordId]
      );

      await dbAdapter.writeQueryAsync(`
        INSERT INTO audit_log (id,base_id,table_id,record_id,field_id,old_value,new_value,action,user_id,user_email,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [nanoid(), b.base_id, r.table_id, op.recordId, op.fieldId, oldValue, val, 'cell.update', userId, userEmail, ts]);

      touchedBases.add(b.base_id);
    }
  });

  return { ok: true, count: operations.length, touchedBases: [...touchedBases] };
}

// ============================================================
// 路由注册（仅异步版本）
// ============================================================

module.exports = function registerGridBatchRoutes(ctx) {
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
  } = ctx;

router.post('/api/batch', authRequired, validate(batchUpdateSchema), asyncHandler(async (req, res) => {
  const { updates } = req.body || {};
  const operations = updates;
  if (!Array.isArray(operations) || operations.length > 500) return res.status(400).json({ error: 'operations must be 1-500 items' });
  const touchedBases = new Set();
  try {
    await dbAdapter.transactionAsync(async () => {
      for (const op of operations) {
        if (op.type !== 'cell.update') throw new Error('unsupported operation');
        const b = await baseOfRecord(op.recordId);
        if (!b || !(await isMember(b.base_id, req.user.id))) throw new Error('forbidden');
        if (!(await canEditData(b.base_id, req.user.id))) throw new Error('viewer cannot batch update');
        const r = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [op.recordId]);
        if (!r) throw new Error('record not found');
        if (r.locked) throw new Error('record sealed');
        const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [op.fieldId]);
        if (!f || f.table_id !== r.table_id || f.locked || READONLY_FIELD_TYPES.has(f.type)) throw new Error('field not writable');
        if (await businessLockCoreProtected(op.recordId, op.fieldId)) throw new Error('业务锁定核心字段已审批保护');
        if (await orderCompletionFieldProtected(op.recordId, op.fieldId)) throw new Error('订单完结日期已锁定');
        let val = op.value == null ? null : String(op.value);
        if (f.type === 'select' && val) {
          const values = selectLabelsFromOptions(f.options);
          if (!values.includes(val)) throw new Error('value not in select options');
        }
        if ((f.type === 'number' || f.type === 'currency') && val !== null && val !== '') {
          const n = Number(val);
          if (!Number.isFinite(n)) throw new Error('number required');
          val = String(n);
        }
        if (f.type === 'checkbox') val = (op.value === true || op.value === 'true' || op.value === '1' || op.value === 1) ? 'true' : 'false';
        const ts = now();
        const oldCell = await dbAdapter.queryOneAsync('SELECT value, version FROM cells WHERE record_id=$1 AND field_id=$2', [op.recordId, op.fieldId]);
        const oldValue = oldCell?.value ?? null;
        // 乐观锁：请求携带 version 时校验版本
        if (op.version != null && oldCell && oldCell.version !== op.version) {
          const err = new Error('version conflict');
          err.code = 409;
          err.details = { currentValue: oldValue, currentVersion: oldCell.version, recordId: op.recordId, fieldId: op.fieldId };
          throw err;
        }
        const nextVersion = (oldCell?.version || 0) + 1;
        await dbAdapter.writeQueryAsync(`
          INSERT INTO cells (record_id,field_id,value,updated_at,updated_by,version) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by, version=excluded.version
        `, [op.recordId, op.fieldId, val, ts, req.user.id, nextVersion]);
        await dbAdapter.writeQueryAsync('UPDATE records SET updated_at=$1 WHERE id=$2', [ts, op.recordId]);
        await dbAdapter.writeQueryAsync(`
          INSERT INTO audit_log (id,base_id,table_id,record_id,field_id,old_value,new_value,action,user_id,user_email,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [nanoid(), b.base_id, r.table_id, op.recordId, op.fieldId, oldValue, val, 'cell.update', req.user.id, req.user.email, ts]);
        touchedBases.add(b.base_id);
      }
    });
  } catch (e) {
    if (e.code === 409) {
      return res.status(409).json({ error: 'version conflict', message: '批量写入中存在版本冲突', conflicts: [e.details] });
    }
    return res.status(400).json({ error: e.message });
  }
  for (const baseId of touchedBases) await audit(baseId, req.user.id, 'batch.execute', { count: operations.length });
  res.json({ ok: true, count: operations.length });
}));



  return router;
};

// ============================================================
// 导出异步函数
// ============================================================
module.exports.batchUpdateCellsAsync = batchUpdateCellsAsync;
