# CollabGrid V0.3.1 修订总结

> 基于 QoderWork 独立审查建议书，分四个阶段完成安全加固与架构升级。
> 日期：2026-06-22

---

## 一、Phase 1 — 安全审计修复（C-1 ~ C-6 + C-13）

### C-1 库存审批竞态条件

**文件**：`server.js` → `approveInventoryOperation`

**问题**：库存读取（`actualBefore`/`virtualBefore`）在事务外执行，并发审批可能导致超卖。

**修复**：将库存读取移入 `db.transaction()` 内部，确保读取和写入在同一事务中完成。

### C-2 封账无事务保护

**文件**：`server.js` → `sealFinanceRecord`

**问题**：5 个写入操作（更新明细状态、标记封账、写入封账时间等）无事务包裹，中途失败会导致数据不一致。

**修复**：整体包裹 `db.transaction()`。

### C-3 撤单审批无事务保护

**文件**：`routes/grid/buttons.js` → `approve_order_cancel`

**问题**：跨表写入（订单状态 + 关联记录）无事务保护。

**修复**：包裹 `db.transaction()`。

### C-4 资源审批无事务保护

**文件**：`routes/grid/buttons.js` → `approve_resource`

**问题**：5 个写入操作（状态变更 + 时间戳 + 关联更新）无事务保护。

**修复**：包裹 `db.transaction()`。

### C-5 活动重建无事务保护

**文件**：`jobs/statusJob.js` → `rebuildActivity`

**问题**：DELETE + 多个 INSERT 操作无事务保护，失败后活动数据丢失。

**修复**：包裹 `db.transaction()`。

### C-6 字段归属校验缺失

**文件**：`routes/grid/cells.js` → PUT 端点

**问题**：写入单元格时未校验字段是否属于记录所在表，可跨表写入任意字段。

**修复**：增加 `f.table_id !== r.table_id` 校验，不匹配返回 404。

### C-13 批量路由校验缺失

**文件**：`routes/grid/batch.js`

**问题**：批量写入缺少 `orderCompletionFieldProtected` 保护、select/number/checkbox 类型校验。

**修复**：补全所有校验逻辑，与单条写入保持一致。

### 额外修复

**文件**：`server.js` → `ensureDefaultSysAdmin`

**问题**：已有 sys_admin 时跳过默认管理员创建，导致默认管理员角色可能为 `none`。

**修复**：移除"已有 sys_admin 就跳过"逻辑，确保默认管理员始终为 `sys_admin`。

---

## 二、P0 — 紧急改造（建议书 2.2 + 2.6）

### P0-1 事务签名改造

**目标**：从编译期消除事务遗漏的根因。

**改造内容**：

| 改造前 | 改造后 |
|--------|--------|
| `upsertCell(recordId, fieldId, value, ...)` | `upsertCell(tx, recordId, fieldId, value, ...)` |
| 第一个参数为 recordId | 第一个参数强制为数据库/事务对象 |
| 忘记包事务不会报错 | `tx` 为 null/undefined 时运行时抛出异常 |

**修改范围**：
- `server.js`：64 处调用（3 处传 `db` + 61 处传 `tx`）
- `routes/grid/buttons.js`：4 处调用（全部传 `tx`）
- 合计 **68 处**调用点适配

### P0-2 公式引擎替换

**目标**：消除 `Function()` 构造器的代码执行风险。

**改造内容**：

| 改造前 | 改造后 |
|--------|--------|
| `Function('"use strict"; return (' + jsExpr + ');')()` | 手写递归下降解析器 |
| 正则白名单过滤表达式 | tokenizer + parser 双阶段解析 |
| 任意 JS 表达式执行 | 仅支持四则运算、括号、字段引用 |

**新文件**：`services/formulaService.js`

**特性**：
- 四则运算（`+ - * /`）、括号嵌套
- 字段引用 `{字段名}`
- 除零保护（返回 NaN → 空字符串）
- 浮点精度控制（四舍五入到 4 位小数）
- 文本公式支持 `evaluateTextFormula`

---

## 三、P1 — 架构改善（建议书 2.1 + 2.3）

### P1-1 轻量数据库迁移框架

**目标**：将散落在 `db.js` 中的 ALTER TABLE 逻辑集中管理。

**新文件**：
- `db/migrate.js`（~60 行）— 迁移框架
- `db/migrations/001_initial_alter.js` — 初始迁移

**机制**：
- `schema_version` 表记录已执行的迁移版本号
- 启动时自动扫描 `migrations/` 目录，按版本号顺序执行未应用的迁移
- 每个迁移文件导出 `{ up(db) }` 函数
- 迁移失败时抛出异常，阻止服务启动

**后续新增迁移**：只需在 `migrations/` 目录下添加 `002_xxx.js` 文件即可。

### P1-2 server.js 按业务域拆分 service 层

**目标**：将 ~1350 行的 server.js 精简为路由入口，业务逻辑独立模块化。

**新增模块**：

