# CollabGrid V0.3.1 安全审查回复与修复方案

**审查方**：独立安全审计
**回复方**：CollabGrid 开发团队
**日期**：2026-06-22

---

## 一、审查结论确认

感谢详尽的审查报告。三路并行审查（安全漏洞 + 架构逻辑 + 数据完整性）的方法有效覆盖了代码的纵深问题。以下是对 26 项 CRITICAL/HIGH 主张的逐项确认：

| 级别 | 总数 | 确认准确 | 部分准确 | 不属实 |
|------|------|---------|---------|-------|
| CRITICAL | 13 | 10 | 3 | 0 |
| HIGH | 13 | 13 | 0 | 0 |

报告的三大主线——事务缺失（6 处）、订单取消不回滚、前端安全短板——全部成立。以下是需要修正的 3 项部分准确主张：

### 1. C-10：NULL 主键问题

报告描述为"UNIQUE/PRIMARY KEY 含 NULL 列"。实际更准确的表述是：

- `commission_ledger.original_ledger_id` 本身**没有 UNIQUE 约束**（不是"含 NULL 的 UNIQUE"），红冲记录可能重复指向同一笔原始佣金
- `order_activity_daily.product_record_id` 允许 NULL 且参与复合主键，SQLite 中 NULL != NULL 导致同一组合可插入多行

### 2. C-12：附件 URL 未消毒

代码已有正则校验 `^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$`，排除了 `javascript:` 协议，XSS 直接注入风险较低。但确实缺少域名白名单和 SSRF 防护。

### 3. C-13：批量路由绕过字段保护

`batch.js` 已检查 `f.locked`、`READONLY_FIELD_TYPES`、`businessLockCoreProtected`，并非"完全绕过"。缺失的是 `orderCompletionFieldProtected`、select 选项校验、number 格式校验、checkbox 归一化共 4 项。

### 4. 测试覆盖：数据大屏准确性

报告声称"dashboard 聚合准确性无测试"不属实。`dashboard_test.js` 有具体数值断言：应收总额 200、应付总额 120、8 张 KPI 卡片、7 天趋势、库存预警 >= 1。

---

## 二、系统性模式诊断

报告识别的 4 个系统性模式，我们逐一给出根因分析和修复策略：

### 模式 A：事务缺失（6 处）

**根因**：项目早期使用单条 SQL 即可完成的操作，随着业务复杂度增加，多步写入逐渐增多，但开发者习惯未同步升级。`upsertCell` 被设计为独立工具函数，调用方未意识到需要包裹事务。

**修复策略**：
1. 建立"多步写入必须事务"的编码规范
2. 在 `db.js` 中提供 `withTransaction(fn)` 辅助函数，降低使用门槛
3. 代码审查时强制检查所有涉及 2+ 次写入的函数

### 模式 B：读-改-写竞态（库存 + 佣金）

**根因**：SQLite 的 WAL 模式让读写并发不阻塞，开发者误以为"不会冲突"。实际上 WAL 只解决读写冲突，不解决读写-修改-写入的 TOCTOU 问题。

**修复策略**：
1. 所有"读取当前值 -> 计算新值 -> 写入"的操作，必须将读取移入事务内部
2. 使用 `SELECT ... FOR UPDATE` 语义（SQLite 中通过事务隔离实现）

### 模式 C：订单取消不回滚下游

**根因**：业务设计上的刻意选择——小型团队场景下，自动回滚可能引发不可逆的数据丢失（如已发货的库存无法简单加回）。但报告正确指出，随着业务增长，这会成为重大隐患。

**修复策略**：
1. 短期：取消审批时自动生成红冲任务记录，进入待处理队列，而非仅设标记
2. 中期：引入"取消回滚链"，按依赖顺序反向执行（库存恢复 -> 账单撤销 -> 佣金扣减）
3. 长期：评估是否需要真正的 Saga 模式或补偿事务

### 模式 D：前端权限仅为装饰性

**根因**：前后端分离架构下，前端负责 UX，后端负责安全，这是正确分工。但前端暴露了内部 API 函数名（如 `renameBase`、`deleteBase`），增加了攻击面。

