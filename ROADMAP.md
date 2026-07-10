# CollabGrid 项目重规划

> 基于全面代码审查，识别出 13 个关键问题，重新规划开发路线。
> 核心原则：**先治理技术债务，再扩展功能。每个阶段交付可运行的系统。**

---

## 当前状态评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | 8/10 | 订单/库存/财务/佣金/客户门户/附件已实现 |
| 安全性 | 7/10 | JWT Cookie、CSRF、CSP、Rate Limit 已到位 |
| 代码质量 | 4/10 | server.js 1274行、app.js 2670行巨型单体 |
| 可维护性 | 3/10 | 重复代码、硬编码路径、无测试框架 |
| 可扩展性 | 2/10 | 同步 SQLite 锁死架构，无法水平扩展 |
| 测试覆盖 | 5/10 | 85 个测试通过，但无框架、无覆盖率度量 |

---

## 路线图总览

```
Phase 0: 治理基础（2天）  ← 当前
  ├── 0.1 引入工程化基础设施
  ├── 0.2 消除代码重复
  └── 0.3 清理冗余文件

Phase 1: 架构解耦（5天）
  ├── 1.1 server.js 拆分为路由模块
  ├── 1.2 前端 API 路径常量层
  ├── 1.3 统一配置管理
  └── 1.4 健康检查端点

Phase 2: 数据库异步化（5天）
  ├── 2.1 创建统一数据库接口层
  ├── 2.2 services/ 层 async 改造
  ├── 2.3 routes/ 层 async 改造
  ├── 2.4 jobs/ 层 async 改造
  └── 2.5 启用读连接池

Phase 3: PostgreSQL 切换（3天）
  ├── 3.1 端到端迁移验证
  ├── 3.2 读写分离配置
  └── 3.3 性能基准测试

Phase 4: 前端工程化（5天）
  ├── 4.1 app.js 按功能拆分
  ├── 4.2 组件化（表格/编辑器/模态框）
  └── 4.3 引入构建工具（Vite）

Phase 5: 生产加固（3天）
  ├── 5.1 CI/CD 流水线
  ├── 5.2 输入校验中间件
  ├── 5.3 Socket.IO 连接管理
  └── 5.4 监控告警
```

---

## Phase 0: 治理基础（2天）

### 0.1 工程化基础设施

**问题**: 无测试框架、无 linter、无构建工具、无 dotenv

| 任务 | 说明 |
|------|------|
| 安装 mocha + chai 为 devDependencies | 替代手写测试脚本 |
| 安装 eslint + prettier | 统一代码风格 |
| 安装 dotenv | 统一环境变量管理 |
| 创建 `.env.example` | 记录所有环境变量及说明 |
| 创建 `.eslintrc.json` | 配置规则 |
| 创建 `.gitignore` | 排除 data/、backups/、node_modules/ |

### 0.2 消除代码重复

**问题**: `tableNameOfField`/`fieldName` 重复 3 处，`JSON.parse(options)` 重复 11 处，Cookie 解析重复 2 处

| 任务 | 说明 |
|------|------|
| 提取 `parseOptions(field)` 到 `helpers.js` | 替换所有 `JSON.parse(f.options)` |
| 提取 `tableNameOfField`/`fieldName` 到 `helpers.js` | 从 server.js/orderService.js/tests 中删除重复 |
| 提取 `parseCookies(header)` 到 `server.js` 顶部 | Cookie 解析只定义一次 |
| 提取 `normalizeSelectOptions` 统一实现 | server.js 和 fields.js 使用同一版本 |

### 0.3 清理冗余文件

**问题**: data.db 在根目录和 data/ 都存在，10 个备份 zip 在仓库中，pg 依赖已安装但未启用

| 任务 | 说明 |
|------|------|
| 删除根目录 `data.db` | 只保留 `data/collab-grid.db` |
| 移动 `backups/` 到 `.gitignore` | 备份不入仓库 |
| 保留 `pgAdapter.js`/`dbFactory.js`/`migrate-to-pg.js` | Phase 3 会用到，不删除 |

---

## Phase 1: 架构解耦（5天）

### 1.1 server.js 拆分

**问题**: server.js 1274 行，承担 schema、字段校验、业务逻辑、路由注册、Socket.IO 全部职责

拆分为：
| 新文件 | 内容 |
|--------|------|
| `middleware/cookies.js` | Cookie 解析中间件 |
| `middleware/csrf.js` | CSRF 验证中间件 |
| `middleware/trace.js` | 请求追踪中间件 |
| `middleware/rateLimit.js` | 速率限制中间件 |
| `routes/auth.js` | 登录/注册/登出/刷新 |
| `routes/bases.js` | 基地 CRUD |
| `routes/audit.js` | 审计日志查询 |
| `socket/handler.js` | Socket.IO 事件处理 |
| `socket/middleware.js` | Socket.IO 认证中间件 |
| `bootstrap.js` | 服务启动、中间件注册、路由挂载 |

server.js 精简为 ~100 行的入口文件。

### 1.2 前端 API 路径常量层

**问题**: 53 处前端 API 路径硬编码

| 任务 | 说明 |
|------|------|
| 创建 `public/modules/api-routes.js` | 定义所有 API 路径常量 |
| app.js 中替换硬编码字符串 | 使用 `API.RECORDS_CELLS(id, fid)` |

### 1.3 统一配置管理

**问题**: 13 个环境变量分散在 6 个文件中

