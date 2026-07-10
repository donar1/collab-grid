// services/notificationJob.js — 定时聚合事件生成通知
const { aggregateEvents, listNotifications, unreadCount } = require('./notification');

let jobInterval = null;

/**
 * 启动定时聚合任务（默认每 60 秒执行一次）
 * @param {number} intervalMs
 * @param {function} onNotification - 可选回调，新通知生成后调用 onNotification(userId, notification)
 */
function start(intervalMs = 60 * 1000, onNotification = null) {
  if (jobInterval) clearInterval(jobInterval);
  jobInterval = setInterval(async () => {
    try {
      const result = await aggregateEvents();
      if (result.notifications > 0 && onNotification) {
        // 通知所有有未读通知的用户（通过 socket 广播）
        // 用 aggregateEvents 内的最后一批通知 user_id 作为通知目标
        // 简化：广播 'notification:new' 事件，前端自行拉取最新数据
        onNotification(null, { count: result.notifications });
      }
    } catch (e) {
      console.error('[notificationJob] 聚合失败:', e.message);
    }
  }, intervalMs);
  console.log(`[notificationJob] 启动成功，间隔 ${intervalMs}ms`);
}

/**
 * 停止定时任务
 */
function stop() {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
    console.log('[notificationJob] 已停止');
  }
}

module.exports = { start, stop };
