// V0.3：从 server.js 拆出的表格通用路由模块
const express = require('express');
const { nanoid } = require('nanoid');
const { asyncHandler } = require('../utils');
const { validate } = require('../../app/validate');
const { executeButtonSchema } = require('../../app/validators');
const dbAdapter = require('../../services/dbAdapter');
const { parseOptions } = require('../../services/helpers');

// ============================================================
// 异步版本的核心业务逻辑函数（使用 PG 风格 $1,$2... 占位符）
// ============================================================

/**
 * 撤单审批通过后，自动在"财务红冲处理区"创建红冲任务记录（异步版本）
 * @param {string} baseId
 * @param {string} orderId
 * @param {string} cancelRecordId
 * @param {string} userId
 * @param {number} ts
 * @param {object} opts - { fieldsMapFn, upsertCellFn }
 * @returns {string[]} 创建的红冲任务记录 ID 列表
 */
// 预加载明细 cells 到内存 Map（复用 commissionJob 模式）
async function preloadCellMapForRecords(recordIds) {
  if (!recordIds.length) return new Map();
  const placeholders = recordIds.map((_, i) => `$${i + 1}`).join(',');
  const rows = await dbAdapter.queryAsync(
    `SELECT record_id, field_id, value FROM cells WHERE record_id IN (${placeholders})`,
    recordIds
  );
  const map = new Map();
  for (const r of rows) {
    map.set(`${r.record_id}:${r.field_id}`, r.value || '');
  }
  return map;
}
function cellVal(cellMap, recordId, fieldId) {
  if (!fieldId) return '';
  return cellMap.get(`${recordId}:${fieldId}`) || '';
}

