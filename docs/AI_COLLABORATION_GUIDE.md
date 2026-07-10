# AI 协作开发规范

> 本文档为 AI 助手接手 CollabGrid 项目开发时必须遵守的行为规范。所有 AI 协作者在修改代码前，均应先阅读并遵循本规范。

---

## 1. 文档目的

本文档是 **AI 助手与人类开发者协作时的行为规范**。它定义了 AI 在参与本项目的代码修改、文件创建、数据库操作、测试执行等环节中应遵循的标准流程和约束规则。

**适用对象**：所有参与本项目的 AI 助手（包括但不限于代码生成、代码审查、重构、功能开发等场景）。

**核心原则**：

- **安全第一**：任何修改不得破坏现有功能的安全性
- **最小变更**：每次只改一个逻辑关注点，降低引入风险
- **透明沟通**：修改前先说明方案，等待人类确认后再执行
- **可追溯**：每一步操作都有据可查

---

## 2. 修改流程

AI 助手修改项目代码时，必须严格遵循以下五步流程：

### 第一步：读取目标文件，理解现有逻辑

- 使用 `Read` 工具完整读取目标文件（及相关的依赖文件）
- 理解现有代码的业务逻辑、数据流向和调用关系
- 识别当前实现的设计意图，避免误改

### 第二步：向用户提出变更方案

在动手修改之前，必须向人类开发者说明：

| 要素 | 说明 |
|------|------|
| **改什么** | 具体修改哪些文件、哪些函数、哪些行 |
| **为什么改** | 修改的业务动机或技术原因 |
| **影响范围** | 该修改会影响哪些上下游模块、哪些 API 端点、哪些前端功能 |
| **替代方案** | 是否有其他可行的实现方式及其利弊 |

### 第三步：等待用户确认后再执行修改

- **必须等待人类开发者明确确认**后方可执行代码修改
- 如果用户要求调整方案，应重新评估后再提出
- 未经确认不得擅自修改任何项目文件

### 第四步：执行修改后运行语法检查

修改完成后，对每个被修改的 `.js` 文件执行：

```bash
node --check <被修改的文件路径>
```

确保没有语法错误。如果有语法错误，立即修复并重新检查。

### 第五步：说明修改的影响范围和后续验证

修改完成后，向用户说明：

1. **变更摘要**：实际修改了哪些内容
2. **影响范围**：受影响的模块、路由、服务
3. **建议的测试命令**：需要运行哪些测试来验证修改正确性（参见第 5 节）
4. **可能的后续操作**：是否需要数据库迁移、配置更新、文档更新等

---

## 3. 文件修改规则

### 3.1 单一关注点原则

- 每次只修改**一个逻辑关注点**，不要在一次操作中同时修改多个不相关的功能
- 如果用户要求多个修改，逐个进行并分别说明

### 3.2 API 端点保护

- **不删除现有 API 端点的路由定义**
- 如需废弃某个端点，可以标记 `deprecated` 并在注释中说明，但保留路由代码
- 新增端点时参照现有路由结构，放置在 `routes/` 目录下

### 3.3 配置文件保护

- **不修改 `config.js` 的默认值结构**
- 可以新增配置项（添加新的 `getEnv` / `getInt` / `getBool` 调用）
- 不更改现有配置项的默认 fallback 值
- `.env` 文件的修改仅限 `.env.example`，不修改 `.env` 本身

### 3.4 数据库结构保护

- **不直接修改 `db.js` 中的 DDL（CREATE TABLE / ALTER TABLE）语句**
- 新增字段必须通过独立的 migration 脚本完成
- migration 脚本放置在合理的目录下，命名遵循项目命名规范

### 3.5 新增文件规则

- 新增文件时放在合理的目录下，参照现有目录结构：
  - 路由模块 -> `routes/` 目录
  - 业务服务 -> `services/` 目录
  - 定时任务 -> `jobs/` 目录
  - 中间件 -> `app/` 目录
  - 前端模块 -> `public/modules/` 目录
- 文件命名必须遵循 `NAMING_CONVENTIONS.md` 中的规则

---

## 4. 命名规范

以下规则提取自 `NAMING_CONVENTIONS.md`，AI 助手在创建或重命名文件时必须遵守。

### 4.1 通用原则

- **自解释**：文件名应能独立说明内容
- **一致性**：同类型文件使用统一命名模式
- **全英文**：禁止中文文件名
- **禁止特殊字符**：用 `-` 或 `_` 连接，禁止空格

### 4.2 源代码命名

