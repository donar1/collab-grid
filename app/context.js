// app/context.js — server.js 辅助函数与上下文构建（纯异步版本）
const dbAdapter = require('../services/dbAdapter');
const { nanoid } = require('nanoid');
const { evaluateFormula, evaluateTextFormula } = require('../services/formulaService');
const { parseOptions, cellValueByName, fieldIdByName, fieldsMap, firstLinkedRecordId, upsertCell, tableNameOfField, fieldName, tableByName, assertRecordWritable } = require('../services/helpers');
const { BASE_ROLES, normalizeBaseRole, normalizeSystemRole, publicRoleMeta: publicRoleMetaV2, baseRoleRank } = require('../security/roles');
const { buildSecurityAsync } = require('../security/guards');
const matrixStore = require('../security/matrixStore');

// ---- Lazy init pattern: security is built asynchronously ----
let _security = null;
let _initPromise = null;

async function _ensureInit() {
  if (_security) return;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    await matrixStore.ensureSchemaAsync();
    _security = await buildSecurityAsync();
  })();
  await _initPromise;
}

// 立即启动初始化（不阻塞 require），同时导出 promise 供 server.js await
const ready = _ensureInit();

const now = () => Date.now();
const ROLES = BASE_ROLES.slice();
const LEGACY_ROLE_VALUES = ['owner', 'admin', 'approver', 'finance', 'editor', 'viewer'];

function formatTimestamp(ts, options) {
  if (!ts) return '';
  const numTs = typeof ts === 'string' ? parseInt(ts, 10) : ts;
  const d = new Date(numTs);
  const opts = options || {};

  // 自定义格式模板
  const template = opts.format || '';
  if (template) {
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const yy = String(yyyy).slice(-2);
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const HH = pad(d.getHours());
    const MM = pad(d.getMinutes());
    const ss = pad(d.getSeconds());
    return template
      .replace(/yyyy/g, yyyy)
      .replace(/yy/g, yy)
      .replace(/mm/g, mm)
      .replace(/dd/g, dd)
      .replace(/HH/g, HH)
      .replace(/MM/g, MM)
      .replace(/ss/g, ss);
  }

  // 默认格式：根据 showSeconds 开关决定
  const showSeconds = opts.showSeconds !== false; // 默认显示秒
  if (showSeconds) {
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\//g, '-');
  }
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
}

function normalizeRole(role, fallback = 'business') {
  const raw = String(role || '').trim();
  if (BASE_ROLES.includes(raw)) return raw;
  if (LEGACY_ROLE_VALUES.includes(raw)) return raw;
  return fallback;
}
function roleRank(role) { return baseRoleRank(role); }
async function isMember(baseId, userId) { return await _security.isMember(baseId, userId); }
async function getRole(baseId, userId) { return await _security.getRole(baseId, userId); }
async function canManageBase(baseId, userId) { return await _security.canManageBase(baseId, userId); }
async function canManageStructure(baseId, userId) { return await _security.canManageStructure(baseId, userId); }
async function canEditData(baseId, userId) { return await _security.canEditData(baseId, userId); }
async function canApprove(baseId, userId) { return await _security.canApprove(baseId, userId); }
async function canSealRecord(baseId, userId, nextLocked) { return await _security.canSealRecord(baseId, userId, nextLocked); }
async function canRunJobs(baseId, userId) { return await _security.canRunJobs(baseId, userId); }
async function canViewTable(baseId, userId, tableId) {
  // 先检查是否为 base 成员
  if (!(await isMember(baseId, userId))) return false;
  // 查询该用户在此 base 的角色
  const role = await getRole(baseId, userId);
  // owner 和 admin 始终可以查看所有表
  if (role === 'owner' || role === 'admin') return true;
  // 检查 sys_admin 系统角色
  const u = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [userId]);
  if (u && u.system_role === 'sys_admin') return true;
  // 查询 table_permissions
  const perm = await dbAdapter.queryOneAsync(
    'SELECT can_view FROM table_permissions WHERE base_id=$1 AND table_id=$2 AND role=$3',
    [baseId, tableId, role]
  );
  // 如果没有显式配置，默认允许查看（向后兼容）
  if (!perm) return true;
  return !!perm.can_view;
}
async function canEditTable(baseId, userId, tableId) {
  if (!(await isMember(baseId, userId))) return false;
  const role = await getRole(baseId, userId);
  if (role === 'owner' || role === 'admin') return true;
  const u = await dbAdapter.queryOneAsync('SELECT system_role FROM users WHERE id=$1', [userId]);
  if (u && u.system_role === 'sys_admin') return true;
  const perm = await dbAdapter.queryOneAsync(
    'SELECT can_edit FROM table_permissions WHERE base_id=$1 AND table_id=$2 AND role=$3',
    [baseId, tableId, role]
  );
  if (!perm) return true; // 默认允许编辑（向后兼容）
  return !!perm.can_edit;
}
function publicRoleMeta(role) {
  const meta = publicRoleMetaV2(role);
  return { value: meta.value, label: meta.label, rank: roleRank(meta.value) };
}