| 模块 | 职责 | 导出函数数 |
|------|------|-----------|
| `services/helpers.js` | 共享基础函数（upsertCell, cellValue, fieldsMap 等） | 17 |
| `services/formulaService.js` | 公式引擎（递归下降解析器） | 2 |
| `services/inventoryService.js` | 库存审批 | 3 |
| `services/financeService.js` | 财务结算/封账/红冲 | 7 |
| `services/orderService.js` | 订单管理/默认值/布局 | 6 + 1 常量 |
| `services/dashboardService.js` | 数据大屏统计 | 5 |

**拆分结果**：
- server.js 从 **~1350 行 → ~960 行**
- 22 个业务函数外移到独立 service 模块
- server.js 通过 `gridRouteContext` 和 `coreRouteContext` 注入 service 函数
- broadcast 函数通过 `setBroadcast()` 注入到 helpers，service 层可直接调用

---

## 四、P2 — 质量提升（建议书 2.4 + 2.5）

### P2-1 测试金字塔重构

**目标**：从单层 HTTP E2E 测试升级为三层测试金字塔。

**测试结构**：

```
tests/
├── unit/                          ← 70% 零依赖单元测试
│   ├── formulaService.test.js     ← 22 个测试
│   └── syncService.test.js        ← 15 个测试
├── integration/                   ← 20% 内存 SQLite 集成测试
│   └── helpers.test.js            ← 6 个测试
├── p0_security_test.js            ← 10% HTTP 端到端
├── permission_matrix_test.js
└── security_audit_phase1_test.js
```

**运行方式**：
- 单元测试：`node tests/unit/*.test.js`（无需数据库、无需服务）
- 集成测试：`node tests/integration/*.test.js`（内存 SQLite）
- E2E 测试：需启动 HTTP 服务后执行

**测试覆盖**：
- 公式引擎：tokenize、parseAndEval、evaluateFormula、evaluateTextFormula、除零保护、浮点精度、非法输入
- 同步服务：publish、missedEvents、buffer overflow、clear
- 数据库操作：upsertCell、cellValue、fieldIdByName、事务支持

### P2-2 Socket.IO 重同步协议

**目标**：解决客户端断连后丢失实时事件的问题。

**新文件**：`services/syncService.js`

**机制**：

```
客户端连接 → base:join → 服务端发送 sync:seq { lastSeq: N }
                                    ↓
客户端断连重连 → sync:request { lastSeq: N }
                                    ↓
服务端查询 missedEvents(baseId, N) → 补发缺失事件
                                    ↓
服务端发送 sync:ack { currentSeq: M }
```

**核心设计**：
- 每个 base 维护独立的 **seq 计数器**（单调递增）
- **环形缓冲区**容量 200 条，自动淘汰旧事件
- `broadcast()` 函数自动调用 `syncService.publish()`，所有实时事件自动入缓冲区
- 缓冲区溢出时返回 `sync:snapshot` 通知客户端全量刷新
- `sync:request` 处理重连补发，逐条重放缺失事件

---

## 五、文件变更清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `services/formulaService.js` | 公式引擎（递归下降解析器） |
| `services/syncService.js` | Socket.IO 重同步协议 |
| `services/helpers.js` | 共享基础函数 |
| `services/inventoryService.js` | 库存审批 service |
| `services/financeService.js` | 财务结算 service |
| `services/orderService.js` | 订单管理 service |
| `services/dashboardService.js` | 数据大屏 service |
| `db/migrate.js` | 数据库迁移框架 |
| `db/migrations/001_initial_alter.js` | 初始迁移 |
| `tests/unit/formulaService.test.js` | 公式引擎单元测试 |
| `tests/unit/syncService.test.js` | 同步服务单元测试 |
| `tests/integration/helpers.test.js` | 数据库集成测试 |
| `tests/security_audit_phase1_test.js` | Phase 1 安全审计测试 |

### 修改文件

| 文件 | 变更内容 |
|------|----------|
| `server.js` | upsertCell 签名改造 + 公式引擎替换 + 22 个函数外移 + syncService 集成 + Socket.IO 增强 |
| `db.js` | ALTER TABLE 逻辑提取到迁移框架 |
| `routes/grid/buttons.js` | C-3/C-4 事务包裹 + upsertCell 签名适配 |
| `routes/grid/cells.js` | C-6 字段归属校验 |
| `routes/grid/batch.js` | C-13 批量路由校验补全 |
| `jobs/statusJob.js` | C-5 活动重建事务包裹 |

---

## 六、测试结果

| 测试套件 | 结果 |
|----------|------|
| `p0_security_test.js` | 通过 |
| `permission_matrix_test.js` | 通过 |
| `security_audit_phase1_test.js` | 通过 |
| `tests/unit/formulaService.test.js` | 22/22 通过 |
| `tests/unit/syncService.test.js` | 15/15 通过 |
| `tests/integration/helpers.test.js` | 6/6 通过 |
| **合计** | **全部通过** |
