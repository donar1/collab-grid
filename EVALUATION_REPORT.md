# Collab-Grid 项目完整评估报告

> 评估日期：2026-06-22
> 评估范围：全量代码、配置、文档（只读，未修改任何文件）

---

## 1. 代码统计

### 1.1 项目概览

| 类别 | 文件数 | 代码行数（估算） | 说明 |
|------|--------|------------------|------|
| 后端 JS 文件 | 34 | ~9,800 | 含根目录、services/、routes/、security/、layers/、app/、jobs/、db/ |
| 前端文件 | 9 | ~3,200 | public/ 下 JS、CSS、HTML |
| 测试文件 | 3 | ~650 | tests/ 目录 |
| 配置文件 | 5 | ~250 | package.json、.env.example、config.js、build.js 等 |
| 文档 | 5 | ~500 | docs/、README、ARCHITECTURE_LAYERS 等 |
| **总计** | **~56** | **~14,400** | — |

### 1.2 后端文件明细

| 目录/文件 | 行数 | 职责 |
|-----------|------|------|
| `server.js` | ~1,050 | Express 主服务、路由挂载、Socket.IO、全局中间件 |
| `auth.js` | ~120 | JWT Cookie 认证、密码哈希、用户注册/登录 |
| `db.js` | ~80 | SQLite 连接（WAL 模式）、读写分离代理 |
| `publicDb.js` | ~292 | 外部查询库（独立 SQLite），客户快照、对账系统 |
| `dbFactory.js` | ~55 | 数据库工厂，支持 SQLite/PostgreSQL 切换 |
| `pgAdapter.js` | ~180 | PostgreSQL 适配器（基于 `pg` 驱动） |
| `config.js` | ~45 | 运行时配置（端口、密钥、Cookie 域等） |
| `logger.js` | ~30 | 简单日志封装 |
| `services/dbAdapter.js` | ~120 | 数据库适配器抽象层（SQLite/PostgreSQL 统一接口） |
| `services/helpers.js` | ~183 | 共享基础函数（cellValue、upsertCell、fieldsMap、广播等） |
| `services/syncService.js` | ~120 | 实时同步服务（Socket 广播、presence） |
| `services/formulaService.js` | ~260 | 公式引擎（SUM、AVERAGE、LOOKUP、LINK 等） |
| `services/orderService.js` | ~280 | 订单业务逻辑（创建、审批、红冲、库存扣减） |
| `services/inventoryService.js` | ~180 | 库存业务逻辑（出入库、流水、成本更新） |
| `services/financeService.js` | ~287 | 财务核算（应收/应付明细、结算单、封账、红冲） |
| `services/dashboardService.js` | ~191 | 数据大屏聚合统计 |
| `routes/grid/*.js` (7 文件) | ~1,050 | 表格/单元格/记录/按钮/链接/批量操作/公式路由 |
| `routes/core/*.js` (6 文件) | ~1,200 | 核心业务路由：产品、客户、订单、账单、库存、财务 |
| `routes/security/*.js` (1 文件) | ~80 | 权限矩阵路由 |
| `routes/public/*.js` (1 文件) | ~65 | 外部客户查询 API |
| `security/guards.js` | ~100 | 权限守卫（RBAC：owner/admin/editor/viewer） |
| `security/permissions.js` | ~75 | 权限矩阵定义（表级/字段级/记录级） |
| `security/roles.js` | ~30 | 角色常量定义 |
| `security/matrixStore.js` | ~50 | 权限矩阵存储与查询 |
| `layers/tableLayer.js` | ~110 | 表数据访问层（封装表级 CRUD） |
| `layers/businessRelations.js` | ~90 | 业务关系层（订单-库存-财务关联） |
| `app/middleware.js` | ~90 | Express 中间件（错误处理、审计日志） |
| `app/socket.js` | ~120 | Socket.IO 事件处理（实时协作） |
| `app/context.js` | ~40 | 应用上下文（依赖注入辅助） |
| `jobs/index.js` | ~35 | 定时任务调度器入口 |
| `jobs/snapshotSyncJob.js` | ~292 | 快照同步任务（内部库→外部库） |
| `db/migrate.js` | ~80 | 数据库迁移脚本（SQLite 表结构初始化） |
| `scripts/migrate-to-pg.js` | ~180 | PostgreSQL 迁移脚本 |
| `scripts/build.js` | ~55 | 前端构建脚本（esbuild） |

