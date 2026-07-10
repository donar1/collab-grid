// V0.3：从 server.js 拆出的表格通用路由模块
const express = require('express');
const { nanoid } = require('nanoid');
const { asyncHandler } = require('../utils');
const { validate } = require('../../app/validate');
const { createTableSchema, createFieldSchema, updateFieldSchema } = require('../../app/validators');
const dbAdapter = require('../../services/dbAdapter');
const { parseOptions } = require('../../services/helpers');

// ============================================================
// 异步版本的核心业务逻辑函数（使用 PG 风格 $1,$2... 占位符）
// ============================================================

/**
 * 获取表格分页数据（异步版本）
 */
async function getTablePageAsync(tableId, opts = {}) {
  const { offset = 0, limit = 200 } = opts;
  const fields = await dbAdapter.queryAsync(
    'SELECT * FROM fields WHERE table_id=$1 ORDER BY position',
    [tableId]
  );
  const mappedFields = fields.map(f => ({
    ...f,
    locked: !!f.locked,
    options: parseOptions(f),
  }));

  const countRow = await dbAdapter.queryOneAsync(
    'SELECT COUNT(*) AS c FROM records WHERE table_id=$1 AND deleted_at IS NULL',
    [tableId]
  );
  const total = countRow.c;

  const records = await dbAdapter.queryAsync(
    'SELECT * FROM records WHERE table_id=$1 AND deleted_at IS NULL ORDER BY position, created_at LIMIT $2 OFFSET $3',
    [tableId, limit, offset]
  );
  const mappedRecords = records.map(r => ({ ...r, locked: !!r.locked }));

  const recordIds = mappedRecords.map(r => r.id);
  let cells = [];
  let links = [];
  if (recordIds.length) {
    const placeholders = recordIds.map((_, i) => `$${i + 1}`).join(',');
    cells = await dbAdapter.queryAsync(
      `SELECT * FROM cells WHERE record_id IN (${placeholders})`,
      recordIds
    );
    links = await dbAdapter.queryAsync(
      `SELECT * FROM links WHERE from_record_id IN (${placeholders})`,
      recordIds
    );
  }

  return { tableId, records: mappedRecords, cells, links, page: { offset, limit, total }, fields: mappedFields };
}

/**
 * 搜索表格记录（异步版本）
 */
async function searchTableAsync(tableId, opts = {}) {
  const { q = '', displayFieldId = '', limit = 30, offset = 0 } = opts;
  const fields = await dbAdapter.queryAsync(
    'SELECT * FROM fields WHERE table_id=$1 ORDER BY position',
    [tableId]
  );
  const mappedFields = fields.map(f => ({
    ...f,
    locked: !!f.locked,
    options: parseOptions(f),
  }));

  let displayField = displayFieldId
    ? await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1 AND table_id=$2', [displayFieldId, tableId])
    : mappedFields[0];

  let records;
  let total;
  if (!q) {
    const countRow = await dbAdapter.queryOneAsync(
      'SELECT COUNT(*) AS c FROM records WHERE table_id=$1 AND deleted_at IS NULL',
      [tableId]
    );
    total = countRow.c;
    records = await dbAdapter.queryAsync(
      'SELECT * FROM records WHERE table_id=$1 AND deleted_at IS NULL ORDER BY position, created_at LIMIT $2 OFFSET $3',
      [tableId, limit, offset]
    );
  } else {
    const like = `%${q.replace(/[%_]/g, m => '\\' + m)}%`;
    if (displayField) {
      const countRow = await dbAdapter.queryOneAsync(
        `SELECT COUNT(*) AS c FROM records r
         JOIN cells c ON c.record_id=r.id AND c.field_id=$1
         WHERE r.table_id=$2 AND r.deleted_at IS NULL AND c.value LIKE $3 ESCAPE '\\'`,
        [displayField.id, tableId, like]
      );
      total = countRow.c;
      records = await dbAdapter.queryAsync(
        `SELECT r.* FROM records r
         JOIN cells c ON c.record_id=r.id AND c.field_id=$1
         WHERE r.table_id=$2 AND r.deleted_at IS NULL AND c.value LIKE $3 ESCAPE '\\'
         ORDER BY r.position, r.created_at LIMIT $4 OFFSET $5`,
        [displayField.id, tableId, like, limit, offset]
      );
    } else {
      total = 0;
      records = [];
    }
  }

  const mappedRecords = records.map(r => ({ ...r, locked: !!r.locked }));
  const recordIds = mappedRecords.map(r => r.id);
  let cells = [];
  let links = [];
  if (recordIds.length) {
    const placeholders = recordIds.map((_, i) => `$${i + 1}`).join(',');
    cells = await dbAdapter.queryAsync(
      `SELECT * FROM cells WHERE record_id IN (${placeholders})`,
      recordIds
    );
    links = await dbAdapter.queryAsync(
      `SELECT * FROM links WHERE from_record_id IN (${placeholders})`,
      recordIds
    );
  }

  return { tableId, records: mappedRecords, cells, links, fields: mappedFields, page: { offset, limit, total }, q };
}

