# 测试覆盖率缺口分析

> 生成时间：2026-06-30
> 分析范围：tests/ 全部测试文件 vs services/、routes/、jobs/、app/ 源代码模块

---

## 1. 现有测试概览

### 总计

| 指标 | 数量 |
|------|------|
| 总测试文件数 | **29**（unit 9 + integration 4 + root 16） |
| 总断言/用例数（估算） | **约 570+** |

### 按类型分类

| 类型 | 文件数 | 文件列表 | 估算用例数 | 说明 |
|------|--------|----------|-----------|------|
| **unit** | 9 | dbAdapter, permissions, roles, config, helpers, logger, auth, syncService, formulaService | ~175 | 纯函数/模块级测试，零外部依赖或仅内存 SQLite |
| **integration** | 4 | security, financeService, orderService, helpers | ~30 | 内存 SQLite 集成测试，验证 service 与数据库交互 |
| **e2e** | 13 | security_audit_phase1, permission_matrix, p0_security, dashboard, finance_reconciliation, inventory, jobs, diagnostics_bulk, order_management, business_lock, team_scale, product_info, resource_archive, p0_api | ~453 | 需启动 server.js，通过 HTTP API 进行端到端验证 |
| **load** | 2 | pressureTest, dailyLoadTest | 0（性能指标型） | 并发压力测试和日业务量模拟，不使用断言，以性能指标为判据 |
| **frontend** | 1 | frontend_logic_test | ~11 | 测试前端模块（clipboard、keyboard、fields、links） |

### 各文件用例明细

#### tests/unit/（9 个文件）

| 文件 | 测试框架 | 估算断言数 | 覆盖目标 |
|------|----------|-----------|----------|
| dbAdapter.test.js | 自定义 assert | ~12 | services/dbAdapter.js |
| permissions.test.js | 自定义 test() | ~40 | security/permissions.js + security/roles.js |
| roles.test.js | 自定义 assert | ~40 | security/roles.js |
| config.test.js | 自定义 assert | ~30 | config.js |
| helpers.test.js | mocha (describe/it) | 5 | services/helpers.js |
| logger.test.js | mocha (describe/it) | 6 | logger.js |
| auth.test.js | mocha (describe/it) | 6 | auth.js |
| syncService.test.js | 自定义 assert | ~13 | services/syncService.js |
| formulaService.test.js | 自定义 assert | ~20 | services/formulaService.js |

#### tests/integration/（4 个文件）

| 文件 | 测试框架 | 估算断言数 | 覆盖目标 |
|------|----------|-----------|----------|
| security.test.js | mocha (describe/it) | 4 | SQL 注入防护、密码哈希、唯一约束、成员角色 |
| financeService.test.js | 自定义 assert | ~15 | services/financeService.js（moneyRound、financeTables、hasDetailForOrder） |
| orderService.test.js | 自定义 assert | ~5 | services/orderService.js（orderCompletionFieldProtected） |
| helpers.test.js | 自定义 assert | ~6 | services/helpers.js + formulaService.js 集成 |

#### tests/ 根目录（16 个文件，含 load/）

| 文件 | 估算断言数 | 测试类型 |
|------|-----------|----------|
| security_audit_phase1_test.js | 31 | e2e - 安全审计修复回归 |
| permission_matrix_test.js | 54 | e2e - 权限矩阵端到端 |
| p0_security_test.js | 8 | e2e - 生产安全配置 |
| dashboard_test.js | 19 | e2e - 仪表盘功能 |
| finance_reconciliation_test.js | 38 | e2e - 财务对账 |
| inventory_test.js | 34 | e2e - 库存管理 |
| jobs_test.js | 43 | e2e - 定时任务 |
| diagnostics_bulk_test.js | 21 | e2e - 诊断批量操作 |
| order_management_test.js | 46 | e2e - 订单管理 |
| business_lock_test.js | 58 | e2e - 业务锁定 |
| team_scale_test.js | 25 | e2e - 团队规模 |
| product_info_test.js | 29 | e2e - 产品信息 |
| resource_archive_test.js | 27 | e2e - 资源档案 |
| p0_api_test.js | 20 | e2e - P0 核心接口 |
| frontend_logic_test.js | 11 | 前端逻辑 |
| load/pressureTest.js | 0 | 压力测试（性能指标） |
| load/dailyLoadTest.js | 0 | 日业务量模拟（性能指标） |

