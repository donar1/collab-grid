# layers/

架构分层定义目录。声明三层结构的边界、字段类型和业务对象关系，不包含具体路由实现。

## 文件说明

| 文件 | 作用 |
|------|------|
| `tableLayer.js` | 第一层：通用表格能力定义。导出 `FIELD_TYPES`（全部字段类型列表）和 `READONLY_FIELD_TYPES`（只读字段类型列表），供 `server.js` 和路由模块引用 |
| `businessRelations.js` | 第二层：五个核心业务对象定义。导出 `CORE_BUSINESS_OBJECTS`（产品/客户/订单/账单/库存）和 `BUSINESS_CALL_CHAIN`（调用链路），供 `/api/system/business-relations` 端点返回 |

## 三层架构

```
第一层：操作界面 / 通用表格能力（routes/grid/*）
  └── 表格、记录、单元格、关联、按钮、批量操作

第二层：核心业务（routes/core/*）
  └── 产品、客户、订单、账单、库存

第三层：附加层（server.js 内保留）
  └── 数据大屏、财务核算、作业调度、诊断中心
```

## 设计原则

- 本目录只放「定义」，不放「实现」
- 路由实现在 `routes/` 目录
- 作业实现在 `jobs/` 目录
