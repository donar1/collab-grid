# CollabGrid API 文档

## 认证

所有 API（除 `/api/login`、`/api/register`、`/api/csrf-token` 外）需要 Cookie 认证。

状态变更请求（POST/PUT/PATCH/DELETE）需要附加 `X-CSRF-Token` header。

### 获取 CSRF Token
```
GET /api/csrf-token
```
响应：
```json
{ "csrfToken": "abc123..." }
```

### 登录
```
POST /api/login
Content-Type: application/json

{ "email": "user@example.com", "password": "password123" }
```
响应：设置 `cg_token` Cookie
```json
{ "user": { "id": "u1", "email": "user@example.com", "displayName": "User" } }
```

### 注册
```
POST /api/register
Content-Type: application/json

{ "email": "new@example.com", "password": "password123", "displayName": "New User" }
```

### 登出
```
POST /api/auth/logout
X-CSRF-Token: <token>
```

### Token 刷新
```
POST /api/auth/refresh
```
响应：
```json
{ "token": "new-jwt-token" }
```

---

## 基地 (Base)

### 列出基地
```
GET /api/bases
```
响应：
```json
{
  "bases": [
    { "id": "b1", "name": "My Base", "role": "owner", "memberCount": 3 }
  ]
}
```

### 创建基地
```
POST /api/bases
X-CSRF-Token: <token>
Content-Type: application/json

{ "name": "New Base" }
```

### 获取基地详情
```
GET /api/bases/:baseId
```

### 重命名基地
```
PATCH /api/bases/:baseId
X-CSRF-Token: <token>
Content-Type: application/json

{ "name": "New Name" }
```

### 删除基地
```
DELETE /api/bases/:baseId
X-CSRF-Token: <token>
```

---

## 表格 (Table)

### 创建表格
```
POST /api/bases/:baseId/tables
X-CSRF-Token: <token>
Content-Type: application/json

{ "name": "Orders" }
```

### 重命名表格
```
PATCH /api/tables/:tableId
X-CSRF-Token: <token>
Content-Type: application/json

{ "name": "New Name" }
```

### 删除表格
```
DELETE /api/tables/:tableId
X-CSRF-Token: <token>
```

---

## 字段 (Field)

### 创建字段
```
POST /api/tables/:tableId/fields
X-CSRF-Token: <token>
Content-Type: application/json

{
  "name": "Status",
  "type": "select",
  "options": { "values": [{"label": "Draft"}, {"label": "Done"}] }
}
```

### 更新字段
```
PATCH /api/fields/:fieldId
X-CSRF-Token: <token>
Content-Type: application/json

{ "name": "New Name", "options": {...} }
```

### 删除字段
```
DELETE /api/fields/:fieldId
X-CSRF-Token: <token>
```

---

## 记录 (Record)

### 创建记录
```
POST /api/tables/:tableId/records
X-CSRF-Token: <token>
```
响应：
```json
{ "id": "r1" }
```

### 更新记录
```
PATCH /api/records/:recordId
X-CSRF-Token: <token>
Content-Type: application/json

{ "height": 50, "locked": true }
```

### 删除记录
```
DELETE /api/records/:recordId
X-CSRF-Token: <token>
```

---

## 单元格 (Cell)

### 更新单元格
```
PUT /api/records/:recordId/cells/:fieldId
X-CSRF-Token: <token>
Content-Type: application/json

{ "value": "new value" }
```

### 更新单元格样式
```
PATCH /api/records/:recordId/cells/:fieldId/style
X-CSRF-Token: <token>
Content-Type: application/json

{ "style": { "bold": true, "color": "#ff0000" } }
```

---

## 批量操作 (Batch)

### 批量更新
```
POST /api/batch
X-CSRF-Token: <token>
Content-Type: application/json

{
  "ops": [
    { "type": "cell", "recordId": "r1", "fieldId": "f1", "value": "v1" },
    { "type": "record.create", "tableId": "t1" }
  ]
}
```

---

## 按钮操作 (Buttons)

### 执行按钮操作
```
POST /api/buttons/execute
X-CSRF-Token: <token>
Content-Type: application/json

{ "fieldId": "f1", "recordId": "r1", "action": "seal_record" }
```

---

## 附件 (Attachment)

### 上传附件
```
POST /api/attachments/upload
X-CSRF-Token: <token>
Content-Type: multipart/form-data

baseId=b1&recordId=r1&fieldId=f1
<file>
```

### 下载附件
```
GET /api/attachments/:id/download
```

### 删除附件
```
DELETE /api/attachments/:id
X-CSRF-Token: <token>
```

---

## 外部查询 (Public API)

### 客户快照查询
```
GET /api/public/snapshots?category=order&limit=20&offset=0
X-Customer-Token: <customer-token>
```

### 对账查询
```
GET /api/public/reconciliation?dateFrom=2026-01-01&dateTo=2026-12-31
X-Customer-Token: <customer-token>
```

### 数据大屏
```
GET /api/public/dashboard
X-Customer-Token: <customer-token>
```

---

## 成员管理

### 邀请成员
```
POST /api/bases/:baseId/invites
X-CSRF-Token: <token>
Content-Type: application/json

{ "role": "editor" }
```

### 接受邀请
```
POST /api/invites/:token/accept
X-CSRF-Token: <token>
```

---

## 审计日志

### 获取审计日志
```
GET /api/bases/:baseId/audit?limit=50&offset=0
```

---

## 错误响应

