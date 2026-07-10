# shared/api-changes.md

> API 字段/路径跟策划假设的不一致。旧→新。

| 日期 | 端点 | 策划假设 | 实际返回 | 影响 | 状态 |
|------|------|---------|---------|------|------|
| 2026-07-07 | `GET /api/bases/:id/diagnostics` | issue 含 `message` 字段 | issue 含 `title` 字段，无 `message` | 桥接层告警内容显示 `?` | 已修复：后端新增 `message`/`type` |
| 2026-07-07 | `GET /api/bases/:id/diagnostics` | 表名 = `订单管理区` | 模板创建 `销售订单表` | 诊断报告缺少业务模块 | 已修复：后端增加表名 fallback |
| 2026-07-07 | `PUT /api/records/:id/cells/:fieldId` | link 字段传 `linkRecordId` 即可 | 需调 `POST /api/links` | links 表为空，关联断裂 | 已修复：补录 links |
