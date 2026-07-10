// tests/unit/syncService.test.js
// P2-2: syncService 纯单元测试（零依赖，无需数据库）

const syncService = require('../../services/syncService');

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`  FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

function assert(condition, label) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

// ---- publish & currentSeq ----
const seq1 = syncService.publish('base_1', 'record:update', { recordId: 'r1' });
assertEqual(seq1, 1, 'publish: first seq = 1');
const seq2 = syncService.publish('base_1', 'record:update', { recordId: 'r2' });
assertEqual(seq2, 2, 'publish: second seq = 2');
assertEqual(syncService.currentSeq('base_1'), 2, 'currentSeq: base_1 = 2');
assertEqual(syncService.currentSeq('nonexistent'), 0, 'currentSeq: nonexistent = 0');

// ---- missedEvents ----
const missed = syncService.missedEvents('base_1', 0);
assertEqual(missed.length, 2, 'missedEvents: lastSeq=0 returns 2');
assertEqual(missed[0].seq, 1, 'missedEvents: first seq=1');
assertEqual(missed[1].event, 'record:update', 'missedEvents: second event=record:update');

const missed2 = syncService.missedEvents('base_1', 1);
assertEqual(missed2.length, 1, 'missedEvents: lastSeq=1 returns 1');
assertEqual(missed2[0].seq, 2, 'missedEvents: after seq=1, next seq=2');

const missed3 = syncService.missedEvents('base_1', 2);
assertEqual(missed3.length, 0, 'missedEvents: lastSeq=current returns 0');

const missed4 = syncService.missedEvents('nonexistent', 0);
assertEqual(missed4.length, 0, 'missedEvents: nonexistent base returns 0');

// ---- buffer overflow ----
for (let i = 3; i <= syncService.RING_SIZE + 5; i++) {
  syncService.publish('base_1', 'record:update', { recordId: `r${i}` });
}
// lastSeq=1 意味着客户端丢失了 seq 2 及之后的事件，但缓冲区已溢出
const missed5 = syncService.missedEvents('base_1', 1);
assert(missed5.length === 1 && missed5[0].event === 'sync:snapshot', 'missedEvents: overflow returns sync:snapshot');
assertEqual(missed5[0].payload.reason, 'buffer_overflow', 'buffer overflow reason');

// ---- clear ----
syncService.clear('base_1');
assertEqual(syncService.currentSeq('base_1'), 0, 'clear: seq resets to 0');
assertEqual(syncService.missedEvents('base_1', 0).length, 0, 'clear: no missed events');

// ---- report ----
const total = passed + failed;
console.log(`\n syncService.test.js: ${total} tests, ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);