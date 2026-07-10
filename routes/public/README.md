# routes/public/

V0.3.1 引入：**外部库**（`collab-grid-public.db`）相关的客户查询入口。

- `customerQuery.js` —— 颁发 / 撤销客户查询令牌；客户用 `X-Customer-Token`
  头访问 `/api/public/*`，只能读到 `public_customer_snapshot` 中本人的数据。
  所有外部访问都进 `public_access_log`。

外部库由 `publicDb.js` 独立维护，写入路径全部通过 `routes/public/*`
或内部任务的"快照同步函数"；任何内部业务表都不会通过外部 API 暴露。
