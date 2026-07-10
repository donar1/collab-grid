# Collab-Grid

极简多维协作表格平台（Airtable-like），支持实时同步、字段锁定、关联关系、业务模板、权限矩阵与后台作业调度。面向中小企业提供可自定义的数据管理与业务流程引擎。

---

## 项目概述

Collab-Grid 是一个三层架构的协作表格平台：

- **第一层 — 通用表格能力**：空间（Base）、表、字段、记录、单元格、关联、按钮、批量操作、实时同步
- **第二层 — 核心业务对象**：产品、客户、订单、账单、库存，以及它们之间的调用链路
- **第三层 — 数据洞察**：数据大屏、财务核算、诊断中心（只读不写）

后端采用 **Node.js + Express + Socket.IO**，数据库支持 **SQLite**（开发/单节点）和 **PostgreSQL**（生产/多节点），通过统一的适配层实现零侵入切换。

---

## 源码位置

```
C:\Users\super\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\work-mode-projects\6a35dcc2331cf6fa93b387fb\collab-grid
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js >= 18 |
| Web 框架 | Express 4.x |
| 实时通信 | Socket.IO 4.x |
| 数据库 | better-sqlite3（开发）/ PostgreSQL 16（生产） |
| 连接池 | pg (node-postgres) |
| 认证 | JWT (jsonwebtoken) + bcryptjs |
| ID 生成 | nanoid |
| 日志 | 结构化 JSON 日志 |
| 构建 | esbuild |
| 测试 | Mocha + Chai |
| 部署 | Docker / PM2 |

---

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9
- PostgreSQL 16（生产模式可选）

### 安装依赖

```bash
npm install
```

### 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，设置 JWT_SECRET、数据库连接等
```

关键配置项：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NODE_ENV` | 运行环境 | `development` |
| `PORT` | 服务端口 | `3000` |
| `DB_ENGINE` | 数据库引擎：`sqlite` 或 `postgresql` | `sqlite` |
| `JWT_SECRET` | JWT 签名密钥（必须修改） | — |
| `DEFAULT_ADMIN_PASSWORD` | 默认管理员密码（必须修改） | — |
| `PG_HOST` / `PG_PORT` / `PG_DATABASE` / `PG_USER` / `PG_PASSWORD` | PostgreSQL 连接 | — |

### 启动服务

```bash
# 开发模式（SQLite）
npm run dev

# 生产模式（PostgreSQL，需先安装并配置 PG）
npm start
```

### Docker 启动

```bash
# SQLite 模式
docker-compose up app

# PostgreSQL 模式
docker-compose up app-pg postgres
```

---

## 项目结构

```
collab-grid/
├── server.js              # Express + Socket.IO 入口
├── auth.js                # JWT 签发/校验 + 认证中间件
├── config.js              # 统一配置层
├── logger.js              # 结构化日志
├── db.js                  # SQLite 连接与 Schema
├── publicDb.js            # 外部展示库（public schema）
├── pgAdapter.js           # PostgreSQL 适配层（读写分离）
├── dbFactory.js           # 数据库引擎工厂
│
├── app/
│   ├── context.js         # 应用上下文（字段/记录/关联操作）
│   ├── middleware.js      # Express 中间件（CORS、CSRF、速率限制）
│   └── socket.js          # Socket.IO 事件处理器
│
├── routes/
│   ├── grid/              # 通用表格路由（表、记录、单元格、关联、按钮、批量、附件）
│   ├── core/              # 核心业务路由（客户、产品、订单、库存、账单）
│   ├── security/          # 权限矩阵路由
│   └── public/            # 外部客户查询路由
│
├── services/
│   ├── helpers.js         # 通用辅助函数（单元格读写、关联操作）
│   ├── orderService.js    # 订单管理（默认字段、产品同步）
│   ├── financeService.js  # 财务核算（结算、退款、红冲）
│   ├── inventoryService.js # 库存管理（出入库审批）
│   ├── dashboardService.js # 数据大屏
│   ├── formulaService.js  # 公式计算
│   ├── syncService.js     # 实时同步服务
│   └── dbAdapter.js       # 数据库适配层（SQLite/PG 统一接口）
│
├── jobs/
│   ├── index.js           # 作业调度器与 CRUD
│   ├── grid.js            # Grid 工厂（佣金计算、快照同步）
│   ├── commissionJob.js   # 佣金分录作业
│   ├── statusJob.js       # 状态汇总作业
│   ├── diagnostics.js     # 诊断中心
│   └── snapshotSyncJob.js # 快照同步作业
│
├── security/
│   ├── guards.js          # 权限守卫（角色校验、能力检查）
│   ├── matrixStore.js     # 权限矩阵存储
│   ├── permissions.js     # 23 条权限码定义
│   └── roles.js           # 角色体系
│
├── layers/
│   ├── tableLayer.js      # 表格层常量与工具
│   └── businessRelations.js # 业务对象与调用链路
│
├── public/                # 前端静态资源
│   ├── app.js             # 前端入口
│   └── modules/           # 前端模块（渲染、编辑、Socket、状态等）
│
├── db/
│   └── migrations/        # 数据库迁移脚本
│
├── tests/                 # 测试套件
│   ├── unit/              # 单元测试
│   ├── integration/       # 集成测试
│   ├── load/              # 负载测试
│   └── *.js               # 业务场景黑盒测试
│
├── scripts/               # 构建与迁移脚本
├── docs/                  # 架构文档、ER 图、部署指南
├── backups/               # 版本备份
└── data/                  # 运行时数据目录
```

---

## 数据库架构

### 内部库（16 张表）

| 表名 | 说明 | 主键 |
|------|------|------|
| `users` | 用户 | `id` |
| `bases` | 工作空间 | `id` |
| `members` | 成员关系 | `(base_id, user_id)` |
| `tables` | 表格 | `id` |
| `fields` | 字段定义 | `id` |
| `records` | 记录 | `id` |
| `cells` | 单元格 | `(record_id, field_id)` |
| `links` | 关联记录 | `id` |
| `invites` | 邀请令牌 | `token` |
| `attachments` | 附件 | `id` |
| `audit_log` | 审计日志 | `id` |
| `job_configs` | 作业配置 | `(base_id, job_key)` |
| `job_runs` | 作业运行历史 | `id` |
| `commission_ledger` | 佣金分录 | `id` |
| `order_activity_daily` | 每日订单汇总 | `(base_id, business_date, side, channel_record_id, product_record_id)` |
| `permission_overrides` | 权限覆盖 | `id` |

### 外部库（4 张表）

| 表名 | 说明 | 主键 |
|------|------|------|
| `public_clients` | 外部客户 token | `token` |
| `public_customer_snapshot` | 客户可见快照 | `(base_id, customer_key, category, ref_id)` |
| `public_access_log` | 外部访问审计 | `id` |
| `public_reconciliation` | 外部对账 | `id` |

---

## API 概览

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/register` | 用户注册 |
| POST | `/api/login` | 用户登录 |
| POST | `/api/auth/refresh` | 刷新 Token |
| POST | `/api/auth/change-password` | 修改密码 |
| GET | `/api/me` | 获取当前用户 |

