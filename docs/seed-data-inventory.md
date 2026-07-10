# Seed Data Inventory

> 所有灌入数据的完整清单，可追溯。

## Base 信息

| 项目 | 值 |
|------|-----|
| Base ID | `h7Coc0p6p_HWj7ysLDU4C` |
| Base 名称 | 业务验证空间 |
| 创建时间 | 2026-07-07 |
| 创建用户 | `seed_1783402667254@test.local` |

## 表记录统计

| 表名 | 记录数 | 来源脚本 |
|------|--------|---------|
| 产品表 | 4 | `scripts/seed-business-data.js` |
| 客户账户表 | 3 | `scripts/seed-business-data.js` |
| 销售订单表 | 13 | `scripts/seed-business-data.js` (5) + `scripts/seed-phase3-supplement.js` (2 已取消) + 其他 |
| 库存表 | 4 | `scripts/seed-business-data.js` |
| 结算表 | 9 | `scripts/seed-business-data.js` (3) + `scripts/seed-phase3-supplement.js` (3) + 其他 |
| 退款表 | 7 | `scripts/seed-phase3-supplement.js` (2) + 其他 |
| 预存设备表 | 2 | `scripts/seed-phase3-supplement.js` (1) + 其他 |
| 设备使用记录表 | 1 | `scripts/seed-phase3-supplement.js` |
| 资金流水表 | 0 | — |
| 采购订单表 | 0 | — |

## Link 关联统计

| 关联类型 | 数量 | 修复脚本 |
|----------|------|---------|
| 订单 → 客户 | 13 | `scripts/fix-links.js` |
| 订单 → 产品 | 13 | `scripts/fix-links.js` |
| 结算 → 销售订单 | 9 | `scripts/fix-links.js` |
| 退款 → 销售订单 | 7 | `scripts/fix-links.js` |
| **合计** | **42** | — |

## 数据质量检查

| 检查项 | 结果 | 状态 |
|--------|------|------|
| 订单 link 完整性 | 13/13 客户 + 13/13 产品 | 已修复 |
| 结算 link 完整性 | 9/9 销售订单 | 已修复 |
| 退款 link 完整性 | 7/7 销售订单 | 已修复 |
| 订单状态分布 | 待发货 2 / 已发货 2 / 已完成 1 / 已取消 2 + 其他 | — |
| 结算状态分布 | 待结算 8 / 已结算 1 | — |

## 备注

- `order_activity_daily` 表由 `scripts/backfill-daily.js` 回填 56 行
- 部分记录可能来自早期测试运行，脚本执行多次导致数量超出预期
- 建议：后续灌入脚本使用时间戳前缀命名，如 `seed_20260707_1430_orders.js`
