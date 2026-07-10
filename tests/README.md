# tests/

集成测试目录。所有测试均为黑盒 HTTP 集成测试，依赖运行中的服务实例（`localhost:3000`），无 mock 无单元测试。

## 运行方式

```bash
# 运行单个测试
npm run test:p0

# 运行全部测试（需逐个执行）
npm run test:frontend && npm run test:p0-security && npm run test:p0 && npm run test:resource && npm run test:product && npm run test:team-scale && npm run test:business-lock && npm run test:order && npm run test:inventory && npm run test:finance && npm run test:jobs && npm run test:dashboard && npm run test:diagnostics
```

## 测试文件说明

| 文件 | 覆盖范围 |
|------|----------|
| `p0_api_test.js` | 基础 API：注册、登录、空间创建、成员邀请、表格 CRUD、字段操作、记录 CRUD、单元格写入、关联操作 |
| `p0_security_test.js` | P0 安全：生产环境配置校验、CORS 收口、登录限流、按钮封账守门 |
| `resource_archive_test.js` | 资源档案：模板初始化、审批通过、数据可使用标记 |
| `product_info_test.js` | 产品信息：模板初始化、lookup 字段、产品状态 |
| `business_lock_test.js` | 业务锁定：模板初始化、审批通过、渠道负责人 lookup |
| `order_management_test.js` | 订单管理：模板初始化、订单创建、快照字段、退款/撤单 |
| `inventory_test.js` | 库存系统：实际/虚拟入库、自营出库扣减、非自营不扣减、重复审批拦截、库存流水 |
| `finance_reconciliation_test.js` | 财务对账：明细幂等生成、红冲、撤单产生「需要财务红冲」标记 |
| `jobs_test.js` | 作业系统：dryRun 不落地、状态流转、佣金结算、重复执行幂等、配置 PATCH |
| `dashboard_test.js` | 数据大屏：KPI 卡片、趋势数据、排行榜、库存预警、异常中心 |
| `diagnostics_bulk_test.js` | 诊断中心 + 批量导入：问题检测、5000 条订单批量导入 |
| `frontend_logic_test.js` | 前端逻辑：纯 JS 逻辑测试（不依赖服务） |
| `team_scale_test.js` | 团队权限与规模：角色矩阵、多成员协作 |

## 测试覆盖缺口

- 错误路径（JWT 过期、越权、字段已锁定）
- 并发审批（同一按钮 race 条件）
- 应付侧红冲（当前仅覆盖应收侧）
- 退款佣金冲回
- dry-run 不写 `order_activity_daily`