/**
 * 创建表格（异步版本）
 */
async function createTableAsync(baseId, name, userId, ts) {
  const tableName = (name || '新表').trim();
  const existing = await dbAdapter.queryOneAsync(
    'SELECT 1 FROM tables WHERE base_id=$1 AND name=$2',
    [baseId, tableName]
  );
  if (existing) throw new Error(`table "${tableName}" already exists`);

  const id = nanoid();
  const maxRow = await dbAdapter.queryOneAsync(
    'SELECT MAX(position) AS m FROM tables WHERE base_id=$1',
    [baseId]
  );
  const pos = (maxRow?.m || 0) + 1;

  await dbAdapter.writeQueryAsync(
    'INSERT INTO tables (id,base_id,name,position,created_at) VALUES ($1,$2,$3,$4,$5)',
    [id, baseId, tableName, pos, ts]
  );

  const fid = nanoid();
  await dbAdapter.writeQueryAsync(
    'INSERT INTO fields (id,table_id,name,type,options,locked,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [fid, id, '名称', 'text', null, 0, 0, ts]
  );

  return { id, name: tableName, position: pos };
}

/**
 * 创建字段（异步版本）
 */
async function createFieldAsync(tableId, baseId, name, type, options, ts) {
  const posRow = await dbAdapter.queryOneAsync(
    'SELECT COUNT(*) AS c FROM fields WHERE table_id=$1',
    [tableId]
  );
  const pos = posRow.c;

  const id = nanoid();
  const optionsJson = options ? JSON.stringify(options) : null;

  await dbAdapter.writeQueryAsync(
    'INSERT INTO fields (id,table_id,name,type,options,locked,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, tableId, name || '新字段', type, optionsJson, 0, pos, ts]
  );

  return { id, tableId, name: name || '新字段', type, options, locked: false, position: pos };
}

/**
 * 切换字段锁定状态（异步版本）
 */
async function toggleFieldLockAsync(fieldId, locked) {
  await dbAdapter.writeQueryAsync(
    'UPDATE fields SET locked=$1 WHERE id=$2',
    [locked ? 1 : 0, fieldId]
  );
  return { fieldId, locked: !!locked };
}

/**
 * 更新字段（异步版本）
 */
async function updateFieldAsync(fieldId, updates) {
  const { name, options, width, position } = updates;
  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f) throw new Error('field not found');

  const nextName = name !== undefined ? name : f.name;
  const nextOptions = options !== undefined ? JSON.stringify(options) : f.options;
  const nextWidth = width !== undefined ? width : f.width;
  const nextPosition = position !== undefined ? position : f.position;

  await dbAdapter.writeQueryAsync(
    'UPDATE fields SET name=$1, options=$2, width=$3, position=$4 WHERE id=$5',
    [nextName, nextOptions, nextWidth, nextPosition, fieldId]
  );

  return { fieldId, ...updates };
}

/**
 * 删除字段（异步版本）
 */
