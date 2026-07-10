# CollabGrid V0.4.0 技术债务清单

**基于深度综合审计报告整理** | **2026-07-01**

---

## 总览

| 严重程度 | 数量 | 占比 |
|----------|------|------|
| P0 严重 | 17 | 23% |
| P1 高危 | 18 | 24% |
| P2 中危 | 18 | 24% |
| P3 低危 | 13 | 18% |
| 技术债务（非缺陷） | 8 | 11% |
| **合计** | **74** | |

---

## 一、P0 严重（上线前必须修复）

### 安全类（6 项）

| ID | 问题 | 文件 | 预估工时 | 可AI独立完成 |
|----|------|------|----------|-------------|
| S-01 | JWT_SECRET 有默认值，启动时未强制校验 | `config.js:42` | 0.5h | 是 |
| S-02 | JWT 无撤销机制，改密码后旧 token 仍有效 | `auth.js`, `server.js:471` | 3h | 是 |
| S-04 | 密码复杂度仅检查长度，弱密码可通过 | `app/validators.js:18` | 0.5h | 是 |
| S-06 | SVG 附件 inline 模式存在 XSS | `routes/grid/attachments.js:282` | 0.5h | 是 |
| S-09 | 文件上传无总大小限制，可 OOM | `routes/grid/attachments.js:122` | 0.5h | 是 |
| S-15 | createRecordSchema 允许任意 fieldId | `app/validators.js:54` | 0.5h | 是 |

### 架构类（3 项）

| ID | 问题 | 文件 | 预估工时 | 可AI独立完成 |
|----|------|------|----------|-------------|
| S-07 | SQLite/PG Schema 不一致（7 项差异） | `db.js` vs `pgAdapter.js` | 4h | 需验证 |
| S-08 | Core 路由硬编码角色绕过权限矩阵 | `routes/core/customers.js:31` | 2h | 是 |
| S-10 | 公式引擎无循环引用检测 | `services/formulaService.js` | 2h | 是 |

### 代码质量类（1 项）

| ID | 问题 | 文件 | 预估工时 | 可AI独立完成 |
|----|------|------|----------|-------------|
| S-03 | bcrypt.hashSync 阻塞事件循环（4处） | `server.js:387,398,416,479` | 0.5h | 是 |

### 性能类（1 项，审计归类为P0但实际影响大屏场景）

| ID | 问题 | 文件 | 预估工时 | 可AI独立完成 |
|----|------|------|----------|-------------|
| S-05 | 非生产环境错误消息泄露内部信息 | `server.js:298` | 0.5h | 是 |

---

## 二、P1 高危（本周内修复）

### 安全类（7 项）

| ID | 问题 | 文件 | 预估工时 | 可AI独立完成 |
|----|------|------|----------|-------------|
| H-01 | JWT payload 明文传输 email (PII) | `auth.js:20` | 1h | 是 |
| H-02 | CSRF token 允许从 body 读取 | `app/middleware.js:61` | 0.5h | 是 |
| H-03 | CSRF token 端点无速率限制 | `routes/auth.js:23` | 0.5h | 是 |
| H-04 | /health 暴露内部信息（无认证） | `server.js:111` | 0.5h | 是 |
| H-05 | bcryptjs 纯 JS 实现性能差 | `package.json` | 1h | 需验证 |
| H-15 | 管理员密码输出到日志 | `server.js:381` | 0.5h | 是 |
| H-16 | express 版本存在 CVE-2024-29041 | `package.json` | 0.5h | 需验证 |
| H-17 | CSP 缺少 object-src 'none' | `app/middleware.js:30` | 0.5h | 是 |

### 性能类（5 项）

| ID | 问题 | 文件 | 预估工时 | 可AI独立完成 |
|----|------|------|----------|-------------|
| S-11 | dashboardSummary 严重 N+1（500单=7500次查询） | `services/dashboardService.js:43` | 3h | 是 |
| S-12 | generateFinanceDetails N+1（500单=10000次） | `services/financeService.js:65` | 3h | 是 |
| S-14 | 5000条批量导入单事务过大 | `routes/core/orders.js:133` | 1h | 是 |
| S-16 | injectComputedCells 批量查询不足 O(n*m) | `app/context.js:353` | 3h | 是 |
| S-17 | isMember 双次重复查询 | `security/guards.js:31` | 0.5h | 是 |

### 架构类（4 项）

| ID | 问题 | 文件 | 预估工时 | 可AI独立完成 |
|----|------|------|----------|-------------|
| H-06 | server.js 337行业务逻辑未拆分 | `server.js:368-705` | 6h | 需验证 |
| H-07 | 前端 window 全局命名空间污染 | `public/modules/` | 4h | 需浏览器验证 |
| H-08 | 环形缓冲区 200 条不足 | `services/syncService.js:6` | 0.5h | 是 |
| H-09 | broadcast 无节流，消息风暴 | `server.js:104` | 2h | 是 |

