// app/socket.js — Socket.IO 认证与实时同步
const { verify } = require('../auth');
const { parseCookies } = require('../services/helpers');

const HEARTBEAT_INTERVAL = 30 * 1000;   // 心跳检查间隔：30 秒
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 活动超时阈值：5 分钟

// 存储每个 socket 的心跳定时器
const heartbeatTimers = new Map();

function parseSocketCookie(socket) {
  return parseCookies(socket.handshake.headers.cookie);
}

function buildSocketAuth({ verifyToken, isMember, getUserById }) {
  return async (socket, next) => {
    const cookies = parseSocketCookie(socket);
    const token = cookies['cg_token'] || socket.handshake.auth?.token;
    const payload = token ? verifyToken(token) : null;
    if (!payload) return next(new Error('unauthorized'));
    // HIGH-7/8: 验证用户仍然存在且未被禁用
    const user = await getUserById(payload.uid);
    if (!user) return next(new Error('user not found'));
    socket.user = { id: user.id, email: user.email };
    next();
  };
}

function buildSocketHandlers({ io, isMember, syncService, getUserById }) {
  io.use(buildSocketAuth({ verifyToken: verify, isMember, getUserById }));

  io.on('connection', (socket) => {
    // HIGH-10: 连接数限制（每 IP 最多 10 个并发连接）
    const clientIp = socket.handshake.address;
    const connectionsFromIp = Array.from(io.sockets.sockets.values())
      .filter(s => s.handshake.address === clientIp).length;
    if (connectionsFromIp > 10) {
      socket.disconnect(true);
      return;
    }

    // 心跳活跃度检测：记录初始活动时间并启动定时检查
    socket.lastActivity = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - socket.lastActivity > INACTIVITY_TIMEOUT) {
        console.log(`[heartbeat] socket ${socket.id} (user ${socket.user?.id}) inactive for >5min, disconnecting`);
        socket.disconnect(true);
      }
    }, HEARTBEAT_INTERVAL);
    heartbeatTimers.set(socket.id, timer);

    socket.on('base:join', async (baseId) => {
      if (!(await isMember(baseId, socket.user.id))) return;
      socket.join('base:' + baseId);
      socket.emit('sync:seq', { baseId, lastSeq: syncService.currentSeq(baseId) });
      // HIGH-9: 广播 userId 而非 email（PII 保护）
      socket.to('base:' + baseId).emit('presence:join', { userId: socket.user.id });
    });

    socket.on('base:leave', (baseId) => {
      socket.leave('base:' + baseId);
      socket.to('base:' + baseId).emit('presence:leave', { userId: socket.user.id });
    });

    // HIGH-10: 限流——每个 socket 每 100ms 最多处理 1 个 sync:request
    const rateLimits = new Map();
    socket.on('sync:request', async ({ baseId, lastSeq }) => {
      const now = Date.now();
      const last = rateLimits.get(socket.id) || 0;
      if (now - last < 100) return; // 限流
      rateLimits.set(socket.id, now);
      socket.lastActivity = now; // 更新心跳活跃时间戳

      if (!(await isMember(baseId, socket.user.id))) return;
      const missed = syncService.missedEvents(baseId, lastSeq || 0);
      for (const item of missed) {
        if (item.event === 'sync:snapshot') {
          socket.emit('sync:snapshot', { baseId, reason: item.payload.reason, currentSeq: item.payload.currentSeq });
        } else {
          socket.emit(item.event, item.payload);
        }
      }
      socket.emit('sync:ack', { baseId, currentSeq: syncService.currentSeq(baseId) });
    });

    socket.on('disconnect', () => {
      // 清理限流记录
      rateLimits.delete(socket.id);

      // 清理所有已加入的房间
      for (const room of socket.rooms) {
        socket.leave(room);
      }

      // 清理心跳定时器
      const timer = heartbeatTimers.get(socket.id);
      if (timer) {
        clearInterval(timer);
        heartbeatTimers.delete(socket.id);
      }
    });
  });
}

/**
 * 获取当前连接统计信息
 * @param {import('socket.io').Server} io
 * @returns {{ total: number, byBase: Object.<string, number> }}
 */
function getConnectionStats(io) {
  const total = io.sockets.sockets.size;
  const byBase = {};
  for (const socket of io.sockets.sockets.values()) {
    for (const room of socket.rooms) {
      if (room.startsWith('base:')) {
        const baseId = room.slice(5); // 去掉 "base:" 前缀
        byBase[baseId] = (byBase[baseId] || 0) + 1;
      }
    }
  }
  return { total, byBase };
}

module.exports = { buildSocketHandlers, getConnectionStats };
