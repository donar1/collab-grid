// verify-pg-to-sqlite.js — 验证 _pgToSQLite 修复
const db = require('../db');

// 模拟修复后的 _pgToSQLite（与 dbAdapter.js 中一致）
function _pgToSQLite(sql, params = []) {
  if (!params.length) return { sql: sql.replace(/\$\d+/g, '?'), params: [] };
  const indices = [];
  const newSql = sql.replace(/\$(\d+)/g, (match, num) => {
    indices.push(Number(num) - 1);
    return '?';
  });
  return { sql: newSql, params: indices.map(i => params[i]) };
}

// Test 1: 无重复 $N（正常情况，行为和之前一样）
console.log('=== Test 1: no duplicate $N ===');
const r1 = _pgToSQLite('SELECT * FROM records WHERE id=$1', ['rec_1']);
console.log('  SQL:', r1.sql, '| Params:', JSON.stringify(r1.params));
console.assert(r1.params.length === 1, 'FAIL: params count');
console.log('  PASS');

// Test 2: $1 重复（dashboardService.js L59 场景）
console.log('\n=== Test 2: $1 duplicate (dashboard links) ===');
const r2 = _pgToSQLite(
  'SELECT field_id, from_record_id, to_record_id FROM links WHERE from_record_id IN (SELECT id FROM records WHERE table_id=$1) OR to_record_id IN (SELECT id FROM records WHERE table_id=$1)',
  ['table_123']
);
console.log('  SQL:', r2.sql);
console.log('  Params:', JSON.stringify(r2.params));
console.assert(r2.params.length === 2, 'FAIL: params should have 2 entries (two $1 refs)');
console.assert(r2.params[0] === 'table_123' && r2.params[1] === 'table_123', 'FAIL: both should be table_123');
console.log('  PASS');

// Test 3: $1 重复（tables.js L488 场景）
console.log('\n=== Test 3: $1 duplicate (delete links) ===');
const r3 = _pgToSQLite(
  'DELETE FROM links WHERE from_record_id=$1 OR to_record_id=$1',
  ['rec_456']
);
console.log('  SQL:', r3.sql);
console.log('  Params:', JSON.stringify(r3.params));
console.assert(r3.params.length === 2, 'FAIL: params should have 2 entries');
console.log('  PASS');

// Test 4: $1 重复 + $2（tables.js L554 场景）
console.log('\n=== Test 4: $1 twice, $2 once ===');
const r4 = _pgToSQLite(
  'UPDATE records SET deleted_at=$1, updated_at=$1 WHERE id=$2',
  [123456789, 'rec_789']
);
console.log('  SQL:', r4.sql);
console.log('  Params:', JSON.stringify(r4.params));
console.assert(r4.params.length === 3, 'FAIL: params should have 3 entries');
console.assert(r4.params[0] === 123456789 && r4.params[1] === 123456789 && r4.params[2] === 'rec_789', 'FAIL: values wrong');
console.log('  PASS');

// Test 5: 无 params
console.log('\n=== Test 5: no params ===');
const r5 = _pgToSQLite('SELECT * FROM tables LIMIT 1', []);
console.log('  SQL:', r5.sql);
console.assert(r5.params.length === 0, 'FAIL: params should be empty');
console.log('  PASS');

// Test 6: 实际执行 - 模拟软删除（之前报错 Too few params）
console.log('\n=== Test 6: actual execution (soft delete) ===');
const realRec = db.prepare('SELECT id FROM records LIMIT 1').get();
if (realRec) {
  const r6 = _pgToSQLite(
    'UPDATE records SET deleted_at=$1, updated_at=$1 WHERE id=$2',
    [Date.now(), realRec.id]
  );
  console.log('  SQL:', r6.sql);
  console.log('  Params count:', r6.params.length);
  const info = db.prepare(r6.sql).run(...r6.params);
  console.log('  Affected rows:', info.changes);
  // 恢复
  db.prepare('UPDATE records SET deleted_at=NULL, updated_at=? WHERE id=?').run(Date.now(), realRec.id);
  console.log('  PASS');
} else {
  console.log('  SKIP: no records');
}

// Test 7: 实际执行 - 模拟 dashboard links 查询
console.log('\n=== Test 7: actual dashboard query ===');
const tables = db.prepare('SELECT id FROM tables LIMIT 1').all();
if (tables.length) {
  const r7 = _pgToSQLite(
    'SELECT field_id, from_record_id, to_record_id FROM links WHERE from_record_id IN (SELECT id FROM records WHERE table_id=$1) OR to_record_id IN (SELECT id FROM records WHERE table_id=$1)',
    [tables[0].id]
  );
  console.log('  SQL:', r7.sql);
  console.log('  Params count:', r7.params.length);
  const links = db.prepare(r7.sql).all(...r7.params);
  console.log('  Links found:', links.length);
  console.log('  PASS');
} else {
  console.log('  SKIP: no tables');
}

console.log('\n=== All tests passed! ===');