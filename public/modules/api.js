// modules/api.js — API 客户端（含路径常量）

const API = {
  csrf: '/api/csrf-token',
  register: '/api/register',
  login: '/api/login',
  logout: '/api/auth/logout',
  refresh: '/api/auth/refresh',
  changePassword: '/api/auth/change-password',
  me: '/api/me',
  systemBusinessRelations: '/api/system/business-relations',

  bases: '/api/bases',
  base: (id) => `/api/bases/${id}`,
  baseRename: (id) => `/api/bases/${id}`,
  baseDelete: (id) => `/api/bases/${id}`,
  baseTables: (id) => `/api/bases/${id}/tables`,
  baseInvites: (id) => `/api/bases/${id}/invites`,
  baseAudit: (id) => `/api/bases/${id}/audit`,
  baseDashboardSummary: (id) => `/api/bases/${id}/dashboard/summary`,
  baseJobConfigs: (id) => `/api/bases/${id}/jobs/configs`,
  baseJobConfig: (baseId, jobKey) => `/api/bases/${baseId}/jobs/configs/${jobKey}`,
  baseJobRun: (baseId, jobKey) => `/api/bases/${baseId}/jobs/${jobKey}/run`,
  baseJobRuns: (id) => `/api/bases/${id}/jobs/runs`,
  baseJobRunDetail: (baseId, runId) => `/api/bases/${baseId}/jobs/runs/${runId}`,
  baseDiagnostics: (id) => `/api/bases/${id}/diagnostics`,
  baseTemplateBusinessCore: (id) => `/api/bases/${id}/templates/business-core`,

  tables: '/api/tables',
  table: (id) => `/api/tables/${id}`,
  tableRecords: (id) => `/api/tables/${id}/records`,
  tableFields: (id) => `/api/tables/${id}/fields`,
  tablePosition: (id) => `/api/tables/${id}/position`,
  tableVisibility: (id) => `/api/tables/${id}/visibility`,
  tablePermissions: (baseId, tableId) => `/api/bases/${baseId}/tables/${tableId}/permissions`,
  baseTablePermissions: (baseId) => `/api/bases/${baseId}/tables/permissions`,

  records: '/api/records',
  record: (id) => `/api/records/${id}`,
  recordLock: (id) => `/api/records/${id}/lock`,

  fields: '/api/fields',
  field: (id) => `/api/fields/${id}`,
  fieldLock: (id) => `/api/fields/${id}/lock`,

  cells: '/api/cells',
  cell: (id) => `/api/cells/${id}`,

  links: '/api/links',
  link: (id) => `/api/links/${id}`,

  buttonsExecute: '/api/buttons/execute',

  batch: '/api/batch',

  inviteAccept: (token) => `/api/invites/${token}/accept`,
  memberRole: (baseId, userId) => `/api/bases/${baseId}/members/${userId}`,

  attachments: '/api/attachments',
  attachmentUpload: '/api/attachments/upload',
  attachment: (id) => `/api/attachments/${id}`,

  customers: '/api/customers',
  customer: (id) => `/api/customers/${id}`,
  customerOrders: (id) => `/api/customers/${id}/orders`,

  products: '/api/products',
  product: (id) => `/api/products/${id}`,

  orders: '/api/orders',
  order: (id) => `/api/orders/${id}`,
  orderStatus: (id) => `/api/orders/${id}/status`,
  orderCancel: (id) => `/api/orders/${id}/cancel`,
  orderRefund: (id) => `/api/orders/${id}/refund`,
  orderRed: (id) => `/api/orders/${id}/red`,
  orderReconciliation: (id) => `/api/orders/${id}/reconciliation`,
  orderTracking: (id) => `/api/orders/${id}/tracking`,
  orderLayout: (id) => `/api/orders/${id}/layout`,

  inventory: '/api/inventory',
  inventoryApprove: (id) => `/api/inventory/${id}/approve`,

  bills: '/api/bills',
  bill: (id) => `/api/bills/${id}`,
  billSeal: (id) => `/api/bills/${id}/seal`,
  billReverse: (id) => `/api/bills/${id}/reverse`,

  securityMatrix: '/api/security/matrix',
  securityMatrixBase: (baseId) => `/api/security/matrix/${baseId}`,
  securityMatrixBaseUser: (baseId, userId) => `/api/security/matrix/${baseId}/${userId}`,

  users: '/api/users',
  userSystemRole: (userId) => `/api/security/users/${userId}/system-role`,

  publicQuery: '/api/public/query',
  publicDashboard: '/api/public/dashboard',
};

async function fetchCsrfToken() {
  try {
    const r = await fetch(API.csrf, { credentials: 'same-origin' });
    const data = await r.json();
    if (data.csrfToken) AppState.csrfToken = data.csrfToken;
  } catch { /* noop */ }
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.method && opts.method !== 'GET' && opts.method !== 'HEAD' && AppState.csrfToken) {
    headers['X-CSRF-Token'] = AppState.csrfToken;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 30000);
  try {
    const r = await fetch(path, {
      ...opts,
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || ('HTTP ' + r.status));
      err.status = r.status;
      err.body = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

window.API = API;
window.api = api;
window.fetchCsrfToken = fetchCsrfToken;
