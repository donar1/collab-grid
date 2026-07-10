// tests/unit/helpers.test.js — helpers.js 单元测试
const assert = require('assert');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const TEST_DB = path.join(__dirname, 'helpers-test.db');

describe('helpers', () => {
  let db;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = new Database(TEST_DB);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE tables (id TEXT PRIMARY KEY, base_id TEXT, name TEXT);
      CREATE TABLE fields (id TEXT PRIMARY KEY, table_id TEXT, name TEXT, type TEXT, options TEXT);
      CREATE TABLE records (id TEXT PRIMARY KEY, table_id TEXT, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE cells (record_id TEXT, field_id TEXT, value TEXT, PRIMARY KEY(record_id, field_id));
      CREATE TABLE links (id TEXT PRIMARY KEY, field_id TEXT, from_record_id TEXT, to_record_id TEXT);
    `);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('tableByName returns correct table', () => {
    db.prepare('INSERT INTO tables (id, base_id, name) VALUES (?, ?, ?)').run('t1', 'b1', 'Orders');
    const t = db.prepare('SELECT * FROM tables WHERE base_id=? AND name=?').get('b1', 'Orders');
    assert.ok(t);
    assert.strictEqual(t.id, 't1');
  });

  it('fieldsMap returns field name mapping', () => {
    db.prepare('INSERT INTO tables (id, base_id, name) VALUES (?, ?, ?)').run('t1', 'b1', 'Orders');
    db.prepare('INSERT INTO fields (id, table_id, name, type) VALUES (?, ?, ?, ?)').run('f1', 't1', 'Name', 'text');
    db.prepare('INSERT INTO fields (id, table_id, name, type) VALUES (?, ?, ?, ?)').run('f2', 't1', 'Price', 'currency');

    const fields = db.prepare('SELECT * FROM fields WHERE table_id=?').all('t1');
    const map = {};
    for (const f of fields) map[f.name] = f;

    assert.strictEqual(map['Name'].id, 'f1');
    assert.strictEqual(map['Price'].id, 'f2');
  });

  it('cellValue returns empty string for missing cell', () => {
    const value = db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get('r1', 'f1')?.value || '';
    assert.strictEqual(value, '');
  });

  it('cellValue returns correct value', () => {
    db.prepare('INSERT INTO cells (record_id, field_id, value) VALUES (?, ?, ?)').run('r1', 'f1', 'test-value');
    const value = db.prepare('SELECT value FROM cells WHERE record_id=? AND field_id=?').get('r1', 'f1')?.value || '';
    assert.strictEqual(value, 'test-value');
  });

  it('links query returns correct records', () => {
    db.prepare('INSERT INTO links (id, field_id, from_record_id, to_record_id) VALUES (?, ?, ?, ?)')
      .run('l1', 'f1', 'r1', 'r2');
    db.prepare('INSERT INTO links (id, field_id, from_record_id, to_record_id) VALUES (?, ?, ?, ?)')
      .run('l2', 'f1', 'r1', 'r3');

    const links = db.prepare('SELECT to_record_id FROM links WHERE field_id=? AND from_record_id=?').all('f1', 'r1');
    assert.strictEqual(links.length, 2);
    assert.ok(links.some(l => l.to_record_id === 'r2'));
    assert.ok(links.some(l => l.to_record_id === 'r3'));
  });
});