所有错误响应格式：
```json
{
  "error": "Error message",
  "traceId": "abc123-def456"
}
```

常见状态码：
- `400` — 请求参数错误
- `401` — 未认证
- `403` — 无权限
- `404` — 资源不存在
- `409` — 冲突（如重复邮箱）
- `423` — 记录已锁定
- `429` — 请求过于频繁
- `500` — 服务器内部错误

---

# 完整 API 参考（含 Joi Schema 与示例）

## 错误响应格式

通用错误：
```json
{ "error": "错误描述" }
```

验证错误（400 Bad Request）：
```json
{
  "error": "validation error",
  "details": [
    { "field": "email", "message": "\"email\" must be a valid email" },
    { "field": "password", "message": "\"password\" length must be at least 8 characters long" }
  ]
}
```

业务错误示例：
```json
{ "error": "forbidden" }
{ "error": "record not found" }
{ "error": "record sealed" }
{ "error": "field locked" }
{ "error": "table \"Orders\" already exists" }
```

---

## HTTP 状态码一览

| 状态码 | 含义 | 典型场景 |
|--------|------|----------|
| 200 | 成功 | GET 请求成功返回数据 |
| 201 | 创建成功 | POST 创建资源成功（当前代码统一用 200） |
| 400 | 请求参数错误 | Joi 校验失败、业务规则校验失败 |
| 401 | 未认证 | `cg_token` Cookie 缺失或过期、Socket.IO 认证失败 |
| 403 | 无权限 | 非 Base 成员、角色权限不足、字段/记录锁定 |
| 404 | 资源不存在 | 记录、字段、附件、运行记录等不存在 |
| 409 | 冲突 | 同名表已存在、重复注册、记录被外部引用 |
| 410 | 已删除 | 记录已被软删除，无法再次删除 |
| 415 | Content-Type 错误 | 端点要求 `application/json` 但收到其他类型 |
| 423 | 已锁定 | 记录已封账(sealed)、字段已锁定 |
| 429 | 请求过于频繁 | 客户查询限流(60次/分钟)、Socket.IO 限流(100ms间隔) |
| 500 | 服务器内部错误 | 数据库异常、未捕获的异常 |

---

## 认证 API

### 获取 CSRF Token
```
GET /api/csrf-token
```
无请求体。
响应 (200)：
```json
{ "csrfToken": "abc123..." }
```
同时设置 `csrf_token` Cookie（httpOnly, sameSite=Strict）。

---

### 注册
```
POST /api/register
```
**Joi Schema (`registerSchema`)**:
```js
{
  email:     string, email 格式, 必填
  password:  string, min=8, max=128, 必填
  displayName: string, min=1, max=100, 必填
}
```
请求体：
```json
{ "email": "new@example.com", "password": "password123", "displayName": "New User" }
```
响应 (200)：设置 `cg_token` Cookie
```json
{ "user": { "id": "u1", "email": "new@example.com", "displayName": "New User" } }
```
错误 (409)：`{ "error": "email already registered" }`

---

### 登录
```
POST /api/login
```
**Joi Schema (`loginSchema`)**:
```js
{
  email:     string, email 格式, 必填
  password:  string, min=1, max=128, 必填
}
```
请求体：
```json
{ "email": "user@example.com", "password": "password123" }
```
响应 (200)：设置 `cg_token` Cookie
```json
{ "user": { "id": "u1", "email": "user@example.com", "displayName": "User" } }
```
错误 (401)：`{ "error": "invalid credentials" }`

---

### 登出
```
POST /api/auth/logout
X-CSRF-Token: <token>
```
无请求体。
响应 (200)：
```json
{ "ok": true }
```

---

### Token 刷新
```
POST /api/auth/refresh
Authorization: Bearer <token>
```
或使用 `cg_token` Cookie。
无请求体。
响应 (200)：设置新 `cg_token` Cookie
```json
{ "token": "new-jwt-token" }
```
错误 (401)：`{ "error": "token expired" }`

---

### 修改密码
```
POST /api/auth/change-password
X-CSRF-Token: <token>
```
**Joi Schema (`changePasswordSchema`)**:
```js
{
  oldPassword: string, min=1, max=128, 必填
  newPassword: string, min=8, max=128, 必填
}
```
请求体：
```json
{ "oldPassword": "old1234", "newPassword": "new5678" }
```
响应 (200)：
```json
{ "ok": true }
```
错误 (400)：`{ "error": "wrong password" }`

---

### 获取当前用户
```
GET /api/me
```
无请求体。
响应 (200)：
```json
{ "user": { "id": "u1", "email": "user@example.com", "displayName": "User", "systemRole": "manager" } }
```

---

## 工作区（Base）API

### 列出 Base
```
GET /api/bases
```
响应 (200)：
```json
{ "bases": [{ "id": "b1", "name": "My Base", "role": "owner", "memberCount": 3 }] }
```

### 创建 Base
```
POST /api/bases
X-CSRF-Token: <token>
```
**Joi Schema (`createBaseSchema`)**:
```js
{ name: string, min=1, max=200, 必填 }
```
请求体：
```json
{ "name": "New Base" }
```
响应 (200)：
```json
{ "id": "b1", "name": "New Base" }
```

### 重命名 Base
```
PATCH /api/bases/:baseId
X-CSRF-Token: <token>
```
**Joi Schema (`renameBaseSchema`)**:
```js
{ name: string, min=1, max=200, 必填 }
```

