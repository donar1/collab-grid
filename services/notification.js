// services/notification.js — 通知服务（事件聚合 + 通知生成 + 批量插入）
const { nanoid } = require('nanoid');
const dbAdapter = require('./dbAdapter');

/**
 * 批量插入事件（供业务代码调用）
 * @param {Array<{baseId, type, payload}>} events
 */
async function insertEvents(events) {
  if (!events?.length) return;
  const ts = Date.now();
  for (const e of events) {
    await dbAdapter.writeQueryAsync(
      'INSERT INTO events (id, base_id, type, payload, created_at, processed) VALUES ($1,$2,$3,$4,$5,$6)',
      [nanoid(), e.baseId, e.type, JSON.stringify(e.payload), ts, 0]
    );
  }
}

/**
 * 批量插入通知（供聚合 job 调用）
 * @param {Array<{userId, baseId, type, title, content}>} notifications
 */
async function insertNotifications(notifications) {
  if (!notifications?.length) return;
  const ts = Date.now();
  for (const n of notifications) {
    await dbAdapter.writeQueryAsync(
      'INSERT INTO notifications (id, user_id, base_id, type, title, content, read, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [nanoid(), n.userId, n.baseId || null, n.type, n.title, n.content ? JSON.stringify(n.content) : null, 0, ts]
    );
  }
}

/**
 * 聚合未处理的事件，生成用户通知
 */
async function aggregateEvents() {
  // 1. 获取所有未处理的事件
  const events = await dbAdapter.queryAsync(
    'SELECT * FROM events WHERE processed=0 ORDER BY created_at ASC LIMIT 500'
  );
  if (!events.length) return { processed: 0, notifications: 0 };

  // 2. 按 base_id 分组
  const byBase = new Map();
  for (const e of events) {
    if (!byBase.has(e.base_id)) byBase.set(e.base_id, []);
    byBase.get(e.base_id).push(e);
  }

  let totalNotifications = 0;

  // 3. 对每个 base 分别聚合
  for (const [baseId, baseEvents] of byBase) {
    // 获取该 base 的所有成员
    const members = await dbAdapter.queryAsync(
      'SELECT user_id FROM members WHERE base_id=$1',
      [baseId]
    );
    const userIds = members.map(m => m.user_id);
    if (!userIds.length) continue;

    // 按 type 聚合
    const byType = new Map();
    for (const e of baseEvents) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type).push(e);
    }

    const notifications = [];

    for (const [type, typeEvents] of byType) {
      if (type === 'exception') {
        // 异常事件：逐条生成通知
        for (const e of typeEvents) {
          const payload = JSON.parse(e.payload);
          for (const uid of userIds) {
            notifications.push({
              userId: uid,
              baseId,
              type: 'exception',
              title: payload.title || '业务异常提醒',
              content: payload,
            });
          }
        }
      } else if (type === 'inventory') {
        // 库存预警：按产品聚合，去重
        const productIds = new Set();
        for (const e of typeEvents) {
          const payload = JSON.parse(e.payload);
          if (payload.recordId) productIds.add(payload.recordId);
        }
        if (productIds.size > 0) {
          for (const uid of userIds) {
            notifications.push({
              userId: uid,
              baseId,
              type: 'inventory',
              title: `库存预警：${productIds.size} 个产品库存不足`,
              content: { productIds: [...productIds], count: productIds.size },
            });
          }
        }
      } else if (type === 'system') {
        // 系统事件：逐条生成
        for (const e of typeEvents) {
          const payload = JSON.parse(e.payload);
          for (const uid of userIds) {
            notifications.push({
              userId: uid,
              baseId,
              type: 'system',
              title: payload.title || '系统通知',
              content: payload,
            });
          }
        }
      }
    }

    if (notifications.length) {
      await insertNotifications(notifications);
      totalNotifications += notifications.length;
    }
  }

  // 4. 标记事件为已处理
  const eventIds = events.map(e => e.id);
  const placeholders = eventIds.map((_, i) => `$${i + 1}`).join(',');
  await dbAdapter.writeQueryAsync(
    `UPDATE events SET processed=1 WHERE id IN (${placeholders})`,
    eventIds
  );

  return { processed: events.length, notifications: totalNotifications };
}

/**
 * 获取用户的通知列表
 * @param {string} userId
 * @param {{limit?: number, offset?: number, unreadOnly?: boolean}} options
 */
async function listNotifications(userId, options = {}) {
  const { limit = 50, offset = 0, unreadOnly = false } = options;
  let sql = 'SELECT * FROM notifications WHERE user_id=$1';
  const params = [userId];
  if (unreadOnly) {
    sql += ' AND read=0';
  }
  sql += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
  params.push(limit, offset);
  return dbAdapter.queryAsync(sql, params);
}

/**
 * 获取用户未读通知数量
 * @param {string} userId
 */
async function unreadCount(userId) {
  const row = await dbAdapter.queryOneAsync(
    'SELECT COUNT(*) as cnt FROM notifications WHERE user_id=$1 AND read=0',
    [userId]
  );
  return row?.cnt || 0;
}

/**
 * 标记通知为已读
 * @param {string} userId
 * @param {string} notificationId
 */
async function markAsRead(userId, notificationId) {
  await dbAdapter.writeQueryAsync(
    'UPDATE notifications SET read=1 WHERE id=$1 AND user_id=$2',
    [notificationId, userId]
  );
}

/**
 * 批量标记所有通知为已读
 * @param {string} userId
 */
async function markAllAsRead(userId) {
  await dbAdapter.writeQueryAsync(
    'UPDATE notifications SET read=1 WHERE user_id=$1 AND read=0',
    [userId]
  );
}

/**
 * 删除通知
 * @param {string} userId
 * @param {string} notificationId
 */
async function deleteNotification(userId, notificationId) {
  await dbAdapter.writeQueryAsync(
    'DELETE FROM notifications WHERE id=$1 AND user_id=$2',
    [notificationId, userId]
  );
}

module.exports = {
  insertEvents,
  insertNotifications,
  aggregateEvents,
  listNotifications,
  unreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
