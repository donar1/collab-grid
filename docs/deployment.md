# CollabGrid 部署指南

## 目录

- [快速开始](#快速开始)
- [SQLite 模式部署](#sqlite-模式部署)
- [PostgreSQL 模式部署](#postgresql-模式部署)
- [PM2 生产部署](#pm2-生产部署)
- [环境变量说明](#环境变量说明)
- [数据备份与恢复](#数据备份与恢复)
- [健康检查端点](#健康检查端点)
- [从 SQLite 迁移到 PostgreSQL](#从-sqlite-迁移到-postgresql)

---

## 快速开始

```bash
# 克隆项目
git clone <repo-url> collab-grid
cd collab-grid

# 安装依赖
npm install

# 复制环境变量配置
cp .env.example .env

# 根据需要编辑 .env（详见环境变量说明）
```

---

## SQLite 模式部署

SQLite 模式适合开发环境和小规模部署（单机、数据量 < 1GB）。

### Docker Compose 部署

```bash
# 构建并启动（端口映射 3000:3000）
docker-compose up -d app
```

数据持久化：SQLite 数据库文件存储在 `./data` 目录，通过 Docker volume 映射到容器内 `/app/data`。

### 本地直接运行

```bash
# 确保 .env 中 DB_ENGINE=sqlite（默认值）
node server.js
```

### SQLite 配置要点

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `DB_ENGINE` | `sqlite` | 数据库引擎 |
| `DB_PATH` | `./data/collab-grid.db` | 数据库文件路径 |
| `DB_READ_POOL_SIZE` | `4` | 只读连接池大小（WAL 模式下并发读） |

SQLite 使用 WAL（Write-Ahead Logging）模式，支持读写并发：
- 写连接：单连接串行写入
- 读连接池：多个只读连接可并发读取

---

## PostgreSQL 模式部署

PostgreSQL 模式适合生产环境和中大规模部署（多实例、高并发、大数据量）。

### Docker Compose 部署

```bash
# 启动 PostgreSQL + 应用（端口映射 3001:3000）
docker-compose up -d app-pg
```

该命令会：
1. 启动 `postgres` 服务（PostgreSQL 16 Alpine）
2. 等待 PostgreSQL 健康检查通过（`pg_isready`）
3. 启动 `app-pg` 服务并自动建表

### PostgreSQL 连接配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `PG_HOST` | `localhost` | PostgreSQL 主机地址 |
| `PG_PORT` | `5432` | PostgreSQL 端口 |
| `PG_DATABASE` | `collabgrid` | 数据库名称 |
| `PG_USER` | `postgres` | 数据库用户 |
| `PG_PASSWORD` | （空） | 数据库密码 |
| `PG_POOL_MAX` | `20` | 写连接池最大连接数 |
| `PG_IDLE_TIMEOUT_MS` | `30000` | 空闲连接超时(ms) |
| `PG_CONNECTION_TIMEOUT_MS` | `5000` | 连接超时(ms) |

### 读写分离（可选）

当配置了 `PG_READ_HOST` 时，系统会创建独立的只读连接池指向只读副本：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `PG_READ_HOST` | （空） | 只读副本主机地址，留空则读写共用主库 |
| `PG_READ_PORT` | `5432` | 只读副本端口 |
| `PG_READ_POOL_MAX` | `10` | 只读连接池最大连接数 |

### 本地 PostgreSQL 部署

```bash
# 确保 PostgreSQL 已安装并运行
# 创建数据库
createdb collabgrid

# 设置环境变量
export DB_ENGINE=postgresql
export PG_HOST=localhost
export PG_PORT=5432
export PG_DATABASE=collabgrid
export PG_USER=postgres
export PG_PASSWORD=your_password

# 启动应用
node server.js
```

---

## PM2 生产部署

### 基本部署

```bash
# 使用生产环境配置启动
pm2 start ecosystem.config.cjs --env production
```

### 常用 PM2 命令

```bash
# 查看运行状态
pm2 status

# 查看日志
pm2 logs collab-grid

# 重启应用
pm2 restart collab-grid

# 停止应用
pm2 stop collab-grid

# 删除进程
pm2 delete collab-grid

# 监控面板
pm2 monit

# 保存当前进程列表（开机自启）
pm2 save
pm2 startup
```

### ecosystem.config.cjs 配置说明

```javascript
module.exports = {
  apps: [{
    name: 'collab-grid',        // 进程名称
    script: 'server.js',          // 入口脚本
    instances: 1,                 // 实例数（单实例，SQLite 不支持多进程）
    exec_mode: 'fork',            // 执行模式
    max_memory_restart: '512M',   // 内存超限自动重启
    autorestart: true,           // 崩溃自动重启
    env_production: {
      NODE_ENV: 'production',
    },
  }],
};
```

> **注意**：SQLite 模式下 `instances` 必须为 1，因为 SQLite 不支持多进程并发写入。PostgreSQL 模式可适当增加实例数。

---

## 环境变量说明

完整环境变量列表参考 `.env.example`。

### 基础配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | `development` | 运行环境：development / production |
| `PORT` | `3000` | 服务监听端口 |

### 安全配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JWT_SECRET` | `change-me-to-a-256-bit-secret` | JWT 签名密钥（**生产环境必须修改**） |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | CORS 允许的来源（逗号分隔） |

### 数据库配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_ENGINE` | `sqlite` | 数据库引擎：sqlite / postgresql |
| `DB_PATH` | `./data/collab-grid.db` | SQLite 数据库文件路径 |
| `PUBLIC_DB_PATH` | `./data/public.db` | 外部查询数据库路径 |
| `DB_READ_POOL_SIZE` | `4` | SQLite 只读连接池大小 |

### PostgreSQL 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PG_HOST` | `localhost` | PostgreSQL 主机 |
| `PG_PORT` | `5432` | PostgreSQL 端口 |
| `PG_DATABASE` | `collabgrid` | 数据库名称 |
| `PG_USER` | `postgres` | 数据库用户名 |
| `PG_PASSWORD` | （空） | 数据库密码 |
| `PG_POOL_MAX` | `20` | 写连接池最大连接数 |
| `PG_IDLE_TIMEOUT_MS` | `30000` | 空闲连接超时(ms) |
| `PG_CONNECTION_TIMEOUT_MS` | `5000` | 连接获取超时(ms) |
| `PG_READ_HOST` | （空） | 只读副本主机（留空禁用读写分离） |
| `PG_READ_PORT` | `5432` | 只读副本端口 |
| `PG_READ_POOL_MAX` | `10` | 只读连接池最大连接数 |

### 日志配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LOG_LEVEL` | `info` | 日志级别：debug / info / warn / error |
| `LOG_TO_FILE` | `false` | 是否输出到文件 |
| `LOG_DIR` | `./logs` | 日志文件目录 |

### 速率限制

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `RATE_LIMIT_WINDOW_MS` | `60000` | 速率限制时间窗口(ms) |
| `RATE_LIMIT_MAX` | `20` | 时间窗口内最大请求数 |
| `AUTH_RATE_LIMIT_MAX` | `10` | 认证接口速率限制 |

### 调度器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SCHEDULER_ENABLED` | `true` | 是否启用定时任务调度器 |
| `SCHEDULER_INTERVAL_MINUTES` | `1` | 调度器检查间隔(分钟) |

### 上传

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `UPLOAD_MAX_SIZE` | `10485760` | 最大上传文件大小(字节)，默认 10MB |

### 默认管理员

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DEFAULT_ADMIN_EMAIL` | `admin@collabgrid.local` | 默认管理员邮箱 |
| `DEFAULT_ADMIN_DISPLAY_NAME` | `系统管理员` | 默认管理员显示名 |
| `DEFAULT_ADMIN_PASSWORD` | `Admin@123456` | 默认管理员密码（**生产环境必须修改**） |

### 生产环境安全检查

`config.js` 在生产环境下会强制检查以下配置：
- `ALLOWED_ORIGINS` 不能为空（禁止 CORS 全开放）
- `JWT_SECRET` 不能为默认值

---

## 数据备份与恢复

### SQLite 备份

```bash
# 方法 1: 直接复制数据库文件（需先停止写入或使用 WAL checkpoint）
sqlite3 data/collab-grid.db "PRAGMA wal_checkpoint(TRUNCATE);"
cp data/collab-grid.db backups/collab-grid-$(date +%Y%m%d-%H%M%S).db

# 方法 2: 使用 sqlite3 备份 API
sqlite3 data/collab-grid.db ".backup backups/collab-grid-$(date +%Y%m%d-%H%M%S).db"
```

### SQLite 恢复

```bash
# 停止应用
pm2 stop collab-grid

# 替换数据库文件
cp backups/collab-grid-20260623-120000.db data/collab-grid.db

# 重启应用
pm2 restart collab-grid
```

### PostgreSQL 备份

```bash
# 全库备份（自定义格式，支持并行恢复）
pg_dump -Fc -U postgres collabgrid > backups/collab-grid-$(date +%Y%m%d-%H%M%S).dump

# SQL 文本格式备份
pg_dump -U postgres collabgrid > backups/collab-grid-$(date +%Y%m%d-%H%M%S).sql

# 仅备份 schema
pg_dump -s -U postgres collabgrid > backups/collab-grid-schema-$(date +%Y%m%d-%H%M%S).sql
```

### PostgreSQL 恢复

```bash
# 从自定义格式恢复
pg_restore -U postgres -d collabgrid backups/collab-grid-20260623-120000.dump

# 从 SQL 文本恢复
psql -U postgres -d collabgrid < backups/collab-grid-20260623-120000.sql
```

### Docker 环境备份

```bash
# SQLite: 备份挂载的 data 目录
docker run --rm -v collab-grid_data:/app/data -v $(pwd)/backups:/backup alpine \
  tar czf /backup/collab-grid-$(date +%Y%m%d).tar.gz /app/data

# PostgreSQL: 使用 docker exec
docker exec collab-grid-postgres-1 pg_dump -U postgres collabgrid > backup.sql
```

---

## 健康检查端点

### GET /health

返回服务健康状态，用于负载均衡器和监控探针。

#### SQLite 模式响应

```json
{
  "status": "healthy",
  "dbEngine": "sqlite",
  "uptime": 3600000,
  "timestamp": 1719123456789
}
```

#### PostgreSQL 模式响应

```json
{
  "status": "healthy",
  "dbEngine": "postgresql",
  "writeLatency": 2,
  "readLatency": 1,
  "poolStats": {
    "write": {
      "total": 5,
      "idle": 4,
      "waiting": 0
    },
    "read": {
      "total": 3,
      "idle": 3,
      "waiting": 0
    },
    "readReplica": true
  },
  "readReplica": true
}
```

#### 异常响应

```json
{
  "status": "unhealthy",
  "error": "connection refused"
}
```

#### 使用示例

```bash
# 基本检查
curl http://localhost:3000/health

# Docker 健康检查配置（docker-compose.yml 中已配置 postgres 的健康检查）
# 应用层可在 Dockerfile 中添加：
# HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
#   CMD curl -f http://localhost:3000/health || exit 1
```

---

## 从 SQLite 迁移到 PostgreSQL

以下步骤将 SQLite 数据库迁移到 PostgreSQL。

### 步骤 1: 准备 PostgreSQL 环境

```bash
# 确保 PostgreSQL 已运行
docker-compose up -d postgres

# 等待 PostgreSQL 就绪
docker-compose exec postgres pg_isready -U postgres
```

### 步骤 2: 安装迁移工具

```bash
npm install -g pgloader
# 或使用 pg_dump / sqlite3 手动迁移
```

### 步骤 3: 导出 SQLite 数据

```bash
# 导出为 SQL（需要适配 PostgreSQL 语法）
sqlite3 data/collab-grid.db .dump > sqlite_dump.sql
```

### 步骤 4: 转换 SQL 语法

SQLite 和 PostgreSQL 的语法差异需要手动处理：

| SQLite | PostgreSQL |
|--------|------------|
| `INTEGER PRIMARY KEY` (自增) | `SERIAL` 或 `INTEGER GENERATED ALWAYS AS IDENTITY` |
| `TEXT` | `VARCHAR(n)` 或 `TEXT` |
| `REAL` | `DOUBLE PRECISION` |
| `datetime('now')` | `NOW()` |
| `PRAGMA foreign_keys = ON` | 默认启用 |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT DO UPDATE` |

推荐使用 `pgAdapter.js` 中的 `SCHEMA_SQL` 在 PostgreSQL 中建表，然后只迁移数据。

### 步骤 5: 在 PostgreSQL 中建表

```bash
# 设置环境变量
export DB_ENGINE=postgresql
export PG_HOST=localhost
export PG_PORT=5432
export PG_DATABASE=collabgrid
export PG_USER=postgres
export PG_PASSWORD=pgpass

# 启动应用一次，自动执行 SCHEMA_SQL 建表
node -e "
const { initPools, initSchema, closePools } = require('./pgAdapter');
(async () => {
  await initSchema();
  await closePools();
  console.log('Schema created');
})();
"
```

### 步骤 6: 迁移数据

编写迁移脚本，逐表导出 SQLite 数据并导入 PostgreSQL：

```bash
node scripts/migrate-sqlite-to-pg.js
```

迁移脚本示例逻辑：
1. 从 SQLite 读取每张表的数据
2. 按照外键依赖顺序（users -> bases -> members -> tables -> ...）插入 PostgreSQL
3. 处理自增 ID 和序列重置
4. 验证数据完整性

### 步骤 7: 切换并验证

```bash
# 修改 .env
# DB_ENGINE=postgresql

# 重启应用
pm2 restart collab-grid

# 验证健康检查
curl http://localhost:3000/health

# 验证数据
# - 检查用户列表
# - 检查 Base 列表
# - 检查记录数据
```

### 注意事项

- 迁移前务必完整备份 SQLite 数据库
- 迁移期间建议停止写入（维护模式）
- 迁移后保留 SQLite 备份至少一周
- `commission_ledger` 和 `order_activity_daily` 有大量数据时，建议分批迁移
- `permission_overrides` 表由 `matrixStore.js` 自动创建，无需手动迁移
