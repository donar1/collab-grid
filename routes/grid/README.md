# routes/grid/

第一层：通用表格能力路由。处理所有与多维表格基础操作相关的 API，不涉及具体业务语义。

## 文件说明

| 文件 | 负责的 API 路径 | 说明 |
|------|-----------------|------|
| `tables.js` | `GET/POST /api/bases/:baseId/tables`、`PUT/DELETE /api/bases/:baseId/tables/:tableId/fields/:fieldId` 等 | 表格列表、搜索、创建、字段增删改锁定 |
| `records.js` | `POST/PUT/DELETE /api/bases/:baseId/tables/:tableId/records/:recordId` | 记录新增、更新、删除、封账状态 |
| `cells.js` | `PUT /api/bases/:baseId/tables/:tableId/records/:recordId/cells/:fieldId` | 单元格写入、样式写入、只读字段保护 |
| `links.js` | `POST/DELETE /api/bases/:baseId/links` | 关联字段增删、lookup 快照重算、订单产品默认值同步 |
| `buttons.js` | `POST /api/buttons/execute` | 按钮 action 分发：审批通过、封账/解封、红冲、库存出入库审批、订单退款/撤单 |
| `batch.js` | `POST /api/batch` | 批量 cell.update（上限 500 条） |

## 依赖

- 由 `server.js` 通过 `gridRouteContext` 注入共享依赖
- 引用 `layers/tableLayer.js` 的字段类型定义