### 获取 Base 详情
```
GET /api/bases/:baseId
```
查询参数：`limit`（分页限制）
响应包含 Base 信息及其所有表格数据。

### 删除 Base
```
DELETE /api/bases/:baseId
X-CSRF-Token: <token>
```
响应 (200)：`{ "ok": true }`

---

## 表格 API

### 分页参数规范

表格列表和搜索接口使用以下分页参数：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `offset` | number | 0 | 偏移量，最小 0 |
| `limit` | number | 200 | 每页条数，范围 20-500 |
| `q` | string | (空) | 搜索关键字（仅搜索接口） |
| `displayFieldId` | string | 第一个字段 | 搜索展示字段 ID |
| `sortField` | string | - | 排序字段（预留） |
| `sortDir` | string | - | 排序方向：`asc` / `desc`（预留） |

---

### 表格分页数据
```
GET /api/tables/:tableId/page?offset=0&limit=200
```
响应 (200)：
```json
{
  "tableId": "t1",
  "records": [{ "id": "r1", "height": 34, "locked": false, "position": 1, "table_id": "t1", "created_at": 1234567890, "updated_at": 1234567890 }],
  "cells": [{ "record_id": "r1", "field_id": "f1", "value": "hello", "updated_at": 1234567890, "updated_by": "u1" }],
  "links": [{ "id": "l1", "field_id": "f2", "from_record_id": "r1", "to_record_id": "r2" }],
  "page": { "offset": 0, "limit": 200, "total": 42 }
}
```

### 搜索表格记录
```
GET /api/tables/:tableId/search?q=关键词&displayFieldId=f1&offset=0&limit=30
```
响应 (200)：
```json
{
  "tableId": "t1",
  "records": [...],
  "cells": [...],
  "links": [...],
  "fields": [...],
  "page": { "offset": 0, "limit": 30, "total": 5 },
  "q": "关键词"
}
```
错误 (400)：`{ "error": "display field does not belong to table" }`

### 创建表格
```
POST /api/bases/:baseId/tables
X-CSRF-Token: <token>
```
**Joi Schema (`createTableSchema`)**:
```js
{ name: string, min=1, max=200, 必填 }
```
响应 (200)：
```json
{ "id": "t1" }
```
错误 (409)：`{ "error": "table \"Orders\" already exists" }`

### 重命名表格
```
PATCH /api/tables/:tableId
X-CSRF-Token: <token>
```
请求体：`{ "name": "New Name" }`

### 删除表格
```
DELETE /api/tables/:tableId
X-CSRF-Token: <token>
```
响应 (200)：`{ "ok": true }`

### 表格排序
```
PATCH /api/tables/:tableId/position
X-CSRF-Token: <token>
```
请求体：`{ "position": 2 }`

### 表格显隐
```
PATCH /api/tables/:tableId/visibility
X-CSRF-Token: <token>
```
请求体：`{ "hidden": true }`

### 创建字段
```
POST /api/tables/:tableId/fields
X-CSRF-Token: <token>
```
**Joi Schema (`createFieldSchema`)**:
```js
{
  name:    string, min=1, max=200, 必填
  type:    string, 枚举值, 必填
  options: object, 允许 null
}
```
允许的 `type` 值：`text` | `number` | `singleSelect` | `multiSelect` | `date` | `lookup` | `formula` | `autoNumber` | `createdTime` | `lastModifiedTime` | `lastModifiedBy` | `attachment`

### 更新字段
```
PATCH /api/fields/:fieldId
X-CSRF-Token: <token>
```
**Joi Schema (`updateFieldSchema`)**:
```js
{
  name:    string, min=1, max=200
  type:    string, 枚举值
  options: object
  width:   number, integer, min=60, max=600
}
```

### 字段锁定/解锁
```
PATCH /api/fields/:fieldId/lock
X-CSRF-Token: <token>
```
请求体：`{ "locked": true }`

### 删除字段
```
DELETE /api/fields/:fieldId
X-CSRF-Token: <token>
```
错误 (423)：`{ "error": "field locked" }`

### 软删除记录（表内）
```
DELETE /api/tables/:tableId/records/:recordId
X-CSRF-Token: <token>
```
响应 (200)：`{ "ok": true, "recordId": "r1" }`
错误 (409)：`{ "error": "record referenced", "references": [...] }`
错误 (410)：`{ "error": "already deleted" }`

### 恢复记录
```
POST /api/tables/:tableId/records/:recordId/restore
X-CSRF-Token: <token>
```
响应 (200)：`{ "ok": true, "recordId": "r1" }`

---

## 记录 API

### 创建记录
```
POST /api/tables/:tableId/records
X-CSRF-Token: <token>
```
**Joi Schema (`createRecordSchema`)**:
```js
{
  cells: object, min=0, max=500
  // 键为 21 位 nanoid（fieldId），值为 string 或 ''
}
```
请求体示例：
```json
{ "cells": { "f1": "Hello", "f2": "World" } }
```
响应 (200)：
```json
{ "id": "r1" }
```

### 更新记录属性
```
PATCH /api/records/:recordId
X-CSRF-Token: <token>
```
请求体（部分更新）：
```json
{ "height": 50, "locked": true }
```
- `height`: number, 28-240 之间
- `locked`: boolean（true = 封账，false = 解封）
响应 (200)：
```json
{ "ok": true, "height": 50, "locked": true }
```
错误 (423)：`{ "error": "record sealed" }`（更新已锁定记录）或 `no permission to seal record` / `only owner/admin can unseal record`

