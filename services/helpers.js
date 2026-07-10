// services/helpers.js — 共享基础函数
// 所有 service 模块共用的底层工具函数（仅异步/PostgreSQL 模式）

const dbAdapter = require('./dbAdapter');
const { nanoid } = require('nanoid');

function now() { return Date.now(); }

// ============================================================
// 纯 JS 工具函数（无 DB 调用）
// ============================================================

async function numValue(recordId, fieldId) {
  if (!recordId || !fieldId) return 0;
  const val = await cellValue(recordId, fieldId);
  const v = Number(val);
  return Number.isFinite(v) ? v : 0;
}

function broadcast(baseId, event, payload) {
  // 由 server.js 注入实际的 broadcast 函数
  if (typeof broadcast._fn === 'function') broadcast._fn(baseId, event, payload);
}

function setBroadcast(fn) { broadcast._fn = fn; }

function parseOptions(fieldOrOptions) {
  if (!fieldOrOptions) return null;
  const opts = typeof fieldOrOptions === 'string' ? fieldOrOptions : fieldOrOptions.options;
  if (!opts) return null;
  if (typeof opts === 'object') return opts;
  try { return JSON.parse(opts); } catch { return null; }
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const [k, ...v] = pair.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  });
  return cookies;
}

// ============================================================
// 异步函数（通过 dbAdapter 的异步接口工作）
// ============================================================

async function cellValue(recordId, fieldId) {
  if (!fieldId) return '';
  const row = await dbAdapter.queryOneAsync(
    'SELECT value FROM cells WHERE record_id=$1 AND field_id=$2', [recordId, fieldId]
  );
  return row?.value || '';
}

async function cellValueByName(recordId, tableId, name) {
  const fid = await fieldIdByName(tableId, name);
  return fid ? await cellValue(recordId, fid) : '';
}

async function tableNameOfRecord(recordId) {
  const row = await dbAdapter.queryOneAsync(
    'SELECT t.name FROM records r JOIN tables t ON t.id=r.table_id WHERE r.id=$1', [recordId]
  );
  return row?.name || '';
}

async function tableByName(baseId, name) {
  return dbAdapter.queryOneAsync(
    'SELECT * FROM tables WHERE base_id=$1 AND name=$2', [baseId, name]
  );
}

async function fieldsMap(tableId) {
  const rows = await dbAdapter.queryAsync(
    'SELECT * FROM fields WHERE table_id=$1', [tableId]
  );
  return Object.fromEntries(rows.map(f => [f.name, f]));
}

async function fieldIdByName(tableId, name) {
  const map = await fieldsMap(tableId);
  return map[name]?.id || null;
}

async function firstLinkedRecordId(fromRecordId, linkFieldId) {
  if (!linkFieldId) return null;
  const row = await dbAdapter.queryOneAsync(
    'SELECT to_record_id FROM links WHERE field_id=$1 AND from_record_id=$2 ORDER BY created_at LIMIT 1',
    [linkFieldId, fromRecordId]
  );
  return row?.to_record_id || null;
}

async function addLinkIfMissing(fieldId, fromRecordId, toRecordId, ts) {
  if (!fieldId || !fromRecordId || !toRecordId) return;
  ts = ts || now();
  const exists = await dbAdapter.queryOneAsync(
    'SELECT 1 FROM links WHERE field_id=$1 AND from_record_id=$2 AND to_record_id=$3',
    [fieldId, fromRecordId, toRecordId]
  );
  if (exists) return;
  await dbAdapter.writeQueryAsync(
    'INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES ($1,$2,$3,$4,$5)',
    [nanoid(), fieldId, fromRecordId, toRecordId, ts]
  );
}

async function createRecordRaw(tableId, userId, locked, ts) {
  userId = userId || null;
  locked = locked || 0;
  ts = ts || now();
  const id = nanoid();
  // 使用时间戳作为 position 基数，避免并发 MAX(position)+1 冲突
  const position = ts;
  await dbAdapter.writeQueryAsync(
    'INSERT INTO records (id,table_id,position,locked,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, tableId, position, locked ? 1 : 0, ts, ts]
  );
  return id;
}

async function displayValue(recordId, preferredNames) {
  const r = await dbAdapter.queryOneAsync(
    'SELECT table_id FROM records WHERE id=$1', [recordId]
  );
  if (!r) return '';
  for (const name of preferredNames) {
    const fid = await fieldIdByName(r.table_id, name);
    const val = await cellValue(recordId, fid);
    if (val) return val;
  }
  return '';
}

async function upsertCell(recordId, fieldId, value, userId, ts) {
  if (!fieldId) return;
  userId = userId || null;
  ts = ts || now();
  await dbAdapter.writeQueryAsync(
    `INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
    [recordId, fieldId, value == null ? '' : String(value), ts, userId]
  );
}

async function assertRecordWritable(recordId, message) {
  message = message || '记录已封账，不能通过审批按钮修改';
  const r = await dbAdapter.queryOneAsync(
    'SELECT locked FROM records WHERE id=$1', [recordId]
  );
  if (r?.locked) throw new Error(message);
}

async function tableNameOfField(fieldId) {
  const f = await dbAdapter.queryOneAsync(
    'SELECT table_id FROM fields WHERE id=$1', [fieldId]
  );
  if (!f) return null;
  const t = await dbAdapter.queryOneAsync(
    'SELECT name FROM tables WHERE id=$1', [f.table_id]
  );
  return t?.name || null;
}

async function fieldName(fieldId) {
  const f = await dbAdapter.queryOneAsync(
    'SELECT name FROM fields WHERE id=$1', [fieldId]
  );
  return f?.name || null;
}

module.exports = {
  nanoid, now,
  cellValue, cellValueByName, tableNameOfRecord, tableByName, fieldsMap, fieldIdByName,
  firstLinkedRecordId, addLinkIfMissing, createRecordRaw, displayValue,
  upsertCell, assertRecordWritable, numValue, broadcast, setBroadcast,
  parseOptions, tableNameOfField, fieldName, parseCookies,
};