### 1.3 前端文件明细

| 文件 | 行数 | 职责 |
|------|------|------|
| `public/index.html` | ~55 | 主页面、CDN 资源加载、CSP 配置 |
| `public/app.js` | ~1,450 | 前端主应用（状态管理、路由、事件绑定） |
| `public/styles.css` | ~520 | 全局样式、主题变量、响应式布局 |
| `public/modules/grid-render.js` | ~380 | 表格渲染引擎（虚拟滚动、单元格编辑） |
| `public/modules/auth.js` | ~120 | 前端认证（登录/注册/权限检查） |
| `public/modules/api.js` | ~90 | API 请求封装（fetch、错误处理） |
| `public/modules/dashboard.js` | ~150 | 大屏数据展示组件 |
| `public/modules/socket.js` | ~156 | WebSocket 客户端（实时更新、presence） |
| `public/modules/utils.js` | ~50 | 工具函数（DOM 操作、toast、confirm） |

### 1.4 测试文件明细

| 文件 | 行数 | 职责 |
|------|------|------|
| `tests/unit/auth.test.js` | ~120 | 认证单元测试（bcrypt、JWT、注册/登录） |
| `tests/integration/security.test.js` | ~280 | 安全集成测试（SQL 注入、XSS、权限、速率限制） |
| `tests/p0_security_test.js` | ~250 | P0 安全回归测试（自动化安全扫描） |

---

## 2. 架构评估

### 2.1 后端分层清晰度：良好（8/10）

项目采用 **三层架构**，分层较为清晰：

```
┌─────────────────────────────────────────┐
│  第一层：操作界面 / 通用表格能力          │
│  routes/grid/  +  services/formulaService │
├─────────────────────────────────────────┤
│  第二层：核心业务                         │
│  routes/core/  +  services/*Service       │
├─────────────────────────────────────────┤
│  第三层：数据大屏与财务核算               │
│  services/dashboardService  +  financeService│
└─────────────────────────────────────────┘
```

**路由层（routes/）**：
- 按功能域拆分为 `grid/`、`core/`、`security/`、`public/`，职责单一
- 使用 `asyncHandler` 统一捕获异步错误
- 每个路由模块通过 `ctx` 注入依赖，便于测试和替换

**服务层（services/）**：
- 业务逻辑集中封装：`orderService`、`inventoryService`、`financeService`、`dashboardService`
- `helpers.js` 提供共享底层工具，但部分函数（如 `upsertCell`）同时承担数据访问职责，边界略模糊
- `formulaService` 独立实现公式引擎，与业务解耦

**数据层（db/、layers/）**：
- `db.js` 管理数据库连接，`dbFactory.js` + `pgAdapter.js` + `services/dbAdapter.js` 提供多数据库适配
- `layers/tableLayer.js` 和 `businessRelations.js` 尝试封装数据访问，但实际业务代码中大量直接使用 `db.prepare(...)`，数据层抽象不够彻底

**安全层（security/）**：
- `guards.js` 实现 RBAC 权限检查
- `permissions.js` + `matrixStore.js` 实现细粒度权限矩阵（表级/字段级/记录级）
- 安全中间件在 `server.js` 中统一挂载，位置合理

**改进建议**：
- 建议将 `services/helpers.js` 中的原始 SQL 操作进一步下沉到 `layers/` 或 `repositories/`，避免服务层直接操作数据库
- `server.js` 超过 1,000 行，建议将路由挂载、中间件配置、Socket.IO 初始化进一步拆分

### 2.2 前端模块化程度：中等（6/10）