### 硬删除记录
```
DELETE /api/records/:recordId
X-CSRF-Token: <token>
```
响应 (200)：`{ "ok": true }`
错误 (423)：`{ "error": "record sealed" }`

---

## 单元格 API

### 更新单元格值
```
PUT /api/records/:recordId/cells/:fieldId
X-CSRF-Token: <token>
```
**Joi Schema (`updateCellSchema`)**:
```js
{
  value:         string, 允许 null 或 ''
  linkRecordId:  string, 允许 null
}
```
请求体：
```json
{ "value": "new value" }
```
响应 (200)：`{ "ok": true }`

业务校验规则：
- 只读字段类型不可写（`lastModifiedTime`、`lastModifiedBy`、`createdTime`、`formula`、`autoNumber`、`lookup(snapshot)`）
- `select` 类型：值必须在 options 的 values 列表中
- `number` / `currency` 类型：值必须为有效数字
- `checkbox` 类型：自动将 `true/1/"true"` 转为 `"true"`，其余转为 `"false"`
- 业务锁定保护字段和订单完结日期字段不可修改
- 字段锁定时返回 423

### 更新单元格样式
```
PATCH /api/records/:recordId/cells/:fieldId/style
X-CSRF-Token: <token>
```
请求体：
```json
{ "style": { "bold": true, "color": "#ff0000", "backgroundColor": "#ffff00" } }
```
响应 (200)：`{ "ok": true }`

---

## 关联 API

### 创建关联
```
POST /api/links
X-CSRF-Token: <token>
```
**Joi Schema (`createLinkSchema`)**:
```js
{
  fromRecordId: string, 21位 nanoid, 必填
  toRecordId:   string, 21位 nanoid, 必填
  fieldId:      string, 21位 nanoid, 必填
}
```
请求体：
```json
{ "fromRecordId": "r1", "toRecordId": "r2", "fieldId": "f1" }
```
响应 (200)：
```json
{ "id": "l1" }
```
说明：
- `fieldId` 必须是 `link` 类型字段
- 不允许多重链接时，旧链接会被自动替换
- 如果链接已存在，返回已有链接 ID：`{ "id": "l1", "replaced": true }`
- 自动重算关联的 lookup 快照

### 删除关联
```
DELETE /api/links/:id
X-CSRF-Token: <token>
```
响应 (200)：`{ "ok": true }`
错误 (404)：`{ "error": "not found" }`

---

## 批量操作 API

### 批量更新单元格
```
POST /api/batch
X-CSRF-Token: <token>
```
**Joi Schema (`batchUpdateSchema`)**:
```js
{
  updates: array, min=1, max=500, 必填
  // 每项结构：
  {
    recordId: string, 21位 nanoid, 必填
    fieldId:  string, 21位 nanoid, 必填
    value:    string, 允许 null 或 ''
  }
}
```
请求体：
```json
{
  "updates": [
    { "recordId": "r1", "fieldId": "f1", "value": "hello" },
    { "recordId": "r2", "fieldId": "f2", "value": "world" }
  ]
}
```
响应 (200)：
```json
{ "ok": true, "count": 2 }
```
说明：
- 所有更新在同一事务中执行，任何一项失败则全部回滚
- 适用与单个单元格更新相同的字段类型校验和业务保护规则
- 支持的字段类型校验：select、number、currency、checkbox

---

## 按钮执行 API

### 执行按钮操作
```
POST /api/buttons/execute
X-CSRF-Token: <token>
```
**Joi Schema (`executeButtonSchema`)**:
```js
{
  action:    string, 枚举值, 必填
               允许: "seal" | "unseal" | "approve" | "reject" | "cancel" | "red_note"
  recordIds: array, 21位 nanoid, min=1, max=500, 必填
  baseId:    string, 21位 nanoid, 必填
  tableId:   string, 21位 nanoid, 必填
}
```
请求体：
```json
{ "action": "seal", "recordIds": ["r1", "r2"], "baseId": "b1", "tableId": "t1" }
```

实际路由处理中，按钮字段从 `fieldId` + `recordId` 获取，action 从字段 options 中读取。前端 API 常量为 `/api/buttons/execute`。

支持的按钮 action 及其效果：

| action | 效果 | 权限 |
|--------|------|------|
| `seal_record` | 记录锁定(封账) | canSealRecord |
| `unseal_record` | 记录解锁 | canSealRecord (owner/admin only) |
| `approve_resource` | 审批通过资源档案，设置审批状态/可用/待办/建群 | canApprove |
| `approve_business_lock` | 审批通过业务锁定，设置判断/审批结果 | canApprove |
| `approve_inventory_operation` | 审批通过出入库操作 | canApprove |
| `seal_finance_record` | 财务记录封账 | canRunJobs |
| `approve_finance_reversal` | 审批通过财务红冲 | canApprove |
| `approve_order_refund` | 审批通过退款申请，自动处理红冲 | canApprove |
| `approve_order_cancel` | 审批通过撤单申请，自动取消订单并生成红冲任务 | canApprove |

响应 (200)：
```json
{ "ok": true, "action": "seal_record", "locked": true }
```
退款/撤单审批额外返回：
```json
{ "ok": true, "action": "approve_order_cancel", "needFinanceReversal": true, "autoReversalIds": ["rx1", "rx2"] }
```

---

## 附件 API

