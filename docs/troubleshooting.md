# CollabGrid 故障排查指南

本文档涵盖 CollabGrid 在安装、部署和运行过程中常见问题的诊断与解决方法。涉及的实际配置值和代码行为均基于项目源码，确保准确性。

---

## 日志格式速查

系统使用 `logger.js` 输出结构化日志，格式如下：

```
[ISO时间] [级别] [追踪ID] 消息 {结构化数据}
```

级别分为：`DEBUG`、`INFO`、`WARN`、`ERROR`（ERROR 输出到 stderr，其余输出到 stdout）。每条日志携带一个唯一的追踪 ID（traceId），可通过 `AsyncLocalStorage` 跨异步调用传递，便于在并发请求中追踪完整调用链。

敏感字段（如 `password`、`token`、`secret`、`jwt`、`cookie`、`email` 等）在日志中会自动脱敏显示为 `[REDACTED]`。

可通过 `LOG_LEVEL` 环境变量控制日志级别（默认 `info`），设置为 `LOG_LEVEL=debug` 可获取更详细的调试信息。

---

## 1. better-sqlite3 编译失败

### 症状

`npm install` 时报 native module 编译错误，常见错误信息：

```
gyp ERR! build error
gyp ERR! stack Error: `C:\Program Files (x86)\Microsoft Visual Studio\...\MSBuild.exe` failed
```

或

```
node-pre-gyp WARN Tried to download(403): https://github.com/JoshuaWise/better-sqlite3/releases/download/v11.3.0/better-sqlite3-v11.3.0-electron-v93-win32-x64.tar.gz
```

### 原因

`better-sqlite3`（当前版本 `^11.3.0`，见 `package.json`）包含 C++ 原生模块，在 Windows 上需要以下编译工具链：

- **Visual Studio Build Tools**（含 C++ 桌面开发工作负载）
- **Python**（node-gyp 依赖，推荐 Python 3.x）

缺少任一工具都会导致 `node-gyp` 编译失败。

### 解决

**方案 A：安装编译工具链**

```powershell
# 以管理员权限运行 PowerShell
npm install -g windows-build-tools
# 或手动安装 Visual Studio Build Tools，勾选"使用 C++ 的桌面开发"
```

安装后重新执行：

```powershell
# 清除缓存后重新安装
npm cache clean --force
npm install
```

**方案 B：使用 prebuilt binary**

```powershell
# 如果网络允许，尝试直接下载预编译二进制
npm install --build-from-source=false
```

**方案 C：使用 SQLite 模式的替代方案**

如果编译问题无法解决，可切换到 PostgreSQL 模式，在 `.env` 中设置：

```env
DB_ENGINE=postgresql
```

此时无需 `better-sqlite3`，但需要配置 PostgreSQL 连接（参见第 2 节）。

### 预防

在 `package.json` 中锁定 `better-sqlite3` 版本，避免大版本升级引入破坏性变更：

```json
"better-sqlite3": "11.3.0"
```

---

## 2. PostgreSQL 连接失败

### 症状

服务启动时或运行中报以下错误之一：

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

```
error: password authentication failed for user "postgres"
```

```
error: database "collabgrid" does not exist
```

### 检查步骤

**1. 确认 PostgreSQL 是否运行**

```bash
# Linux / macOS
pg_isready -h localhost -p 5432

# Windows（PowerShell）
pg_isready -h localhost -p 5432
```

如果返回 `no response`，说明 PostgreSQL 未启动：

```bash
# Windows 服务管理
net start postgresql-x64-16

# Linux
sudo systemctl start postgresql
```

**2. 检查 `.env` 配置**

对照 `.env.example` 检查以下关键字段是否正确：

```env
DB_ENGINE=postgresql
PG_HOST=localhost          # 主库地址
PG_PORT=5432               # 主库端口
PG_DATABASE=collabgrid      # 数据库名称
PG_USER=postgres           # 用户名
PG_PASSWORD=你的密码        # 密码
PG_POOL_MAX=20             # 连接池上限
PG_CONNECTION_TIMEOUT_MS=5000  # 连接超时（毫秒）
```

