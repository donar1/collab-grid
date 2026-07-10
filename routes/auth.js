// routes/auth.js — 认证相关路由
const express = require('express');
const { asyncHandler } = require('./utils');
const { validate } = require('../app/validate');
const { registerSchema, loginSchema, changePasswordSchema } = require('../app/validators');
const { blacklistToken } = require('../auth');

module.exports = function registerAuthRoutes({
  authRateLimit,
  registerUserAsync,
  loginUserAsync,
  refreshUserAsync,
  changePasswordAsync,
  getMeAsync,
  setTokenCookie,
  clearTokenCookie,
  authRequired,
  middleware,
  isProduction,
}) {
  const router = express.Router();

  // CSRF token 获取端点
  router.get('/csrf-token', (req, res) => {
    const token = middleware.csrfToken();
    res.cookie('csrf_token', token, { httpOnly: true, secure: isProduction, sameSite: 'Strict', path: '/' });
    res.json({ csrfToken: token });
  });

  // 注册
  router.post('/register', authRateLimit, validate(registerSchema), asyncHandler(async (req, res) => {
    const { email, password, displayName } = req.body || {};
    const result = await registerUserAsync({ email, password, displayName });
    if (result.error) return res.status(result.status).json({ error: result.error });
    setTokenCookie(res, result.token);
    res.json(result);
  }));

  // 登录
  router.post('/login', authRateLimit, validate(loginSchema), asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const result = await loginUserAsync({ email, password });
    if (result.error) return res.status(result.status).json({ error: result.error });
    setTokenCookie(res, result.token);
    res.json(result);
  }));

  // 登出
  router.post('/auth/logout', (req, res) => {
    clearTokenCookie(res);
    res.json({ ok: true });
  });

  // 刷新 token
  router.post('/auth/refresh', asyncHandler(async (req, res) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const cookieToken = req.cookies ? req.cookies['cg_token'] : null;
    const currentToken = token || cookieToken;
    const result = await refreshUserAsync({ currentToken });
    if (result.error) return res.status(result.status).json({ error: result.error });
    setTokenCookie(res, result.token);
    res.json(result);
  }));

  // 修改密码
  router.post('/auth/change-password', authRequired, authRateLimit, validate(changePasswordSchema), asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    const result = await changePasswordAsync({ userId: req.user.id, currentPassword: oldPassword, newPassword });
    if (result.error) return res.status(result.status).json({ error: result.error });
    // S-02: blacklist current JWT so it cannot be reused after password change
    if (req.user.jti) blacklistToken(req.user.jti);
    res.json(result);
  }));

  // 获取当前用户
  router.get('/me', authRequired, asyncHandler(async (req, res) => {
    const user = await getMeAsync(req.user.id);
    res.json({ user });
  }));

  return router;
};