---

## 2. 模块覆盖矩阵

### services/ 模块覆盖（8 个文件）

| 源模块 | 对应测试文件 | 覆盖状态 |
|--------|------------|----------|
| services/dashboardService.js | tests/dashboard_test.js（e2e 间接覆盖） | **部分覆盖** - 仅通过 e2e HTTP 接口间接验证，缺少单元测试 |
| services/dbAdapter.js | tests/unit/dbAdapter.test.js | **已覆盖** - 12+ 断言，覆盖 query/queryOne/run/transaction/async |
| services/financeService.js | tests/integration/financeService.test.js, tests/finance_reconciliation_test.js（e2e） | **部分覆盖** - 集成测试仅覆盖 moneyRound/financeTables/hasDetailForOrder，对账逻辑由 e2e 间接覆盖 |
| services/formulaService.js | tests/unit/formulaService.test.js, tests/integration/helpers.test.js | **已覆盖** - 20+ 单元断言 + 集成验证 |
| services/helpers.js | tests/unit/helpers.test.js, tests/integration/helpers.test.js | **已覆盖** - 单元 + 集成双重测试 |
| services/inventoryService.js | tests/inventory_test.js（e2e 间接覆盖） | **部分覆盖** - 仅 e2e 间接覆盖，缺少单元测试 |
| services/orderService.js | tests/integration/orderService.test.js, tests/order_management_test.js（e2e） | **部分覆盖** - 集成测试仅覆盖 orderCompletionFieldProtected，订单 CRUD 由 e2e 覆盖 |
| services/syncService.js | tests/unit/syncService.test.js | **已覆盖** - 13+ 断言，覆盖 publish/missedEvents/clear/overflow |

### routes/ 模块覆盖（20 个文件）

| 源模块 | 对应测试文件 | 覆盖状态 |
|--------|------------|----------|
| routes/auth.js | tests/p0_security_test.js, tests/security_audit_phase1_test.js, tests/permission_matrix_test.js（e2e） | **部分覆盖** - 仅通过 e2e 登录/注册接口间接覆盖，缺少路由层单元测试 |
| routes/bases.js | tests/p0_api_test.js, tests/team_scale_test.js, tests/product_info_test.js 等多个 e2e | **部分覆盖** - e2e 间接覆盖创建/查询 base，缺少边界条件测试 |
| routes/dashboard.js | tests/dashboard_test.js（e2e） | **部分覆盖** - 仅 e2e 间接覆盖 |
| routes/grid/tables.js | tests/p0_api_test.js, tests/product_info_test.js（e2e 间接） | **部分覆盖** - e2e 间接覆盖 |
| routes/grid/records.js | tests/p0_api_test.js, tests/order_management_test.js, tests/inventory_test.js 等多个 e2e | **部分覆盖** - 通过多个 e2e 间接覆盖 CRUD |
| routes/grid/cells.js | tests/dashboard_test.js, tests/finance_reconciliation_test.js, tests/business_lock_test.js（e2e） | **部分覆盖** - e2e 间接覆盖单元格读写 |
| routes/grid/links.js | tests/dashboard_test.js, tests/finance_reconciliation_test.js（e2e） | **部分覆盖** - e2e 间接覆盖关联操作 |
| routes/grid/buttons.js | 无 | **未覆盖** |
| routes/grid/batch.js | tests/diagnostics_bulk_test.js（e2e 间接） | **部分覆盖** - 仅 e2e 间接覆盖 |
| routes/grid/attachments.js | 无 | **未覆盖** |
| routes/core/orders.js | tests/order_management_test.js（e2e） | **部分覆盖** - e2e 间接覆盖 |
| routes/core/inventory.js | tests/inventory_test.js（e2e） | **部分覆盖** - e2e 间接覆盖 |
| routes/core/bills.js | tests/finance_reconciliation_test.js（e2e 间接） | **部分覆盖** - e2e 间接覆盖 |
| routes/core/products.js | tests/product_info_test.js（e2e 间接） | **部分覆盖** - e2e 间接覆盖 |
| routes/core/customers.js | tests/resource_archive_test.js（e2e 间接） | **部分覆盖** - e2e 间接覆盖 |
| routes/security/matrix.js | tests/permission_matrix_test.js（e2e） | **部分覆盖** - e2e 间接覆盖 |
| routes/public/customerQuery.js | tests/permission_matrix_test.js（e2e 中有外部 token 验证） | **部分覆盖** - e2e 中有少量覆盖 |
| routes/invites.js | tests/team_scale_test.js（e2e 间接） | **部分覆盖** - e2e 间接覆盖 |
| routes/templates.js | 无 | **未覆盖** |
| routes/utils.js | 无（工具模块，被其他路由间接引用） | **未覆盖** |