项目初始化时（`server.js` 第 92-96 行），`dbAdapter.init()` 会读取上述配置并初始化连接池。如果连接超时（默认 5000ms），会抛出连接超时错误。

**3. 检查 pg_hba.conf 认证规则**

PostgreSQL 的 `pg_hba.conf` 文件控制客户端认证方式。如果使用密码认证，确保配置中包含：

```
# TYPE  DATABASE  USER  ADDRESS      METHOD
host    all       all   127.0.0.1/32 scram-sha-256
host    all       all   ::1/128       scram-sha-256
```

修改后需要重新加载 PostgreSQL 配置：

```bash
# Linux
sudo systemctl reload postgresql

# Windows：在 pgAdmin 或服务管理器中重启
```

### 常见错误

**密码含特殊字符**

`.env` 中的 `PG_PASSWORD` 如果包含 `#`、`@`、`%` 等特殊字符，在部分解析场景下可能被截断或误解析。建议：

- 使用引号包裹密码值：`PG_PASSWORD="p@ss#w0rd!"`
- 或将密码中的特殊字符进行 URL encode（`@` -> `%40`，`#` -> `%23`）

**读写分离配置**

如果配置了 `PG_READ_HOST`，系统会使用读副本连接。确保读副本可达且数据已同步：

```env
PG_READ_HOST=192.168.1.100   # 读库地址
PG_READ_PORT=5432
PG_READ_POOL_MAX=10
```

如果读库不可用，所有读操作将失败，但写操作（走主库）不受影响。

---

## 3. JWT Token 问题

### 症状

API 请求返回 `401 Unauthorized`，或前端页面跳转回登录页。

### 机制说明

系统使用 `jsonwebtoken` 库（`^9.0.2`）签发和验证 JWT。关键配置（`config.js` + `auth.js`）：

| 配置项 | 环境变量 | 默认值 |
|--------|----------|--------|
| 签名密钥 | `JWT_SECRET` | `dev-secret-change-me` |
| Token 有效期 | 硬编码 7 天 | `7d` |
| Cookie 名称 | `cg_token` | — |
| Cookie 有效期 | 与 JWT 一致 | `7 * 24 * 3600 * 1000` ms |
| Cookie 属性 | `httpOnly: true, secure: 生产环境, sameSite: Strict` | — |

Token 通过 Cookie（`cg_token`）或 `Authorization: Bearer <token>` 头传递。

### 检查

**1. Token 是否过期**

JWT 有效期为 **7 天**（硬编码在 `auth.js` 第 20 行）。过期后需重新登录。查看 Token 过期时间的快速方法：

```javascript
// 在浏览器控制台
const token = document.cookie.split('; ').find(c => c.startsWith('cg_token='))?.split('=')[1];
const payload = JSON.parse(atob(token.split('.')[1]));
console.log('Token 过期时间:', new Date(payload.exp * 1000));
```

**2. JWT_SECRET 是否一致**

生产环境下，`config.js` 会在启动时检查 `JWT_SECRET`，如果仍是默认值 `dev-secret-change-me` 则直接抛出错误阻止启动：

```
Error: 生产环境必须设置 JWT_SECRET
```

如果修改了 `JWT_SECRET`，所有已签发的 Token 将失效，所有用户需要重新登录。

**3. Cookie 配置**

在生产环境中，Cookie 设置了 `secure: true`，这意味着只通过 HTTPS 传输。如果前端通过 HTTP 访问，Cookie 不会被发送，导致认证失败。确保：

```env
NODE_ENV=production       # 生产环境自动开启 secure
COOKIE_SECURE=true         # 也可显式控制
COOKIE_SAMESITE=Strict     # 跨站请求不携带 Cookie
```

### 解决

1. 清除浏览器中 `cg_token` Cookie，重新登录
2. 如果切换了 `JWT_SECRET`，通知所有用户重新登录
3. 开发环境可直接设置 `NODE_ENV=development` 以关闭 `secure` Cookie