// -------- field / cell helpers (pure, no db) --------
function normalizeSelectOptions(options) {
  const rawValues = Array.isArray(options?.values) ? options.values : [];
  const seen = new Set();
  const values = [];
  for (const raw of rawValues) {
    const label = typeof raw === 'object' && raw !== null ? String(raw.label || '').trim() : String(raw || '').trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const rawColor = typeof raw === 'object' && raw !== null ? String(raw.color || '').trim() : '';
    const color = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '#64748b';
    values.push({ label, color });
  }
  return { values };
}

function selectLabelsFromOptions(optionsJson) {
  const parsed = optionsJson ? parseOptions(optionsJson) : { values: [] };
  return (parsed?.values || []).map(v => typeof v === 'object' && v !== null ? v.label : v).filter(Boolean);
}

function normalizeLookupOptions(options) {
  const linkFieldId = String(options?.linkFieldId || '').trim();
  const sourceFieldId = String(options?.sourceFieldId || '').trim();
  const mode = options?.mode === 'snapshot' ? 'snapshot' : 'live';
  if (!linkFieldId || !sourceFieldId) return null;
  return { linkFieldId, sourceFieldId, mode };
}

function linkAllowsMultiple(field) {
  const options = parseOptions(field) || {};
  return !!options.multiple;
}

function normalizeAutoNumberOptions(options) {
  return {
    prefix: String(options?.prefix || 'AUTO-').slice(0, 24),
    start: Math.max(1, Number.parseInt(options?.start || 1, 10) || 1),
    pad: Math.max(1, Math.min(8, Number.parseInt(options?.pad || 4, 10) || 4)),
  };
}

function normalizeCurrencyOptions(options) {
  return {
    symbol: String(options?.symbol || '\u00a5').slice(0, 4),
    precision: Math.max(0, Math.min(4, Number.parseInt(options?.precision ?? 2, 10) || 0)),
  };
}

function normalizeFormulaOptions(options) {
  const expression = String(options?.expression || '').trim();
  if (!expression) return null;
  if (expression.length > 240) return null;
  if (!/^[\d\s+\-*/().{}_\u4e00-\u9fa5A-Za-z]+$/.test(expression)) return null;
  return { expression };
}

function normalizeTextFormulaOptions(options) {
  const expression = String(options?.expression || '').trim();
  if (!expression || expression.length > 400) return null;
  return { expression };
}

function normalizeButtonOptions(options) {
  const action = String(options?.action || 'seal_record').trim();
  const allowed = new Set([
    'seal_record', 'unseal_record', 'approve_resource', 'approve_business_lock', 'approve_inventory_operation',
    'seal_finance_record', 'approve_finance_reversal', 'approve_order_refund', 'approve_order_cancel'
  ]);
  return {
    label: String(options?.label || ((action === 'approve_resource' || action === 'approve_business_lock' || action === 'approve_inventory_operation' || action === 'approve_finance_reversal' || action === 'approve_order_refund' || action === 'approve_order_cancel') ? '审批通过' : (action === 'unseal_record' ? '解除封账' : '封账'))).slice(0, 20),
    action: allowed.has(action) ? action : 'seal_record',
  };
}