async function createAutoReversalTasksAsync(baseId, orderId, cancelRecordId, userId, ts, opts = {}) {
  const { fieldsMapFn, upsertCellFn } = opts;
  const createdIds = [];
  const reversalTable = await dbAdapter.queryOneAsync(
    "SELECT * FROM tables WHERE base_id=$1 AND name='财务红冲处理区'",
    [baseId]
  );
  if (!reversalTable) return createdIds;
  const rf = fieldsMapFn ? fieldsMapFn(reversalTable.id) : {};

  const arTable = await dbAdapter.queryOneAsync(
    "SELECT * FROM tables WHERE base_id=$1 AND name='应收结算明细区'",
    [baseId]
  );
  const apTable = await dbAdapter.queryOneAsync(
    "SELECT * FROM tables WHERE base_id=$1 AND name='应付结算明细区'",
    [baseId]
  );

  // 查找订单关联的应收明细
  if (arTable) {
    const arFields = fieldsMapFn ? fieldsMapFn(arTable.id) : {};
    const orderLinkFieldId = arFields['来源订单']?.id;
    if (orderLinkFieldId) {
      const details = await dbAdapter.queryAsync(
        'SELECT r.id FROM records r JOIN links l ON l.from_record_id=r.id WHERE l.field_id=$1 AND l.to_record_id=$2',
        [orderLinkFieldId, orderId]
      );
      // P2-1: N+1 优化 — 预加载所有明细 cells
      const arCellMap = await preloadCellMapForRecords(details.map(d => d.id));
      for (const detail of details) {
        const detailStatus = cellVal(arCellMap, detail.id, arFields['明细状态']?.id);
        if (detailStatus === '已红冲' || detailStatus === '红冲明细') continue;
        const amount = Number(cellVal(arCellMap, detail.id, arFields['应收金额']?.id) || 0);
        if (amount <= 0) continue;

        const rid = nanoid();
        // P2-2: position 竞争 — 用时间戳替代 COUNT，避免并发重复
        const position = ts;
        await dbAdapter.writeQueryAsync(
          'INSERT INTO records (id,table_id,position,locked,created_at,updated_at) VALUES ($1,$2,$3,0,$4,$5)',
          [rid, reversalTable.id, position, ts, ts]
        );
        if (upsertCellFn) {
          await upsertCellFn(rid, rf['红冲来源']?.id, '订单撤单', userId, ts);
          await upsertCellFn(rid, rf['红冲对象类型']?.id, '应收明细', userId, ts);
          await upsertCellFn(rid, rf['原应收明细']?.id, '', userId, ts);
        }
        await dbAdapter.writeQueryAsync(
          'INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES ($1,$2,$3,$4,$5)',
          [nanoid(), rf['原应收明细']?.id, rid, detail.id, ts]
        );
        if (upsertCellFn) {
          await upsertCellFn(rid, rf['红冲方向']?.id, '冲回应收', userId, ts);
          await upsertCellFn(rid, rf['红冲金额']?.id, String(amount), userId, ts);
          await upsertCellFn(rid, rf['红冲原因']?.id, '撤单', userId, ts);
          await upsertCellFn(rid, rf['红冲状态']?.id, '待审核', userId, ts);
          await upsertCellFn(rid, rf['处理结果']?.id, `自动生成（撤单 ${cancelRecordId}）`, userId, ts);
        }
        createdIds.push(rid);
      }
    }
  }

  // 查找订单关联的应付明细
  if (apTable) {
    const apFields = fieldsMapFn ? fieldsMapFn(apTable.id) : {};
    const orderLinkFieldId = apFields['来源订单']?.id;
    if (orderLinkFieldId) {
      const details = await dbAdapter.queryAsync(
        'SELECT r.id FROM records r JOIN links l ON l.from_record_id=r.id WHERE l.field_id=$1 AND l.to_record_id=$2',
        [orderLinkFieldId, orderId]
      );
      // P2-1: N+1 优化 — 预加载所有明细 cells
      const apCellMap = await preloadCellMapForRecords(details.map(d => d.id));
      for (const detail of details) {
        const detailStatus = cellVal(apCellMap, detail.id, apFields['明细状态']?.id);
        if (detailStatus === '已红冲' || detailStatus === '红冲明细') continue;
        const amount = Number(cellVal(apCellMap, detail.id, apFields['应付金额']?.id) || 0);
        if (amount <= 0) continue;

        const rid = nanoid();
        // P2-2: position 竞争 — 用时间戳替代 COUNT，避免并发重复
        const position = ts;
        await dbAdapter.writeQueryAsync(
          'INSERT INTO records (id,table_id,position,locked,created_at,updated_at) VALUES ($1,$2,$3,0,$4,$5)',
          [rid, reversalTable.id, position, ts, ts]
        );
        if (upsertCellFn) {
          await upsertCellFn(rid, rf['红冲来源']?.id, '订单撤单', userId, ts);
          await upsertCellFn(rid, rf['红冲对象类型']?.id, '应付明细', userId, ts);
          await upsertCellFn(rid, rf['原应付明细']?.id, '', userId, ts);
        }
        await dbAdapter.writeQueryAsync(
          'INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES ($1,$2,$3,$4,$5)',
          [nanoid(), rf['原应付明细']?.id, rid, detail.id, ts]
        );
        if (upsertCellFn) {
          await upsertCellFn(rid, rf['红冲方向']?.id, '冲回应付', userId, ts);
          await upsertCellFn(rid, rf['红冲金额']?.id, String(amount), userId, ts);
          await upsertCellFn(rid, rf['红冲原因']?.id, '撤单', userId, ts);
          await upsertCellFn(rid, rf['红冲状态']?.id, '待审核', userId, ts);
          await upsertCellFn(rid, rf['处理结果']?.id, `自动生成（撤单 ${cancelRecordId}）`, userId, ts);
        }
        createdIds.push(rid);
      }
    }
  }

  return createdIds;
}

/**
 * 执行按钮操作（异步版本）
 * @param {string} fieldId
 * @param {string} recordId
 * @param {object} opts - { userId, baseId, tableId, fieldsMapFn, upsertCellFn, fieldIdByNameFn, firstLinkedRecordIdFn }
 * @returns {object} 执行结果
 */
