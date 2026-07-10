// routes/notifications.js — 通知路由
const { asyncHandler } = require('./utils');
const notificationService = require('../services/notification');

module.exports = function (ctx) {
  const { authRequired } = ctx;
  const express = require('express');
  const router = express.Router();

  // 获取当前用户的通知列表
  router.get('/api/notifications', authRequired, asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const unreadOnly = req.query.unread === 'true';
    const notifications = await notificationService.listNotifications(req.user.id, { limit, offset, unreadOnly });
    const unread = await notificationService.unreadCount(req.user.id);
    res.json({ notifications, unread });
  }));

  // 获取未读通知数量
  router.get('/api/notifications/unread-count', authRequired, asyncHandler(async (req, res) => {
    const count = await notificationService.unreadCount(req.user.id);
    res.json({ count });
  }));

  // 标记单条通知为已读
  router.patch('/api/notifications/:id/read', authRequired, asyncHandler(async (req, res) => {
    await notificationService.markAsRead(req.user.id, req.params.id);
    res.json({ ok: true });
  }));

  // 批量标记所有通知为已读
  router.patch('/api/notifications/read-all', authRequired, asyncHandler(async (req, res) => {
    await notificationService.markAllAsRead(req.user.id);
    res.json({ ok: true });
  }));

  // 删除单条通知
  router.delete('/api/notifications/:id', authRequired, asyncHandler(async (req, res) => {
    await notificationService.deleteNotification(req.user.id, req.params.id);
    res.json({ ok: true });
  }));

  return router;
};