### 空间管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bases` | 列出空间 |
| POST | `/api/bases` | 创建空间 |
| GET | `/api/bases/:id` | 空间详情 |
| PATCH | `/api/bases/:id` | 重命名空间 |
| DELETE | `/api/bases/:id` | 删除空间 |

### 通用表格

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/bases/:baseId/tables` | 表列表 / 创建表 |
| GET/PATCH/DELETE | `/api/bases/:baseId/tables/:tableId` | 表详情 / 更新 / 删除 |
| GET/POST | `/api/bases/:baseId/tables/:tableId/records` | 记录列表 / 创建记录 |
| PATCH/DELETE | `/api/bases/:baseId/tables/:tableId/records/:recordId` | 记录更新 / 删除 |
| PATCH | `/api/bases/:baseId/tables/:tableId/records/:recordId/cells/:fieldId` | 更新单元格 |
| POST/DELETE | `/api/bases/:baseId/links` | 创建 / 删除关联 |
| POST | `/api/bases/:baseId/batch` | 批量操作 |
| POST | `/api/bases/:baseId/button-actions` | 按钮动作 |

### 核心业务

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/bases/:baseId/customers` | 客户管理 |
| GET/POST | `/api/bases/:baseId/products` | 产品管理 |
| GET/POST | `/api/bases/:baseId/orders` | 订单管理 |
| GET/POST | `/api/bases/:baseId/inventory` | 库存管理 |
| GET/POST | `/api/bases/:baseId/bills` | 账单管理 |

### 作业与诊断

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bases/:baseId/jobs/configs` | 作业配置列表 |
| PATCH | `/api/bases/:baseId/jobs/configs/:jobKey` | 更新作业配置 |
| POST | `/api/bases/:baseId/jobs/:jobKey/run` | 手动运行作业 |
| GET | `/api/bases/:baseId/jobs/runs` | 运行历史 |
| GET | `/api/bases/:baseId/diagnostics` | 诊断报告 |
| GET | `/api/bases/:baseId/dashboard/summary` | 数据大屏 |

### 权限与安全

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bases/:baseId/permissions` | 权限矩阵快照 |
| POST | `/api/bases/:baseId/permissions/batch` | 批量修改权限 |
| GET | `/api/bases/:baseId/audit` | 审计日志 |

---

## 权限体系

Collab-Grid 采用基于角色的访问控制（RBAC），定义了 23 条细粒度权限码：

| 角色 | 说明 |
|------|------|
| `owner` | 空间所有者，拥有全部权限 |
| `admin` | 管理员，可管理结构与成员 |
| `finance` | 财务角色，可操作结算与审批 |
| `editor` | 编辑者，可编辑数据 |
| `viewer` | 查看者，只读权限 |
| `public` | 外部公开访问 |

权限矩阵支持按空间覆盖，可通过 `/api/bases/:baseId/permissions` 动态调整。

---

## 测试

```bash
# 运行全部测试
npm test

# 单独运行
npm run test:frontend      # 前端逻辑测试
npm run test:p0            # P0 API 测试
npm run test:p0-security   # P0 安全测试
npm run test:permission    # 权限矩阵测试
```

---

## 部署

### Docker

```bash
docker build -t collab-grid .
docker run -p 3000:3000 --env-file .env collab-grid
```

### PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
```

### 手动部署

```bash
npm ci --production
npm start
```

---

## 相关文档

| 文档 | 说明 |
|------|------|
| `COLLABGRID_PROJECT_GUIDE.md` | 项目总览与三层架构详解 |
| `API.md` | 完整 API 文档 |
| `ARCHITECTURE_LAYERS.md` | 架构分层说明 |
| `docs/er-diagram.md` | ER 图（Mermaid） |
| `docs/deployment.md` | 部署指南 |
| `ROADMAP.md` | 开发路线图 |
| `CHANGELOG_v0.3.1.md` | 变更日志 |

---

## 许可证

MIT
