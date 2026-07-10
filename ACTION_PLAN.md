# CollabGrid 独立执行计划书

**编制日期**：2026-06-30 | **编制依据**：行动需求表 v2026-06-30

任务分为两类：
- **纯文档类**：AI 可独立完成，零风险
- **代码类**：AI 可完成编码，但完成后需一层人工验证（运行测试或浏览器验证）

---

## 第一条线：生产部署补齐

### 1.1 SMTP 邮件告警（表二 #7，P2）

**交付物**：`app/notifier.js` + `config.js` 更新

当前 `app/alerts.js` 已实现内存告警管理，但告警只存在于内存中，服务重启即丢失。扩展方向：

- 新增 `app/notifier.js`，封装邮件发送逻辑（使用 Node.js 内置 `net` 模块直连 SMTP，无需额外依赖）
- `pushAlert()` 推送告警时同步调用 `notifier.send()` 异步发送邮件
- `config.js` 新增 `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASS`、`SMTP_FROM`、`ALERT_RECIPIENTS` 六项配置
- 仅在 `ALERT_RECIPIENTS` 配置时启用，未配置则静默跳过

**预估耗时**：1h | **人工验证**：配置 SMTP 后触发一次告警，确认邮件收到

### 1.2 自动备份脚本（表二 #8，P1）

**交付物**：`scripts/auto-backup.js`

功能：
- SQLite 模式：复制 `.db` 文件到 `backups/` 并压缩
- PostgreSQL 模式：调用 `pg_dump` 导出 SQL 到 `backups/`
- 支持 `--schedule` 参数作为 cron 任务入口
- 自动清理 30 天前的备份
- 备份文件命名：`backup_YYYYMMDD_HHmmss.{sql.gz|db.gz}`

**预估耗时**：1h | **人工验证**：运行脚本一次，确认备份文件完整可恢复

### 1.3 PM2 日志轮转配置（表二 #6，P1）

**交付物**：`ecosystem.config.cjs` 更新 + `scripts/setup-logrotate.js`

- 在 `ecosystem.config.cjs` 中配置 `log_date_format` 和日志文件路径
- 创建一键安装脚本 `scripts/setup-logrotate.js`，执行 `pm2 install pm2-logrotate` 并配置保留天数

**预估耗时**：0.5h | **人工验证**：在服务器上执行安装脚本，确认日志按天轮转

### 1.4 性能基准测试脚本（表二 #10，P2）

**交付物**：`scripts/benchmark.js`

功能：
- 使用 `autocannon`（需 `npm install --save-dev autocannon`）或手写 HTTP 压测
- 测试场景：`GET /health`、`POST /api/login`、`GET /api/tables/:id/page`、`PUT /api/records/:id/cells/:fieldId`
- 输出：QPS、P50/P95/P99 延迟、错误率
- 同时测 SQLite 和 PG 两种模式
- 结果以 JSON 格式写入 `benchmarks/` 目录

**预估耗时**：2h | **人工验证**：在目标服务器上运行，解读 QPS 和延迟数据是否满足业务需求

---

## 第二条线：AI 交接准备

### 2.1 前端模块依赖图（表三 #2，P0）

**交付物**：`docs/frontend-dependency-graph.md`（Mermaid 格式）

通过分析 24 个模块的 `window.*` 引用关系，已完成依赖梳理。交付文档包含：

- 四层加载顺序图（Layer 1 基础工具 → Layer 2 核心业务 → Layer 3 交互操作 → Layer 4 UI 面板）
- Mermaid `graph TD` 格式的完整依赖关系图
- 循环依赖标注（`cell-edit.js` ↔ `clipboard-ops.js`）
- `field-modal.js` 与 `field-modal-v2.js` 的 slot 冲突说明
- 各模块职责、暴露 API、行数的汇总表

**预估耗时**：0.5h | **风险**：纯文档，零风险

### 2.2 数据库 ER 图（表三 #4，P1）

**交付物**：`docs/er-diagram.md`（Mermaid 格式）

当前 `docs/er-diagram/` 目录不存在。需要：

- 从 `db/migrations/` 和 `pgAdapter.js` 中提取完整的建表 DDL
- 绘制 14 张核心表的 ER 关系图
- 标注外键关系、字段类型、索引

**预估耗时**：2h | **风险**：纯文档，低

### 2.3 测试覆盖缺口分析（表三 #6，P2）

**交付物**：`docs/test-coverage-gap.md`

当前有 31 个测试文件，需要：

- 逐文件统计测试用例数
- 对照 `services/`、`routes/`、`jobs/`、`app/` 目录列出覆盖情况
- 标注未覆盖的核心模块和关键路径
- 给出优先补全建议

**预估耗时**：1.5h | **风险**：纯文档，低

### 2.4 常见错误排查手册（表三 #8，P2）

**交付物**：`docs/troubleshooting.md`

内容：
- better-sqlite3 编译失败（Windows native 模块问题）
- PostgreSQL 连接拒绝/认证失败
- JWT token 过期/无效的处理流程
- Socket.IO 连接断开后的恢复策略
- 端口被占用时的排查步骤
- PM2 进程异常退出的日志定位

**预估耗时**：1h | **风险**：纯文档，低

### 2.5 API 契约文档补全（表三 #3，P1）

**交付物**：`API.md` 更新

当前 `app/validators.js` 已定义 18 个 Joi schema 覆盖核心端点的输入校验。需要补充：

- 每个端点的完整请求/响应示例（含成功和错误场景）
- HTTP 状态码说明（200/201/400/401/403/404/409/500）
- 错误响应体格式统一说明
- 分页参数规范
- Socket.IO 事件契约