### 其他（2 项）

| ID | 问题 | 文件 | 预估工时 | 可AI独立完成 |
|----|------|------|----------|-------------|
| H-11 | batch 更新每条追加 6-7 次查询 | `routes/grid/batch.js:118` | 2h | 是 |
| H-12 | 公式引擎无结果缓存 | `app/context.js:396` | 2h | 是 |

---

## 三、P2 中危（本月内修复）

| ID | 问题 | 分类 | 文件 |
|----|------|------|------|
| M-01 | gridRouteContext 42 个属性参数爆炸 | 架构 | `server.js:185` |
| M-02 | Grid 路由不检查 table_permissions.canViewTable | 架构 | `routes/grid/tables.js` |
| M-03 | 错误响应包含 traceId 可被关联分析 | 安全 | `server.js:302` |
| M-04 | DB 连接池事件日志记录 client PID | 性能 | `pgAdapter.js:40` |
| M-05 | idSchema 与 nanoidSchema 重复定义宽松 | 代码 | `app/validators.js:4` |
| M-06 | users 表缺 email 索引(SQLite) | 性能 | `db.js` |
| M-07 | bases 缺 owner_id 索引 / invites 缺索引 | 性能 | `db.js` |
| M-08 | missedEvents 线性扫描 O(200) | 性能 | `services/syncService.js:53` |
| M-09 | dashboardSummary 大对象一次性构建 | 性能 | `services/dashboardService.js:35` |
| M-10 | createTableWithFields 逐条 INSERT | 性能 | `app/context.js:495` |
| M-11 | fieldByName Map 每次重建 | 性能 | `app/context.js:236` |
| M-12 | renderSingleRow 每格 4 个事件监听器 | 前端 | `public/modules/grid-render.js:556` |
| M-13 | getBaseDetailAsync 全量加载 | 性能 | `server.js:585` |
| M-14 | transactionAsync SQLite/PG 返回值不一致 | 架构 | `services/dbAdapter.js` |
| M-15 | cookieSecure 无生产强制校验 | 安全 | `config.js` |
| M-16 | 数据库切换无运行时迁移能力 | 架构 | `config.js` |
| M-17 | app/socket.js 无测试覆盖 | 测试 | `tests/` |
| M-18 | routes/grid/buttons.js 无测试覆盖 | 测试 | `tests/` |

---

## 四、P3 低危（可迭代处理）

| ID | 问题 | 分类 |
|----|------|------|
| L-01 | 前端 renderGrid 全量 DOM 重建 | 性能 |
| L-02 | paintSelection 全量 DOM 遍历 | 性能 |
| L-03 | visibleRecordsFor 重复计算 7500 次 | 性能 |
| L-04 | H-18 公式引擎无嵌套深度限制 | 安全 |
| L-05 | H-10 rings Map 无清理机制 | 内存 |
| L-06 | express 依赖升级风险 | 依赖 |
| L-07 | 前端循环依赖（cell-edit / clipboard-ops） | 架构 |
| L-08 | field-modal v1 废弃代码残留 | 代码 |

---

## 五、技术债务（长期规划）

| ID | 债务项 | 说明 | 建议 |
|----|--------|------|------|
| TD-01 | 前端工程化 | 无模块系统，window 全局污染 | 引入 Vite + ES Module（需浏览器逐步验证） |
| TD-02 | 前端组件化 | 重复 UI 模式未抽取为组件 | 提取 Table/Editor/Modal 组件 |
| TD-03 | 测试覆盖率低 | 约 40%，socket/buttons/attachments 空白 | 补齐单元测试和集成测试 |
| TD-04 | 性能基准测试 | 未进行并发和负载验证 | 搭建预生产环境，模拟 50-100 并发 |
| TD-05 | 生产部署未演练 | HTTPS/Nginx/防火墙均未配置 | 完成生产检查清单 |
| TD-06 | 依赖升级策略 | express 有 CVE，bcryptjs 性能差 | 建立定期 audit 和升级流程（CI 已加 npm audit） |
| TD-07 | 监控体系不完整 | 仅内存告警，无 Prometheus/Grafana | 接入外部监控 |
| TD-08 | 数据库迁移回滚 | 已完成回滚脚本 | 需在测试环境完整演练 |

---

## 六、已修复项（上一轮评估中已处理）

| 评估报告项 | 修复内容 | 状态 |
|-------------|----------|------|
| 数据库迁移缺少回滚方案 | 新建 `scripts/rollback-to-pg.js` | 已完成 |
| 日志轮转需手动配置 | `ecosystem.config.cjs` 添加 `post_update` 钩子 | 已完成 |
| 未集成依赖漏洞扫描 | CI 新增 npm audit 步骤 | 已完成 |

