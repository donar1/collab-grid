# CollabGrid

一个极简的多维协作表格平台（Airtable-like），支持实时同步、字段锁定、关联关系、权限矩阵和内外库分离。

## 项目概述

CollabGrid 面向小型团队的业务数据管理场景。核心设计是把"表格操作"和"业务含义"拆成两层：底层提供通用的表、字段、记录、关联能力；上层在产品、客户、订单、账单、库存五个对象之间建立调用链路。第三层的数据大屏和财务核算只读不写，避免反向污染核心业务。

当前版本 V0.3.1，已完成三层架构拆分、权限矩阵、默认系统管理员和内外库分离。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 运行时 | Node.js >= 18 |
| Web 框架 | Express 4 + Socket.IO 4（实时广播） |
| 数据库 | better-sqlite3（WAL 模式），双实例：内部库 + 外部展示库 |
| 鉴权 | JWT（jsonwebtoken）+ bcryptjs |
| ID 生成 | nanoid |

## 快速启动

```bash
npm install
npm start          # 默认端口 3000
# 或指定端口
PORT=8080 npm start
```

首次启动时，如果系统里没有任何 sys_admin，会自动创建一个默认系统管理员：

```
账号：admin@collabgrid.local
密码：Admin@123456
```

建议首次登录后立即修改密码。也可通过环境变量覆盖：

```bash
DEFAULT_ADMIN_EMAIL=admin@example.com
DEFAULT_ADMIN_PASSWORD=你的强密码
DEFAULT_ADMIN_DISPLAY_NAME=系统管理员
```

## 项目结构

```
collab-grid/
├── server.js                 # 启动入口：Express + Socket.IO + 路由挂载
├── auth.js                   # JWT 签发/校验 + authRequired 中间件
├── db.js                     # 内部库（collab-grid.db）：所有业务表
├── publicDb.js               # 外部库（collab-grid-public.db）：客户查询隔离
├── jobs.js                   # 定时任务调度器
├── layers/
│   ├── tableLayer.js         # 第一层：表格能力边界（字段类型、只读类型）
│   └── businessRelations.js  # 第二层：五个核心对象与调用链路定义
├── security/                 # V0.3.1 权限矩阵层
│   ├── roles.js              # 角色常量与新旧映射
│   ├── permissions.js        # 23 条权限码 + 默认矩阵
│   ├── matrixStore.js        # permission_overrides 表 + 有效权限合并
│   └── guards.js             # 与旧 can* API 兼容的安全门面
├── routes/
│   ├── grid/                 # 第一层：通用表格路由
│   │   ├── tables.js         # 表/字段增删改、分页、搜索
│   │   ├── records.js        # 记录新增、更新、删除、封账
│   │   ├── cells.js          # 单元格写入、样式、只读保护
│   │   ├── links.js          # 关联字段增删、lookup 重算
│   │   ├── buttons.js        # 按钮 action、审批、封账、红冲
│   │   └── batch.js          # 批量 cell.update
│   ├── core/                 # 第二层：核心业务对象初始化路由
│   │   ├── customers.js      # 资源档案、员工档案、业务锁定
│   │   ├── products.js       # 产品名称数据源、产品信息
│   │   ├── orders.js         # 订单管理、批量导入
│   │   ├── inventory.js      # 库存商品、出入库、流水
│   │   └── bills.js          # 应收/应付、收付款流水、红冲
│   ├── security/
│   │   └── matrix.js         # 权限矩阵查看/改写、系统角色提权
│   └── public/
│       └── customerQuery.js  # 外部库客户查询：token 颁发/撤销/快照查询
├── public/                   # 前端静态资源
│   ├── app.js                # 主应用
│   └── modules/              # 剪贴板、键盘、字段、关联
├── tests/                    # 端到端测试
│   ├── p0_api_test.js        # 基础 API 回归
│   ├── p0_security_test.js   # 安全基线（生产模式 CORS、JWT 强制、限流）
│   ├── permission_matrix_test.js  # V0.3.1 权限矩阵全链路
│   └── ...                   # 业务场景测试（订单、库存、财务、大屏等）
├── docs/
│   ├── ARCHITECTURE_LAYERS.md
│   ├── V0.3_RELEASE_NOTES.md
│   ├── V0.3.1_PERMISSION_MATRIX.md
│   └── COLLABGRID_PROJECT_GUIDE.md   # 本文档
├── NAMING_CONVENTIONS.md     # 项目命名规则
└── backups/                  # 版本回退点压缩包
```

