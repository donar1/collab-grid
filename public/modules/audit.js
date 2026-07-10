// modules/audit.js — 审计日志加载与渲染
(function() {
  'use strict';
  const { el, toast } = window;
  const { AppState: state } = window;
  const { api, fmtTime } = window;

  async function loadAudit() {
    try {
      const r = await api('/api/bases/' + state.currentBaseId + '/audit');
      state.auditLogs = r.logs;
      renderAuditPanel();
    } catch (e) { toast(e.message, 'err'); }
  }

  function renderAuditPanel() {
    document.querySelector('.audit-panel')?.remove();
    const panel = el('aside', { class: 'audit-panel' });
    panel.appendChild(el('h3', {}, '操作日志'));
    if (!state.auditLogs.length) panel.appendChild(el('div', { style: { color: 'var(--muted)' } }, '还没有操作记录'));
    for (const log of state.auditLogs) {
      const summary = describe(log);
      panel.appendChild(el('div', { class: 'audit-item' },
        el('div', { class: 'who' }, log.display_name || log.user_id),
        el('div', { class: 'when' }, fmtTime(log.created_at)),
        el('div', { class: 'what' }, summary),
      ));
    }
    document.body.appendChild(panel);
  }

  function describe(log) {
    const p = log.payload || {};
    const map = {
      'base.create': () => `创建工作空间「${p.name}」`,
      'table.create': () => `新增数据表「${p.name}」`,
      'field.create': () => `添加字段「${p.name}」(${p.type})`,
      'field.lock': () => `${p.locked ? '锁定' : '解锁'}字段`,
      'field.rename': () => `重命名字段为「${p.name}」`,
      'field.update': () => p.options ? '更新字段选项' : `更新字段「${p.name || ''}」`,
      'field.delete': () => `删除字段「${p.name || ''}」`,
      'record.create': () => '新增一行',
      'record.delete': () => '删除一行',
      'cell.update': () => `更新单元格值为「${p.value ?? ''}」`,
      'link.create': () => '建立关联',
      'link.delete': () => '取消关联',
      'member.join': () => '加入工作空间',
    };
    return (map[log.action] || (() => log.action))();
  }

  window.AppAudit = { loadAudit, renderAuditPanel };
})();
