// tests/unit/dbAdapter.test.js
// Phase 9.1: dbAdapter.js 单元测试
// 覆盖：getEngine()、SQLite 模式下 query/queryOne/run/transaction

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — expected "${expected}", got "${actual}"`); }
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

function assertThrows(fn, label) {
  try {
    fn();
    failed++;
    console.error(`  FAIL: ${label} — expected throw, but did not`);
  } catch (_) {
    passed++;
  }
}

// ---- 测试 1: getEngine() 返回正确值 ----
console.log('\n--- dbAdapter.test.js: getEngine() ---');

const dbAdapter = require('../../services/dbAdapter');

assertEqual(dbAdapter.getEngine(), 'sqlite', '默认引擎为 sqlite');

// ---- 测试 2: SQLite 模式下 query/queryOne/run ----
console.log('\n--- dbAdapter.test.js: SQLite 同步接口 ---');

// query 返回数组
const users = dbAdapter.query('SELECT * FROM users LIMIT 5');
assert(Array.isArray(users), 'query() 返回数组');

// queryOne 返回单个对象或 null
const oneUser = dbAdapter.queryOne('SELECT * FROM users LIMIT 1');
assert(oneUser === null || typeof oneUser === 'object', 'queryOne() 返回对象或 null');

// run 返回对象（包含 changes 等）
const runResult = dbAdapter.run("SELECT count(*) as cnt FROM users");
assert(typeof runResult === 'object', 'run() 返回对象');

// query 带参数
const paramResult = dbAdapter.query('SELECT * FROM users WHERE id = ?', ['nonexistent-id-12345']);
assertDeepEqual(paramResult, [], 'query 带参数返回空数组');

// queryOne 带参数返回 undefined（SQLite 无匹配时）
const paramOne = dbAdapter.queryOne('SELECT * FROM users WHERE id = ?', ['nonexistent-id-12345']);
assertEqual(paramOne, undefined, 'queryOne 带参数返回 undefined');

// ---- 测试 3: transaction ----
console.log('\n--- dbAdapter.test.js: transaction ---');

// transaction 返回一个函数
const txFn = dbAdapter.transaction(() => {});
assert(typeof txFn === 'function', 'transaction() 返回函数');

// transaction 在 SQLite 模式下可以正常执行
const txResult = dbAdapter.transaction(() => {
  dbAdapter.run('SELECT 1');
  return 42;
})();
assertEqual(txResult, 42, 'transaction 执行并返回值');

// transaction 回滚
try {
  dbAdapter.transaction(() => {
    dbAdapter.run('SELECT 1');
    throw new Error('test rollback');
  })();
  failed++;
  console.error('  FAIL: transaction 应该抛出异常');
} catch (e) {
  assertEqual(e.message, 'test rollback', 'transaction 正确抛出异常');
}

// ---- 测试 4: 异步接口在 SQLite 模式下也能正常工作 ----
console.log('\n--- dbAdapter.test.js: 异步接口兼容性 ---');

(async () => {
  try {
    const asyncUsers = await dbAdapter.queryAsync('SELECT * FROM users LIMIT 3');
    assert(Array.isArray(asyncUsers), 'queryAsync() 返回数组');

    const asyncOne = await dbAdapter.queryOneAsync('SELECT * FROM users WHERE id = ?', ['nonexistent']);
    assertEqual(asyncOne, undefined, 'queryOneAsync() 无匹配返回 undefined');

    const asyncRun = await dbAdapter.runAsync('SELECT 1');
    assert(typeof asyncRun === 'object', 'runAsync() 返回对象');

    const asyncTx = await dbAdapter.transactionAsync(() => {
      dbAdapter.run('SELECT 1');
      return 'tx-ok';
    });
    assertEqual(asyncTx, 'tx-ok', 'transactionAsync() 返回值正确');

    // ---- 报告 ----
    const total = passed + failed;
    console.log(`\n dbAdapter.test.js: ${total} tests, ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    failed++;
    console.error('  FAIL: 异步测试异常:', e.message);
    const total = passed + failed;
    console.log(`\n dbAdapter.test.js: ${total} tests, ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
})();
