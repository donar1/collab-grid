# Collab-Grid 项目说明书

**版本**：0.3.1 | **Node.js**：>= 18 | **维护日期**：2026-06-30

Collab-Grid 是一个极简多维协作表格平台（Airtable-like），面向中小企业提供可自定义的数据管理与业务流程引擎。它支持通用表格能力、核心业务对象、数据大屏、权限矩阵与后台作业调度。

---

## 1. 项目定位

Collab-Grid 采用三层架构：

- **第一层 — 通用表格能力**：空间、表、字段、记录、单元格、关联关系、按钮、批量操作、实时同步
- **第二层 — 核心业务对象**：产品、客户、订单、账单、库存及相互调用链路
- **第三层 — 数据洞察**：数据大屏、财务核算、诊断中心

后端采用 Node.js + Express + Socket.IO，数据库支持 SQLite（开发/单节点）和 PostgreSQL（生产/多节点），通过统一适配层实现零侵入切换。

---

## 2. 技术栈

### 2.1 后端

| 技术 | 版本 | 用途 |
|------|------|------|
| Node.js | >= 18 | 运行时 |
| Express | ^4.19.2 | HTTP 框架 |
| Socket.IO | ^4.7.5 | 实时通信 |
| better-sqlite3 | ^11.3.0 | SQLite 数据库驱动（同步，高并发） |
| pg | ^8.22.0 | PostgreSQL 驱动 |
| bcryptjs | ^2.4.3 | 密码哈希 |
| jsonwebtoken | ^9.0.2 | JWT 认证 |
| nanoid | ^3.3.7 | ID 生成 |
| joi | ^17.x | 请求体验证 |
| cors | ^2.8.5 | 跨域处理 |
| dotenv | ^17.4.2 | 环境变量管理 |

### 2.2 前端

- 原生 JavaScript（ES2022），无前端框架
- 模块化拆分至 `public/modules/`
- esbuild 构建前端 bundle
- 实时同步通过 Socket.IO 增量同步

### 2.3 开发工具

| 工具 | 版本 | 用途 |
|------|------|------|
| ESLint | ^10.5.0 | 代码静态分析 |
| Prettier | ^3.8.4 | 代码格式化 |
| esbuild | ^0.28.1 | 前端构建 |
| Mocha | ^11.7.6 | 测试框架 |
| Chai | ^6.2.2 | 断言库 |

---

## 3. 目录结构

```
collab-grid/
  app/                    # Express 中间件与 Socket.IO 处理
    alerts.js             # 内存告警管理（调度器失败、DB 异常）
    context.js            # 全局上下文（权限、字段类型、审计）
    middleware.js         # 安全头、CORS、CSRF、限流、trace
    socket.js             # Socket.IO 认证、限流、心跳、连接数监控
    validate.js           # Joi 校验中间件
    validators.js         # 18 个 API 请求体验证 schema
  backups/                # 数据备份（zip 包）
  data/                   # SQLite 数据库文件与附件
  db/                     # 数据库迁移脚本
  docs/                   # ADR、架构文档、ER 图、部署说明
  jobs/                   # 后台作业
    commissionJob.js      # 佣金分录作业
    diagnostics.js        # 数据一致性诊断中心
    grid.js               # Grid 工厂（佣金计算、快照同步）
    index.js              # 作业调度器框架
    snapshotSyncJob.js    # 快照同步（对外客户查询）
    statusJob.js          # 资源状态自动更新作业
  layers/                 # 分层架构
    businessRelations.js  # 业务对象关系图
    tableLayer.js         # 表与业务层映射
  public/                 # 静态资源
    app.js                # 前端引导入口（11 行，逻辑已拆至 modules/）
    modules/              # 24 个前端 JS 模块
    css/                  # 14 个样式文件
  routes/                 # 20 个路由文件
    auth.js               # 注册、登录、密码修改
    bases.js              # 工作区 CRUD
    dashboard.js          # 仪表盘、作业配置、诊断
    invites.js            # 邀请与成员管理
    templates.js          # 业务模板初始化
    utils.js              # asyncHandler 包装器
    core/                 # 核心业务模板路由
      bills.js, customers.js, inventory.js, orders.js, products.js
    grid/                 # 表格网格路由
      attachments.js, batch.js, buttons.js, cells.js, links.js, records.js, tables.js
    public/               # 公开查询路由
      customerQuery.js
    security/             # 权限矩阵路由
      matrix.js
  scripts/                # 构建与迁移脚本
    build.js              # esbuild 构建
    check.js              # 全项目 JS 语法检查
    migrate-public-to-pg.js  # PG 数据迁移
    reset_pwd.js          # 管理员密码重置
    verify-migration.js   # 迁移验证
  security/               # 权限守卫（guards.js）
  services/               # 业务服务层
    dashboardService.js   # 仪表盘数据聚合
    dbAdapter.js          # 统一数据库接口（SQLite/PG 自动切换）
    financeService.js     # 财务结算、封账、红冲
    formulaService.js     # 公式引擎（递归下降解析器）
    helpers.js            # 通用工具函数
    inventoryService.js   # 出入库审批
    orderService.js       # 订单默认值、产品关联同步
    syncService.js        # 环形缓冲区实时同步
  tests/                  # 测试套件
  .github/workflows/ci.yml  # GitHub Actions CI
  auth.js                 # JWT 认证逻辑
  config.js               # 统一配置（31 项配置项）
  db.js                   # SQLite 初始化
  dbFactory.js            # 数据库工厂（读写连接池）
  docker-compose.yml      # Docker Compose 编排
  Dockerfile              # Docker 镜像
  ecosystem.config.cjs    # PM2 进程管理配置
  eslint.config.js        # ESLint flat config
  logger.js               # 结构化日志（JSON）
  package.json            # 依赖与脚本
  pgAdapter.js            # PostgreSQL 适配层
  publicDb.js             # 公开查询数据库（SQLite）
  server.js               # Express 入口（~690 行）
```

