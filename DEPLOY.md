# CollabGrid 部署指南

## 环境要求

- Node.js >= 18
- PostgreSQL >= 14（生产环境）或 SQLite（开发环境）
- npm >= 9

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，根据环境修改配置。

### 3. 启动服务

```bash
# 开发模式（SQLite）
node server.js

# 生产模式（PostgreSQL）
NODE_ENV=production DB_ENGINE=postgresql node server.js
```

## 环境变量说明

### 基础配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | `development` | 运行环境 |
| `PORT` | `3000` | 服务端口 |

### 安全

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JWT_SECRET` | `dev-secret-change-me` | JWT 密钥（生产必须修改） |
| `ALLOWED_ORIGINS` | `` | CORS 允许来源（生产必须设置） |

### 数据库

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_ENGINE` | `sqlite` | 数据库引擎：sqlite / postgresql |
| `DB_PATH` | `./data/collab-grid.db` | SQLite 文件路径 |
| `PG_HOST` | `localhost` | PostgreSQL 主机 |
| `PG_PORT` | `5432` | PostgreSQL 端口 |
| `PG_DATABASE` | `collabgrid` | PostgreSQL 数据库名 |
| `PG_USER` | `postgres` | PostgreSQL 用户名 |
| `PG_PASSWORD` | `` | PostgreSQL 密码 |
| `PG_POOL_MAX` | `20` | 连接池最大连接数 |
| `PG_READ_HOST` | `` | 读副本主机（可选） |
| `PG_READ_PORT` | `5432` | 读副本端口 |

### 日志

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LOG_LEVEL` | `info` | 日志级别：debug/info/warn/error |
| `LOG_TO_FILE` | `false` | 是否写入日志文件 |
| `LOG_DIR` | `./logs` | 日志目录 |

### 默认管理员

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEFAULT_ADMIN_EMAIL` | `admin@collabgrid.local` | 默认管理员邮箱 |
| `DEFAULT_ADMIN_PASSWORD` | `` | 默认管理员密码（生产必须设置） |

## 生产环境检查清单

- [ ] 修改 `JWT_SECRET`（至少 32 位随机字符串）
- [ ] 设置 `ALLOWED_ORIGINS`（禁止 CORS 全开放）
- [ ] 设置 `DEFAULT_ADMIN_PASSWORD`（强密码）
- [ ] 使用 PostgreSQL（`DB_ENGINE=postgresql`）
- [ ] 配置 `PG_PASSWORD`
- [ ] 配置 `PG_READ_HOST`（如需读写分离）
- [ ] 启用日志文件（`LOG_TO_FILE=true`）
- [ ] 配置反向代理（Nginx）
- [ ] 启用 HTTPS
- [ ] 配置防火墙规则

## 健康检查

```bash
curl http://localhost:3000/health
```

返回示例：
```json
{
  "status": "ok",
  "uptime": 123.45,
  "timestamp": "2026-06-24T07:42:46.870Z",
  "engine": "postgresql"
}
```

## 监控端点

| 端点 | 说明 | 权限 |
|------|------|------|
| `GET /health` | 健康检查 | 公开 |
| `GET /api/system/business-relations` | 业务关系图 | 需登录 |

## 数据库迁移

### SQLite 到 PostgreSQL

```bash
node scripts/migrate-public-to-pg.js
```

### 验证迁移

```bash
node scripts/verify-migration.js
```

## 日志查看

```bash
# 实时查看日志
tail -f logs/app.log

# 查看错误日志
grep ERROR logs/app.log
```

## 故障排查

### 端口被占用

```bash
# 查找占用 3000 端口的进程
lsof -i :3000

# 或修改 PORT 环境变量
PORT=3001 node server.js
```

### 数据库连接失败

1. 检查 PostgreSQL 服务是否运行
2. 检查 `PG_HOST`、`PG_PORT`、`PG_USER`、`PG_PASSWORD` 配置
3. 检查数据库是否存在

### JWT 验证失败

- 检查 `JWT_SECRET` 是否设置
- 检查 token 是否过期

## 备份策略

### 自动备份

建议配置 cron 任务定期备份：

```bash
# SQLite
0 2 * * * cp data/collab-grid.db backups/collab-grid-$(date +\%Y\%m\%d).db

# PostgreSQL
0 2 * * * pg_dump -h localhost -U postgres collabgrid > backups/collabgrid-$(date +\%Y\%m\%d).sql
```

## 性能优化

### 连接池调优

根据并发量调整连接池大小：

```env
PG_POOL_MAX=50
PG_READ_POOL_MAX=20
```

### 读取优化

配置读副本实现读写分离：

```env
PG_READ_HOST=read-replica.example.com
PG_READ_PORT=5432
```
