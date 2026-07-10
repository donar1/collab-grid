const { nanoid } = require('nanoid');
const formulaService = require('../services/formulaService');
const { parseOptions } = require('../services/helpers');
const dbAdapter = require('../services/dbAdapter');

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toDateString(value) {
  const s = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

function autoNumberValue(record, field) {
  const opts = parseOptions(field);
  const start = Number.parseInt(opts.start || 1, 10) || 1;
  const pad = Math.max(1, Number.parseInt(opts.pad || 4, 10) || 4);
  return `${opts.prefix || 'AUTO-'}${String(start + (record.position || 0)).padStart(pad, '0')}`;
}

async function makeGrid() {
  async function table(baseId, name) {
    return dbAdapter.queryOneAsync('SELECT * FROM tables WHERE base_id=$1 AND name=$2', [baseId, name]);
  }

  async function fields(tableId) {
    return dbAdapter.queryAsync('SELECT * FROM fields WHERE table_id=$1 ORDER BY position', [tableId]);
  }

  async function fieldsByName(tableId) {
    const fs = await fields(tableId);
    return Object.fromEntries(fs.map(f => [f.name, f]));
  }

  async function cell(recordId, fieldId) {
    const row = await dbAdapter.queryOneAsync('SELECT value FROM cells WHERE record_id=$1 AND field_id=$2', [recordId, fieldId]);
    return row?.value || '';
  }

  async function setCell(recordId, fieldId, value, userId = null, ts = Date.now()) {
    const val = value == null ? null : String(value);
    await dbAdapter.runAsync(`
      INSERT INTO cells (record_id,field_id,value,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT(record_id,field_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by
    `, [recordId, fieldId, val, ts, userId]);
    await dbAdapter.runAsync('UPDATE records SET updated_at=$1 WHERE id=$2', [ts, recordId]);
  }

  async function linked(recordId, fieldId) {
    const rows = await dbAdapter.queryAsync('SELECT to_record_id FROM links WHERE from_record_id=$1 AND field_id=$2 ORDER BY created_at', [recordId, fieldId]);
    return rows.map(r => r.to_record_id);
  }

  async function firstLinked(recordId, fieldId) {
    const ids = await linked(recordId, fieldId);
    return ids[0] || '';
  }

  async function addLink(fieldId, fromRecordId, toRecordId, ts = Date.now()) {
    if (!toRecordId) return '';
    const old = await dbAdapter.queryOneAsync('SELECT id FROM links WHERE field_id=$1 AND from_record_id=$2 AND to_record_id=$3', [fieldId, fromRecordId, toRecordId]);
    if (old) return old.id;
    const fieldRow = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [fieldId]);
    const opts = parseOptions(fieldRow);
    if (!opts.multiple) await dbAdapter.runAsync('DELETE FROM links WHERE field_id=$1 AND from_record_id=$2', [fieldId, fromRecordId]);
    const id = nanoid();
    await dbAdapter.runAsync('INSERT INTO links (id,field_id,from_record_id,to_record_id,created_at) VALUES ($1,$2,$3,$4,$5)', [id, fieldId, fromRecordId, toRecordId, ts]);
    return id;
  }

  async function createRecord(tableId, ts = Date.now()) {
    const id = nanoid();
    const maxRow = await dbAdapter.queryOneAsync('SELECT MAX(position) AS m FROM records WHERE table_id=$1', [tableId]);
    const maxPos = maxRow?.m || 0;
    const pos = maxPos + 1;
    await dbAdapter.runAsync('INSERT INTO records (id,table_id,height,locked,position,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, tableId, 34, 0, pos, ts, ts]);
    return id;
  }

  async function evaluateFormula(record, tableFields, expression) {
    const byName = Object.fromEntries(tableFields.map(f => [f.name, f]));
    return formulaService.evaluateFormula(expression, async (name) => {
      const f = byName[String(name).trim()];
      if (!f) return '0';
      return String(toNumber(await value(record, f, tableFields)));
    });
  }

  async function value(record, field, tableFields = null) {
    if (!record || !field) return '';
    if (field.type === 'autoNumber') return autoNumberValue(record, field);
    if (field.type === 'formula') return evaluateFormula(record, tableFields || await fields(record.table_id), parseOptions(field).expression);
    if (field.type === 'createdTime' || field.type === 'lastModifiedTime') return new Date(record.updated_at || record.created_at).toISOString().slice(0, 10);
    if (field.type === 'lookup') {
      const opts = parseOptions(field);
      if (!opts.linkFieldId || !opts.sourceFieldId) return '';
      const linkedIds = await linked(record.id, opts.linkFieldId);
      const results = [];
      for (const id of linkedIds) {
        const linkedRecord = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [id]);
        if (!linkedRecord) continue;
        const sourceField = await dbAdapter.queryOneAsync('SELECT * FROM fields WHERE id=$1', [opts.sourceFieldId]);
        const linkedFields = await fields(linkedRecord.table_id);
        const v = await value(linkedRecord, sourceField, linkedFields);
        if (v) results.push(v);
      }
      return results.filter(Boolean).join(', ');
    }
    return cell(record.id, field.id);
  }

  async function displayRecord(recordId, preferredNames = []) {
    const record = await dbAdapter.queryOneAsync('SELECT * FROM records WHERE id=$1', [recordId]);
    if (!record) return '';
    const fs = await fields(record.table_id);
    for (const name of preferredNames) {
      const f = fs.find(x => x.name === name);
      const v = await value(record, f, fs);
      if (v) return v;
    }
    for (const f of fs) {
      const v = await value(record, f, fs);
      if (v) return v;
    }
    return recordId;
  }

  return { table, fields, fieldsByName, cell, setCell, linked, firstLinked, addLink, createRecord, value, displayRecord, toDateString, toNumber };
}

module.exports = { makeGrid, toDateString, toNumber };