**模块数量**：9 个前端文件，其中 7 个模块文件

**最大文件**：`public/app.js`（~1,450 行），承担了：
- 全局状态管理（`AppState`）
- 路由/视图切换
- 事件监听与绑定
- UI 组件渲染（表格、侧边栏、顶部栏、设置面板）
- 公式编辑、字段配置、批量操作等复杂交互

**模块化优点**：
- 按职责拆分为 `grid-render`、`auth`、`api`、`dashboard`、`socket`、`utils`
- 使用 IIFE + `window.AppXxx` 命名空间，避免全局污染

**模块化不足**：
- `app.js` 过于庞大，建议拆分为 `router.js`、`state.js`、`components/` 子目录
- 无前端构建工具链的代码分割配置（esbuild 仅用于合并，未配置 chunk 分割）
- 无前端单元测试

### 2.3 数据库设计评估

**表结构**：

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `bases` | 工作空间 | `id`, `name`, `owner_id` |
| `tables` | 数据表定义 | `id`, `base_id`, `name`, `position` |
| `fields` | 字段定义 | `id`, `table_id`, `name`, `type`, `options` |
| `records` | 记录/行 | `id`, `table_id`, `position`, `locked` |
| `cells` | 单元格值 | `record_id`, `field_id`, `value` |
| `links` | 关联关系 | `field_id`, `from_record_id`, `to_record_id` |
| `users` | 用户 | `id`, `email`, `password_hash`, `role` |
| `members` | 空间成员 | `base_id`, `user_id`, `role` |
| `audit_logs` | 审计日志 | `base_id`, `user_id`, `action`, `details` |
| `public_clients` | 外部客户令牌 | `token`, `base_id`, `customer_key` |
| `public_customer_snapshot` | 客户可见快照 | `base_id`, `customer_key`, `category`, `ref_id` |
| `public_access_log` | 外部访问审计 | `token`, `path`, `status`, `ip` |
| `public_reconciliation` | 对账记录 | `id`, `base_id`, `record_date`, `debit`, `credit` |

**索引评估**：
- 核心表有合理索引：`cells(record_id, field_id)`、`links(field_id, from_record_id)`、`fields(table_id)`
- 外部库有专用索引：`idx_public_snapshot_lookup`、`idx_public_access_token`、`idx_recon_lookup`
- **缺失**：`cells` 表缺少针对 `value` 字段的索引（影响按值查询性能）；`records` 表缺少复合索引 `(table_id, position)`

**外键约束**：
- SQLite 已启用 `PRAGMA foreign_keys = ON`
- 但表定义中未显式声明 `FOREIGN KEY` 约束（如 `cells` 表的 `record_id`、`field_id`），依赖应用层维护引用完整性
- **风险**：手动删除记录时可能产生孤儿数据

---

## 3. 安全评估

### 3.1 已实施的安全措施

| 安全措施 | 实施状态 | 位置/说明 |
|----------|----------|-----------|
| **JWT 认证** | 已实施 | `auth.js`：HS256 签名，7 天过期，存储于 httpOnly Cookie |
| **密码哈希** | 已实施 | `bcryptjs`，salt rounds = 10 |
| **CSRF 防护** | 已实施 | `csurf` 中间件，Cookie-based token |
| **CORS** | 已实施 | `cors` 中间件，限制 `http://localhost:3000` |
| **CSP** | 已实施 | `index.html` 中 `<meta http-equiv="Content-Security-Policy">` |
| **速率限制** | 已实施 | `express-rate-limit`：API 100 req/15min，登录 5 req/15min |
| **SQL 注入防护** | 已实施 | 全面使用参数化查询（`db.prepare(...).run(...)`），无字符串拼接 |
| **XSS 防护** | 部分实施 | 前端 `textContent` 替代 `innerHTML`；但 `formulaService.js` 中 `new Function()` 存在风险 |
| **输入校验** | 已实施 | `validator` 库校验邮箱，`zod` 校验请求体（部分路由） |
| **权限控制** | 已实施 | RBAC（owner/admin/editor/viewer）+ 细粒度权限矩阵 |
| **审计日志** | 已实施 | `audit_logs` 表记录所有关键操作 |
| **数据隔离** | 已实施 | 内外库分离（`collab-grid.db` vs `collab-grid-public.db`） |
| **记录封账** | 已实施 | `records.locked` 字段 + `assertRecordWritable()` 校验 |
| **HTTPS 支持** | 配置就绪 | `.env.example` 中 `USE_HTTPS=true`，生产环境可启用 |