### 获取附件列表
```
GET /api/attachments?recordId=r1&fieldId=f1
```
查询参数（必填）：`recordId`, `fieldId`
响应 (200)：
```json
{
  "attachments": [
    { "id": "a1", "file_name": "photo.jpg", "file_type": "image/jpeg", "file_size": 102400, "created_at": 1234567890 }
  ]
}
```

### 上传附件
```
POST /api/attachments/upload
X-CSRF-Token: <token>
Content-Type: multipart/form-data
```
表单字段（必填）：`baseId`, `recordId`, `fieldId`
上传文件字段。

限制：
- 单文件最大 20MB
- 允许的类型：`image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`, `image/bmp`, `application/pdf`, `xlsx`, `docx`, `xls`, `doc`, `text/csv`, `text/plain`, `application/zip`, `application/x-rar-compressed`

响应 (200)：
```json
{
  "ok": true,
  "files": [
    { "id": "a1", "filename": "photo.jpg", "mimeType": "image/jpeg", "size": 102400 }
  ]
}
```

### 下载附件
```
GET /api/attachments/:id/download
```
响应：直接返回文件二进制流，Content-Type 为文件原始类型。

### 删除附件
```
DELETE /api/attachments/:id
X-CSRF-Token: <token>
```
响应 (200)：`{ "ok": true }`

---

## 邀请/成员 API

### 创建邀请
```
POST /api/bases/:baseId/invites
X-CSRF-Token: <token>
```
**Joi Schema (`createInviteSchema`)**:
```js
{
  email: string, email 格式, 必填
  role:  string, 枚举值, 必填
}
```
允许的 `role` 值：`manager` | `business` | `data_clerk` | `support` | `warehouse`
响应 (200)：
```json
{ "ok": true, "token": "invite_token_abc" }
```

### 更新成员角色
```
PATCH /api/bases/:baseId/members/:userId
X-CSRF-Token: <token>
```
**Joi Schema (`updateRoleSchema`)**:
```js
{ role: string, 枚举值, 必填 }
```
允许的 `role` 值：`owner` | `manager` | `business` | `data_clerk` | `support` | `warehouse`
响应 (200)：
```json
{ "ok": true }
```

### 接受邀请
```
POST /api/invites/:token/accept
X-CSRF-Token: <token>
```
无请求体。
响应 (200)：
```json
{ "ok": true }
```

---

## 模板 API

模板端点用于初始化预定义的业务表格结构。所有模板端点均为 POST 操作，由具有结构管理权限(owner/admin)的用户触发。

### 核心业务模板
```
POST /api/bases/:baseId/templates/business-core
X-CSRF-Token: <token>
```
创建：产品表、销售订单表、采购订单表、库存表、结算表、退款表、客户账户表、资金流水表、预存设备表、设备使用记录表。
响应 (200)：
```json
{ "ok": true, "tables": ["产品表", "销售订单表", ...] }
```

### 资源档案模板
```
POST /api/bases/:baseId/templates/resource-archive
X-CSRF-Token: <token>
```
创建：资源档案中心。

### 产品信息模板
```
POST /api/bases/:baseId/templates/product-info
X-CSRF-Token: <token>
```
创建：产品名称数据源区、产品信息区。前置条件：资源档案中心已存在。

### 业务锁定模板
```
POST /api/bases/:baseId/templates/business-lock
X-CSRF-Token: <token>
```
创建：业务锁定区、员工档案中心（如不存在）、状态变更日志（如不存在）。前置条件：资源档案中心、产品信息区已存在。

### 订单管理模板
```
POST /api/bases/:baseId/templates/order-management
X-CSRF-Token: <token>
```
创建：订单管理区。前置条件：资源档案中心、产品信息区已存在。

### 库存模板
```
POST /api/bases/:baseId/templates/inventory
X-CSRF-Token: <token>
```
创建：库存商品区、出入库操作区、库存流水区。前置条件：产品信息区已存在。

### 财务对账模板
```
POST /api/bases/:baseId/templates/finance-reconciliation
X-CSRF-Token: <token>
```
创建：财务结算对象区、应收结算明细区、应付结算明细区、应收结算单区、应付结算单区、收付款流水区、财务红冲处理区、退款处理区、撤单处理区。前置条件：资源档案中心、订单管理区已存在。

### 订单批量导入
```
POST /api/bases/:baseId/bulk/orders
X-CSRF-Token: <token>
```
请求体：
```json
{
  "orders": [
    {
      "productId": "p1", "payerId": "r1", "payeeId": "r2",
      "quantity": 10, "zone": "下单区", "address": "xxx路",
      "customerName": "张三", "phone": "13800000000",
      "receivable": 100, "payable": 80
    }
  ]
}
```
限制：单次最多 5000 条。
响应 (200)：
```json
{ "ok": true, "createdCount": 10, "recordIds": ["r1", "r2", ...] }
```

### 生成财务明细
```
POST /api/bases/:baseId/finance/generate-details
X-CSRF-Token: <token>
```
响应 (200)：财务明细生成结果。

---

## 仪表盘/作业/诊断 API

### 仪表盘摘要
```
GET /api/bases/:baseId/dashboard/summary
```
响应 (200)：仪表盘统计数据。

### 任务配置列表
```
GET /api/bases/:baseId/jobs/configs
```
响应 (200)：
```json
{ "configs": [{ "jobKey": "snapshot_sync", "enabled": true, "schedule_time": "02:00" }] }
```

