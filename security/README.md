# security/

V0.3.1 引入的安全/权限层，统一管理：

- `roles.js` —— 系统级角色（sys_admin / data_engineer / none）、Base 级角色
  （manager / business / data_clerk / support / warehouse）、外部角色
  （customer_query），以及旧角色（owner/admin/approver/finance/editor/viewer）的兼容映射。
- `permissions.js` —— 权限码常量、权限码 → 中文标签映射、各角色默认权限矩阵。
- `matrixStore.js` —— `permission_overrides` 表与有效权限合并逻辑：
  默认矩阵 + 系统级覆盖 + 外部覆盖 + base 级覆盖（显式拒绝优先于授权）。
- `guards.js` —— 注入 db 后产出与旧 `server.js` 中
  `can*`、`isMember`、`getRole` 接口兼容的函数，使路由层零侵入升级。

调用约定：`server.js` 启动时 `require('./security/matrixStore').ensureSchema(db)`，
然后 `const security = buildSecurity(db)`，把 `security.canXxx / isMember / getRole`
透传到 `gridRouteContext / coreRouteContext` 即可。

新增 HTTP 入口（见 `routes/security/matrix.js`）：

- `GET  /api/security/permissions`               列权限码（带中文标签），任何登录用户可读
- `GET  /api/security/matrix`                    查看当前矩阵（系统/外部/全部 base）
- `GET  /api/bases/:baseId/security/matrix`      查看某 base 的矩阵 + 我自己的有效权限
- `PUT  /api/security/matrix`                    sys_admin 批量改写（系统/外部/全局 base）
- `PUT  /api/bases/:baseId/security/matrix`      sys_admin 或 base manager 改写该 base
- `GET  /api/security/me`                        当前用户在每个 base 的有效权限聚合