### jobs/ 模块覆盖（6 个文件）

| 源模块 | 对应测试文件 | 覆盖状态 |
|--------|------------|----------|
| jobs/index.js | tests/jobs_test.js（e2e 间接覆盖） | **部分覆盖** - 仅通过 e2e HTTP 接口间接验证任务调度 |
| jobs/commissionJob.js | tests/jobs_test.js, tests/dailyLoadTest.js（load 模拟） | **部分覆盖** - e2e 间接覆盖 + load 模拟 |
| jobs/diagnostics.js | tests/diagnostics_bulk_test.js（e2e 间接） | **部分覆盖** - e2e 间接覆盖 |
| jobs/snapshotSyncJob.js | 无直接测试 | **未覆盖** |
| jobs/statusJob.js | 无直接测试 | **未覆盖** |
| jobs/grid.js | 无直接测试 | **未覆盖** |

### app/ 模块覆盖（6 个文件）

| 源模块 | 对应测试文件 | 覆盖状态 |
|--------|------------|----------|
| app/middleware.js | tests/p0_security_test.js, tests/security_audit_phase1_test.js（e2e 间接） | **部分覆盖** - e2e 间接验证了认证/限流中间件 |
| app/socket.js | 无 | **未覆盖** |
| app/context.js | 无 | **未覆盖** |
| app/validators.js | 无 | **未覆盖** |
| app/validate.js | 无 | **未覆盖** |
| app/alerts.js | 无 | **未覆盖** |

---

## 3. 未覆盖的关键路径

以下 5 个模块最需要补充测试，按风险排序：

### 1. app/socket.js（WebSocket 实时通信）

**原因：**
- WebSocket 是协同编辑的核心通道，负责多人实时同步
- syncService 的事件发布机制依赖 socket 进行推送
- 完全没有任何测试覆盖，一旦出 bug 会导致用户看到脏数据或操作丢失
- 并发场景下的消息顺序、断线重连、事件丢失等边界条件未经验证

### 2. routes/grid/buttons.js（按钮操作路由）

**原因：**
- 按钮是触发业务操作（如审批、封账、锁单）的入口
- 缺少对按钮权限检查、操作幂等性、并发执行的安全测试
- 与 financeService、orderService 的交互逻辑未经单元测试验证

### 3. routes/grid/attachments.js（附件上传路由）

**原因：**
- 文件上传涉及安全问题（文件类型校验、大小限制、路径遍历防护）
- 上传失败、部分上传、大文件处理等边界条件未测试
- 附件与记录的关联关系、删除清理逻辑未覆盖
- 安全面风险最高的路由之一

### 4. app/validators.js + app/validate.js（输入验证层）

**原因：**
- 输入验证是防御 SQL 注入、XSS、数据污染的第一道防线
- 目前验证逻辑仅通过 e2e 测试间接覆盖了正常路径
- 恶意输入、畸形数据、超大 payload 等攻击面未经系统测试
- 缺少对验证规则完整性的回归测试

### 5. jobs/snapshotSyncJob.js + jobs/statusJob.js（定时任务）

**原因：**
- 快照同步是跨 base 数据一致性的关键机制
- 状态同步 job 影响用户看到的数据新鲜度
- 任务失败重试、并发执行、幂等性等边界条件未验证
- 定时任务的错误处理、日志记录、告警机制未覆盖

---

## 4. 补全建议

按优先级排序（P0 > P1 > P2 > P3）：

### P0：安全与核心功能（建议立即补全）