| 文件类型 | 命名模式 | 示例 |
|---------|---------|------|
| 路由模块 | 名词（复数）+ `.js` | `tables.js`, `customers.js` |
| 业务层定义 | 名词 + `.js` | `tableLayer.js`, `businessRelations.js` |
| 安全模块 | 名词 + `.js` | `roles.js`, `permissions.js` |
| 工具/助手 | `xxxHelper.js` 或 `xxxUtil.js` | `dbAdapterHelper.js` |
| 前端模块 | 名词 + `.js` | `clipboard.js`, `keyboard.js` |

**关键规则**：
- 路由文件用**复数名词**（`orders` 不是 `order`）
- `index.js` 只做目录导出聚合，不放业务逻辑
- 禁止使用 `new.js`、`temp.js`、`test.js` 等临时名

### 4.3 文档命名

| 文档类型 | 命名模式 | 示例 |
|---------|---------|------|
| 架构设计 | `ARCHITECTURE_` + 主题 + `.md` | `ARCHITECTURE_LAYERS.md` |
| API 文档 | `API_` + 范围 + `.md` | `API_REFERENCE.md` |
| 部署文档 | `DEPLOY_` + 环境 + `.md` | `DEPLOY_PRODUCTION.md` |
| 决策记录 | `ADR_` + 日期 + `_` + 主题 + `.md` | `ADR_20260622_DB_SPLIT.md` |

### 4.4 测试命名

- 所有测试文件必须以 `_test.js` 结尾
- P0 测试前缀统一为 `p0_`（如 `p0_api_test.js`）
- 场景名使用 snake_case，优先用业务术语

### 4.5 禁止的命名

| 禁止 | 替代方案 |
|------|---------|
| `README.md` 放实质内容 | 用具体主题名（如 `COLLABGRID_xxx.md`） |
| `index.js` 做业务逻辑 | 用具体名词命名 |
| `doc.md`, `notes.md` | 用 `ARCHITECTURE_xxx.md` 或 `ADR_xxx.md` |
| 中文文件名 | 全用英文 |

---

## 5. 测试要求

### 5.1 分层测试策略

| 修改范围 | 测试命令 | 说明 |
|---------|---------|------|
| `services/` | 对应服务的测试脚本 | 如 `npm run test:order`、`npm run test:inventory` |
| `routes/` | `npm run test:p0` | 验证基础 API 功能 |
| `jobs/` | `npm run test:jobs` | 验证定时任务逻辑 |
| `app/`（middleware / socket / validators） | `npm run test:p0-security` | 验证安全相关功能 |

### 5.2 新增 API 端点

新增任何 API 端点时，**必须在 `app/validators.js` 中添加对应的 Joi schema** 进行请求参数校验。

### 5.3 全量测试

完成修改后，运行全量测试确认无回归：

```bash
npm test
```

该命令会依次执行：`test:frontend` -> `test:p0` -> `test:p0-security` -> `test:permission`。

### 5.4 可用的测试脚本

项目 `package.json` 中定义的完整测试脚本列表：

| 命令 | 用途 |
|------|------|
| `npm run test:frontend` | 前端逻辑测试 |
| `npm run test:p0` | P0 基础 API 测试 |
| `npm run test:p0-security` | P0 安全测试 |
| `npm run test:permission` | 权限矩阵测试 |
| `npm run test:jobs` | 定时任务测试 |
| `npm run test:order` | 订单管理测试 |
| `npm run test:inventory` | 库存测试 |
| `npm run test:finance` | 财务对账测试 |
| `npm run test:dashboard` | 仪表盘测试 |
| `npm run test:diagnostics` | 诊断批量测试 |
| `npm run test:resource` | 资源归档测试 |
| `npm run test:product` | 产品信息测试 |
| `npm run test:team-scale` | 团队规模测试 |
| `npm run test:business-lock` | 业务锁定测试 |
| `npm run check` | 代码检查脚本 |
| `npm run lint` | ESLint 检查 |
| `npm test` | 全量测试（frontend + p0 + p0-security + permission） |

---

## 6. 数据库操作规范

本项目支持 **SQLite 和 PostgreSQL 双引擎**，所有数据库操作代码必须同时兼容两种引擎。

### 6.1 参数化查询

```javascript
// 正确 - 使用参数化查询
dbAdapter.queryAsync('SELECT * FROM users WHERE id = $1', [userId]);

// 错误 - 字符串拼接 SQL
dbAdapter.queryAsync(`SELECT * FROM users WHERE id = '${userId}'`);
```