### 3.2 潜在风险点

| 风险等级 | 风险描述 | 位置 |
|----------|----------|------|
| **高** | `formulaService.js` 使用 `new Function()` 执行用户输入的公式表达式，存在代码注入风险 | `formulaService.js:45` |
| **中** | `publicDb.js` 的 `querySnapshots()` 在内存中过滤数据，若数据量大可能导致性能问题和信息泄露（虽然已按 baseId/customerKey 过滤） | `publicDb.js:142-191` |
| **中** | `server.js` 中 `normalizeSelectOptions` 使用 `JSON.parse` 解析用户输入，若输入非法可能导致崩溃 | `server.js` |
| **低** | JWT Secret 从环境变量读取，但 `config.js` 中无密钥强度校验（如最小长度） | `config.js` |
| **低** | 前端 `app.js` 中部分动态 HTML 拼接（如 `el('div', { innerHTML: ... })`）可能存在 XSS，需确认是否经过转义 | `public/app.js` |
| **低** | Socket.IO 的 `base:join` 事件未校验用户是否有权限访问该 base | `app/socket.js` |

---

## 4. 性能评估

### 4.1 数据库查询优化

| 优化措施 | 状态 | 说明 |
|----------|------|------|
| **WAL 模式** | 已启用 | `db.js` 和 `publicDb.js` 均设置 `journal_mode = WAL`，提升并发读写性能 |
| **读写分离** | 部分实现 | `db.js` 提供 `getReadDb()` 返回只读连接，但业务代码中大部分仍使用主 `db` 对象 |
| **连接池** | 未实现 | SQLite 为文件级数据库，无连接池；PostgreSQL 适配器未配置 `pg.Pool` |
| **表结构缓存** | 已实施 | `services/helpers.js` 中 `_tableCache` 和 `_fieldsCache`，TTL 60 秒 |
| **查询缓存** | 已实施 | `publicDb.js` 中 `_queryCache`，TTL 30 秒，限制 5000 条 |
| **索引覆盖** | 基本满足 | 核心查询路径有索引，但 `cells.value` 筛选缺少索引 |

### 4.2 前端性能

| 优化措施 | 状态 | 说明 |
|----------|------|------|
| **构建工具** | 已配置 | `esbuild` 用于合并前端模块（`scripts/build.js`） |
| **代码分割** | 未实施 | 无动态 `import()` 或多 chunk 配置 |
| **资源压缩** | 未实施 | 无 minification 配置（esbuild 可配置但未启用） |
| **CDN 资源** | 已使用 | Socket.IO、SortableJS 使用 CDN |
| **虚拟滚动** | 未实施 | 表格渲染为全量 DOM，大数据量时可能卡顿 |
| **防抖/节流** | 部分实施 | 单元格编辑有 `blur` 触发保存，无显式防抖 |

### 4.3 实时同步机制

| 特性 | 状态 | 说明 |
|------|------|------|
| **Socket.IO** | 已实施 | 基于 WebSocket 的实时双向通信 |
| **事件粒度** | 细粒度 | 支持 `cell:update`、`field:add/delete`、`record:add/delete`、`link:add/delete` 等 |
| **Presence** | 已实施 | `presence:join/leave` 事件，顶部栏显示在线用户 |
| **乐观更新** | 未实施 | 前端等待服务器确认后才更新 UI |
| **冲突解决** | 简单覆盖 | 无 OT/CRDT 算法，后写入覆盖先写入 |
| **离线支持** | 未实施 | 无本地缓存或离线编辑能力 |

