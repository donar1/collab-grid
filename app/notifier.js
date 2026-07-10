// app/notifier.js — 邮件通知（基于 Nodemailer，支持 TLS）
const nodemailer = require('nodemailer');
const config = require('../config');

// 复用 transporter 实例（按 host:port:user 缓存）
let _transporter = null;
let _transporterKey = '';

function getTransporter() {
  const { host, port, user, pass } = config.smtp;
  const key = `${host}:${port}:${user}`;
  if (_transporter && _transporterKey === key) return _transporter;

  if (!host) return null;

  _transporter = nodemailer.createTransport({
    host,
    port: port || 587,
    secure: (port || 587) === 465, // 465 使用 SSL，587 使用 STARTTLS
    auth: { user, pass },
    // TLS 配置
    tls: {
      rejectUnauthorized: true, // 生产环境启用证书校验
    },
    connectionTimeout: 10000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });

  _transporterKey = key;
  return _transporter;
}

async function sendEmail({ to, subject, text }) {
  const { from } = config.smtp;
  const transporter = getTransporter();
  if (!transporter || !to) return false;

  try {
    const info = await transporter.sendMail({
      from: from || config.smtp.user,
      to,
      subject,
      text,
    });
    return !!info.messageId;
  } catch (e) {
    console.error('[notifier] sendEmail failed:', e.message);
    return false;
  }
}

async function notifyAlert(level, source, message) {
  const { recipients } = config.smtp;
  if (!recipients.length) return;

  const subject = `[CollabGrid Alert] [${level.toUpperCase()}] ${source}: ${message.slice(0, 80)}`;
  const text = [
    `CollabGrid Alert`,
    `Time: ${new Date().toISOString()}`,
    `Level: ${level}`,
    `Source: ${source}`,
    `Message: ${message}`,
    '',
    'This is an automated alert from CollabGrid.',
  ].join('\n');

  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, text });
    } catch (e) {
      // silently fail - alerts are best-effort
    }
  }
}

// 关闭 transporter 连接池（用于优雅退出）
async function close() {
  if (_transporter) {
    try { _transporter.close(); } catch (_) {}
    _transporter = null;
    _transporterKey = '';
  }
}

module.exports = { sendEmail, notifyAlert, close };
