// ecosystem.config.cjs — pm2 进程守护配置
module.exports = {
  apps: [{
    name: 'collab-grid',
    script: 'server.js',
    instances: 1,
    max_memory_restart: '512M',
    autorestart: true,
    watch: false,
    env: { NODE_ENV: 'development', PORT: 3001 }
  }]
};