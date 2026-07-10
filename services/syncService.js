// services/syncService.js
// P2-2: Socket.IO 重同步协议
// seq 号 + 环形缓冲区 + 断连补发
// 每个 base 维护一个环形缓冲区，最多保留 RING_SIZE 条事件

const RING_SIZE = 2000;

// baseId -> { counter, buffer: [{ seq, event, payload, ts }] }
const rings = new Map();

function getOrCreateRing(baseId) {
  let ring = rings.get(baseId);
  if (!ring) {
    ring = { counter: 0, buffer: [], lastAccess: Date.now() };
    rings.set(baseId, ring);
  }
  ring.lastAccess = Date.now();
  return ring;
}

/**
 * 发布事件到同步缓冲区并返回 seq 号
 * @param {string} baseId
 * @param {string} event - 事件名
 * @param {object} payload - 事件载荷
 * @returns {number} seq 号
 */
function publish(baseId, event, payload) {
  const ring = getOrCreateRing(baseId);
  ring.lastAccess = Date.now(); // H-10: track last activity for GC
  const seq = ++ring.counter;
  ring.buffer.push({ seq, event, payload, ts: Date.now() });
  if (ring.buffer.length > RING_SIZE) {
    ring.buffer.shift();
  }
  return seq;
}

/**
 * 获取从指定 seq 之后缺失的事件列表
 * @param {string} baseId
 * @param {number} lastSeq - 客户端持有的最新 seq，0 表示未加入过
 * @returns {Array} 缺失事件数组 [{ seq, event, payload, ts }]
 */
function missedEvents(baseId, lastSeq) {
  const ring = rings.get(baseId);
  if (!ring || !ring.buffer.length) return [];
  if (lastSeq >= ring.counter) return [];
  // lastSeq 可能太久远，缓冲区已被覆盖（0 表示首次加入，不从 buffer 判断）
  const firstSeq = ring.buffer[0].seq;
  if (lastSeq > 0 && lastSeq < firstSeq) {
    // 缓冲区不完整，返回当前快照提示（由客户端决定全量刷新）
    return [{ seq: 0, event: 'sync:snapshot', payload: { reason: 'buffer_overflow', currentSeq: ring.counter } }];
  }
  return ring.buffer.filter(item => item.seq > lastSeq);
}

/**
 * 获取 base 的当前最新 seq
 */
function currentSeq(baseId) {
  const ring = rings.get(baseId);
  return ring ? ring.counter : 0;
}

/**
 * 清理 base 的缓冲区（当 base 被删除时）
 */
function clear(baseId) {
  rings.delete(baseId);
}

async function publishAsync(...args) {
  return publish(...args);
}
async function missedEventsAsync(...args) {
  return missedEvents(...args);
}
async function currentSeqAsync(...args) {
  return currentSeq(...args);
}
async function clearAsync(...args) {
  return clear(...args);
}

// H-10: Periodic cleanup of stale rings (bases not accessed for 30 minutes)
const RING_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [baseId, ring] of rings) {
    if (!ring.lastAccess || (now - ring.lastAccess > RING_TTL_MS)) {
      rings.delete(baseId);
    }
  }
}, 5 * 60 * 1000); // check every 5 minutes

module.exports = { publish, publishAsync, missedEvents, missedEventsAsync, currentSeq, currentSeqAsync, clear, clearAsync, RING_SIZE };