// app/alerts.js — 内存告警管理
const MAX_ALERTS = 100;
const alerts = [];

function pushAlert(level, source, message) {
  alerts.push({
    timestamp: new Date().toISOString(),
    level, // 'error' | 'warn' | 'info'
    source, // 'scheduler' | 'socket' | 'db' | 'system'
    message,
  });
  if (alerts.length > MAX_ALERTS) alerts.shift();

  // 尝试发送邮件通知（异步，不阻塞）
  if (level === 'error' || level === 'warn') {
    require('./notifier').notifyAlert(level, source, message).catch(() => {});
  }
}

function getAlerts({ level, source, since, limit = 50 } = {}) {
  let result = alerts;
  if (level) result = result.filter(a => a.level === level);
  if (source) result = result.filter(a => a.source === source);
  if (since) result = result.filter(a => a.timestamp >= since);
  return result.slice(-limit);
}

function getStats() {
  return {
    total: alerts.length,
    lastHour: alerts.filter(a => Date.now() - new Date(a.timestamp).getTime() < 3600000).length,
    byLevel: {
      error: alerts.filter(a => a.level === 'error').length,
      warn: alerts.filter(a => a.level === 'warn').length,
      info: alerts.filter(a => a.level === 'info').length,
    },
  };
}

module.exports = { pushAlert, getAlerts, getStats };
