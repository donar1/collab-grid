// modules/state.js — 全局状态
const AppState = {
  me: null,
  bases: [],
  currentBaseId: null,
  base: null,
  activeTableId: null,
  socket: null,
  presence: new Map(),
  showAudit: false,
  auditLogs: [],
  pendingInvite: null,
  selection: null,
  dragSelecting: false,
  pasteAppendMode: false,
  editingCell: null,
  tableViews: {},
  visibleRecords: [],
  visibleFields: [],
  csrfToken: '',
};

// 挂载到 window，供 IIFE 模块通过 const { AppState: state } = window; 解构使用
window.AppState = AppState;