---

## 4. Socket.IO 连接问题

### 症状

- 实时同步不工作：其他用户的操作不会实时更新到当前页面
- 数据修改后需要手动刷新才能看到变化
- 浏览器 Console 报 `socket not connected` 或类似的连接错误

### 机制说明

Socket.IO（`^4.7.5`）用于实时同步。连接认证机制（`app/socket.js`）：

1. 从 Cookie（`cg_token`）或 `handshake.auth.token` 获取 JWT
2. 调用 `verify()` 验证 Token 有效性
3. 查询数据库确认用户存在且未被禁用
4. 通过后建立 WebSocket 连接

连接后，系统每 **30 秒**发送一次心跳检查，如果 **5 分钟**无活动则自动断开（`app/socket.js` 第 6-7 行）。

每个 IP 最多 **10 个并发连接**（`app/socket.js` 第 37 行）。

### 检查

**1. 确认 Socket 是否成功连接**

在浏览器 Console 中检查：

```javascript
// 检查 Socket.IO 连接状态
console.log(window.socket?.io?.engine?.readyState);
// 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
```

或查看浏览器 DevTools -> Network -> WS 标签页，确认有 WebSocket 连接建立。

**2. CORS 配置**

Socket.IO 的 CORS 配置与 HTTP API 共用同一份 `allowedOrigins` 配置（`server.js` 第 62 行）。检查 `.env`：

```env
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

如果前端域名不在白名单中，Socket.IO 握手将被浏览器 CORS 策略阻止。

**3. Cookie 设置**

Socket.IO 认证需要从 Cookie 中读取 `cg_token`。如果 Cookie 的 `SameSite` 设置为 `Strict` 且前端和后端不在同一域名下，Cookie 不会被发送。

开发环境建议：

```env
COOKIE_SAMESITE=Lax    # 允许同站点导航时携带 Cookie
COOKIE_SECURE=false     # HTTP 环境下必须为 false
```

**4. 连接数限制**

如果同一 IP 的并发连接数超过 10 个，新连接会被强制断开（`app/socket.js` 第 37-40 行）。检查是否有多个标签页或自动化测试工具占用了连接。

### 恢复策略

- **客户端自动重连**：Socket.IO 内置指数退避重连机制，默认会自动尝试重新连接
- **手动恢复**：如果自动重连失败，刷新页面可强制重新建立连接
- **服务端重启**：重启后端服务会断开所有 Socket 连接，客户端会在数秒内自动重连

---

## 5. 端口被占用

### 症状

服务启动时报错：

```
Error: listen EADDRINUSE: address already in use :::3000
```

### 原因

默认端口（`PORT=3000`，见 `config.js` 第 31 行）已被其他进程占用，可能是：

- 之前的 CollabGrid 实例未正确关闭
- 其他开发工具（如前端 dev server）占用了同一端口
- PM2 管理的进程仍在运行

### 解决

**1. 查找占用进程**

```powershell
# Windows
netstat -ano | findstr :3000
```

输出示例：

```
TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    12345
```

最后一列 `12345` 即为进程 PID。

**2. 终止占用进程**

```powershell
# Windows
taskkill /PID 12345 /F

# 如果是 PM2 管理的进程
pm2 stop collab-grid
pm2 delete collab-grid
```

**3. 修改端口**

在 `.env` 中修改端口：

```env
PORT=3001
```

注意同时更新 `ALLOWED_ORIGINS` 中的 URL 端口号。

---

## 6. PM2 进程异常退出

### 查看日志

```bash
# 查看最近 100 行日志
pm2 logs collab-grid --lines 100

# 查看错误日志
pm2 logs collab-grid --err --lines 100