- 统一使用 `$1, $2, $3` 占位符风格（SQLite 和 PostgreSQL 均支持）
- **严禁拼接 SQL 字符串**，防止 SQL 注入

### 6.2 列别名限制

- **不要在 HAVING 子句中引用列别名**（PostgreSQL 不支持）
- 使用完整表达式代替别名引用

```javascript
// 错误 - PG 不支持在 HAVING 中引用别名
dbAdapter.queryAsync('SELECT count(*) AS cnt FROM t GROUP BY x HAVING cnt > 5');

// 正确 - 使用完整表达式
dbAdapter.queryAsync('SELECT count(*) AS cnt FROM t GROUP BY x HAVING count(*) > 5');
```

### 6.3 列名大小写

- PostgreSQL 返回的列名是**小写**的
- SQLite 默认也返回小写列名
- 在 JavaScript 代码中访问查询结果时，统一使用**小写列名**

### 6.4 读写分离

| 操作类型 | 使用方法 | 说明 |
|---------|---------|------|
| SELECT 查询 | `dbAdapter.queryAsync()` | 使用 read pool（读副本） |
| INSERT / UPDATE / DELETE | `dbAdapter.runAsync()` 或 `dbAdapter.writeQueryAsync()` | 使用 write pool（主库） |

- 所有 SELECT 查询应使用读池，减轻主库压力
- 写操作必须走写池，确保数据一致性

---

## 7. 禁止事项

以下是 AI 助手在本项目中的**绝对禁止事项**：

| 编号 | 禁止行为 | 说明 |
|------|---------|------|
| 7.1 | 不修改 `.env` 文件 | 环境配置只修改 `.env.example`，不修改 `.env` 本身 |
| 7.2 | 不提交 `node_modules/` 或 `data/*.db` | 依赖和数据库文件不应纳入版本控制 |
| 7.3 | 不引入新的 npm 依赖而不说明理由 | 如需新增依赖，必须先向用户说明理由并获得确认 |
| 7.4 | 不修改 `public/app.js` 的引导逻辑 | 前端入口代码的引导流程不可修改 |
| 7.5 | 不在代码中硬编码密钥或密码 | 所有敏感信息必须通过环境变量或配置文件管理 |
| 7.6 | 不跳过语法检查 | 每次修改 .js 文件后必须执行 `node --check` |
| 7.7 | 不未经确认就修改代码 | 必须先提出方案，等待用户确认 |

---

## 8. 提交规范

### 8.1 Commit Message 格式

```
类型(范围): 简短描述
```

### 8.2 类型说明

| 类型 | 用途 |
|------|------|
| `feat` | 新增功能 |
| `fix` | 修复缺陷 |
| `docs` | 文档变更 |
| `refactor` | 代码重构（不改变功能行为） |
| `test` | 测试相关变更 |
| `chore` | 构建、工具、配置等非业务变更 |

### 8.3 示例

```
feat(routes): 新增客户批量导出端点
fix(services): 修复订单库存扣减竞态条件
docs: 更新 API 协作规范文档
refactor(jobs): 优化诊断任务批量处理逻辑
test: 补充权限矩阵边界用例
chore: 更新 devDependencies 版本
```

### 8.4 范围参考

常见的范围值包括：`routes`、`services`、`jobs`、`app`、`security`、`layers`、`public`、`config`、`docs` 等，参照项目的目录结构。

---

## 附录：项目结构速览

```
collab-grid/
├── server.js          # Express + Socket.IO 入口
├── config.js          # 统一配置层（环境变量 -> 运行时配置）
├── auth.js            # 认证模块
├── db.js              # 数据库初始化与 DDL
├── jobs.js            # 定时任务调度
├── logger.js          # 日志模块
├── app/               # 中间件、Socket.IO 处理、Joi validators
├── routes/            # API 路由（按功能模块划分）
│   └── grid/          # 网格相关路由
├── services/          # 业务服务层
├── layers/            # 业务领域定义（tableLayer、businessRelations）
├── security/          # 安全模块（角色、权限、守卫）
├── jobs/              # 具体定时任务实现
├── public/            # 前端静态资源
│   ├── app.js         # 前端引导入口（禁止修改）
│   ├── modules/       # 前端功能模块
│   └── dist/          # 构建产物
├── tests/             # 测试脚本
├── docs/              # 项目文档
├── backups/           # 备份归档
└── scripts/           # 构建和工具脚本
```

---

> 最后更新：2026-06-30
> 适用版本：CollabGrid v0.3.1
