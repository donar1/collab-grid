// tests/integration/security.test.js — 安全集成测试
const assert = require('assert');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const TEST_DB = path.join(__dirname, 'security-test.db');

describe('security', () => {
  let db;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = new Database(TEST_DB);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT, system_role TEXT);
      CREATE TABLE bases (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT);
      CREATE TABLE members (base_id TEXT, user_id TEXT, role TEXT, PRIMARY KEY(base_id, user_id));
    `);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('should prevent SQL injection in parameterized queries', () => {
    const maliciousId = "'; DROP TABLE users; --";
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const result = stmt.get(maliciousId);
    assert.strictEqual(result, undefined);
    // Table should still exist
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const names = tables.map(t => t.name);
    assert.ok(names.includes('users'));
  });

  it('should hash passwords, not store plaintext', () => {
    const bcrypt = require('bcryptjs');
    const plainPassword = 'password123';
    const hash = bcrypt.hashSync(plainPassword, 10);
    db.prepare('INSERT INTO users (id, email, password_hash, system_role) VALUES (?, ?, ?, ?)')
      .run('u1', 'test@example.com', hash, 'user');
    const user = db.prepare('SELECT password_hash FROM users WHERE id=?').get('u1');
    assert.ok(!user.password_hash.includes(plainPassword));
    assert.ok(bcrypt.compareSync(plainPassword, user.password_hash));
  });

  it('should enforce unique email constraint', () => {
    db.prepare('INSERT INTO users (id, email, password_hash, system_role) VALUES (?, ?, ?, ?)')
      .run('u1', 'dup@example.com', 'hash1', 'user');
    assert.throws(() => {
      db.prepare('INSERT INTO users (id, email, password_hash, system_role) VALUES (?, ?, ?, ?)')
        .run('u2', 'dup@example.com', 'hash2', 'user');
    });
  });

  it('should verify member role exists', () => {
    db.prepare('INSERT INTO users (id, email, password_hash, system_role) VALUES (?, ?, ?, ?)')
      .run('u1', 'owner@test.com', 'hash', 'sys_admin');
    db.prepare('INSERT INTO bases (id, name, owner_id) VALUES (?, ?, ?)')
      .run('b1', 'TestBase', 'u1');
    db.prepare('INSERT INTO members (base_id, user_id, role) VALUES (?, ?, ?)')
      .run('b1', 'u1', 'owner');

    const member = db.prepare('SELECT role FROM members WHERE base_id=? AND user_id=?').get('b1', 'u1');
    assert.strictEqual(member.role, 'owner');
  });
});