### 更新任务配置
```
PATCH /api/bases/:baseId/jobs/configs/:jobKey
X-CSRF-Token: <token>
```
**Joi Schema (`updateJobConfigSchema`)**:
```js
{
  enabled:                  boolean
  dry_run:                  boolean
  batch_size:               number, integer, min=1, max=10000
  max_runtime_ms:           number, integer, min=1000, max=600000
  config_json:              string, 允许 null
  schedule_enabled:         boolean
  schedule_time:            string, HH:mm 格式, 允许 null
  schedule_business_date_mode: string, "today" | "yesterday", 允许 null
}
```
响应 (200)：
```json
{ "ok": true, "config": { "jobKey": "snapshot_sync", "enabled": true, ... } }
```

### 运行任务
```
POST /api/bases/:baseId/jobs/:jobKey/run
X-CSRF-Token: <token>
```
请求体（可选）：
```json
{ "businessDate": "2026-06-30", "dryRun": false }
```
- `businessDate`：业务日期，格式 `YYYY-MM-DD`，默认当天
- `dryRun`：是否试运行
响应 (200)：
```json
{ "runId": "run1", "summary": { "processed": 42, "errors": 0 } }
```

### 任务运行历史
```
GET /api/bases/:baseId/jobs/runs?limit=30
```
响应 (200)：
```json
{ "runs": [{ "id": "run1", "jobKey": "snapshot_sync", "status": "completed", "startedAt": 1234567890 }] }
```

### 任务运行详情
```
GET /api/bases/:baseId/jobs/runs/:runId
```
响应 (200)：
```json
{ "run": { "id": "run1", "jobKey": "snapshot_sync", "status": "completed", "summary": {...} } }
```
错误 (404)：`{ "error": "run not found" }`

### 诊断
```
GET /api/bases/:baseId/diagnostics?businessDate=2026-06-30
```
查询参数（可选）：`businessDate`，格式 `YYYY-MM-DD`
响应 (200)：诊断结果数据。

---

## 权限矩阵 API

### 列出所有用户（仅管理员可访问）
```
GET /api/users
```
角色要求：`sys_admin` | `manager` | `data_clerk` | `data_engineer`
响应 (200)：
```json
{
  "users": [
    { "id": "u1", "email": "admin@example.com", "display_name": "Admin", "system_role": "sys_admin", "must_change_password": false, "created_at": 1234567890 }
  ]
}
```

### 权限码和角色字典
```
GET /api/security/permissions
```
响应 (200)：
```json
{
  "permissions": ["base.create", "table.create", ...],
  "systemRoles": [{ "value": "sys_admin", "label": "系统管理员" }],
  "baseRoles": [{ "value": "owner", "label": "所有者" }],
  "externalRoles": [{ "value": "customer", "label": "客户" }]
}
```

### 当前用户有效权限
```
GET /api/security/me
```
响应 (200)：
```json
{
  "userId": "u1",
  "systemRole": "manager",
  "memberships": [
    { "baseId": "b1", "baseName": "My Base", "role": "owner", "permissions": ["base.create", "table.create", ...] }
  ]
}
```

### 全局权限矩阵快照
```
GET /api/security/matrix
```
权限要求：`sys_admin` | `data_engineer` | `matrix.read`
响应 (200)：
```json
{
  "defaults": {
    "system": { "sys_admin": { "base.create": true, ... } },
    "external": { "customer": { ... } },
    "base": { "owner": { ... } }
  },
  "effective": { ... },
  "overrides": [{ "scope": "base", "role": "manager", "permission": "table.create", "allow": true }]
}
```

### 单 Base 权限矩阵
```
GET /api/bases/:baseId/security/matrix
```
响应 (200)：同全局矩阵结构，额外包含：
```json
{
  "mine": {
    "role": "manager",
    "permissions": ["table.create", "record.edit", ...]
  }
}
```

### 修改全局权限矩阵（仅 sys_admin）
```
PUT /api/security/matrix
X-CSRF-Token: <token>
```
请求体：
```json
{
  "changes": [
    { "scope": "system", "role": "manager", "permission": "base.create", "allow": true },
    { "scope": "base", "role": "business", "baseId": "b1", "permission": "record.edit", "allow": null }
  ]
}
```
- `allow: null` 表示清除覆盖（恢复默认值）
- 允许的 scope：`system` | `external` | `base`
响应 (200)：
```json
{ "ok": true, "applied": 2 }
```

### 修改 Base 级权限矩阵
```
PUT /api/bases/:baseId/security/matrix
X-CSRF-Token: <token>
```
同上格式，但仅允许 `scope: "base"`，且 `baseId` 必须匹配当前 base。

### 修改系统角色（仅 sys_admin）
```
PATCH /api/security/users/:userId/system-role
X-CSRF-Token: <token>
```
请求体：
```json
{ "systemRole": "manager" }
```
保护规则：
- 不能修改自己的角色
- 最后一个 sys_admin 和最后一个 manager 不能被降级
- manager 角色不能降为 none
响应 (200)：
```json
{ "ok": true, "userId": "u2", "systemRole": "manager" }
```

### 表级权限查看
```
GET /api/bases/:baseId/tables/permissions
```
响应 (200)：
```json
{
  "tables": [
    { "tableId": "t1", "permissions": { "manager": { "canView": true, "canEdit": true }, "data_clerk": { "canView": true, "canEdit": false } } }
  ]
}
```

### 表级权限更新
```
PUT /api/bases/:baseId/tables/:tableId/permissions
X-CSRF-Token: <token>
```
请求体：
```json
{
  "permissions": {
    "manager": { "canView": true, "canEdit": true },
    "data_clerk": { "canView": true, "canEdit": false }
  }
}
```
响应 (200)：
```json
{ "ok": true, "tableId": "t1", "permissions": { ... } }
```