async function executeButtonAsync(fieldId, recordId, opts = {}) {
  const { userId, baseId, tableId } = opts;
  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f || f.type !== 'button') throw new Error('not a button field');

  const options = parseOptions(f) || {};
  const action = options.action || 'seal_record';
  const ts = Date.now();

  if (action === 'approve_resource') {
    const fields = await dbAdapter.queryAsync('SELECT * FROM fields WHERE table_id=$1', [f.table_id]);
    const statusField = fields.find(x => x.name === '审批状态');
    const usableField = fields.find(x => x.name === '数据可使用');
    const todoField = fields.find(x => x.name === '待办');
    const groupField = fields.find(x => x.name === '建群对接');

    await dbAdapter.transactionAsync(async () => {
      if (statusField) {
        await dbAdapter.writeQueryAsync(`
          INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
        `, [recordId, statusField.id, '已通过', ts, userId]);
      }
      if (usableField) {
        await dbAdapter.writeQueryAsync(`
          INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
        `, [recordId, usableField.id, 'true', ts, userId]);
      }
      if (todoField) {
        await dbAdapter.writeQueryAsync(`
          INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
        `, [recordId, todoField.id, '已完成', ts, userId]);
      }
      if (groupField) {
        await dbAdapter.writeQueryAsync(`
          INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
        `, [recordId, groupField.id, '已正常对接', ts, userId]);
      }
      await dbAdapter.writeQueryAsync(
        'UPDATE records SET locked=$1, updated_at=$2 WHERE id=$3',
        [1, ts, recordId]
      );
    });

    return { ok: true, action, locked: true };
  }

  if (action === 'approve_business_lock') {
    const fields = await dbAdapter.queryAsync('SELECT * FROM fields WHERE table_id=$1', [f.table_id]);
    const judgeField = fields.find(x => x.name === '判断');
    const approvalField = fields.find(x => x.name === '审批结果');

    if (judgeField) {
      await dbAdapter.writeQueryAsync(`
        INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
      `, [recordId, judgeField.id, '关联', ts, userId]);
    }
    if (approvalField) {
      await dbAdapter.writeQueryAsync(`
        INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
      `, [recordId, approvalField.id, '已通过', ts, userId]);
    }
    await dbAdapter.writeQueryAsync(
      'UPDATE records SET updated_at=$1 WHERE id=$2',
      [ts, recordId]
    );

    return { ok: true, action, locked: false };
  }

  if (action === 'approve_order_refund' || action === 'approve_order_cancel') {
    const fields = opts.fieldsMapFn ? opts.fieldsMapFn(f.table_id) : {};
    const orderId = opts.firstLinkedRecordIdFn ? opts.firstLinkedRecordIdFn(recordId, fields['原订单']?.id) : null;

    let autoReversalIds = [];
    await dbAdapter.transactionAsync(async () => {
      if (opts.upsertCellFn) {
        await opts.upsertCellFn(
          recordId,
          fields[action === 'approve_order_refund' ? '退款状态' : '撤单状态']?.id,
          '已通过', userId, ts
        );
        await opts.upsertCellFn(recordId, fields['需要财务红冲']?.id, 'true', userId, ts);
      }

      if (action === 'approve_order_cancel' && orderId) {
        const orderRecord = await dbAdapter.queryOneAsync(
          'SELECT table_id FROM records WHERE id=$1',
          [orderId]
        );
        const orderTableId = orderRecord?.table_id;
        const orderStatusFieldId = opts.fieldIdByNameFn ? await opts.fieldIdByNameFn(orderTableId, '订单状态') : null;
        if (orderStatusFieldId && opts.upsertCellFn) {
          await opts.upsertCellFn(orderId, orderStatusFieldId, '已取消', userId, ts);
        }

        // 自动创建红冲任务记录
        autoReversalIds = await createAutoReversalTasksAsync(baseId, orderId, recordId, userId, ts, {
          fieldsMapFn: opts.fieldsMapFn,
          upsertCellFn: opts.upsertCellFn,
        });

        const resultMsg = autoReversalIds.length > 0
          ? `订单已取消；已自动生成 ${autoReversalIds.length} 条红冲任务（待审核）。`
          : '订单已取消；未找到需红冲的结算明细。';
        if (opts.upsertCellFn) {
          await opts.upsertCellFn(recordId, fields['处理结果']?.id, resultMsg, userId, ts);
        }
      }

      await dbAdapter.writeQueryAsync(
        'UPDATE records SET updated_at=$1 WHERE id=$2',
        [ts, recordId]
      );
    });

    return { ok: true, action, needFinanceReversal: true, autoReversalIds };
  }

  // 默认：seal_record / unseal_record
  const locked = action === 'unseal_record' ? 0 : 1;
  await dbAdapter.writeQueryAsync(
    'UPDATE records SET locked=$1, updated_at=$2 WHERE id=$3',
    [locked, ts, recordId]
  );

  return { ok: true, action, locked: !!locked };
}

// ============================================================
// 路由注册（仅异步版本）
// ============================================================

