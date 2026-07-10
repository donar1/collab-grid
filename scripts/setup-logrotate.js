// scripts/setup-logrotate.js — 一键安装 PM2 日志轮转
// Usage: node scripts/setup-logrotate.js
const { execSync } = require('child_process');

try {
  console.log('Installing pm2-logrotate...');
  execSync('npx pm2 install pm2-logrotate', { stdio: 'inherit' });
  console.log('Configuring rotation...');
  execSync('npx pm2 set pm2-logrotate:max_size 10M', { stdio: 'inherit' });
  execSync('npx pm2 set pm2-logrotate:retain 30', { stdio: 'inherit' });
  execSync('npx pm2 set pm2-logrotate:compress true', { stdio: 'inherit' });
  execSync('npx pm2 set pm2-logrotate:rotateInterval 0 0 * * *', { stdio: 'inherit' });
  console.log('Done. Logs will rotate daily at midnight, keeping 30 days.');
} catch (e) {
  console.error('Failed to install pm2-logrotate:', e.message);
  process.exit(1);
}