**修复策略**：
1. 后端已做最终校验，这是底线，不需要改动
2. 前端不暴露 API 调用函数的全局引用，使用 IIFE 或模块作用域封装
3. 添加 CSP 头，限制脚本执行来源

---

## 三、分阶段修复方案

### Phase 1 — 止血（本周内完成）

目标：封死数据损坏和安全绕过的直接路径

| # | 问题 | 修复动作 | 验证方式 |
|---|------|---------|---------|
| C-1 | 库存审批竞态 | 将库存读取移入 `db.transaction()` 内部 | 并发测试：两个同时审批同一商品，库存应正确累加 |
| C-2 | 封账无事务 | `sealFinanceRecord` 包裹 `db.transaction()` | 中断测试：模拟第 3 次写入后崩溃，重启后数据应一致 |
| C-3 | 撤单审批无事务 | `approve_order_cancel` 包裹 `db.transaction()` | 同上 |
| C-4 | 资源审批无事务 | `approve_resource` 包裹 `db.transaction()` | 同上 |
| C-5 | 活动重建无事务 | `rebuildActivity` 包裹 `db.transaction()` | 同上 |
| C-6 | 字段归属未校验 | `cells.js` 写入端点增加 `f.table_id === r.table_id` 检查 | 跨表 fieldId 写入应返回 400 |
| C-13 | 批量路由缺失检查 | `batch.js` 补全 `orderCompletionFieldProtected` + select/number/checkbox 校验 | 批量接口与单条接口的校验行为一致 |

**交付标准**：所有 Phase 1 修复通过 `npm run test:p0` + `npm run test:permission` + 新增专项测试。

### Phase 2 — 补漏（两周内完成）

目标：修复业务逻辑缺陷和架构短板

| # | 问题 | 修复动作 | 验证方式 |
|---|------|---------|---------|
| C-7 | 快照永不同步 | 在订单完结、账单生成、库存审批后自动调用 `publicStore.upsertSnapshot()`；或添加定时作业每 5 分钟同步 | 外部客户查询能看到最新数据 |
| C-8 | 红冲双计 | `dashboardSummary` 聚合时排除 `type='reversal'` 的明细行；或红冲操作不再创建负金额明细，只更新原记录 | 红冲后 dashboard 总额正确 |
| C-9 | 取消不回滚 | 取消审批时自动生成红冲任务记录（进入 `job_queue`），而非仅设标记 | 取消后账单/佣金有对应的红冲记录 |
| C-10 | NULL 主键 | `order_activity_daily.product_record_id` 设为 `NOT NULL DEFAULT ''`；`commission_ledger.original_ledger_id` 加 UNIQUE | 重复插入触发冲突而非静默累积 |
| C-11 | JWT 存 localStorage | 添加 `/api/auth/cookie-login` 端点，返回 `Set-Cookie: cg_token=...; HttpOnly; Secure; SameSite=Strict`；前端优先读取 cookie | XSS 注入无法窃取 token |
| H-1 | 无优雅停机 | 注册 `process.on('SIGTERM', ...)` 和 `process.on('SIGINT', ...)`，依次关闭 server、停止调度器、关闭 db | `kill -TERM` 后进程正常退出，无 WAL 残留 |
| H-2 | 无全局错误处理 | 所有路由后添加 `app.use((err, req, res, next) => { ... })`，返回 JSON 错误，记录日志 | 故意抛出异常的测试路由返回 500 而非崩溃 |
| H-3 | 调度器漏跑 | 改用 `schedule_time <= currentTime` + `schedule_last_run_date < currentLocalDate` | 服务器在目标分钟停机后重启，任务补跑 |

**交付标准**：Phase 2 修复通过全部 14 套回归测试 + 新增业务闭环测试。

### Phase 3 — 加固（一个月内完成）

目标：提升整体健壮性和可维护性