---

## 4. 架构说明

### 4.1 数据流

请求从 Express 路由进入，经过 `app/middleware.js` 的安全头、CORS、CSRF、限流后到达业务路由。路由调用 `services/` 层处理业务逻辑，通过 `services/dbAdapter.js` 统一接口访问 SQLite 或 PostgreSQL。

Socket.IO 负责实时同步：客户端通过 `sync:request` 事件拉取增量更新，服务端基于 `services/syncService.js` 的环形缓冲区（200 条）按 baseId 隔离推送变更。

### 4.2 数据库切换

`services/dbAdapter.js` 根据 `config.dbEngine`（`sqlite` 或 `postgresql`）自动选择后端：

- **SQLite**：better-sqlite3 同步 API + 异步包装。WAL 模式，支持高并发读取。
- **PostgreSQL**：pg 连接池。支持读写分离（`pg.readHost` 配置只读副本）。

切换方式：修改 `.env` 中的 `DB_ENGINE` 环境变量，无需改动任何业务代码。

### 4.3 权限模型

三层权限体系：

1. **系统角色**：`sys_admin` / `manager` / `user`（全局）
2. **Base 角色**：`owner` / `manager` / `business` / `data_clerk` / `support` / `warehouse`
3. **表权限**：每张表可独立配置读写权限

权限矩阵存储在 `permission_overrides` 和 `table_permissions` 表中，通过 `security/guards.js` 在每次请求时校验。

---

## 5. 核心功能模块

### 5.1 表格引擎

- **22 种字段类型**：text、number、singleSelect、multiSelect、date、lookup、formula、autoNumber、createdTime、lastModifiedTime、lastModifiedBy、attachment 等
- **公式引擎**：手写递归下降解析器，支持四则运算、字段引用 `{字段名}`、除零保护
- **关联关系**：双向 link 字段，支持多对多
- **实时同步**：Socket.IO 增量同步，100ms 限流，序列号追踪
- **批量操作**：500 条批量更新、批量粘贴

### 5.2 业务模板

一键初始化核心业务模板：

| 模板 | 包含表 |
|------|--------|
| 产品信息 | 产品名称数据源、产品信息 |
| 客户档案 | 资源档案中心、财务结算对象 |
| 订单管理 | 订单管理区、退款处理区、撤单处理区 |
| 库存管理 | 库存商品区、出入库操作区、库存流水区 |
| 财务对账 | 应收结算明细、应付结算明细、收付款流水、红冲处理 |
| 业务锁定 | 锁定区 |

### 5.3 后台作业

| 作业 | 功能 |
|------|------|
| 资源状态更新 | 按 30 天/7 天窗口自动标记客户/产品活跃状态 |
| 佣金结算 | 快照写入、佣金计算、退款冲回、奖金汇总 |
| 快照同步 | 订单/产品/库存预警同步至公开查询数据库 |
| 数据诊断 | 7 类数据一致性检查 |

