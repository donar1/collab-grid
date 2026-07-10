const Joi = require('joi');
const config = require('../config');

// 通用
const idSchema = Joi.string().length(21).pattern(/^[a-zA-Z0-9_-]+$/);
const nanoidSchema = Joi.string().min(1).max(21).pattern(/^[a-zA-Z0-9_-]+$/);

// Email: 开发模式下允许 .local 等非标准域名
const emailField = config.isProduction
  ? Joi.string().email().required()
  : Joi.string().pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).required().messages({ 'string.pattern.base': '{{#label}} must be a valid email' });

// Auth
const registerSchema = Joi.object({
  email: emailField,
  password: Joi.string().min(12).max(128).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).+$/, '密码必须包含大写字母、小写字母、数字和特殊字符(!@#$%^&*)，至少12位').required(),
  displayName: Joi.string().min(1).max(100).required(),
});
const loginSchema = Joi.object({
  email: emailField,
  password: Joi.string().min(1).max(128).required(),
});
const changePasswordSchema = Joi.object({
  oldPassword: Joi.string().min(1).max(128).required(),
  newPassword: Joi.string().min(12).max(128).pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).+$/, '密码必须包含大写字母、小写字母、数字和特殊字符(!@#$%^&*)，至少12位').required(),
});

// Base
const createBaseSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
});
const renameBaseSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
});

// Table
const FIELD_TYPES = ['text','multiLineText','number','currency','checkbox','singleSelect','multiSelect','select','date','link','lookup','formula','textFormula','autoNumber','createdTime','lastModifiedTime','lastModifiedBy','attachment','button'];
const createTableSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
});
const createFieldSchema = Joi.object({
  name: Joi.string().min(1).max(200).required(),
  type: Joi.string().valid(...FIELD_TYPES).required(),
  options: Joi.object().allow(null),
});
const updateFieldSchema = Joi.object({
  name: Joi.string().min(1).max(200),
  type: Joi.string().valid(...FIELD_TYPES),
  options: Joi.object(),
  width: Joi.number().integer().min(60).max(600),
});

// Record
const createRecordSchema = Joi.object({
  cells: Joi.object().min(0).max(500).pattern(Joi.string().pattern(/^[a-z0-9_-]{1,50}$/i).required().messages({ 'string.pattern.base': 'fieldId 格式无效' }), Joi.string().allow('')),
});

// Cell
const updateCellSchema = Joi.object({
  value: Joi.string().allow(null, ''),
  linkRecordId: Joi.string().allow(null),
});

// Link
const createLinkSchema = Joi.object({
  fromRecordId: idSchema.required(),
  toRecordId: idSchema.required(),
  fieldId: idSchema.required(),
});

// Batch
const batchUpdateSchema = Joi.object({
  updates: Joi.array().items(Joi.object({
    type: Joi.string().valid('cell.update').required(),
    recordId: idSchema.required(),
    fieldId: idSchema.required(),
    value: Joi.string().allow(null, ''),
  })).min(1).max(500).required(),
});

// Button execute
const executeButtonSchema = Joi.object({
  fieldId: idSchema.required(),
  recordId: idSchema.required(),
  action: Joi.string().valid('seal_record', 'unseal_record', 'approve_resource', 'approve_business_lock', 'approve_inventory_operation', 'approve_order_refund', 'approve_order_cancel', 'approve_finance_reversal'),
});

// Member role
const updateRoleSchema = Joi.object({
  role: Joi.string().valid('owner','manager','business','data_clerk','support','warehouse').required(),
});

// Invite
const createInviteSchema = Joi.object({
  email: emailField,
  role: Joi.string().valid('manager','business','data_clerk','support','warehouse').required(),
});

// Job config
const updateJobConfigSchema = Joi.object({
  enabled: Joi.boolean(),
  dry_run: Joi.boolean(),
  batch_size: Joi.number().integer().min(1).max(10000),
  max_runtime_ms: Joi.number().integer().min(1000).max(600000),
  config_json: Joi.string().allow(null),
  schedule_enabled: Joi.boolean(),
  schedule_time: Joi.string().pattern(/^([01]\d|2[0-3]):([0-5]\d)$/).allow(null),
  schedule_business_date_mode: Joi.string().valid('today','yesterday').allow(null),
});

module.exports = {
  idSchema,
  nanoidSchema,
  registerSchema,
  loginSchema,
  changePasswordSchema,
  createBaseSchema,
  renameBaseSchema,
  createTableSchema,
  createFieldSchema,
  updateFieldSchema,
  createRecordSchema,
  updateCellSchema,
  createLinkSchema,
  batchUpdateSchema,
  executeButtonSchema,
  updateRoleSchema,
  createInviteSchema,
  updateJobConfigSchema,
};