---

## 5. 可维护性评估

### 5.1 代码重复度：中等偏高

**重复模式**：
- `asyncHandler` 在每个路由模块中重复定义（`routes/core/*.js`、`routes/grid/*.js` 等），应提取到公共工具
- `moneyRound` 函数在 `financeService.js` 和 `dashboardService.js` 中重复定义
- `localDateString`、`daysAgoDateString` 等日期工具在 `dashboardService.js` 中内联定义，未提取到公共库
- 权限检查逻辑（`role !== 'owner' && role !== 'admin'`）在多个路由中重复

### 5.2 配置集中化程度：良好

| 配置项 | 位置 | 评价 |
|--------|------|------|
| 运行时配置 | `config.js` | 端口、密钥、Cookie 域集中管理 |
| 环境变量 | `.env.example` | 模板完整，涵盖数据库、邮件、HTTPS、JWT 等 |
| 前端 CDN | `index.html` | 版本号硬编码，建议集中配置 |
| 数据库路径 | `db.js`、`publicDb.js` | 分散定义，建议统一 |
| 业务常量 | `security/roles.js` | 角色常量集中，但其他业务常量（如订单状态）分散在各服务中 |

### 5.3 测试覆盖率：偏低

| 测试类型 | 文件数 | 覆盖率估计 | 评价 |
|----------|--------|------------|------|
| 单元测试 | 1 | ~15% | 仅覆盖 `auth.js` 的核心函数 |
| 集成测试 | 1 | ~20% | 覆盖安全场景（SQL 注入、XSS、权限） |
| P0 回归测试 | 1 | — | 安全扫描脚本 |
| 服务层测试 | 0 | 0% | `orderService`、`financeService` 等无测试 |
| 前端测试 | 0 | 0% | 无前端单元/E2E 测试 |
| 数据库迁移测试 | 0 | 0% | 无迁移回滚测试 |

**关键缺失**：
- 财务核算逻辑（应收/应付计算、红冲、封账）无测试
- 库存流水逻辑无测试
- 公式引擎无测试
- Socket.IO 实时同步无测试

### 5.4 文档完整性：中等

| 文档 | 状态 | 评价 |
|------|------|------|
| `README.md` | 存在 | 项目总览，但 `docs/README.md` 只是目录索引 |
| `ARCHITECTURE_LAYERS.md` | 存在 | 三层架构设计说明清晰 |
| `V0.3_RELEASE_NOTES.md` | 存在 | 版本变更记录 |
| `V0.3.1_PERMISSION_MATRIX.md` | 存在 | 权限矩阵说明 |
| `COLLABGRID_PROJECT_GUIDE.md` | 存在 | 项目指南（原 README） |
| `NAMING_CONVENTIONS.md` | 存在 | 命名规范 |
| API 文档 | 缺失 | 无 OpenAPI/Swagger 文档 |
| 部署文档 | 缺失 | 无 Docker/K8s/PM2 部署指南 |
| 数据库 ER 图 | 缺失 | 无实体关系图 |
| 开发环境搭建指南 | 缺失 | 仅 `npm install && npm start` |

---

## 6. 迁移准备度评估

### 6.1 PostgreSQL 迁移基础设施

| 组件 | 状态 | 评价 |
|------|------|------|
| `dbFactory.js` | 已实施 | 支持通过 `DB_TYPE=postgres` 切换数据库 |
| `pgAdapter.js` | 已实施 | 基于 `pg` 驱动的 PostgreSQL 适配器，实现了 `query`/`run`/`all`/`get`/`transaction` 接口 |
| `services/dbAdapter.js` | 已实施 | 统一数据库适配器，抽象 SQLite/PostgreSQL 差异 |
| `scripts/migrate-to-pg.js` | 已实施 | 数据迁移脚本，支持表结构 + 数据迁移 |
| `db/migrate.js` | 已实施 | SQLite 表结构初始化脚本 |

**迁移成熟度**：**70%**