### 5.4 仪表盘

- 今日/本月订单数、销售额、毛利
- 7 日趋势图
- 付款方/收款方排名
- 应收/应付汇总与红冲统计
- 库存预警与异常项

---

## 6. 核心 API 概览

### 6.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/register` | 用户注册（Joi 校验） |
| POST | `/api/login` | 用户登录（Joi 校验） |
| POST | `/api/auth/change-password` | 修改密码（Joi 校验） |
| GET | `/api/me` | 当前用户信息 |
| GET | `/api/csrf-token` | 获取 CSRF Token |

### 6.2 工作区

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bases` | 工作区列表 |
| POST | `/api/bases` | 创建工作区（Joi 校验） |
| PATCH | `/api/bases/:id` | 重命名（Joi 校验） |
| DELETE | `/api/bases/:id` | 删除工作区 |
| GET | `/api/bases/:id` | 工作区详情 |

### 6.3 表格操作

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tables/:tableId/page` | 分页数据 |
| POST | `/api/tables/:tableId/records` | 创建记录（Joi 校验） |
| PUT | `/api/records/:recordId/cells/:fieldId` | 更新单元格（Joi 校验） |
| POST | `/api/batch` | 批量更新（Joi 校验） |
| POST | `/api/buttons/execute` | 执行按钮动作（Joi 校验） |

### 6.4 系统端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查（含 DB 状态、socket 连接数、告警统计） |
| GET | `/api/alerts` | 告警查询（需认证） |
| GET | `/api/system/business-relations` | 业务对象关系图 |
| GET | `/api/bases/:baseId/diagnostics` | 数据一致性诊断 |

---

## 7. 数据库设计

### 7.1 SQLite 与 PostgreSQL 兼容

所有 DDL 使用兼容两者的语法：

- ID：VARCHAR(21)，nanoid 生成
- 时间戳：BIGINT，毫秒级 Unix 时间戳
- JSON：TEXT（SQLite）/ JSONB（PG）
- BOOLEAN：INTEGER 0/1（SQLite）/ BOOLEAN（PG）
- 自增主键：INTEGER PRIMARY KEY AUTOINCREMENT（SQLite）/ SERIAL（PG）

### 7.2 核心表

| 表名 | 说明 |
|------|------|
| `users` | 用户 |
| `bases` | 工作区 |
| `base_members` | 工作区成员关系 |
| `tables` | 表 |
| `fields` | 字段 |
| `records` | 记录 |
| `cells` | 单元格 |
| `links` | 关联关系 |
| `attachments` | 附件 |
| `audit_log` | 审计日志 |
| `commission_ledger` | 佣金流水 |
| `job_runs` | 作业执行记录 |
| `permission_overrides` | 权限覆盖 |
| `table_permissions` | 表权限 |

---

## 8. 配置说明

配置文件：`config.js`，所有配置均从环境变量读取。

### 8.1 常用配置项

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `PORT` | 3000 | 服务端口号 |
| `NODE_ENV` | development | 环境（development / production） |
| `DB_ENGINE` | sqlite | 数据库引擎（sqlite / postgresql） |
| `JWT_SECRET` | collabgrid-dev-secret | JWT 签名密钥（**生产必须修改**） |
| `ALLOWED_ORIGINS` | * | CORS 白名单（**生产必须设置**） |
| `PG_HOST` | localhost | PostgreSQL 主机 |
| `PG_PORT` | 5432 | PostgreSQL 端口 |
| `PG_DATABASE` | collabgrid | PostgreSQL 数据库名 |
| `PG_USER` | collabgrid | PostgreSQL 用户名 |
| `PG_PASSWORD` | collabgrid | PostgreSQL 密码 |
| `PG_READ_HOST` | — | 只读副本主机（可选） |
| `SCHEDULER_ENABLED` | true | 是否启用后台作业调度 |

完整配置示例见 `.env.example`。

---

## 9. 部署指南

### 9.1 开发环境

```bash
npm install               # 安装依赖
cp .env.example .env      # 复制配置模板
node server.js            # 启动服务器（默认 SQLite 模式）
```

### 9.2 Docker 部署

```bash
docker-compose up -d      # 启动 PostgreSQL + 应用
```

### 9.3 生产部署

1. 修改 `.env`：设置 `DB_ENGINE=postgresql`、`JWT_SECRET`、`ALLOWED_ORIGINS`
2. 运行数据迁移：`node scripts/migrate-public-to-pg.js`
3. 验证迁移：`node scripts/verify-migration.js`
4. 使用 PM2 启动：`pm2 start ecosystem.config.cjs`