---

## 公开查询 API

公开查询 API 使用 `X-Customer-Token` 头进行认证，不依赖内部 JWT。
限流规则：每客户每分钟最多 60 次请求。

### 客户自身信息
```
GET /api/public/me
X-Customer-Token: <customer-token>
```
响应 (200)：
```json
{ "baseId": "b1", "customerKey": "cust001", "displayName": "Customer A", "role": "customer", "expiresAt": 1735689600000 }
```

### 快照查询
```
GET /api/public/snapshots?category=order&limit=50&offset=0&dateFrom=2026-01-01&dateTo=2026-12-31&status=active&keyword=搜索
X-Customer-Token: <customer-token>
```
查询参数：
| 参数 | 类型 | 说明 |
|------|------|------|
| `category` | string | 快照类别：`order` / `product` 等 |
| `limit` | number | 每页条数，默认 50 |
| `offset` | number | 偏移量，默认 0 |
| `dateFrom` | string | 起始日期 |
| `dateTo` | string | 结束日期 |
| `status` | string | 状态筛选 |
| `minAmount` | number | 最小金额 |
| `maxAmount` | number | 最大金额 |
| `keyword` | string | 关键字搜索 |

响应 (200)：
```json
{
  "customerKey": "cust001",
  "displayName": "Customer A",
  "category": "order",
  "total": 42,
  "offset": 0,
  "limit": 50,
  "cached": true,
  "snapshots": [{ "refId": "r1", "data": {...} }]
}
```

### 对账查询
```
GET /api/public/reconciliation?dateFrom=2026-01-01&dateTo=2026-12-31&category=order&status=pending
X-Customer-Token: <customer-token>
```
查询参数：`dateFrom`, `dateTo`, `category`, `status`, `limit`, `offset`

### 数据大屏
```
GET /api/public/dashboard
X-Customer-Token: <customer-token>
```
响应 (200)：
```json
{
  "customerKey": "cust001",
  "displayName": "Customer A",
  "orders": { "count": 42, "receivable": 100000, "payable": 80000, "profit": 20000 },
  "products": { "count": 15, "specialCount": 3, "outOfStock": 1 },
  "trend": [{ "date": "2026-06-01", "count": 5, "amount": 12000 }]
}
```

### 客户 Token 管理（内部 API）

#### 颁发 Token
```
POST /api/bases/:baseId/public/clients
X-CSRF-Token: <token>
```
请求体：
```json
{ "customerKey": "cust001", "displayName": "Customer A", "ttlDays": 30 }
```
响应 (200)：
```json
{ "ok": true, "token": "cust_token_abc", "expiresAt": 1735689600000 }
```

#### 列出客户 Token
```
GET /api/bases/:baseId/public/clients
```
响应 (200)：
```json
{ "clients": [{ "token": "cust_token_abc", "customerKey": "cust001", "displayName": "Customer A" }] }
```

#### 撤销 Token
```
DELETE /api/bases/:baseId/public/clients/:token
X-CSRF-Token: <token>
```
响应 (200)：`{ "ok": true }`

#### 手动同步快照（数据修复用）
```
POST /api/bases/:baseId/public/snapshots/sync
X-CSRF-Token: <token>
```
请求体：
```json
{
  "items": [
    { "customerKey": "cust001", "category": "order", "refId": "r1", "data": { "amount": 100 } }
  ]
}
```
响应 (200)：
```json
{ "ok": true, "written": 1 }
```

---

## 系统端点

### 健康检查（无需认证）
```
GET /health
```
响应 (200)：
```json
{
  "status": "ok",
  "uptime": 86400,
  "timestamp": "2026-06-30T12:00:00.000Z",
  "engine": "better-sqlite3",
  "db": { "status": "healthy", "latency": 1 },
  "memory": { "rss": "80MB", "heapUsed": "40MB", "heapTotal": "60MB" },
  "socketConnections": { "total": 5, "byBase": { "b1": 3, "b2": 2 } },
  "alerts": { "total": 0, "lastHour": 0, "byLevel": { "error": 0, "warn": 0, "info": 0 } }
}
```

### 告警列表
```
GET /api/alerts?level=error&source=db&since=2026-06-29T00:00:00Z&limit=50
```
查询参数：`level`, `source`, `since`, `limit`
响应 (200)：
```json
{
  "alerts": [{ "level": "error", "source": "db", "message": "...", "timestamp": "2026-06-30T12:00:00.000Z" }],
  "stats": { "total": 1, "lastHour": 1, "byLevel": { "error": 1, "warn": 0, "info": 0 } }
}
```

### 业务关系说明
```
GET /api/system/business-relations
```
响应 (200)：
```json
{
  "layers": {
    "table": "第一层：操作界面与通用表格能力，负责字段、记录、关联、查找、筛选和实时同步",
    "coreBusiness": "第二层：产品、客户、订单、账单、库存等核心业务对象及其调用链路",
    "valueAdded": "第三层：数据大屏与增值计算，可采纳核心结果，后续逐步迭代"
  },
  "objects": [...],
  "callChain": [...]
}
```

---

## Socket.IO 事件契约

### 连接认证

Socket.IO 连接时通过中间件自动认证：
- 从 Cookie (`cg_token`) 或 `handshake.auth.token` 中提取 JWT
- 验证 token 有效且用户存在
- 认证失败则断开连接，错误：`unauthorized` / `user not found`

