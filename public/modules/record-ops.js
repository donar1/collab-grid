// modules/record-ops.js — 记录增删/封账/字段锁定重命名删除
(function() {
  'use strict';
  const { toast } = window;
  const { AppState: state } = window;
  const { api } = window;
  const { askConfirm } = window.CollabGridModal || {};
  const { AppGridRender } = window;
  const { AppAuth } = window;

  async function addRecord(tableId, count = 1) {
    try {
      for (let i = 0; i < count; i++) {
        await api('/api/tables/' + tableId + '/records', { method: 'POST', body: {} });
      }
      toast(`已添加 ${count} 行`);
    }
    catch (e) { toast(e.message, 'err'); }
    // 轻量刷新：只重新加载当前表格数据，不重载整个基地
    if (AppAuth) await AppAuth.loadTablePage(tableId, 0);
  }

  async function addMultipleRecords(tableId) {
    const { askText } = window.CollabGridModal || {};
    if (!askText) return addRecord(tableId);
    const n = await askText({ title: '添加多行', desc: '输入要添加的行数（1-100）', label: '行数', value: '10', placeholder: '例如：10' });
    if (!n) return;
    const count = parseInt(n, 10);
    if (!count || count < 1 || count > 100) { toast('请输入 1-100 之间的数字', 'err'); return; }
    await addRecord(tableId, count);
  }

  async function deleteRecord(id) {
    const ok = await askConfirm({
      title: '删除这一行？',
      desc: '删除后该行的单元格和关联关系也会一起删除。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    try { await api('/api/records/' + id, { method: 'DELETE' }); } catch (e) { toast(e.message, 'err'); }
  }

  async function toggleRecordLock(r) {
    try {
      await api('/api/records/' + r.id, { method: 'PATCH', body: { locked: !r.locked } });
      r.locked = !r.locked;
      AppGridRender.renderGrid();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function executeButton(f, r) {
    try {
      const opts = f.options || {};
      const action = opts.action || 'seal_record';
      // 封账按钮：根据当前锁定状态决定封账或解封
      let actualAction = action;
      if (action === 'seal_record') {
        actualAction = r.locked ? 'unseal_record' : 'seal_record';
      }
      const result = await api('/api/buttons/execute', { method: 'POST', body: { fieldId: f.id, recordId: r.id, action: actualAction } });
      r.locked = !!result.locked;
      toast(r.locked ? '已封账' : '已解封');
      AppGridRender.renderGrid();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function toggleLock(f) {
    try { await api('/api/fields/' + f.id + '/lock', { method: 'PATCH', body: { locked: !f.locked } }); }
    catch (e) { toast(e.message, 'err'); }
  }

  window.AppRecordOps = { addRecord, addMultipleRecords, deleteRecord, toggleRecordLock, executeButton, toggleLock };
})();