# 查看进程状态
pm2 status collab-grid
```

项目的 `ecosystem.config.cjs` 配置了 PM2 日志输出路径：

```javascript
error_file: './logs/pm2-error.log',
out_file: './logs/pm2-out.log',
```

日志时间格式为 `YYYY-MM-DD HH:mm:ss`。

### 常见原因

**1. 内存不足**

`ecosystem.config.cjs` 设置了内存上限重启阈值：

```javascript
max_memory_restart: '512M'
```

当进程内存占用超过 512MB 时，PM2 会自动重启进程。如果频繁触发内存重启：

- 检查是否存在内存泄漏（大量未释放的数据库连接、缓存未清理等）
- 增大内存阈值：`max_memory_restart: '1G'`
- 检查 PostgreSQL 连接池配置（`PG_POOL_MAX` 默认 20，读池 `PG_READ_POOL_MAX` 默认 10）

**2. 端口冲突**

PM2 配置为单实例模式（`instances: 1`，`exec_mode: 'fork'`），不会出现多实例端口冲突。但如果手动启动了额外的 `node server.js`，会产生端口冲突。

**3. 数据库连接超时**

`dbAdapter.init()` 在启动时建立数据库连接。如果 PostgreSQL 不可达（`PG_CONNECTION_TIMEOUT_MS=5000`），进程会因未捕获的 Promise rejection 而退出。检查数据库是否可达以及网络连通性。

**4. 生产环境配置缺失**

`config.js` 在生产环境下执行安全检查。如果 `ALLOWED_ORIGINS` 为空或 `JWT_SECRET` 未修改，启动时会直接抛出错误导致进程退出：

```
Error: 生产环境必须设置 ALLOWED_ORIGINS，禁止 CORS 全开放
Error: 生产环境必须设置 JWT_SECRET
```

### 自动重启配置

当前 `ecosystem.config.cjs` 已启用自动重启：

```javascript
autorestart: true
```

PM2 默认会在进程异常退出后自动重启。如果需要限制重启次数防止无限重启循环，可添加 `max_restarts` 配置：

```javascript
max_restarts: 10,
restart_delay: 5000
```

---

## 7. 数据迁移失败

### 症状

从 SQLite 迁移到 PostgreSQL 时报错，例如：

```
Error: type "TEXT" does not exist
Error: column "id" is of type text but expression is of type bytea
Error: relation "xxx" already exists
```

### 迁移脚本

项目提供了迁移脚本 `scripts/migrate-public-to-pg.js`，用于将 SQLite 的 `publicDb` 数据迁移到 PostgreSQL。

### 常见原因

**1. 数据类型不兼容**

SQLite 和 PostgreSQL 的类型系统存在差异。常见问题：

- SQLite 的 `TEXT` 对应 PostgreSQL 的 `text` 或 `varchar`
- SQLite 的 `INTEGER` 对应 PostgreSQL 的 `integer` 或 `bigint`
- SQLite 的 `BLOB` 对应 PostgreSQL 的 `bytea`
- SQLite 的布尔值（0/1）需要转换为 PostgreSQL 的 `boolean` 类型

迁移脚本使用了 `ON CONFLICT DO NOTHING` 策略跳过已存在的记录，但类型不匹配会导致插入失败。

**2. nanoid 大小写问题**

项目使用 `nanoid@3.x`（见 `package.json`），默认生成小写 ID。如果 SQLite 中存在历史数据包含大写 ID，可能与 PostgreSQL 的区分大小写排序规则（collation）不兼容。确保：

- 迁移前后 nanoid 配置一致
- PostgreSQL 的列排序规则设置为 case-insensitive（如使用 `citext` 类型）

**3. JSON 格式差异**

SQLite 以 TEXT 存储的 JSON 字符串，在迁移到 PostgreSQL 的 `JSONB` 列时，如果源数据包含非法 JSON 格式会报错。可在迁移前清理数据：

```sql
-- 在 PostgreSQL 中检查
SELECT * FROM target_table WHERE NOT jsonb_typeof(json_column)::text IN ('object','array','string','number','boolean','null');
```

### 回滚

**保留 SQLite 原始文件**

迁移脚本以只读模式打开 SQLite（`readonly: true`），不会修改源数据。原始 SQLite 文件始终作为备份保留：

- 主库：`./data/collab-grid.db`（默认 `DB_PATH`）
- 公共库：`./data/public.db`（默认 `PUBLIC_DB_PATH`）

**重新运行迁移**

如果迁移过程中部分失败，重新运行即可。脚本使用 `ON CONFLICT DO NOTHING` 跳过已成功迁移的记录：

```bash
# 重新运行迁移
DB_ENGINE=postgresql node scripts/migrate-public-to-pg.js
```

**切换回 SQLite**

如果 PostgreSQL 迁移无法完成，可直接在 `.env` 中切回 SQLite 模式：

```env
DB_ENGINE=sqlite
DB_PATH=./data/collab-grid.db
PUBLIC_DB_PATH=./data/public.db
```

重启服务后系统会自动使用 SQLite（`dbAdapter.js` 根据 `config.dbEngine` 自动选择引擎）。

---

## 8. 前端空白页

### 症状

浏览器加载页面后显示空白（白屏），无任何内容渲染。

### 检查

**1. 浏览器 Console**

按 `F12` 打开开发者工具，查看 Console 标签页中是否有 JavaScript 错误：

- `Uncaught ReferenceError: ... is not defined` — bundle 缺少依赖
- `Failed to load module script` — ES module 加载失败
- `Unexpected token '<'` — 请求返回了 HTML 而非 JS（通常是 404 或路由回退）

**2. 网络请求**

在 DevTools -> Network 标签页中检查：

- `bundle.js` 或 `meta.json` 是否返回 **404 Not Found** — 说明前端资源未构建
- API 请求是否返回正常数据（如 `/api/bases`）
- 是否有请求被 CORS 策略阻止（状态为 `blocked`）

**3. API 是否正常响应**

```bash
# 检查健康检查端点
curl http://localhost:3000/health