async function deleteFieldAsync(fieldId) {
  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f) throw new Error('field not found');
  if (f.locked) throw new Error('field locked');

  await dbAdapter.writeQueryAsync('DELETE FROM fields WHERE id=$1', [fieldId]);
  return { fieldId, name: f.name };
}

// ============================================================
// 路由注册（仅异步版本）
// ============================================================

module.exports = function registerGridTableRoutes(ctx) {
  const router = express.Router();
  const {
    nanoid,
    now,
    authRequired,
    injectComputedCells,
    baseOfTable,
    baseOfField,
    isMember,
    canManageStructure,
    canEditData,
    audit,
    broadcast,
    FIELD_TYPES,
    normalizeFieldOptions,
  } = ctx;

router.get('/api/tables/:tableId/page', authRequired, asyncHandler(async (req, res) => {
  const { tableId } = req.params;
  const t = await baseOfTable(tableId);
  if (!t || !(await isMember(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const offset = Math.max(0, Number.parseInt(req.query.offset || '0', 10) || 0);
  const limit = Math.max(20, Math.min(500, Number.parseInt(req.query.limit || '200', 10) || 200));
  const fields = (await dbAdapter.queryAsync('SELECT * FROM fields WHERE table_id=$1 ORDER BY position', [tableId]))
    .map(f => ({ ...f, locked: !!f.locked, options: parseOptions(f) }));
  const countRow = await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM records WHERE table_id=$1 AND deleted_at IS NULL', [tableId]);
  const total = countRow.c;
  const records = (await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1 AND deleted_at IS NULL ORDER BY position, created_at LIMIT $2 OFFSET $3', [tableId, limit, offset]))
    .map(r => ({ ...r, locked: !!r.locked }));
  const recordIds = records.map(r => r.id);
  let cells = [];
  let links = [];
  if (recordIds.length) {
    const placeholders = recordIds.map((_, i) => `$${i + 1}`).join(',');
    cells = await dbAdapter.queryAsync(`SELECT * FROM cells WHERE record_id IN (${placeholders})`, recordIds);
    links = await dbAdapter.queryAsync(`SELECT * FROM links WHERE from_record_id IN (${placeholders})`, recordIds);
  }
  cells = await injectComputedCells({ id: tableId }, fields, records, cells);
  res.json({ tableId, records, cells, links, page: { offset, limit, total } });
}));

router.get('/api/tables/:tableId/search', authRequired, asyncHandler(async (req, res) => {
  const { tableId } = req.params;
  const t = await baseOfTable(tableId);
  if (!t || !(await isMember(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  const q = String(req.query.q || '').trim();
  const displayFieldId = String(req.query.displayFieldId || '').trim();
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit || '30', 10) || 30));
  const offset = Math.max(0, Number.parseInt(req.query.offset || '0', 10) || 0);
  const fields = (await dbAdapter.queryAsync('SELECT * FROM fields WHERE table_id=$1 ORDER BY position', [tableId]))
    .map(f => ({ ...f, locked: !!f.locked, options: parseOptions(f) }));
  const displayField = displayFieldId
    ? await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1 AND table_id=$2', [displayFieldId, tableId])
    : fields[0];
  if (displayFieldId && !displayField) return res.status(400).json({ error: 'display field does not belong to table' });
  let records;
  let total;
  if (!q) {
    const countRow = await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM records WHERE table_id=$1 AND deleted_at IS NULL', [tableId]);
    total = countRow.c;
    records = await dbAdapter.queryAsync('SELECT * FROM records WHERE table_id=$1 AND deleted_at IS NULL ORDER BY position, created_at LIMIT $2 OFFSET $3', [tableId, limit, offset]);
  } else {
    const like = `%${q.replace(/[%_]/g, m => '\\' + m)}%`;
    if (displayField) {
      const countRow = await dbAdapter.queryOneAsync(
        `SELECT COUNT(*) AS c FROM records r
         JOIN cells c ON c.record_id=r.id AND c.field_id=$1
         WHERE r.table_id=$2 AND r.deleted_at IS NULL AND c.value LIKE $3 ESCAPE '\\'`,
        [displayField.id, tableId, like]
      );
      total = countRow.c;
      records = await dbAdapter.queryAsync(
        `SELECT r.* FROM records r
         JOIN cells c ON c.record_id=r.id AND c.field_id=$1
         WHERE r.table_id=$2 AND r.deleted_at IS NULL AND c.value LIKE $3 ESCAPE '\\'
         ORDER BY r.position, r.created_at LIMIT $4 OFFSET $5`,
        [displayField.id, tableId, like, limit, offset]
      );
    } else {
      total = 0;
      records = [];
    }
  }
  records = records.map(r => ({ ...r, locked: !!r.locked }));
  const recordIds = records.map(r => r.id);
  let cells = [];
  let links = [];
  if (recordIds.length) {
    const placeholders = recordIds.map((_, i) => `$${i + 1}`).join(',');
    cells = await dbAdapter.queryAsync(`SELECT * FROM cells WHERE record_id IN (${placeholders})`, recordIds);
    links = await dbAdapter.queryAsync(`SELECT * FROM links WHERE from_record_id IN (${placeholders})`, recordIds);
  }
  cells = await injectComputedCells({ id: tableId }, fields, records, cells);
  res.json({ tableId, records, cells, links, fields, page: { offset, limit, total }, q });
}));

// -------- tables --------
router.post('/api/bases/:baseId/tables', authRequired, validate(createTableSchema), asyncHandler(async (req, res) => {
  const { baseId } = req.params;
  if (!(await isMember(baseId, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canManageStructure(baseId, req.user.id))) return res.status(403).json({ error: 'only owner/admin can create tables' });
  const { name } = req.body || {};
  const tableName = (name || '新表').trim();
  // M-3: 禁止同名表
  const existing = await dbAdapter.queryOneAsync('SELECT 1 FROM tables WHERE base_id=$1 AND name=$2', [baseId, tableName]);
  if (existing) return res.status(409).json({ error: `table "${tableName}" already exists` });
  const id = nanoid();
  const maxPosRow = await dbAdapter.queryOneAsync('SELECT MAX(position) AS m FROM tables WHERE base_id=$1', [baseId]);
  const pos = (maxPosRow?.m || 0) + 1;
  const ts = now();
  await dbAdapter.writeQueryAsync('INSERT INTO tables (id,base_id,name,position,created_at) VALUES ($1,$2,$3,$4,$5)',
    [id, baseId, tableName, pos, ts]);
  const fid = nanoid();
  await dbAdapter.writeQueryAsync('INSERT INTO fields (id,table_id,name,type,options,locked,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [fid, id, '名称', 'text', null, 0, 0, ts]);
  await audit(baseId, req.user.id, 'table.create', { id, name });
  broadcast(baseId, 'table:add', { id, name: name || '新表', position: pos });
  res.json({ id });
}));

// -------- fields --------
router.post('/api/tables/:tableId/fields', authRequired, validate(createFieldSchema), asyncHandler(async (req, res) => {
  const { tableId } = req.params;
  const t = await baseOfTable(tableId);
  if (!t || !(await isMember(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canManageStructure(t.base_id, req.user.id))) return res.status(403).json({ error: 'only owner/admin can create fields' });
  const { name, type, options } = req.body || {};
  if (!FIELD_TYPES.includes(type)) return res.status(400).json({ error: 'invalid type' });
  const id = nanoid();
  const posRow = await dbAdapter.queryOneAsync('SELECT COUNT(*) AS c FROM fields WHERE table_id=$1', [tableId]);
  const pos = posRow.c;
  const cleanOptions = await normalizeFieldOptions(type, options, { baseId: t.base_id, tableId });
  if (['link', 'lookup', 'formula'].includes(type) && !cleanOptions) return res.status(400).json({ error: `${type} options invalid` });
  const ts = now();
  await dbAdapter.writeQueryAsync('INSERT INTO fields (id,table_id,name,type,options,locked,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, tableId, name || '新字段', type, cleanOptions ? JSON.stringify(cleanOptions) : null, 0, pos, ts]);
  await audit(t.base_id, req.user.id, 'field.create', { id, name, type });
  const payload = { id, tableId, name: name || '新字段', type, options: cleanOptions, locked: false, position: pos };
  broadcast(t.base_id, 'field:add', payload);
  res.json({ id });
}));

router.patch('/api/fields/:fieldId/lock', authRequired, asyncHandler(async (req, res) => {
  const { fieldId } = req.params;
  const b = await baseOfField(fieldId);
  if (!b || !(await isMember(b.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  // only owner / editor with role 'owner' can toggle lock
  if (!(await canManageStructure(b.base_id, req.user.id))) return res.status(403).json({ error: 'no permission' });
  const { locked } = req.body || {};
  await dbAdapter.writeQueryAsync('UPDATE fields SET locked=$1 WHERE id=$2', [locked ? 1 : 0, fieldId]);
  await audit(b.base_id, req.user.id, 'field.lock', { fieldId, locked: !!locked });
  broadcast(b.base_id, 'field:lock', { fieldId, locked: !!locked });
  res.json({ ok: true });
}));

router.patch('/api/fields/:fieldId', authRequired, validate(updateFieldSchema), asyncHandler(async (req, res) => {
  const { fieldId } = req.params;
  const b = await baseOfField(fieldId);
  if (!b || !(await isMember(b.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canManageStructure(b.base_id, req.user.id))) return res.status(403).json({ error: 'only owner/admin can update fields' });
  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  const { name, options, width, position } = req.body || {};
  const updates = {};
  const isLayoutOnly = (width !== undefined || position !== undefined) && name === undefined && options === undefined;
  if (f.locked && !isLayoutOnly) return res.status(423).json({ error: 'field locked' });
  if (typeof name === 'string' && name.trim()) updates.name = name.trim();
  if (options !== undefined) {
    const current = await baseOfField(fieldId);
    const next = await normalizeFieldOptions(f.type, options, { baseId: b.base_id, tableId: current.table_id, fieldId });
    if (['link', 'lookup', 'formula'].includes(f.type) && !next) return res.status(400).json({ error: `${f.type} options invalid` });
    updates.options = next;
  }
  if (width !== undefined) {
    const n = Number(width);
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid width' });
    updates.width = Math.max(80, Math.min(600, Math.round(n)));
  }
  if (position !== undefined) {
    const n = Number(position);
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid position' });
    updates.position = Math.round(n);
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'nothing to update' });
  const nextName = updates.name || f.name;
  const nextOptions = updates.options !== undefined ? JSON.stringify(updates.options) : f.options;
  const nextWidth = updates.width !== undefined ? updates.width : f.width;
  const nextPosition = updates.position !== undefined ? updates.position : f.position;
  await dbAdapter.writeQueryAsync('UPDATE fields SET name=$1, options=$2, width=$3, position=$4 WHERE id=$5',
    [nextName, nextOptions, nextWidth, nextPosition, fieldId]);
  await audit(b.base_id, req.user.id, 'field.update', { fieldId, ...updates });
  broadcast(b.base_id, 'field:update', { fieldId, ...updates });
  res.json({ ok: true });
}));

router.delete('/api/fields/:fieldId', authRequired, asyncHandler(async (req, res) => {
  const { fieldId } = req.params;
  const b = await baseOfField(fieldId);
  if (!b || !(await isMember(b.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canManageStructure(b.base_id, req.user.id))) return res.status(403).json({ error: 'only owner/admin can delete fields' });
  const f = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
  if (!f) return res.status(404).json({ error: 'field not found' });
  if (f.locked) return res.status(423).json({ error: 'field locked' });
  await dbAdapter.writeQueryAsync('DELETE FROM fields WHERE id=$1', [fieldId]);
  await audit(b.base_id, req.user.id, 'field.delete', { fieldId, name: f.name });
  broadcast(b.base_id, 'field:delete', { fieldId });
  res.json({ ok: true });
}));

// -------- table reorder / visibility / delete / rename --------

router.patch('/api/tables/:tableId/position', authRequired, asyncHandler(async (req, res) => {
  const { tableId } = req.params;
  const t = await baseOfTable(tableId);
  if (!t || !(await isMember(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canManageStructure(t.base_id, req.user.id))) return res.status(403).json({ error: 'only owner/admin can reorder tables' });
  const { position } = req.body || {};
  const n = Number(position);
  if (!Number.isFinite(n)) return res.status(400).json({ error: 'invalid position' });
  await dbAdapter.writeQueryAsync('UPDATE tables SET position=$1 WHERE id=$2', [Math.round(n), tableId]);
  await audit(t.base_id, req.user.id, 'table.position', { tableId, position: Math.round(n) });
  broadcast(t.base_id, 'table:position', { tableId, position: Math.round(n) });
  res.json({ ok: true });
}));

router.patch('/api/tables/:tableId/visibility', authRequired, asyncHandler(async (req, res) => {
  const { tableId } = req.params;
  const t = await baseOfTable(tableId);
  if (!t || !(await isMember(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canManageStructure(t.base_id, req.user.id))) return res.status(403).json({ error: 'only owner/admin can toggle table visibility' });
  const { hidden } = req.body || {};
  const val = hidden ? 1 : 0;
  await dbAdapter.writeQueryAsync('UPDATE tables SET hidden=$1 WHERE id=$2', [val, tableId]);
  await audit(t.base_id, req.user.id, 'table.visibility', { tableId, hidden: !!hidden });
  broadcast(t.base_id, 'table:visibility', { tableId, hidden: !!hidden });
  res.json({ ok: true });
}));

router.delete('/api/tables/:tableId', authRequired, asyncHandler(async (req, res) => {
  const { tableId } = req.params;
  const t = await baseOfTable(tableId);
  if (!t || !(await isMember(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canManageStructure(t.base_id, req.user.id))) return res.status(403).json({ error: 'only owner/admin can delete tables' });
  const tab = await dbAdapter.queryOneAsync('SELECT * FROM tables WHERE id=$1', [tableId]);
  if (!tab) return res.status(404).json({ error: 'table not found' });
  await dbAdapter.transactionAsync(async () => {
    const fields = await dbAdapter.queryAsync('SELECT id FROM fields WHERE table_id=$1', [tableId]);
    for (const f of fields) {
      await dbAdapter.writeQueryAsync('DELETE FROM cells WHERE field_id=$1', [f.id]);
      await dbAdapter.writeQueryAsync('DELETE FROM links WHERE field_id=$1', [f.id]);
    }
    await dbAdapter.writeQueryAsync('DELETE FROM fields WHERE table_id=$1', [tableId]);
    const records = await dbAdapter.queryAsync('SELECT id FROM records WHERE table_id=$1', [tableId]);
    for (const r of records) {
      await dbAdapter.writeQueryAsync('DELETE FROM cells WHERE record_id=$1', [r.id]);
      await dbAdapter.writeQueryAsync('DELETE FROM links WHERE from_record_id=$1 OR to_record_id=$1', [r.id]);
    }
    await dbAdapter.writeQueryAsync('DELETE FROM records WHERE table_id=$1', [tableId]);
    await dbAdapter.writeQueryAsync('DELETE FROM tables WHERE id=$1', [tableId]);
  });
  await audit(t.base_id, req.user.id, 'table.delete', { tableId, name: tab.name });
  broadcast(t.base_id, 'table:delete', { tableId });
  res.json({ ok: true });
}));

router.patch('/api/tables/:tableId', authRequired, asyncHandler(async (req, res) => {
  const { tableId } = req.params;
  const t = await baseOfTable(tableId);
  if (!t || !(await isMember(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canManageStructure(t.base_id, req.user.id))) return res.status(403).json({ error: 'only owner/admin can rename tables' });
  const { name } = req.body || {};
  const newName = String(name || '').trim();
  if (!newName) return res.status(400).json({ error: 'name required' });
  const existing = await dbAdapter.queryOneAsync('SELECT 1 FROM tables WHERE base_id=$1 AND name=$2 AND id<>$3', [t.base_id, newName, tableId]);
  if (existing) return res.status(409).json({ error: `table "${newName}" already exists` });
  await dbAdapter.writeQueryAsync('UPDATE tables SET name=$1 WHERE id=$2', [newName, tableId]);
  await audit(t.base_id, req.user.id, 'table.rename', { tableId, name: newName });
  broadcast(t.base_id, 'table:rename', { tableId, name: newName });
  res.json({ ok: true });
}));

// -------- 软删除 / 恢复记录 --------

async function checkRecordReferences(tableId, recordId) {
  const links = await dbAdapter.queryAsync(
    'SELECT l.field_id, l.from_record_id, f.name AS field_name, f.table_id AS from_table_id, t.name AS from_table_name ' +
    'FROM links l JOIN fields f ON f.id=l.field_id JOIN tables t ON t.id=f.table_id ' +
    'WHERE l.to_record_id=$1 AND f.table_id != $2',
    [recordId, tableId]
  );
  return links.map(l => ({
    tableId: l.from_table_id,
    tableName: l.from_table_name,
    recordId: l.from_record_id,
    fieldName: l.field_name,
  }));
}

// 软删除记录
router.delete('/api/tables/:tableId/records/:recordId', authRequired, asyncHandler(async (req, res) => {
  const { tableId, recordId } = req.params;
  const t = await baseOfTable(tableId);
  if (!t || !(await isMember(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canEditData(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });

  const record = await dbAdapter.queryOneAsync(
    'SELECT id, locked, deleted_at FROM records WHERE id=$1 AND table_id=$2',
    [recordId, tableId]
  );
  if (!record) return res.status(404).json({ error: 'record not found' });
  if (record.locked) return res.status(403).json({ error: 'record locked' });
  if (record.deleted_at) return res.status(410).json({ error: 'already deleted' });

  // 检查引用（block 模式）
  const refs = await checkRecordReferences(tableId, recordId);
  if (refs.length > 0) {
    return res.status(409).json({ error: 'record referenced', references: refs });
  }

  const ts = now();
  await dbAdapter.writeQueryAsync(
    'UPDATE records SET deleted_at=$1, updated_at=$1 WHERE id=$2',
    [ts, recordId]
  );
  await audit(t.base_id, req.user.id, 'record.softDelete', { tableId, recordId });
  broadcast(t.base_id, 'record:delete', { tableId, recordId });
  res.json({ ok: true, recordId });
}));

// 恢复记录
router.post('/api/tables/:tableId/records/:recordId/restore', authRequired, asyncHandler(async (req, res) => {
  const { tableId, recordId } = req.params;
  const t = await baseOfTable(tableId);
  if (!t || !(await isMember(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });
  if (!(await canManageStructure(t.base_id, req.user.id))) return res.status(403).json({ error: 'forbidden' });

  const record = await dbAdapter.queryOneAsync(
    'SELECT id, deleted_at FROM records WHERE id=$1 AND table_id=$2',
    [recordId, tableId]
  );
  if (!record) return res.status(404).json({ error: 'record not found' });
  if (!record.deleted_at) return res.status(400).json({ error: 'not deleted' });

  await dbAdapter.writeQueryAsync(
    'UPDATE records SET deleted_at=NULL, updated_at=$1 WHERE id=$2',
    [Date.now(), recordId]
  );
  await audit(t.base_id, req.user.id, 'record.restore', { tableId, recordId });
  broadcast(t.base_id, 'record:restore', { tableId, recordId });
  res.json({ ok: true, recordId });
}));

  return router;
};

// ============================================================
// 导出异步函数
// ============================================================
module.exports.getTablePageAsync = getTablePageAsync;
module.exports.searchTableAsync = searchTableAsync;
module.exports.createTableAsync = createTableAsync;
module.exports.createFieldAsync = createFieldAsync;
module.exports.toggleFieldLockAsync = toggleFieldLockAsync;
module.exports.updateFieldAsync = updateFieldAsync;
module.exports.deleteFieldAsync = deleteFieldAsync;
