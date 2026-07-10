// 第一层：表格/操作界面通用能力边界
// 这一层只关心“表格如何被操作”，不关心产品、客户、订单、账单、库存的业务含义。

const FIELD_TYPES = Object.freeze([
  'text',
  'multiLineText',
  'number',
  'select',
  'date',
  'link',
  'lookup',
  'autoNumber',
  'formula',
  'textFormula',
  'currency',
  'button',
  'createdTime',
  'lastModifiedTime',
  'lastModifiedBy',
  'checkbox',
  'attachment',
]);

const READONLY_FIELD_TYPES = new Set([
  'lookup',
  'autoNumber',
  'formula',
  'textFormula',
  'button',
  'createdTime',
  'lastModifiedTime',
  'lastModifiedBy',
]);

const TABLE_LAYER_MODULES = Object.freeze({
  auth: '登录、注册、当前用户、成员身份识别',
  bases: '空间创建、空间读取、成员角色',
  tables: '表结构创建、字段创建、字段选项与锁定',
  records: '记录增删改、封账状态',
  cells: '单元格写入、样式、只读字段保护',
  links: '关联字段、反向关系、lookup 快照',
  buttons: '按钮 action 分发与权限校验',
  batch: '批量 cell.update 操作',
  realtime: 'Socket.IO 实时同步事件',
});

function isReadonlyFieldType(type) {
  return READONLY_FIELD_TYPES.has(type);
}

function isSupportedFieldType(type) {
  return FIELD_TYPES.includes(type);
}

module.exports = {
  FIELD_TYPES,
  READONLY_FIELD_TYPES,
  TABLE_LAYER_MODULES,
  isReadonlyFieldType,
  isSupportedFieldType,
};