module.exports = function registerGridButtonRoutes(ctx) {
  const router = express.Router();
  const {
    nanoid,
    now,
    authRequired,
    baseOfRecord,
    isMember,
    canEditData,
    canSealRecord,
    canApprove,
    canRunJobs,
    audit,
    broadcast,
    businessLockCoreProtected,
    businessLockHasProduct,
    cellValueByName,
    fieldsMap,
    firstLinkedRecordId,
    assertRecordWritable,
    upsertCell,
    fieldIdByName,
    approveInventoryOperation,
    sealFinanceRecord,
    approveFinanceReversal,
  } = ctx;

router.post('/api/buttons/execute', authRequired, validate(executeButtonSchema), asyncHandler(async (req, res) => {
  const { fieldId, recordId, action: reqAction } = req.body || {};
  const b = await baseOfRecord(recordId);
  if (!b || !(await isMember(b.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canEditData(b.base_id, req.user.id))) return res.status(403).json({ error: 'viewer cannot execute buttons' });
  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f || f.type !== 'button') return res.status(400).json({ error: 'not a button field' });
  const options = parseOptions(f) || {};
  // 优先使用前端传来的 action（支持封账→解封切换），否则用字段配置的 action
  const action = reqAction || options.action || 'seal_record';
  if (action === 'approve_resource') {
    if (!(await canApprove(b.base_id, req.user.id))) return res.status(403).json({ error: 'only approver/admin/owner can approve' });
    const fields = await dbAdapter.queryAsync('SELECT * FROM fields WHERE table_id=$1', [f.table_id]);
    const statusField = fields.find(x => x.name === '审批状态');
    const usableField = fields.find(x => x.name === '数据可使用');
    const todoField = fields.find(x => x.name === '待办');
    const groupField = fields.find(x => x.name === '建群对接');
    const ts = now();
    await dbAdapter.transactionAsync(async () => {
      if (statusField) await dbAdapter.writeQueryAsync(`
        INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
      `, [recordId, statusField.id, '已通过', ts, req.user.id]);
      if (usableField) await dbAdapter.writeQueryAsync(`
        INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
      `, [recordId, usableField.id, 'true', ts, req.user.id]);
      if (todoField) await dbAdapter.writeQueryAsync(`
        INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
      `, [recordId, todoField.id, '已完成', ts, req.user.id]);
      if (groupField) await dbAdapter.writeQueryAsync(`
        INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
      `, [recordId, groupField.id, '已正常对接', ts, req.user.id]);
      await dbAdapter.writeQueryAsync('UPDATE records SET locked=$1, updated_at=$2 WHERE id=$3', [1, ts, recordId]);
    });
    await audit(b.base_id, req.user.id, 'button.execute', { fieldId, recordId, action });
    broadcast(b.base_id, 'record:update', { recordId, locked: true, updatedAt: ts });
    return res.json({ ok: true, action, locked: true });
  }
  if (action === 'approve_business_lock') {
    if (!(await canApprove(b.base_id, req.user.id))) return res.status(403).json({ error: 'only approver/admin/owner can approve' });
    const fields = await dbAdapter.queryAsync('SELECT * FROM fields WHERE table_id=$1', [f.table_id]);
    const judgeField = fields.find(x => x.name === '判断');
    const approvalField = fields.find(x => x.name === '审批结果');
    const groupValue = await cellValueByName(recordId, f.table_id, '分组');
    if (groupValue === '单品合作区' && !await businessLockHasProduct(recordId, f.table_id)) {
      return res.status(400).json({ error: '单品合作区必须先选择商品，才能审批通过' });
    }
    const ts = now();
    if (judgeField) await dbAdapter.writeQueryAsync(`
      INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
    `, [recordId, judgeField.id, '关联', ts, req.user.id]);
    if (approvalField) await dbAdapter.writeQueryAsync(`
      INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
    `, [recordId, approvalField.id, '已通过', ts, req.user.id]);
    await dbAdapter.writeQueryAsync('UPDATE records SET updated_at=$1 WHERE id=$2', [ts, recordId]);
    await audit(b.base_id, req.user.id, 'button.execute', { fieldId, recordId, action });
    broadcast(b.base_id, 'record:update', { recordId, locked: false, updatedAt: ts });
    return res.json({ ok: true, action, locked: false });
  }
  if (action === 'approve_inventory_operation') {
    if (!(await canApprove(b.base_id, req.user.id))) return res.status(403).json({ error: 'only approver/admin/owner can approve' });
    try {
      const result = await approveInventoryOperation(recordId, f.table_id, b.base_id, req.user.id);
      await audit(b.base_id, req.user.id, 'button.execute', { fieldId, recordId, action, result });
      broadcast(b.base_id, 'record:update', { recordId, locked: false, updatedAt: now() });
      return res.json(result);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  if (action === 'seal_finance_record') {
    if (!(await canRunJobs(b.base_id, req.user.id))) return res.status(403).json({ error: 'only owner/admin/finance can seal finance records' });
    try {
      const result = await sealFinanceRecord(recordId, f.table_id, req.user.id);
      await audit(b.base_id, req.user.id, 'button.execute', { fieldId, recordId, action, result });
      broadcast(b.base_id, 'record:update', { recordId, locked: true, updatedAt: now() });
      return res.json(result);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  if (action === 'approve_finance_reversal') {
    if (!(await canApprove(b.base_id, req.user.id))) return res.status(403).json({ error: 'only approver/admin/owner can approve finance reversal' });
    try {
      const result = await approveFinanceReversal(recordId, f.table_id, b.base_id, req.user.id);
      await audit(b.base_id, req.user.id, 'button.execute', { fieldId, recordId, action, result });
      broadcast(b.base_id, 'record:update', { recordId, locked: true, updatedAt: now() });
      return res.json(result);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  if (action === 'approve_order_refund' || action === 'approve_order_cancel') {
    if (!(await canApprove(b.base_id, req.user.id))) return res.status(403).json({ error: 'only approver/admin/owner can approve' });
    try {
      await assertRecordWritable(recordId, '退款/撤单申请已封账，不能重复审批或修改');
      const fields = await fieldsMap(f.table_id);
      const ts = now();
      const orderId = await firstLinkedRecordId(recordId, fields['原订单']?.id);
      if (orderId) {
        await assertRecordWritable(orderId, '原订单已封账，不能通过审批修改订单状态；请走财务红冲');
      }
      let autoReversalIds = [];
      await dbAdapter.transactionAsync(async () => {
        await upsertCell(null, recordId, fields[action === 'approve_order_refund' ? '退款状态' : '撤单状态']?.id, '已通过', req.user.id, ts);
        await upsertCell(null, recordId, fields['需要财务红冲']?.id, 'true', req.user.id, ts);
        if (action === 'approve_order_cancel' && orderId) {
          const orderRecord = await dbAdapter.queryOneAsync('SELECT table_id FROM records WHERE id=$1', [orderId]);
          const orderTableId = orderRecord?.table_id;
          await upsertCell(null, orderId, await fieldIdByName(orderTableId, '订单状态'), '已取消', req.user.id, ts);
          // 自动创建红冲任务记录
          autoReversalIds = await createAutoReversalTasksAsync(b.base_id, orderId, recordId, req.user.id, ts, {
            fieldsMapFn: fieldsMap,
            upsertCellFn: upsertCell,
          });
          const resultMsg = autoReversalIds.length > 0
            ? `订单已取消；已自动生成 ${autoReversalIds.length} 条红冲任务（待审核）。`
            : '订单已取消；未找到需红冲的结算明细。';
          await upsertCell(null, recordId, fields['处理结果']?.id, resultMsg, req.user.id, ts);
        }
        await dbAdapter.writeQueryAsync('UPDATE records SET updated_at=$1 WHERE id=$2', [ts, recordId]);
      });
      await audit(b.base_id, req.user.id, 'button.execute', { fieldId, recordId, action, autoReversalIds });
      broadcast(b.base_id, 'record:update', { recordId, locked: false, updatedAt: ts });
      return res.json({ ok: true, action, needFinanceReversal: true, autoReversalIds });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  const locked = action === 'unseal_record' ? 0 : 1;
  if (!(await canSealRecord(b.base_id, req.user.id, !!locked))) return res.status(403).json({ error: locked ? 'no permission to seal record' : 'only owner/admin can unseal record' });
  const ts = now();
  await dbAdapter.writeQueryAsync('UPDATE records SET locked=$1, updated_at=$2 WHERE id=$3', [locked, ts, recordId]);
  await audit(b.base_id, req.user.id, 'button.execute', { fieldId, recordId, action });
  broadcast(b.base_id, 'record:update', { recordId, locked: !!locked, updatedAt: ts });
  res.json({ ok: true, action, locked: !!locked });
}));



  return router;
};

// ============================================================
// 导出异步函数
// ============================================================
module.exports.createAutoReversalTasksAsync = createAutoReversalTasksAsync;
module.exports.executeButtonAsync = executeButtonAsync;