**预估耗时**：3h | **风险**：纯文档，低

### 2.6 代码修改规范（表三 #5，P1）

**交付物**：`docs/ai-collaboration-guide.md`

为 AI 助手接手开发制定的协作规范：

- 修改流程：先读文件 → 提出变更方案 → 等确认 → 执行修改 → 运行语法检查 → 说明影响范围
- 文件修改规则：每次只改一个逻辑模块，避免大范围重构
- 测试要求：改动涉及 `services/` 或 `routes/` 时必须运行对应测试
- 命名规范：参考 `NAMING_CONVENTIONS.md`
- 禁止事项：不修改 `config.js` 的默认值结构、不删除现有 API 端点、不修改数据库 DDL

**预估耗时**：1h | **风险**：纯文档，零风险

---

## 第三条线：代码质量提升

### 3.1 field-modal-v2.js 与 field-modal.js 合并（技术债）

**交付物**：保留 `field-modal-v2.js`，删除 `field-modal.js`

两者暴露相同的 `window.AppFieldModal`，加载顺序决定生效版本。v2 是新版，但旧版仍存在于代码库中。

**预估耗时**：0.5h | **人工验证**：打开字段弹窗，确认所有功能正常

### 3.2 cell-edit 与 clipboard-ops 循环依赖消除（技术债）

**交付物**：抽取共享逻辑到 `clipboard.js`

当前 `cell-edit.js` 依赖 `clipboard-ops.js`（通过 `window.AppClipboardOps`），两者通过全局变量耦合。

**预估耗时**：1h | **人工验证**：复制、粘贴、剪贴板操作全部走一遍

### 3.3 .env.example 补全（表三 #7，P2）

**交付物**：`.env.example` 更新

当前 `.env.example` 已包含全部 31 项配置。需新增本次迭代新增的 SMTP 六项配置。

**预估耗时**：0.5h | **风险**：零风险

---

## 执行顺序与时间线

### 第一批（纯文档，零风险，AI 独立完成）

| 序号 | 任务 | 预估耗时 | 交付物 |
|------|------|----------|--------|
| 1 | 前端模块依赖图 | 0.5h | `docs/frontend-dependency-graph.md` |
| 2 | 数据库 ER 图 | 2h | `docs/er-diagram.md` |
| 3 | 测试覆盖缺口分析 | 1.5h | `docs/test-coverage-gap.md` |
| 4 | 代码修改规范 | 1h | `docs/ai-collaboration-guide.md` |
| 5 | 常见错误排查手册 | 1h | `docs/troubleshooting.md` |

### 第二批（代码变更，AI 完成 + 你验证）

| 序号 | 任务 | 预估耗时 | 交付物 | 验证方式 |
|------|------|----------|--------|----------|
| 6 | SMTP 邮件告警 | 1h | `app/notifier.js` | 触发告警，确认邮件收到 |
| 7 | 自动备份脚本 | 1h | `scripts/auto-backup.js` | 运行脚本，确认备份文件完整 |
| 8 | PM2 日志轮转 | 0.5h | `ecosystem.config.cjs` | 在服务器上执行安装脚本 |
| 9 | .env.example 补全 | 0.5h | `.env.example` | 无需验证 |
| 10 | field-modal 合并 | 0.5h | 删除 `field-modal.js` | 浏览器验证字段弹窗 |

### 第三批（代码重构，AI 完成 + 你测试）

| 序号 | 任务 | 预估耗时 | 交付物 | 验证方式 |
|------|------|----------|--------|----------|
| 11 | cell-edit 循环依赖消除 | 1h | `clipboard.js` 扩展 | 复制、粘贴、剪贴板全走一遍 |
| 12 | 性能基准测试脚本 | 2h | `scripts/benchmark.js` | 在服务器运行，解读结果 |

### 第四批（文档补全，参考第二批代码）

| 序号 | 任务 | 预估耗时 | 交付物 |
|------|------|----------|--------|
| 13 | API 契约文档补全 | 3h | `API.md` 更新 |

**总计**：约 14.5 小时

### 需要你亲自参与的（无法由 AI 替代）

| 序号 | 任务 | 说明 |
|------|------|------|
| 14 | JWT_SECRET / ALLOWED_ORIGINS 设置 | 需在目标服务器上修改 `.env` 文件 |
| 15 | HTTPS + Nginx 配置 | 需在服务器上申请证书并配置 Nginx |
| 16 | 防火墙规则配置 | 需服务器运维权限 |
| 17 | 功能匹配度评估（纳海 vs CollabGrid） | 需要纳海的需求文档 |
| 18 | 系统 IP 归属确认 | 需要与纳海之间明确授权协议 |
| 19 | AirScript / AI 集成规划 | 需要纳海的 AirScript 文档 |

---

## 自检修正记录

| 修正项 | 修正前 | 修正后 |
|--------|--------|--------|
| `public/app.js` 行数 | `PROJECT_GUIDE.md` 错误记录 ~2670 行 | 实际 **11 行**，逻辑已拆至 `modules/`。`PROJECT_GUIDE.md` 已修正 |
| app.js 拆分优先级 | review 建议补充为 P0 | 实际已完成拆分（24 个模块），无需额外拆分方案 |
| 性能基准测试批次 | 第一批（立即可做） | 移至第三批（P2），标注需人工解读结果 |
| 代码类任务标注 | "无需你的参与" | 全部标注为 "AI 完成 + 你验证" |