function normalizeFieldStyle(options) {
  const style = options?.style || {};
  const out = {};
  const fontSize = Number.parseInt(style.fontSize || '', 10);
  if (Number.isFinite(fontSize)) out.fontSize = Math.max(10, Math.min(28, fontSize));
  if (/^#[0-9a-fA-F]{6}$/.test(String(style.textColor || ''))) out.textColor = String(style.textColor);
  if (/^#[0-9a-fA-F]{6}$/.test(String(style.bgColor || ''))) out.bgColor = String(style.bgColor);
  return Object.keys(out).length ? out : null;
}
function normalizeCellStyle(style) {
  return normalizeFieldStyle({ style }) || {};
}
function withFieldStyle(normalized, rawOptions) {
  if (!normalized) return normalized;
  const style = normalizeFieldStyle(rawOptions);
  if (!style) return normalized;
  return { ...(normalized || {}), style };
}

async function normalizeFieldOptionsAsync(type, options, context = {}) {
  if (type === 'select') return withFieldStyle(normalizeSelectOptions(options), options);
  if (type === 'link') return withFieldStyle(await normalizeLinkOptionsAsync(options, context.baseId), options);
  if (type === 'lookup') return withFieldStyle(await validateLookupOptionsAsync(options, context.tableId, context.baseId, context.fieldId), options);
  if (type === 'autoNumber') return withFieldStyle(normalizeAutoNumberOptions(options), options);
  if (type === 'currency') return withFieldStyle(normalizeCurrencyOptions(options), options);
  if (type === 'formula') return withFieldStyle(normalizeFormulaOptions(options), options);
  if (type === 'textFormula') return withFieldStyle(normalizeTextFormulaOptions(options), options);
  if (type === 'button') return withFieldStyle(normalizeButtonOptions(options), options);
  return withFieldStyle(options || {}, options);
}

function autoNumberValue(record, field) {
  const opts = parseOptions(field) || {};
  const start = Number.parseInt(opts.start || 1, 10) || 1;
  const pad = Math.max(1, Number.parseInt(opts.pad || 4, 10) || 4);
  return `${opts.prefix || 'AUTO-'}${String(start + (record.position || 0)).padStart(pad, '0')}`;
}

function cellValueFromMap(cellMap, recordId, fieldId) {
  return cellMap.get(`${recordId}:${fieldId}`) || '';
}

function evaluateFormulaValue(expression, record, fields, cellMap) {
  const fieldByName = new Map(fields.map(f => [f.name, f]));
  return evaluateFormula(expression, (name) => {
    const f = fieldByName.get(name);
    if (!f) return '0';
    const raw = cellValueFromMap(cellMap, record.id, f.id);
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : '0';
  });
}

function evaluateTextFormulaValue(expression, record, fields, cellMap) {
  const fieldByName = new Map(fields.map(f => [f.name, f]));
  return evaluateTextFormula(expression, (name) => {
    const f = fieldByName.get(name);
    if (!f) return '';
    return cellValueFromMap(cellMap, record.id, f.id);
  });
}

// ============================================================
// Async 版本 — 所有数据库操作函数（使用 dbAdapter）
// SQL 占位符使用 PG 风格 $1, $2, ...
// ============================================================

/**
 * baseOfTableAsync — 异步版：根据 tableId 获取 base_id
 */
async function baseOfTableAsync(tableId) {
  return dbAdapter.queryOneAsync('SELECT base_id FROM tables WHERE id=$1', [tableId]);
}

/**
 * baseOfFieldAsync — 异步版：根据 fieldId 获取 base_id
 */
async function baseOfFieldAsync(fieldId) {
  return dbAdapter.queryOneAsync(
    `SELECT t.base_id FROM fields f JOIN tables t ON t.id=f.table_id WHERE f.id=$1`,
    [fieldId]
  );
}

/**
 * baseOfRecordAsync — 异步版：根据 recordId 获取 base_id
 */
async function baseOfRecordAsync(recordId) {
  return dbAdapter.queryOneAsync(
    `SELECT t.base_id FROM records r JOIN tables t ON t.id=r.table_id WHERE r.id=$1`,
    [recordId]
  );
}

/**
 * auditAsync — 异步版审计日志写入
 */
async function auditAsync(baseId, userId, action, payload) {
  await dbAdapter.writeQueryAsync(
    `INSERT INTO audit_log (id,base_id,table_id,record_id,field_id,old_value,new_value,action,user_id,user_email,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [nanoid(), baseId, '', '', '', '', JSON.stringify(payload || {}), action, userId, '', now()]
  );
}

/**
 * fieldWithBaseAsync — 异步版：获取字段及其所属 base 信息
 */
async function fieldWithBaseAsync(fieldId) {
  return dbAdapter.queryOneAsync(
    `SELECT f.*, t.base_id, t.id AS source_table_id
     FROM fields f JOIN tables t ON t.id=f.table_id
     WHERE f.id=$1`,
    [fieldId]
  );
}

/**
 * normalizeLinkOptionsAsync — 异步版：校验 link 字段选项
 */
async function normalizeLinkOptionsAsync(options, baseId) {
  const tableId = String(options?.tableId || '').trim();
  const displayFieldId = String(options?.displayFieldId || '').trim();
  const multiple = !!options?.multiple;
  if (!tableId) return null;
  const targetTable = await dbAdapter.queryOneAsync('SELECT * FROM tables WHERE id=$1 AND base_id=$2', [tableId, baseId]);
  if (!targetTable) return null;
  let displayField = null;
  if (displayFieldId) {
    displayField = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1 AND table_id=$2', [displayFieldId, tableId]);
    if (!displayField) return null;
  } else {
    displayField = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE table_id=$1 ORDER BY position LIMIT 1', [tableId]);
  }
  return { tableId, displayFieldId: displayField?.id || '', multiple };
}

/**
 * validateLookupOptionsAsync — 异步版：校验 lookup 字段选项
 */
async function validateLookupOptionsAsync(options, sourceTableId, baseId, lookupFieldId = null) {
  const clean = normalizeLookupOptions(options);
  if (!clean) return null;
  if (lookupFieldId && (clean.linkFieldId === lookupFieldId || clean.sourceFieldId === lookupFieldId)) return null;
  const linkField = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1 AND table_id=$2', [clean.linkFieldId, sourceTableId]);
  if (!linkField || linkField.type !== 'link') return null;
  const linkOptions = parseOptions(linkField) || {};
  const targetTableId = linkOptions.tableId;
  if (!targetTableId) return null;
  const targetTable = await dbAdapter.queryOneAsync('SELECT * FROM tables WHERE id=$1 AND base_id=$2', [targetTableId, baseId]);
  if (!targetTable) return null;
  const sourceField = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1 AND table_id=$2', [clean.sourceFieldId, targetTableId]);
  if (!sourceField) return null;
  if (sourceField.type === 'link' || sourceField.type === 'lookup') return null;
  return clean;
}

/**
 * injectComputedCellsAsync — 异步版：注入计算单元格（autoNumber/formula/textFormula/createdTime/lastModifiedTime/lastModifiedBy/lookup/attachment）
 */
async function injectComputedCellsAsync(table, fields, records, cells) {
  const cellMap = new Map(cells.map(c => [`${c.record_id}:${c.field_id}`, c.value == null ? '' : String(c.value)]));
  const userCache = new Map();
  async function displayUserAsync(userId) {
    if (!userId) return '';
    if (!userCache.has(userId)) {
      const u = await dbAdapter.queryOneAsync('SELECT email, display_name FROM users WHERE id=$1', [userId]);
      userCache.set(userId, u ? (u.display_name || u.email) : userId);
    }
    return userCache.get(userId);
  }
  // Pre-load all attachment metadata for all records
  const allAttIds = new Set();
  for (const f of fields) {
    if (f.type !== 'attachment') continue;
    for (const r of records) {
      const raw = cellMap.get(`${r.id}:${f.id}`);
      if (raw) {
        try { (JSON.parse(raw) || []).forEach(id => allAttIds.add(id)); } catch {}
      }
    }
  }
  const attLookup = new Map();
  if (allAttIds.size > 0) {
    const attPlaceholders = [...allAttIds].map((_, i) => `$${i + 1}`).join(',');
    const attRows = await dbAdapter.queryAsync(
      `SELECT id, file_name, file_type, file_size FROM attachments WHERE id IN (${attPlaceholders})`,
      [...allAttIds]
    );
    for (const a of attRows) attLookup.set(a.id, a);
  }
  const computed = [];
  for (const f of fields) {
    if (!['autoNumber', 'formula', 'textFormula', 'createdTime', 'lastModifiedTime', 'lastModifiedBy', 'lookup', 'attachment'].includes(f.type)) continue;
    for (const r of records) {
      let value = '';
      if (f.type === 'autoNumber') value = autoNumberValue(r, f);
      if (f.type === 'createdTime') {
        try {
          value = formatTimestamp(r.created_at, f.options);
        } catch { value = ''; }
      }
      if (f.type === 'lastModifiedTime') {
        try {
          value = formatTimestamp(r.updated_at || r.created_at, f.options);
        } catch { value = ''; }
      }
      if (f.type === 'attachment') {
        const raw = cellMap.get(`${r.id}:${f.id}`) || '';
        if (raw) {
          try {
            const ids = JSON.parse(raw);
            if (Array.isArray(ids)) {
              value = JSON.stringify(ids.map(id => attLookup.get(id)).filter(Boolean));
            } else value = '[]';
          } catch { value = '[]'; }
        } else value = '[]';
      }
      if (f.type === 'lastModifiedBy') {
        const last = cells.filter(c => c.record_id === r.id && c.updated_by).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))[0];
        value = await displayUserAsync(last?.updated_by);
      }
      if (f.type === 'formula') {
        const expr = f.options?.expression || '';
        value = evaluateFormulaValue(expr, r, fields, cellMap);
      }
      if (f.type === 'textFormula') {
        const expr = f.options?.expression || '';
        value = evaluateTextFormulaValue(expr, r, fields, cellMap);
      }
      if (f.type === 'lookup') {
        const opts = f.options || {};
        if (opts.mode === 'snapshot') continue;
        if (!opts.linkFieldId || !opts.sourceFieldId) continue;
        const links = await dbAdapter.queryAsync(
          'SELECT to_record_id FROM links WHERE field_id=$1 AND from_record_id=$2',
          [opts.linkFieldId, r.id]
        );
        if (links.length) {
          const toIds = links.map(l => l.to_record_id);
          const placeholders = toIds.map((_, i) => `$${i + 1}`).join(',');
          const cellRows = await dbAdapter.queryAsync(
            `SELECT record_id, value FROM cells WHERE field_id=$1 AND record_id IN (${placeholders})`,
            [opts.sourceFieldId, ...toIds]
          );
          const cellMapLookup = new Map(cellRows.map(c => [c.record_id, c.value]));
          const values = [];
          for (const l of links) {
            const cv = cellMapLookup.get(l.to_record_id);
            if (cv != null && cv !== '') { values.push(cv); continue; }
            const sourceField = await dbAdapter.queryOneAsync('SELECT type, options FROM fields WHERE id=$1', [opts.sourceFieldId]);
            if (sourceField?.type === 'autoNumber') {
              const sourceRecord = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [l.to_record_id]);
              if (sourceRecord) values.push(autoNumberValue(sourceRecord, { ...sourceField, options: sourceField.options }));
            }
          }
          value = values.filter(Boolean).join(', ');
        }
      }
      computed.push({ record_id: r.id, field_id: f.id, value, updated_at: r.updated_at || r.created_at, updated_by: null, computed: true });
    }
  }
  return cells.concat(computed);
}

/**
 * recomputeLookupSnapshotsAsync — 异步版：重新计算 lookup 快照字段
 */
async function recomputeLookupSnapshotsAsync(fromRecordId, linkFieldId, baseId, userId) {
  const r = await dbAdapter.queryOneAsync('SELECT table_id FROM records WHERE id=$1', [fromRecordId]);
  if (!r) return;
  const lookupFields = await dbAdapter.queryAsync(`SELECT * FROM fields WHERE table_id=$1 AND type='lookup'`, [r.table_id]);
  for (const lf of lookupFields) {
    const opts = parseOptions(lf) || {};
    if (opts.linkFieldId !== linkFieldId) continue;
    if (opts.mode !== 'snapshot') continue;
    const tos = await dbAdapter.queryAsync(
      'SELECT to_record_id FROM links WHERE field_id=$1 AND from_record_id=$2',
      [linkFieldId, fromRecordId]
    );
    const values = [];
    for (const t of tos) {
      const c = await dbAdapter.queryOneAsync(
        'SELECT value FROM cells WHERE record_id=$1 AND field_id=$2',
        [t.to_record_id, opts.sourceFieldId]
      );
      if (c?.value != null && c.value !== '') values.push(c.value);
    }
    const joined = values.join(', ');
    const ts = now();
    await dbAdapter.writeQueryAsync(
      `INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
      [fromRecordId, lf.id, joined, ts, userId || null]
    );
  }
}

// -------- business lock --------
const BUSINESS_LOCK_CORE_FIELDS = new Set(['合作渠道', '合作关系', '商品', '分组', '申请人', '判断', '审批结果']);
async function businessLockCoreProtectedAsync(recordId, fieldId) {
  if (await tableNameOfField(fieldId) !== '业务锁定区') return false;
  const name = await fieldName(fieldId);
  if (!BUSINESS_LOCK_CORE_FIELDS.has(name)) return false;
  const r = await dbAdapter.queryOneAsync('SELECT table_id FROM records WHERE id=$1', [recordId]);
  if (!r) return false;
  const judge = await cellValueByName(recordId, r.table_id, '判断');
  const approval = await cellValueByName(recordId, r.table_id, '审批结果');
  return judge === '关联' || approval === '已通过';
}
async function businessLockHasProductAsync(recordId, tableId) {
  const productFieldId = await fieldIdByName(tableId, '商品');
  if (!productFieldId) return false;
  const row = await dbAdapter.queryOneAsync(
    'SELECT 1 AS one FROM links WHERE field_id=$1 AND from_record_id=$2 LIMIT 1',
    [productFieldId, recordId]
  );
  return !!row;
}

// -------- template helper --------
async function createTableWithFieldsAsync(baseId, tableName, fieldDefs, startPosition) {
  const tableId = nanoid();
  const ts = now();
  await dbAdapter.writeQueryAsync(
    'INSERT INTO tables (id,base_id,name,position,created_at) VALUES ($1,$2,$3,$4,$5)',
    [tableId, baseId, tableName, startPosition, ts]
  );
  const fields = {};
  for (let index = 0; index < fieldDefs.length; index++) {
    const def = fieldDefs[index];
    const fieldId = nanoid();
    const options = def.options ? JSON.stringify(def.options) : null;
    await dbAdapter.writeQueryAsync(
      'INSERT INTO fields (id,table_id,name,type,options,locked,width,position,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [fieldId, tableId, def.name, def.type, options, def.locked ? 1 : 0, def.width || 160, index, ts]
    );
    fields[def.key || def.name] = fieldId;
  }
  return { tableId, fields };
}

module.exports = {
  nanoid, now, ROLES, ready,
  get security() { return _security; },
  normalizeRole, roleRank,
  isMember, getRole, canManageBase, canManageStructure, canEditData, canApprove, canSealRecord, canRunJobs, canViewTable, canEditTable, publicRoleMeta,
  // ---- Async DB 函数（外部接口统一使用这些） ----
  baseOfTable: baseOfTableAsync,
  baseOfField: baseOfFieldAsync,
  baseOfRecord: baseOfRecordAsync,
  audit: auditAsync,
  normalizeSelectOptions, selectLabelsFromOptions, normalizeLookupOptions,
  fieldWithBase: fieldWithBaseAsync,
  normalizeLinkOptions: normalizeLinkOptionsAsync,
  validateLookupOptions: validateLookupOptionsAsync,
  linkAllowsMultiple, normalizeAutoNumberOptions, normalizeCurrencyOptions,
  normalizeFormulaOptions, normalizeTextFormulaOptions, normalizeButtonOptions, normalizeFieldStyle, normalizeCellStyle,
  withFieldStyle, normalizeFieldOptions: normalizeFieldOptionsAsync, autoNumberValue, cellValueFromMap, evaluateFormulaValue, evaluateTextFormulaValue,
  injectComputedCells: injectComputedCellsAsync,
  recomputeLookupSnapshots: recomputeLookupSnapshotsAsync,
  businessLockCoreProtected: businessLockCoreProtectedAsync,
  businessLockHasProduct: businessLockHasProductAsync,
  createTableWithFields: createTableWithFieldsAsync,
  firstLinkedRecordId, fieldsMap, fieldIdByName, cellValueByName, upsertCell,
  tableByName, assertRecordWritable,
};