## 三层架构

### 第一层：操作界面 / 通用表格能力

只解决"用户如何操作表格"，不承载业务含义。

- 空间、成员、角色、权限
- 表、字段、记录、单元格
- 关联字段、lookup、快照字段
- 按钮 action、封账/解封
- 批量写入、实时同步、审计日志

代码入口：`routes/grid/*` + `layers/tableLayer.js`

### 第二层：核心业务关系

只定义五个核心业务对象：产品、客户、订单、账单、库存。

| 对象 | 主要表 | 负责字段 | 被谁调用 |
| --- | --- | --- | --- |
| 产品 | 产品名称数据源区、产品信息区 | 售价、成本、货号、产品快照 | 订单、库存 |
| 客户 | 资源档案中心、财务结算对象区 | 企业名称、合作渠道、结算对象 | 订单、账单、业务锁定 |
| 订单 | 订单管理区、退款处理区、撤单处理区 | 产品、付款方、收款方、订单状态、应收/应付 | 库存、账单、佣金作业、大屏 |
| 账单 | 应收结算明细区、应付结算明细区、收付款流水区、财务红冲处理区 | 应收、应付、红冲金额、明细状态 | 财务核算、大屏 |
| 库存 | 库存商品区、出入库操作区、库存流水区 | 实际库存、虚拟库存、仓储、成本 | 大屏 |

调用链路：

```
产品 -> 订单（快照售价/成本）
客户 -> 订单（付款方/收款方关联）
订单 -> 账单（完结生成应收/应付）
订单 -> 库存（自营出库扣减）
库存 -> 产品（入库后同步成本）
账单 -> 财务核算（封账后只读）
核心层 -> 数据大屏（只读不写）
```

代码入口：`routes/core/*` + `layers/businessRelations.js`

### 第三层：附加价值层

数据大屏和财务核算优化。只读取第一层和第二层已经确认的结果，不反向写核心业务数据。

当前模块：`GET /api/bases/:baseId/dashboard/summary`、财务对账、红冲、封账、诊断中心、作业运行历史。

## 权限矩阵（V0.3.1）

### 角色体系

| 层级 | 角色 | 说明 |
| --- | --- | --- |
| 系统级 | `sys_admin` | 全权 + 可改任何角色的权限矩阵 |
| 系统级 | `data_engineer` | 可改底层数据/结构、跑维护任务 |
| 系统级 | `none` | 普通用户（默认） |
| Base 级 | `manager` | 管理（含财务）：邀请、改成员、封账、跑任务 |
| Base 级 | `business` | 业务：读写记录、审批，不改结构 |
| Base 级 | `data_clerk` | 数据员：改结构/记录、跑任务，不审批/封账 |
| Base 级 | `support` | 客服：只读 + 大屏 + 审计 + 客户查询 |
| Base 级 | `warehouse` | 库管：读写记录 + 库存出入库审批 |
| 外部 | `customer_query` | 客户查询：仅限外部库，只查自己的快照 |

### 权限码

23 条权限码覆盖：结构读写、记录读写/封账、业务审批、订单审批、库存审批、财务封账/红冲、任务读写/执行/配置、成员管理、审计、大屏、诊断、矩阵读写、底层库维护、客户查询。

默认矩阵见 `security/permissions.js`。sys_admin 可改写全局矩阵；manager 可改写所在 base 的矩阵。

### 旧角色兼容

旧角色（owner / admin / approver / finance / editor / viewer）仍可存入 `members.role`，权限计算时通过 `LEGACY_BASE_ROLE_MAP` 映射到新角色，所有旧测试零修改。