| # | 问题 | 修复动作 | 优先级 |
|---|------|---------|-------|
| H-4 | 位置碰撞 | `records.js` 第 58 行 `COUNT(*)` 改为 `COALESCE(MAX(position), -1) + 1` | P1 |
| H-5 | 退款审批不锁记录 | 审批通过后 `UPDATE records SET locked=1` | P1 |
| H-6 | Formula Function() | 替换为纯数学求值库（如 `expr-eval`）或手写 AST 解析器 | P1 |
| H-7 | 无 CSP | 添加 `Content-Security-Policy: default-src 'self'; script-src 'self';` | P2 |
| H-8 | 无 CSRF | 添加 `csrf-csrf` 中间件，为状态变更请求加 token | P2 |
| H-9 | 无 Token 刷新 | 添加 `refreshToken`（长过期，存数据库）+ `/api/auth/refresh` | P2 |
| H-10 | Rate limiter 降级 | `authRateLimit` 前强制验证 `Content-Type: application/json` | P2 |
| H-11 | 账单生成不检查完结 | `generateFinanceDetails` 增加 `status === '已完结'` 检查 | P1 |
| H-12 | 收付款不更新 AR/AP | 添加 reconciliation 函数，根据流水汇总更新已收/已付金额 | P1 |
| M-1 | N+1 查询 | Lookup 字段批量 JOIN 替代逐条查询 | P2 |
| M-3 | 同名 table | `tables` 表加 `UNIQUE(base_id, name)` | P2 |
| M-4/M-5 | 索引缺失 | `audit_log` 加 `(base_id, created_at)` 索引；`links` 加 `(field_id, from_record_id)` 索引 | P2 |
| 测试缺口 | 7 项未覆盖 | 补全并发库存审批、字段归属校验、批量路由绕过、应付侧红冲、记录删除级联、退款全流程、JWT 过期测试 | P1 |

---

## 四、编码规范补充

基于本次审查发现的问题，新增以下编码规范：

1. **多步写入必须事务**：任何涉及 2+ 次数据库写入的操作，必须使用 `db.transaction()` 包裹
2. **读取-计算-写入必须原子**：所有"先读当前值，再计算新值，再写入"的操作，读取必须在事务内部
3. **字段归属必须校验**：任何向 `cells` 表写入的操作，必须验证 `field.table_id === record.table_id`
4. **批量接口校验对齐**：批量操作的校验逻辑必须与单条操作完全一致，禁止批量绕过
5. **前端不暴露 API 函数**：所有 API 调用函数封装在模块作用域内，不挂载到全局对象

---

## 五、时间线

| 阶段 | 截止日期 | 交付物 |
|------|---------|-------|
| Phase 1 | 2026-06-29 | 6 处事务修复 + 字段归属校验 + 批量路由补全 + 专项测试 |
| Phase 2 | 2026-07-06 | 快照同步 + 红冲双计修复 + 取消回滚 + NULL 主键 + JWT Cookie + 优雅停机 + 全局错误处理 + 调度器补跑 |
| Phase 3 | 2026-07-20 | 位置碰撞 + 记录锁定 + Formula 替换 + CSP + CSRF + Token 刷新 + Rate limiter + 账单完结检查 + 收付款对账 + 索引 + 测试补全 |

---

## 六、审查方建议的采纳情况

| 建议 | 采纳 | 说明 |
|------|------|------|
| 全局审查所有 upsertCell 调用链 | 采纳 | Phase 1 执行，建立编码规范防止新增 |
| 引入 Saga 模式或补偿事务 | 评估中 | 当前团队规模下过度设计，Phase 2 先用"红冲任务队列"过渡 |
| 替换 Function() 为数学求值库 | 采纳 | Phase 3 执行，评估 `expr-eval` 或手写 AST |
| JWT 迁移到 HttpOnly Cookie | 采纳 | Phase 2 执行，保留 Bearer 头作为向后兼容选项 |
| 补全 9 条未覆盖测试路径 | 采纳 | Phase 3 执行，其中 7 条为真实缺口（1 条重复，1 条不属实） |

---

*本文档为 CollabGrid V0.3.1 安全审查的正式回复，后续修复进度将同步更新至本文件。*
