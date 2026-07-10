// modules/socket.js — WebSocket 连接管理 + 事件监听
(function() {
  'use strict';
  const { toast } = window;
  const { AppState: state } = window;

  function flashCell(recordId, fieldId) {
    const cell = document.querySelector(`td[data-record="${recordId}"][data-field="${fieldId}"]`);
    if (!cell) return;
    cell.style.transition = 'background-color .8s';
    cell.style.backgroundColor = '#fff8e1';
    setTimeout(() => cell.style.backgroundColor = '', 800);
  }

  function connectSocket(baseId) {
    if (state.socket) { state.socket.disconnect(); state.socket = null; }
    const s = io({ withCredentials: true });
    state.socket = s;
    s.on('connect', () => s.emit('base:join', baseId));
    s.on('connect_error', (e) => toast('实时连接失败：' + e.message, 'err'));

    s.on('cell:update', (p) => {
      if (!state.base) return;
      for (const t of state.base.tables) {
        const r = t.records.find(r => r.id === p.recordId);
        if (!r) continue;
        const idx = t.cells.findIndex(c => c.record_id === p.recordId && c.field_id === p.fieldId);
        const previous = idx >= 0 ? t.cells[idx] : {};
        const cell = {
          ...previous,
          record_id: p.recordId,
          field_id: p.fieldId,
          value: p.value !== undefined ? p.value : previous.value,
          style_json: p.style_json !== undefined ? p.style_json : previous.style_json,
          updated_at: p.updatedAt,
          updated_by: p.updatedBy,
          version: p.version || previous.version || 1
        };
        if (idx >= 0) t.cells[idx] = cell; else t.cells.push(cell);
        flashCell(p.recordId, p.fieldId);
        // AG Grid mode: update cell via API instead of full re-render
        const { AppGridRender } = window;
        if (AppGridRender?.gridApi) {
          const rowNode = AppGridRender.gridApi.getRowNode(p.recordId);
          if (rowNode) {
            rowNode.setDataValue(p.fieldId, p.value);
            return;
          }
        }
        if (AppGridRender) AppGridRender.renderGrid();
        return;
      }
    });
    s.on('field:add', (p) => {
      const t = state.base.tables.find(t => t.id === p.tableId);
      if (!t) return;
      if (!t.fields.find(f => f.id === p.id)) t.fields.push({ id: p.id, table_id: p.tableId, name: p.name, type: p.type, options: p.options, locked: false, position: p.position });
      const { AppGridRender } = window;
      if (AppGridRender) AppGridRender.renderGrid();
    });
    s.on('field:lock', (p) => {
      for (const t of state.base.tables) {
        const f = t.fields.find(f => f.id === p.fieldId);
        if (f) { f.locked = p.locked; const { AppGridRender } = window; if (AppGridRender) AppGridRender.renderGrid(); return; }
      }
    });
    s.on('field:update', (p) => {
      for (const t of state.base.tables) {
        const f = t.fields.find(f => f.id === p.fieldId);
        if (f) {
          if (p.name) f.name = p.name;
          if (p.options !== undefined) f.options = p.options;
          if (p.width !== undefined) f.width = p.width;
          if (p.position !== undefined) {
            f.position = p.position;
            t.fields.sort((a, b) => (a.position || 0) - (b.position || 0));
          }
          const { AppGridRender } = window; if (AppGridRender) AppGridRender.renderGrid(); return;
        }
      }
    });
    s.on('field:delete', (p) => {
      for (const t of state.base.tables) {
        const idx = t.fields.findIndex(f => f.id === p.fieldId);
        if (idx >= 0) {
          t.fields.splice(idx, 1);
          t.cells = t.cells.filter(c => c.field_id !== p.fieldId);
          t.links = t.links.filter(l => l.field_id !== p.fieldId);
          const { AppGridRender } = window; if (AppGridRender) AppGridRender.renderGrid(); return;
        }
      }
    });
    s.on('record:add', (p) => {
      const t = state.base.tables.find(t => t.id === p.tableId);
      if (!t) return;
      if (!t.records.find(r => r.id === p.id)) t.records.push({ id: p.id, table_id: p.tableId, height: p.height || 34, locked: !!p.locked, position: p.position, created_at: Date.now() });
      const { AppGridRender } = window; if (AppGridRender) AppGridRender.renderGrid();
    });
    s.on('record:update', (p) => {
      for (const t of state.base.tables) {
        const r = t.records.find(r => r.id === p.recordId);
        if (r) {
          if (p.height !== undefined) r.height = p.height;
          if (p.locked !== undefined) r.locked = !!p.locked;
          const { AppGridRender } = window; if (AppGridRender) AppGridRender.renderGrid(); return;
        }
      }
    });
    s.on('record:delete', (p) => {
      for (const t of state.base.tables) {
        const idx = t.records.findIndex(r => r.id === p.recordId);
        if (idx >= 0) { t.records.splice(idx, 1); const { AppGridRender } = window; if (AppGridRender) AppGridRender.renderGrid(); return; }
      }
    });
    s.on('table:add', (p) => {
      if (!state.base.tables.find(t => t.id === p.id)) state.base.tables.push({ id: p.id, name: p.name, fields: [], records: [], cells: [], links: [] });
      const { AppShell } = window; if (AppShell) AppShell.renderShell();
    });
    s.on('base:rename', (p) => {
      const b = state.bases.find(b => b.id === p.baseId);
      if (b) b.name = p.name;
      if (state.base?.id === p.baseId) state.base.name = p.name;
      const { AppShell } = window; if (AppShell) AppShell.renderShell();
    });
    s.on('base:delete', async (p) => {
      const { AppAuth } = window;
      const { AppShell } = window;
      if (state.currentBaseId !== p.baseId) {
        state.bases = state.bases.filter(b => b.id !== p.baseId);
        if (AppShell) AppShell.renderShell();
        return;
      }
      toast(`工作空间「${p.name}」已删除`, 'warn');
      state.base = null;
      state.currentBaseId = null;
      state.activeTableId = null;
      if (AppAuth) await AppAuth.loadBases();
      if (state.bases.length) {
        if (AppAuth) await AppAuth.openBase(state.bases[0].id);
      } else {
        if (AppShell) AppShell.renderShell();
      }
    });
    s.on('link:add', (p) => {
      for (const t of state.base.tables) {
        if (t.records.find(r => r.id === p.fromRecordId)) {
          if (!t.links.find(l => l.id === p.id)) t.links.push({ id: p.id, field_id: p.fieldId, from_record_id: p.fromRecordId, to_record_id: p.toRecordId });
          const { AppGridRender } = window; if (AppGridRender) AppGridRender.renderGrid(); return;
        }
      }
    });
    s.on('link:delete', (p) => {
      for (const t of state.base.tables) {
        const idx = t.links.findIndex(l => l.id === p.id);
        if (idx >= 0) { t.links.splice(idx, 1); const { AppGridRender } = window; if (AppGridRender) AppGridRender.renderGrid(); return; }
      }
    });
    s.on('presence:join', (p) => { state.presence.set(p.userId, p.userId); const { AppShell } = window; if (AppShell) AppShell.renderTopbar(); });
    s.on('presence:leave', (p) => { state.presence.delete(p.userId); const { AppShell } = window; if (AppShell) AppShell.renderTopbar(); });
    s.on('member:join', () => { /* refresh members */ const { AppAuth } = window; if (AppAuth) AppAuth.openBase(state.currentBaseId); });
    s.on('member:role', () => { const { AppAuth } = window; if (AppAuth) AppAuth.openBase(state.currentBaseId); });
    /* 实时通知推送：替代前端 60s 轮询 */
    s.on('notification:new', () => {
      const { AppShell } = window;
      if (AppShell && AppShell.loadNotifications) AppShell.loadNotifications();
    });
  }

  window.AppSocket = { connectSocket, flashCell };
})();
