// security/permissions.js — 权限码 + 默认权限矩阵
// 权限码命名约定：domain.action
//   structure.*  表 / 字段 / 模板  结构层（建表、改字段、删表）
//   record.*     记录数据增删改
//   record.seal  封账 / 解封
//   approval.*   审批按钮（业务锁定/订单完成等）
//   inventory.*  库存出入库审批
//   finance.*    财务封账 / 红冲
//   jobs.*       任务调度（手动 run / 配置）
//   member.*     成员管理（邀请 / 改角色）
//   audit.read   审计日志查看
//   dashboard.read 数据大屏
//   diagnostics.read 诊断
//   matrix.write 权限矩阵自身（仅 sys_admin）
//   db.maintenance  底层数据库迁移 / 维护（仅 data_engineer / sys_admin）
//   customer.query  外部库客户查询（外部角色用）

const PERMISSIONS = [
  'structure.read',
  'structure.write',
  'record.read',
  'record.write',
  'record.seal',
  'approval.business_lock',
  'approval.order',
  'inventory.approve',
  'finance.seal',
  'finance.reversal',
  'jobs.read',
  'jobs.run',
  'jobs.config',
  'member.read',
  'member.invite',
  'member.role',
  'audit.read',
  'dashboard.read',
  'diagnostics.read',
  'matrix.read',
  'matrix.write',
  'db.maintenance',
  'customer.query',
];

const PERMISSION_LABELS = {
  'structure.read': '查看表结构',
  'structure.write': '建表 / 改字段 / 删表',
  'record.read': '查看记录',
  'record.write': '增删改记录',
  'record.seal': '封账 / 解封记录',
  'approval.business_lock': '业务锁定审批',
  'approval.order': '订单完成审批',
  'inventory.approve': '库存出入库审批',
  'finance.seal': '财务封账',
  'finance.reversal': '财务红冲 / 反向',
  'jobs.read': '查看任务运行',
  'jobs.run': '执行后台任务',
  'jobs.config': '修改任务配置 / 排程',
  'member.read': '查看成员',
  'member.invite': '邀请成员',
  'member.role': '修改成员角色',
  'audit.read': '查看审计日志',
  'dashboard.read': '查看数据大屏',
  'diagnostics.read': '查看诊断',
  'matrix.read': '查看权限矩阵',
  'matrix.write': '修改权限矩阵',
  'db.maintenance': '底层数据库维护',
  'customer.query': '客户查询（外部库）',
};

// 默认 base 角色矩阵
// 设计依据：
//   manager     = 管理（含财务）：除底层维护、权限矩阵改写、外部客户查询外，其余都能做
//   business    = 业务：读写记录、业务审批、订单审批；不动结构、不封账、不改成员
//   data_clerk  = 数据员（base 内）：能改记录与结构（用于数据修复），能跑任务，但不审批不封账
//   support     = 客服：只读，能查看大屏、审计、客户查询
//   warehouse   = 库管：能改库存相关记录、能做库存出入库审批
const DEFAULT_BASE_MATRIX = {
  manager: [
    'structure.read', 'structure.write',
    'record.read', 'record.write', 'record.seal',
    'approval.business_lock', 'approval.order',
    'inventory.approve',
    'finance.seal', 'finance.reversal',
    'jobs.read', 'jobs.run', 'jobs.config',
    'member.read', 'member.invite', 'member.role',
    'audit.read', 'dashboard.read', 'diagnostics.read',
    'matrix.read',
  ],
  business: [
    'structure.read',
    'record.read', 'record.write',
    'approval.business_lock', 'approval.order',
    'jobs.read',
    'member.read',
    'dashboard.read',
  ],
  data_clerk: [
    'structure.read', 'structure.write',
    'record.read', 'record.write',
    'jobs.read', 'jobs.run', 'jobs.config',
    'member.read',
    'audit.read', 'dashboard.read', 'diagnostics.read',
  ],
  support: [
    'structure.read',
    'record.read',
    'member.read',
    'audit.read', 'dashboard.read',
    'customer.query',
  ],
  warehouse: [
    'structure.read',
    'record.read', 'record.write',
    'inventory.approve',
    'jobs.read',
    'member.read',
    'dashboard.read',
  ],
};

// 系统级矩阵：sys_admin 拥有全部 + 矩阵写权限；data_engineer 拥有底层维护 + 数据修复必备
// 这些权限作用于"全部 base"，在 hasPermission 中以并集生效。
const DEFAULT_SYSTEM_MATRIX = {
  sys_admin: PERMISSIONS.slice(), // 全部
  data_engineer: [
    'structure.read', 'structure.write',
    'record.read', 'record.write',
    'jobs.read', 'jobs.run', 'jobs.config',
    'audit.read', 'diagnostics.read',
    'matrix.read',
    'db.maintenance',
  ],
  none: [],
};

// 外部角色矩阵（仅外部库使用）
const DEFAULT_EXTERNAL_MATRIX = {
  customer_query: ['customer.query'],
};

function listPermissions() {
  return PERMISSIONS.map(code => ({ code, label: PERMISSION_LABELS[code] || code }));
}

module.exports = {
  PERMISSIONS,
  PERMISSION_LABELS,
  DEFAULT_BASE_MATRIX,
  DEFAULT_SYSTEM_MATRIX,
  DEFAULT_EXTERNAL_MATRIX,
  listPermissions,
};
