# routes/

后端路由模块目录。V0.3 起从 `server.js` 拆分出的路由实现，按「通用表格」和「核心业务」两个子目录组织。

## 目录结构

```
routes/
├── grid/          # 第一层：通用表格能力路由
│   ├── tables.js  #   表格 CRUD、字段增删改、搜索分页
│   ├── records.js #   记录新增、更新、删除、封账
│   ├── cells.js   #   单元格写入、样式写入、只读保护
│   ├── links.js   #   关联增删、lookup 快照重算、订单产品同步
│   ├── buttons.js #   按钮 action 分发（审批、封账、红冲、库存审批）
│   └── batch.js   #   批量 cell.update
└── core/          # 第二层：核心业务路由
    ├── customers.js  #   资源档案中心、员工档案、业务锁定区、状态变更日志
    ├── products.js   #   产品名称数据源区、产品信息区
    ├── orders.js     #   订单管理区、批量订单导入
    ├── inventory.js  #   库存商品区、出入库操作区、库存流水区
    └── bills.js      #   财务结算对象区、应收/应付明细区、红冲/退款/撤单处理区
```

## 模块规范

- 每个文件导出一个 `registerXxxRoutes(ctx)` 工厂函数
- `ctx` 由 `server.js` 构建，注入 `db`、`authRequired`、`audit`、`upsertCell` 等共享依赖
- 路由路径保持与拆分前完全一致，前端无需修改
- 第三层路由（大屏、作业、诊断）暂留在 `server.js` 内