---

## 七、推荐修复顺序

### 第一批（AI 可独立完成，无需浏览器验证）

| 序号 | ID | 任务 | 预估 |
|------|-----|------|------|
| 1 | S-01 | JWT_SECRET 启动强制校验 | 0.5h |
| 2 | S-04 | 密码复杂度加强（大小写+数字+特殊字符，12位） | 0.5h |
| 3 | S-03 | bcrypt.hashSync 改为 bcrypt.hash | 0.5h |
| 4 | S-06 | SVG 强制 attachment 下载 | 0.5h |
| 5 | S-09 | 上传总大小限制 100MB | 0.5h |
| 6 | S-05 | 错误消息统一为通用消息，仅日志记录详情 | 0.5h |
| 7 | S-10 | 公式引擎循环引用检测（visited set + 递归深度<=10） | 2h |
| 8 | S-08 | Core 路由改用权限矩阵 | 2h |
| 9 | H-15 | 移除管理员密码日志输出 | 0.5h |
| 10 | H-17 | CSP 补全 object-src 'none' | 0.5h |
| 11 | H-01 | JWT payload 不存 email，改存 userId | 1h |
| 12 | H-02 | CSRF token 仅从 header 读取 | 0.5h |
| 13 | H-08 | 环形缓冲区扩容至 2000 | 0.5h |
| 14 | H-09 | broadcast 合并为单次 emit | 2h |
| 15 | S-17 | isMember 去重查询 | 0.5h |
| 16 | S-15 | createRecordSchema fieldId 二次校验 | 0.5h |

**第一批小计：~13h**

### 第二批（AI 完成 + 需人工验证）

| 序号 | ID | 任务 | 预估 | 验证方式 |
|------|-----|------|------|----------|
| 17 | S-07 | SQLite/PG Schema 统一 | 4h | 双引擎测试 |
| 18 | S-02 | JWT 撤销机制 | 3h | 服务器重启测试 |
| 19 | S-11 | dashboardSummary N+1 优化 | 3h | 仪表盘加载测试 |
| 20 | S-12 | generateFinanceDetails N+1 优化 | 3h | 财务详情测试 |
| 21 | S-16 | injectComputedCells 批量查询 | 3h | 分页接口测试 |
| 22 | S-14 | 批量导入分批提交 | 1h | 5000条导入测试 |
| 23 | H-04 | /health 敏感信息脱敏 | 0.5h | curl 测试 |
| 24 | H-12 | 公式结果缓存 | 2h | 公式计算测试 |
| 25 | H-16 | express 升级 | 0.5h | 全量回归测试 |
| 26 | M-06/07 | 添加缺失索引 | 1h | 查询性能对比 |
| 27 | H-10 | rings Map GC 清理 | 1h | 内存监控 |

**第二批小计：~25h**

### 第三批（需浏览器验证的前端项）

| 序号 | ID | 任务 | 预估 |
|------|-----|------|------|
| 28 | S-13 | renderGrid 增量更新 | 4h |
| 29 | H-07 | 前端 window 命名空间改为显式导入 | 4h |
| 30 | H-13 | visibleRecordsFor 去重计算 | 2h |
| 31 | H-14 | paintSelection 事件代理 | 1h |
| 32 | L-07 | cell-edit/clipboard-ops 循环依赖重构 | 2h |

**第三批小计：~13h**

### 第四批（大型重构，独立迭代）

| 序号 | ID | 任务 | 预估 |
|------|-----|------|------|
| 33 | H-06 | server.js 业务逻辑拆分到 routes | 6h |
| 34 | M-01 | gridRouteContext 拆分为 3 个子对象 | 3h |
| 35 | TD-01 | 前端 Vite + ES Module 迁移 | 16h |
| 36 | TD-02 | 前端组件化 | 12h |
| 37 | TD-03 | 补齐测试覆盖率至 70% | 10h |
| 38 | TD-04 | 性能基准测试 | 4h |

**第四批小计：~51h**

---

## 八、项目亮点（审计报告确认的优秀设计）

1. 三层权限矩阵设计（System -> Base -> Table）
2. 公式引擎递归下降解析器替代 `new Function()`
3. SQL 注入防御完备（全量参数化查询）
4. 安全头部配置完整（CSP/HSTS/X-Frame-Options 等）
5. 日志脱敏机制（SENSITIVE_KEYS + sanitizeMeta）
6. 数据库双引擎统一接口设计
7. CI/CD 流水线覆盖完整
8. 18 个 Joi Schema 输入校验覆盖广
9. 配置管理规范（38 项全部有默认值）

---

*技术债务清单 V0.4.0 — 总计 74 项，预估总工时 ~102h*
