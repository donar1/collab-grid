# CollabGrid 命名规则

## 设计原则

1. **自解释**：文件名应能独立说明内容，不依赖目录上下文
2. **一致性**：同类型文件使用统一的命名模式
3. **可排序**：版本号、日期使用固定格式，确保字典序 = 时间序
4. **可搜索**：关键术语放在文件名前部，便于模糊匹配

---

## 一、项目根目录文件

| 文件 | 命名模式 | 示例 |
|------|---------|------|
| 项目总览 | `COLLABGRID_` + 内容类型 + `.md` | `COLLABGRID_PROJECT_GUIDE.md` |
| 命名规则本身 | `NAMING_CONVENTIONS.md` | — |
| 启动入口 | `server.js` | — |
| 核心模块 | 功能名 + `.js` | `auth.js`, `db.js`, `publicDb.js`, `jobs.js` |

---

## 二、文档（docs/）

| 文档类型 | 命名模式 | 示例 |
|---------|---------|------|
| 架构设计 | `ARCHITECTURE_` + 主题 + `.md` | `ARCHITECTURE_LAYERS.md` |
| 版本说明 | `V` + 版本号 + `_` + 主题 + `.md` | `V0.3_RELEASE_NOTES.md`, `V0.3.1_PERMISSION_MATRIX.md` |
| API 文档 | `API_` + 范围 + `.md` | `API_REFERENCE.md` |
| 部署文档 | `DEPLOY_` + 环境 + `.md` | `DEPLOY_PRODUCTION.md` |
| 决策记录 | `ADR_` + 日期 + `_` + 主题 + `.md` | `ADR_20260622_DB_SPLIT.md` |
| 目录说明 | `README.md` | — |

**规则**：
- 版本号格式：`V主版本.次版本.修订版本`，如 `V0.3.1`
- 主题使用大写下划线连接（snake_case）
- 禁止用 `README.md` 存放实质内容——它只能是目录索引

---

## 三、源代码（routes/、layers/、security/、public/modules/）

| 文件类型 | 命名模式 | 示例 |
|---------|---------|------|
| 路由模块 | 名词（复数）+ `.js` | `tables.js`, `customers.js`, `matrix.js` |
| 业务层定义 | 名词 + `.js` | `tableLayer.js`, `businessRelations.js` |
| 安全模块 | 名词 + `.js` | `roles.js`, `permissions.js`, `guards.js` |
| 前端模块 | 名词 + `.js` | `clipboard.js`, `keyboard.js` |
| 目录说明 | `README.md` | — |

**规则**：
- 路由文件用复数名词（`tables` 不是 `table`）
- 工具/助手文件用 `xxxHelper.js` 或 `xxxUtil.js`
- 禁止用 `index.js` 作为实质业务文件——它只能是目录导出聚合

---

## 四、测试（tests/）

| 测试类型 | 命名模式 | 示例 |
|---------|---------|------|
| P0 基础测试 | `p0_` + 范围 + `_test.js` | `p0_api_test.js`, `p0_security_test.js` |
| 业务场景测试 | 场景名 + `_test.js` | `order_management_test.js`, `inventory_test.js` |
| 权限测试 | `permission_` + 范围 + `_test.js` | `permission_matrix_test.js` |
| 前端逻辑测试 | `frontend_` + 范围 + `_test.js` | `frontend_logic_test.js` |
| 目录说明 | `README.md` | — |

**规则**：
- 所有测试文件必须以 `_test.js` 结尾
- P0 测试前缀统一为 `p0_`，便于批量筛选
- 场景名使用 snake_case，优先用业务术语而非技术术语

---

## 五、备份（backups/）

| 备份类型 | 命名模式 | 示例 |
|---------|---------|------|
| 完整备份 | `collab-grid-` + 版本/阶段 + `-full-` + 日期时间 + `.zip` | `collab-grid-v0.3-before-permission-matrix-full-20260621.zip` |
| 增量备份 | `collab-grid-` + 阶段 + `-` + 日期时间 + `.zip` | `collab-grid-before-dashboard-20260621-150015.zip` |
| 目录说明 | `README.md` | — |

**规则**：
- 日期格式：`YYYYMMDD`，时间格式：`HHMMSS`
- 完整备份必须包含 `-full-` 标记
- 阶段描述使用 kebab-case（短横线连接）

---

## 六、禁止的命名

| 禁止 | 原因 | 替代方案 |
|------|------|---------|
| `README.md` 放实质内容 | 无法从文件名判断内容 | 用 `COLLABGRID_xxx.md` |
| `index.js` 做业务逻辑 | 目录聚合和业务能力混为一谈 | 业务文件用具体名词 |
| `new.js`, `temp.js`, `test.js` | 临时名会变成永久名 | 一次性文件用完即删 |
| `doc.md`, `notes.md` | 过于笼统 | 用 `ARCHITECTURE_xxx.md` 或 `ADR_xxx.md` |
| 中文文件名 | 跨平台兼容性问题 | 全用英文 |
| 空格和特殊字符 | shell 处理麻烦 | 用 `-` 或 `_` |

---

## 七、快速决策表

```
要写项目总览？     → COLLABGRID_PROJECT_GUIDE.md
要写架构文档？     → ARCHITECTURE_主题.md
要写版本说明？     → V版本号_主题.md
要写 API 文档？    → API_范围.md
要写部署文档？     → DEPLOY_环境.md
要写决策记录？     → ADR_日期_主题.md
要加路由文件？     → 复数名词.js（如 orders.js）
要加测试文件？     → 范围_test.js（如 p0_api_test.js）
要做完整备份？     → collab-grid-阶段-full-YYYYMMDD.zip
```