## 内外库分离

| 库 | 文件 | 内容 |
| --- | --- | --- |
| 内部库 | `data/collab-grid.db` | 所有业务表 + `permission_overrides` |
| 外部库 | `data/collab-grid-public.db` | `public_clients`（外部 token）、`public_customer_snapshot`（客户可见快照）、`public_access_log`（外部访问审计） |

外部 API 走独立 `publicDb`，不持有内部 db 句柄。快照通过显式的同步函数从内部推送出去，内部业务字段永远不通过外部 API 暴露。外部 token 使用 `X-Customer-Token` 头，内部 JWT 无法通过外部接口验证。

## 核心 API 速查

### 鉴权

```
POST /api/register              注册
POST /api/login                 登录
POST /api/auth/change-password  修改密码（需 currentPassword + newPassword）
GET  /api/me                    当前用户信息
```

### 空间与成员

```
GET    /api/bases
POST   /api/bases
DELETE /api/bases/:id
POST   /api/bases/:baseId/invites
POST   /api/invites/:token/accept
PATCH  /api/bases/:baseId/members/:userId
```

### 通用表格

```
GET    /api/bases/:baseId/tables
POST   /api/tables
PATCH  /api/tables/:id
DELETE /api/tables/:id
GET    /api/tables/:id/records
POST   /api/tables/:id/records
PATCH  /api/records/:id
DELETE /api/records/:id
POST   /api/cells/batch
POST   /api/links
DELETE /api/links/:id
POST   /api/buttons/:buttonId/action
```

### 权限矩阵

```
GET    /api/security/permissions
GET    /api/security/me
GET    /api/security/matrix
PUT    /api/security/matrix
GET    /api/bases/:baseId/security/matrix
PUT    /api/bases/:baseId/security/matrix
PATCH  /api/security/users/:userId/system-role
```

### 外部客户查询

```
POST   /api/bases/:baseId/public/clients
GET    /api/bases/:baseId/public/clients
DELETE /api/bases/:baseId/public/clients/:token
POST   /api/bases/:baseId/public/snapshots/sync
GET    /api/public/me                （X-Customer-Token）
GET    /api/public/snapshots         （X-Customer-Token）
```

## 编程思路

### 设计决策

**为什么用 better-sqlite3 而不是 ORM**

项目规模可控，SQL 直接写更清晰。WAL 模式让读写并发不阻塞，单文件部署简单。没有引入 Sequelize/Prisma 等重型依赖，减少了抽象泄漏风险。

**为什么拆成三层而不是 MVC**

MVC 的 Controller 容易变成"什么都管"的上帝类。三层按"能力通用性"划分：第一层不管业务，第二层不管展示，第三层不管写入。这样新增业务对象时，只需要在第二层加一个路由文件，不会碰到底层表格逻辑。

**为什么权限矩阵用覆盖表而不是角色继承**

继承模型在角色多的时候容易形成菱形依赖。覆盖表（permission_overrides）的语义简单：默认矩阵 + 覆盖 + 显式拒绝优先。管理员改矩阵时只需要 INSERT/UPDATE 一行，不需要理解继承链。

**为什么内外库完全分离**

外部客户查询是一个不可信边界。即使代码写对了，未来维护时也可能不小心把内部字段暴露出去。两个物理数据库实例 + 独立的 publicDb.js，从架构上切断了"内部数据被外部 API 误读"的路径。

### 关键模式

**Context 注入**

`server.js` 不直接 require 路由文件，而是构造 `gridRouteContext` 和 `coreRouteContext`，把 `db`、`authRequired`、`security`、`audit` 等依赖注入进去。路由文件只接收 context，不直接依赖全局变量。测试时可以 mock context，不需要起完整服务器。

**旧 API 兼容门面**