# 检查 API 响应
curl -b "cg_token=<your_token>" http://localhost:3000/api/bases
```

### 常见原因

**1. 前端资源未构建**

项目需要通过 esbuild 构建前端资源（`package.json`）：

```bash
# 开发模式构建
npm run build

# 生产模式构建
npm run build:prod

# 构建并查看产物大小
npm run build:analyze
```

构建产物输出到 `public/dist/` 目录。如果该目录不存在或为空，访问页面会导致白屏。

**2. CSRF Token 失效**

系统启用了 CSRF 保护中间件（`server.js` 第 75 行 `middleware.csrf`）。如果 CSRF Token 验证失败，POST/PUT/DELETE 请求会被拒绝。症状包括：

- 登录后立即白屏（登录后的初始化请求被 CSRF 拦截）
- 表单提交返回 403 Forbidden

检查日志中是否有 CSRF 相关的 WARN 或 ERROR 信息。

**3. 安全头（CSP）拦截**

系统配置了 Content Security Policy（`server.js` 第 70 行 `middleware.csp`）。如果 CSP 策略过于严格，可能阻止内联脚本执行导致白屏。

开发环境可临时放宽 CSP（如果中间件支持）或检查 CSP 违规报告。

---

## 9. 健康检查失败

### 症状

访问 `GET /health` 返回 `500 Internal Server Error` 或响应体中 `status` 为 `degraded`。

### 机制说明

健康检查端点（`server.js` 第 111-130 行）综合检查以下指标：

```json
{
  "status": "ok | degraded",
  "uptime": 12345.67,
  "timestamp": "...",
  "engine": "sqlite | postgresql",
  "db": { ... },
  "memory": { "rss": "...", "heapUsed": "...", "heapTotal": "..." },
  "socketConnections": { ... },
  "alerts": { ... }
}
```

其中 `status` 取决于 `dbAdapter.healthCheck()` 的返回值。系统还每 **60 秒**自动执行一次数据库健康检查（`server.js` 第 311-316 行），如果检查失败会通过 `pushAlert` 推送告警。

### 检查

**1. 数据库健康状态**

```bash
curl http://localhost:3000/health | jq .db
```

SQLite 模式下，健康检查始终返回 `{ "status": "healthy", "engine": "sqlite" }`。

PostgreSQL 模式下，`dbAdapter.healthCheck()` 委托给 `pgAdapter.healthCheck()`，会实际查询数据库连接池状态。常见问题：

- 连接池耗尽：`PG_POOL_MAX=20` 可能不足，增大该值
- 连接超时：检查 `PG_CONNECTION_TIMEOUT_MS`（默认 5000ms）是否过短
- 数据库服务停止：确认 PostgreSQL 正在运行

**2. 内存使用**

健康检查返回的 `memory` 字段显示当前内存使用情况。如果 `heapUsed` 持续增长：

- 可能存在内存泄漏，检查是否有未关闭的数据库连接或事件监听器
- PM2 会在内存超过 `max_memory_restart: '512M'` 时自动重启

**3. Socket 连接状态**

健康检查中的 `socketConnections` 字段显示当前 WebSocket 连接数。如果连接数异常高：

- 可能存在客户端重连风暴，检查网络是否稳定
- 确认是否有客户端在循环中反复创建连接

### 诊断端点

**数据库诊断**

```bash
GET /api/bases/:baseId/diagnostics
```

该端点（`routes/dashboard.js` 第 72-77 行）会运行业务诊断检查，返回订单绑定、流水记录、数据一致性等问题报告。需要认证且用户必须是该 Base 的成员。

参数：

| 参数 | 说明 | 示例 |
|------|------|------|
| `baseId` | Base ID（路径参数） | — |
| `businessDate` | 可选，指定业务日期 | `2026-06-30` |

**告警查询**

```bash
GET /api/alerts?level=error&source=db&limit=50
```

查询系统告警列表（需要认证），可按级别、来源和时间范围过滤。

---

## 附录：关键环境变量参考

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `NODE_ENV` | `development` | 运行环境，`production` 会触发安全检查 |
| `PORT` | `3000` | 服务监听端口 |
| `JWT_SECRET` | `dev-secret-change-me` | JWT 签名密钥，生产环境必须修改 |
| `DB_ENGINE` | `sqlite` | 数据库引擎：`sqlite` 或 `postgresql` |
| `DB_PATH` | `./data/collab-grid.db` | SQLite 主库路径 |
| `PUBLIC_DB_PATH` | `./data/public.db` | SQLite 公共库路径 |
| `PG_HOST` | `localhost` | PostgreSQL 主库地址 |
| `PG_PORT` | `5432` | PostgreSQL 主库端口 |
| `PG_DATABASE` | `collabgrid` | PostgreSQL 数据库名 |
| `PG_USER` | `postgres` | PostgreSQL 用户名 |
| `PG_PASSWORD` | _(空)_ | PostgreSQL 密码 |
| `PG_POOL_MAX` | `20` | PostgreSQL 写连接池上限 |
| `PG_READ_POOL_MAX` | `10` | PostgreSQL 读连接池上限 |
| `PG_CONNECTION_TIMEOUT_MS` | `5000` | 连接超时（毫秒） |
| `ALLOWED_ORIGINS` | _(空)_ | CORS 允许的来源列表，生产环境必填 |
| `LOG_LEVEL` | `info` | 日志级别：`debug`/`info`/`warn`/`error` |
| `LOG_TO_FILE` | `false` | 是否写入日志文件 |
| `LOG_DIR` | `./logs` | 日志文件目录 |
| `SCHEDULER_ENABLED` | `true` | 是否启用定时调度器 |
| `COOKIE_SECURE` | `false` | Cookie Secure 标志 |
| `COOKIE_SAMESITE` | `Strict` | Cookie SameSite 策略 |
| `RATE_LIMIT_MAX` | `20` | 通用速率限制（次/分钟） |
| `AUTH_RATE_LIMIT_MAX` | `10` | 认证接口速率限制（次/分钟） |
| `SYNC_MAX_EVENTS` | `500` | 同步事件最大批次 |
| `UPLOAD_MAX_SIZE` | `10485760` | 上传文件大小限制（字节，默认 10MB） |