连接限制：
- 每 IP 最多 10 个并发连接
- 心跳检测：每 30 秒检查，超过 5 分钟无活动自动断开

---

### base:join
加入 Base 房间，开始接收该 Base 的实时事件。

**客户端发送**：
```json
{ "baseId": "b1" }
```
权限：必须是 Base 成员。

**服务端响应**：
- `sync:seq` — 发送当前序列号，用于增量同步
```json
{ "baseId": "b1", "lastSeq": 42 }
```
- `presence:join` — 广播给房间内其他成员（使用 userId，不暴露 email）
```json
{ "userId": "u2" }
```

### base:leave
离开 Base 房间。

**客户端发送**：
```json
{ "baseId": "b1" }
```
广播：`presence:leave` 给房间内其他成员。
```json
{ "userId": "u2" }
```

### sync:request
请求增量同步，获取自上次序列号以来的所有事件。

**客户端发送**：
```json
{ "baseId": "b1", "lastSeq": 42 }
```
限流：每个 socket 每 100ms 最多处理 1 个请求。

**服务端响应**（依次发送）：
1. 错过的事件回放（按序列号顺序）：
   - `record:add`, `record:update`, `record:delete`, `record:restore`
   - `cell:update`, `cell:style`
   - `table:add`, `table:rename`, `table:delete`, `table:position`, `table:visibility`
   - `field:add`, `field:update`, `field:delete`, `field:lock`
   - `link:add`, `link:delete`
2. 如果中间有快照事件：`sync:snapshot`
```json
{ "baseId": "b1", "reason": "table_structure_changed", "currentSeq": 50 }
```
3. 确认消息：`sync:ack`
```json
{ "baseId": "b1", "currentSeq": 55 }
```

### sync:snapshot
全量快照触发信号。当发生重大结构变更（如表格结构变化）时，服务端通知客户端应重新拉取全量数据。

```json
{ "baseId": "b1", "reason": "table_structure_changed", "currentSeq": 50 }
```

### record:add
新记录创建事件。

```json
{ "id": "r1", "tableId": "t1", "height": 34, "locked": false, "position": 1 }
```

### record:update
记录属性更新事件（如高度变化、锁定状态变化）。

```json
{ "recordId": "r1", "height": 50, "locked": true, "updatedAt": 1234567890 }
```

### record:delete
记录删除事件（软删除或硬删除）。

```json
{ "tableId": "t1", "recordId": "r1" }
```
或硬删除时：
```json
{ "recordId": "r1" }
```

### record:restore
记录恢复事件。

```json
{ "tableId": "t1", "recordId": "r1" }
```

### cell:update
单元格值更新事件。

```json
{ "recordId": "r1", "fieldId": "f1", "value": "hello", "updatedAt": 1234567890, "updatedBy": "u1" }
```

### cell:style
单元格样式更新事件。

```json
{ "recordId": "r1", "fieldId": "f1", "styleJson": "{\"bold\":true}", "updatedAt": 1234567890 }
```

### link:add
关联链接创建事件。

```json
{ "id": "l1", "fieldId": "f1", "fromRecordId": "r1", "toRecordId": "r2" }
```

### link:delete
关联链接删除事件。

```json
{ "id": "l1", "fieldId": "f1" }
```

### table:add / table:rename / table:delete / table:position / table:visibility
表格结构变更事件。

```json
{ "id": "t1", "name": "Orders", "position": 1 }
{ "tableId": "t1", "name": "New Name" }
{ "tableId": "t1" }
{ "tableId": "t1", "position": 2 }
{ "tableId": "t1", "hidden": false }
```

### field:add / field:update / field:delete / field:lock
字段结构变更事件。

```json
{ "id": "f1", "tableId": "t1", "name": "Status", "type": "select", "options": {...}, "locked": false, "position": 0 }
{ "fieldId": "f1", "name": "New Name" }
{ "fieldId": "f1" }
{ "fieldId": "f1", "locked": true }
```

### presence:join / presence:leave
用户上下线事件。

```json
{ "userId": "u2" }
```
注意：广播 userId，不暴露 email（PII 保护）。

---

## 通知 (Notifications)

### 预留接口 (V0.10+)

通知系统端点将在 V0.10 中补充，包括：

| Method | Path | 说明 |
|--------|------|------|
| GET | /api/notifications | 获取当前用户的通知列表（支持分页） |
| PATCH | /api/notifications/:id/read | 标记单条通知为已读 |
| PATCH | /api/notifications/read-all | 批量标记所有通知为已读 |
| DELETE | /api/notifications/:id | 删除单条通知 |

**通知数据结构**：
```json
{
  "id": "n1",
  "userId": "u1",
  "type": "exception|inventory|system",
  "title": "库存预警：产品A库存不足",
  "content": { "baseId": "b1", "tableId": "t1", "recordId": "r1" },
  "read": false,
  "createdAt": 1234567890
}
```

---

## 通用说明

### ID 格式
所有资源 ID 使用 nanoid 生成，长度为 21 个字符，仅包含 `A-Za-z0-9_-`。

### 时间戳
所有时间戳为 Unix 毫秒时间戳（number）。

### Content-Type
JSON 端点统一使用 `Content-Type: application/json`。
附件上传使用 `Content-Type: multipart/form-data`。

### CSRF 保护
所有状态变更请求必须携带 `X-CSRF-Token` 请求头，值通过 `GET /api/csrf-token` 获取。
