# jobs/

后台作业子系统。负责定时任务调度、佣金结算、客户状态扫描和诊断中心。

## 模块说明

| 文件 | 作用 |
|------|------|
| `index.js` | 作业调度器入口：配置管理（`job_configs`）、运行流水（`job_runs`）、定时触发（`processSchedules`）、手动执行（`runJob`） |
| `commissionJob.js` | 佣金结算作业：按业务日计算渠道负责人奖金，支持退款冲回，幂等设计（`batch_no` + `INSERT OR IGNORE`） |
| `statusJob.js` | 客户状态扫描作业：根据 30 天活动窗口将客户标记为「活跃/正常/沉淀」，重建活动日聚合表 |
| `grid.js` | 数据库工具层：`makeGrid(db)` 提供 `table()`、`fieldsByName()`、`fieldIdByName()` 等查询封装，供作业域使用 |
| `diagnostics.js` | 诊断中心：检测佣金异常（退款缺原单、重复结算）、库存预警、财务红冲待处理等问题 |

## 作业类型

| 作业标识 | 调度方式 | 说明 |
|----------|----------|------|
| `status_update` | 每分钟检查 | 扫描客户状态变更 |
| `commission` | 每分钟检查 | 计算并结算佣金 |

## 依赖关系

- 被 `server.js` 引用，通过 `/api/bases/:baseId/jobs/*` 端点暴露
- `grid.js` 被 `commissionJob.js` 和 `statusJob.js` 共用
- `diagnostics.js` 被 `/api/bases/:baseId/diagnostics` 端点调用