| 优先级 | 模块 | 建议测试类型 | 具体建议 |
|--------|------|------------|----------|
| P0-1 | app/validators.js | unit | 测试所有验证函数：输入为空/超长/XSS 字符/SQL 注入串时的返回结果 |
| P0-2 | app/validate.js | unit | 测试验证链：各种字段类型（text/number/date/select）的合法/非法输入组合 |
| P0-3 | routes/grid/attachments.js | integration + e2e | 测试文件上传的：类型白名单、大小限制、路径遍历防护、权限检查、关联记录 |
| P0-4 | routes/grid/buttons.js | integration + e2e | 测试按钮操作的：权限拦截、幂等执行、并发安全、失败回滚 |

### P1：实时协同与稳定性（建议 1-2 周内补全）

| 优先级 | 模块 | 建议测试类型 | 具体建议 |
|--------|------|------------|----------|
| P1-1 | app/socket.js | unit + integration | 模拟多客户端连接：消息广播、房间隔离、断线重连、事件顺序保证 |
| P1-2 | jobs/snapshotSyncJob.js | unit | mock 数据库，测试快照生成逻辑、增量同步、冲突检测 |
| P1-3 | jobs/statusJob.js | unit | 测试状态聚合逻辑、异常状态处理、空数据处理 |
| P1-4 | services/dashboardService.js | unit | 抽离纯函数部分，测试聚合计算、缓存逻辑、空数据边界 |
| P1-5 | services/inventoryService.js | unit + integration | 测试库存变动、库存锁定/解锁、并发扣减安全 |

### P2：路由层完善（建议持续推进）

| 优先级 | 模块 | 建议测试类型 | 具体建议 |
|--------|------|------------|----------|
| P2-1 | routes/auth.js | unit + integration | 测试：注册/登录/登出、密码重置、token 过期、暴力破解防护 |
| P2-2 | routes/core/orders.js | integration | 订单全生命周期：创建→编辑→锁定→完结→回滚，异常路径 |
| P2-3 | routes/core/bills.js | integration | 账单生成、收付款记录、对账匹配逻辑 |
| P2-4 | routes/security/matrix.js | unit | 权限矩阵 CRUD、生效延迟、缓存失效、回滚 |
| P2-5 | routes/public/customerQuery.js | integration + e2e | 外部 token 颁发/校验/过期/撤销、数据隔离 |
| P2-6 | routes/templates.js | unit + e2e | 模板创建/复制/删除、字段映射、权限继承 |
| P2-7 | jobs/grid.js | unit | grid 清理任务逻辑、数据一致性检查 |
| P2-8 | routes/utils.js | unit | 工具函数的白盒测试 |

### P3：增强覆盖深度

| 优先级 | 模块 | 建议测试类型 | 具体建议 |
|--------|------|------------|----------|
| P3-1 | app/middleware.js | unit | 逐个中间件独立测试：认证、限流、CORS、请求日志 |
| P3-2 | app/context.js | unit | 请求上下文构建、用户信息注入、base 权限预加载 |
| P3-3 | app/alerts.js | unit | 告警触发条件、去重逻辑、通知渠道 |
| P3-4 | services/orderService.js | unit（补充） | 现有集成测试仅 5 个断言，需补充订单状态机、权限检查等纯函数测试 |
| P3-5 | services/financeService.js | unit（补充） | 补充对账算法、封账/反封账逻辑、精度处理的单元测试 |

### 总结

- **已充分覆盖的模块**：dbAdapter、formulaService、helpers、syncService、config、auth、logger、security/permissions、security/roles
- **部分覆盖的模块**：大部分 routes/ 和部分 services/（仅 e2e 间接覆盖）
- **完全未覆盖的模块**：app/socket.js、app/context.js、app/validators.js、app/validate.js、app/alerts.js、routes/grid/buttons.js、routes/grid/attachments.js、routes/templates.js、routes/utils.js、jobs/snapshotSyncJob.js、jobs/statusJob.js、jobs/grid.js
- **覆盖率估算**：约 40% 的源模块有单元/集成测试，其余仅靠 e2e 间接覆盖或完全未覆盖
- **建议**：优先补全 P0 安全相关测试，然后推进 P1 实时协同和定时任务测试，逐步将 routes/ 层的 e2e 覆盖下沉为可维护的集成测试