| 任务 | 说明 |
|------|------|
| 创建 `config.js` | 集中读取所有环境变量，提供默认值 |
| 各文件引用 `config.js` | 不再直接读 `process.env` |

### 1.4 健康检查端点

**问题**: 压力测试时无健康检查端点

| 任务 | 说明 |
|------|------|
| `GET /api/health` | 返回数据库连接状态、内存、连接数 |
| `GET /api/health/db` | 返回数据库详细信息 |

---

## Phase 2: 数据库异步化（5天）

**核心原则**: 创建统一数据库接口层，让 SQLite 和 PostgreSQL 共用同一套 API。

### 2.1 统一数据库接口层

创建 `db/unified.js`，提供统一的 async API：

```js
// 目标 API（所有代码统一使用这套接口）
const db = {
  async get(sql, params) {},    // 查询单行
  async all(sql, params) {},    // 查询多行
  async run(sql, params) {},    // 执行写入
  async transaction(fn) {},    // 事务
  async exec(sql) {},          // 执行 DDL
};
```

内部实现：
- `DB_ENGINE=sqlite`: 用 `better-sqlite3` 的同步 API 包装为 async（零改造成本）
- `DB_ENGINE=postgresql`: 直接使用 `pg` 连接池

### 2.2 services/ 层改造

将 `helpers.js`/`formulaService.js`/`orderService.js` 等改为 async。

**关键**: 由于 SQLite wrapper 是"伪 async"（同步执行返回 resolved Promise），改造后 SQLite 模式下行为不变，但代码已经是 async 的，切换 PostgreSQL 时无需再改。

### 2.3 routes/ 层改造

所有路由处理函数改为 async。

### 2.4 jobs/ 层改造

所有 job 函数改为 async。

### 2.5 启用读连接池

**问题**: `getReadDb()` 已实现但未使用

将所有 SELECT 查询改为使用读连接（通过统一接口自动路由）。

---

## Phase 3: PostgreSQL 切换（3天）

### 3.1 端到端迁移验证

| 任务 | 说明 |
|------|------|
| 在 Docker 中启动 PostgreSQL | 使用 docker-compose |
| 运行 `migrate-to-pg.js` | 迁移全部数据 |
| 切换 `DB_ENGINE=postgresql` | 验证所有功能 |
| 运行全部测试 | 确保无回归 |

### 3.2 读写分离配置

| 任务 | 说明 |
|------|------|
| 配置主库 + 只读副本 | `PG_READ_HOST` |
| 验证读请求路由到副本 | 检查连接池指标 |

### 3.3 性能基准测试

| 任务 | 说明 |
|------|------|
| 跑压力测试（SQLite vs PostgreSQL） | 对比 QPS |
| 跑 500 笔订单负载测试 | 对比延迟 |
| 记录基准数据 | 作为后续优化参考 |

---

## Phase 4: 前端工程化（5天）

### 4.1 app.js 按功能拆分

| 新模块 | 内容 |
|--------|------|
| `modules/auth-view.js` | 登录/注册 UI |
| `modules/grid.js` | 表格渲染、虚拟滚动 |
| `modules/socket.js` | Socket.IO 连接管理 |
| `modules/field-editors.js` | 各类型字段编辑器 |
| `modules/sidebar.js` | 侧边栏、表格切换 |
| `modules/templates.js` | 模板初始化 |

app.js 精简为 ~200 行的入口文件。

### 4.2 组件化

将重复的 UI 模式提取为可复用组件。

### 4.3 引入 Vite

| 任务 | 说明 |
|------|------|
| 创建 `vite.config.js` | 配置构建 |
| 模块改为 ES Module | import/export |
| 开发热更新 | HMR |

---

## Phase 5: 生产加固（3天）

### 5.1 CI/CD 流水线

GitHub Actions: PR 自动跑测试 + lint + 类型检查。

### 5.2 输入校验中间件

所有 API 入口增加 Joi 校验。

### 5.3 Socket.IO 连接管理

disconnect 清理、心跳检测、连接数监控。

### 5.4 监控告警

健康检查端点、调度器失败告警、WAL 文件监控。

---

## 风险回避清单

| 原始问题 | 回避措施 |
|----------|----------|
| 公式引擎 `new Function()` RCE | 已替换为安全解析器（Phase 0 前已完成） |
| SQL 注入 | 已全面参数化（Phase 0 前已完成） |
| JWT localStorage 窃取 | 已迁移到 HttpOnly Cookie（Phase 0 前已完成） |
| server.js 改造引入回归 | Phase 1 拆分时每步跑全部 85 个测试 |
| async 改造引入竞态 | Phase 2 使用"伪 async" wrapper，SQLite 下行为不变 |
| PG 迁移数据丢失 | Phase 3 先 dry-run 预览，保留 SQLite 备份 |
| 前端拆分破坏功能 | Phase 4 渐进式拆分，每步浏览器验证 |
| pg 依赖成为死代码 | Phase 0 不删除，Phase 3 直接启用 |

---

## 工时估算

| Phase | 天数 | 累计 |
|-------|------|------|
| Phase 0: 治理基础 | 2 | 2 |
| Phase 1: 架构解耦 | 5 | 7 |
| Phase 2: 数据库异步化 | 5 | 12 |
| Phase 3: PostgreSQL 切换 | 3 | 15 |
| Phase 4: 前端工程化 | 5 | 20 |
| Phase 5: 生产加固 | 3 | 23 |

**总计约 23 个工作日（~1 个月）**