### 9.4 PostgreSQL 切换

```bash
# 1. 启动 PostgreSQL（Docker 或自建）
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=collabgrid postgres:15

# 2. 配置 .env
DB_ENGINE=postgresql
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=collabgrid
PG_USER=postgres
PG_PASSWORD=collabgrid

# 3. 启动
node server.js
```

详细部署说明见 `DEPLOY.md`。

---

## 10. 开发指南

### 10.1 启动开发服务器

```bash
npm run dev              # 开发模式（热更新 + SQLite）
npm run build:watch      # 前端构建监听
```

### 10.2 代码规范

```bash
npm run lint             # ESLint 检查
npm run format:check     # Prettier 格式检查
npm run format           # 自动格式化
npm run check            # JS 语法检查（全项目扫描）
```

### 10.3 测试

```bash
npm test                 # 运行全部测试
npm run test:frontend    # 前端逻辑测试
npm run test:order       # 订单业务测试
npm run test:finance     # 财务业务测试
npm run test:diagnostics # 诊断中心测试
```

### 10.4 添加 API 端点

1. 在 `app/validators.js` 定义 schema（如需要输入校验）
2. 在 `routes/` 下创建或修改路由文件
3. 使用 `validate(schema)` 中间件添加校验
4. 在 `server.js` 中注册路由工厂函数
5. 在 `public/modules/api.js` 添加 API 路径常量

---

## 11. CI/CD

GitHub Actions 工作流 `.github/workflows/ci.yml`：

1. 在 Node.js 18/20 矩阵上运行
2. `npm ci` 安装依赖（带缓存）
3. `npm run lint` — ESLint 检查
4. `npm run format:check` — Prettier 格式检查
5. `npm run check` — JS 语法检查
6. `npm run build` — esbuild 构建
7. 启动服务器并通过健康检查轮询确认就绪
8. `npm test` — 运行全部测试

---

## 12. 项目路线图

| Phase | 主题 | 状态 |
|-------|------|------|
| Phase 0 | 治理基础（工程化、代码去重） | 大部分完成 |
| Phase 1 | 架构解耦（server.js 拆分、统一配置、健康检查） | 大部分完成 |
| Phase 2 | 数据库异步化（统一接口层、全 async 改造） | 完成 |
| Phase 3 | PostgreSQL 切换（适配器、迁移脚本、读写分离） | 大部分完成 |
| Phase 4 | 前端工程化（app.js 拆分、组件化、Vite） | 小部分完成 |
| Phase 5 | 生产加固（CI/CD、Joi 校验、Socket.IO 管理、监控告警） | 完成 |

完整路线图见 `ROADMAP.md`。

---

## 13. 生产环境检查清单

| 检查项 | 是否完成 |
|--------|----------|
| 修改 `JWT_SECRET` 为强随机字符串 | [ ] |
| 设置 `ALLOWED_ORIGINS` 为具体域名 | [ ] |
| 启用 HTTPS | [ ] |
| 配置反向代理（Nginx） | [ ] |
| 配置 PostgreSQL 连接池参数 | [ ] |
| 配置日志轮转 | [ ] |
| 设置邮件告警 SMTP | [ ] |
| 配置数据库自动备份 | [ ] |
| 设置防火墙规则 | [ ] |
| 完成性能基准测试 | [ ] |

---

## 14. 相关文档索引

| 文档 | 内容 |
|------|------|
| `README.md` | 项目简介与快速开始 |
| `ROADMAP.md` | 六阶段技术债务治理路线图 |
| `DEPLOY.md` | 详细部署指南与故障排查 |
| `API.md` | API 接口文档 |
| `CHANGELOG_v0.3.1.md` | 版本变更日志 |
| `docs/ARCHITECTURE_LAYERS.md` | 三层架构设计 |
| `docs/er-diagram/` | 数据库 ER 图 |
| `NAMING_CONVENTIONS.md` | 命名规范 |
| `PROJECT_STATUS.md` | 项目状态与待办 |
| `EVALUATION_REPORT.md` | 代码审查报告 |

---

## 15. 联系方式与许可

- 项目仓库：Collab-Grid
- 版本：0.3.1
- 要求 Node.js >= 18

如有问题，请参考 `DEPLOY.md` 的故障排查章节或查看项目状态文档 `PROJECT_STATUS.md`。