**已具备能力**：
- 数据库连接工厂支持运行时切换
- PostgreSQL 适配器实现了核心接口
- 迁移脚本可导出 SQLite 数据并导入 PostgreSQL

**待完善**：
- `pgAdapter.js` 中事务处理使用 `BEGIN`/`COMMIT`/`ROLLBACK` 字符串拼接，建议使用 `pg` 的客户端事务 API
- 未配置 `pg.Pool`，高并发场景下单连接可能成为瓶颈
- 迁移脚本缺少数据校验和回滚机制
- 部分 SQLite 特有语法（如 `INSERT OR REPLACE`）在 PostgreSQL 中需适配为 `ON CONFLICT`（已在 `pgAdapter.js` 中部分处理）

### 6.2 异步化程度

| 指标 | 状态 | 评价 |
|------|------|------|
| `async/await` 覆盖率 | ~60% | 路由层全面使用 async/await；服务层部分函数仍为同步（如 `financeService.js` 中的 `generateFinanceDetails`） |
| 同步阻塞操作 | 存在 | `better-sqlite3` 为同步驱动，所有数据库操作均为同步阻塞 |
| 异步包装 | 部分实施 | `financeService.js`、`dashboardService.js`、`snapshotSyncJob.js` 中提供了 `*Async` 包装函数，但只是简单 `return fn(...)` |
| 后台任务 | 已实施 | `jobs/snapshotSyncJob.js` 支持异步快照同步；`setImmediate` 用于非阻塞钩子 |
| Promise 错误处理 | 基本完善 | 路由层使用 `asyncHandler` 统一捕获；但部分 `setImmediate` 和事件回调缺少错误处理 |

**关键发现**：
- `better-sqlite3` 本身是同步驱动，这是当前架构的最大异步化瓶颈。迁移到 PostgreSQL 后，应全面改用异步查询接口
- 多个 Service 文件末尾提供了 `*Async` 包装（如 `generateFinanceDetailsAsync`），但实现为 `return generateFinanceDetails(...)`，并非真正的异步执行，只是为兼容 async/await 调用约定
- Socket.IO 事件处理器中部分逻辑未加 `try/catch`，可能导致未捕获异常

---

## 7. 总体评分

| 维度 | 评分 | 总结 |
|------|------|------|
| 代码组织 | 7/10 | 分层清晰，但 `server.js` 和 `app.js` 过于庞大，部分重复代码 |
| 架构设计 | 8/10 | 三层架构合理，多数据库适配设计良好，内外库分离是亮点 |
| 安全性 | 8/10 | 安全措施全面，但公式引擎的 `new Function()` 是高风险点 |
| 性能优化 | 6/10 | WAL 和缓存已实施，但缺少连接池、代码分割、虚拟滚动 |
| 可维护性 | 6/10 | 文档基本齐全，但测试覆盖率偏低，代码重复度偏高 |
| 迁移准备度 | 7/10 | PostgreSQL 基础设施已具备，但需完善连接池和异步化改造 |
| **综合评分** | **7/10** | 项目整体质量良好，适合中小规模业务，向大规模生产环境演进需补齐测试、性能优化和异步化 |

---

## 8. 优先改进建议

1. **安全**：将 `formulaService.js` 中的 `new Function()` 替换为安全的表达式解析器（如 `mathjs` 或自定义 AST 解析器）
2. **测试**：为 `orderService`、`financeService`、`inventoryService` 补充单元测试，目标覆盖率 > 60%
3. **性能**：为 PostgreSQL 配置连接池（`pg.Pool`），实现真正的读写分离
4. **前端**：将 `app.js` 拆分为路由、状态、组件子模块；引入代码分割和懒加载
5. **数据库**：为 `cells.value` 和 `records(table_id, position)` 添加索引；显式声明外键约束
6. **异步化**：迁移到 PostgreSQL 后，全面改用异步数据库接口，移除同步阻塞调用
7. **文档**：补充 API 文档（OpenAPI/Swagger）和部署文档