V0.3.1 引入 `security/guards.js` 后，`server.js` 里的 `canManageStructure`、`canEditData` 等旧函数全部代理到 `security.can()`。业务路由（如 `routes/grid/buttons.js`）继续调用旧的 `canApprove`，背后已经走新的权限矩阵。这样升级权限系统时，不需要改 20 多个路由文件。

**审计日志统一入口**

所有写操作通过 `audit(baseId, userId, action, payload)` 记录。`payload` 是 JSON 字符串，后续可以按 action 做聚合分析，不需要为每种操作单独建表。

**按钮 action 分发**

`routes/grid/buttons.js` 用 `actionHandlers` 对象做路由表，而不是一堆 if-else。新增按钮类型时，只需要在对象里加一行 handler，不需要改分发逻辑。

### 扩展指南

**新增一个 base 级角色**

1. 在 `security/roles.js` 的 `BASE_ROLES` 数组里追加角色名
2. 在 `security/permissions.js` 的 `DEFAULT_BASE_MATRIX` 里定义默认权限
3. 在 `server.js` 的 `normalizeRole` 里加入合法值校验（如果需要前端展示）
4. 运行 `npm run check` 和 `npm run test:permission`

**新增一条权限码**

1. 在 `security/permissions.js` 的 `PERMISSIONS` 数组里追加权限码
2. 在 `PERMISSION_LABELS` 里加中文标签
3. 在 `DEFAULT_BASE_MATRIX` / `DEFAULT_SYSTEM_MATRIX` / `DEFAULT_EXTERNAL_MATRIX` 里分配给需要的角色
4. 在 `security/guards.js` 里新增 `canXxx` 门面函数（如果需要旧 API 兼容）

**新增一个外部查询类别**

1. 在 `publicDb.js` 的 `upsertSnapshot` / `querySnapshots` 里，category 字段已经开放，直接传入新类别名即可
2. 在内部任务或手动同步入口里，把需要暴露的数据组装成 `{ customerKey, category, refId, data }` 调用 `publicStore.upsertSnapshot`
3. 外部客户通过 `GET /api/public/snapshots?category=新类别` 查询

**新增一个核心业务对象**

1. 在 `layers/businessRelations.js` 的 `CORE_BUSINESS_OBJECTS` 里定义对象属性
2. 在 `BUSINESS_CALL_CHAIN` 里描述它与现有对象的调用关系
3. 新建 `routes/core/新对象.js`，导出 `registerXxxRoutes(ctx)` 函数
4. 在 `server.js` 里 require 并挂载
5. 在 `routes/core/新对象.js` 里提供模板初始化接口（参考 `customers.js` 的 `initCustomerTables`）

## 测试

```bash
npm run check                # 语法检查（全部 JS 文件）
npm run test:p0              # 基础 API 回归
npm run test:p0-security     # 安全基线
npm run test:permission      # 权限矩阵全链路
npm run test:team-scale      # 团队权限（兼容旧角色）
npm run test:order           # 订单管理
npm run test:inventory       # 库存
npm run test:finance         # 财务对账
npm run test:dashboard       # 数据大屏
npm run test:diagnostics     # 诊断中心
```

## 安全基线

- 生产环境强制 `JWT_SECRET`，禁止开发默认密钥
- 生产环境强制 `ALLOWED_ORIGINS`，禁止 CORS 全开放
- 登录/注册限流（令牌桶，60 秒窗口）
- query token 已禁用（所有查询需 JWT）
- 按钮审批路径遵守封账守门（已封账记录不可改）
- 外部库与内部库物理隔离，外部 token 与内部 JWT 互斥

## 版本历史

| 版本 | 日期 | 主要内容 |
| --- | --- | --- |
| V0.3 | 2026-06-21 | 三层架构拆分、通用表格路由独立、核心业务路由独立 |
| V0.3.1 | 2026-06-22 | 权限矩阵、默认系统管理员、内外库分离、客户查询 |

## 回退点

- V0.3 前：`backups/collab-grid-before-v0.3-full-20260621.zip`
- V0.3.1 前：`backups/collab-grid-v0.3-before-permission-matrix-full-20260621.zip`
