// modules/clipboard-ops.js — 复制/粘贴功能
(function() {
  'use strict';
  const { toast } = window;
  const { AppState: state } = window;
  const { api } = window;
  const ClipboardTools = window.CollabGridClipboard;
  const { AppGridRender } = window;
  const { AppAuth } = window;

  function isInsideModal(node) {
    return !!node?.closest?.('.modal-mask, .modal');
  }

  function isInsideGrid(node) {
    return !!node?.closest?.('.grid-wrap');
  }

  function shouldHandleTableClipboard(event) {
    if (!state.base || !AppGridRender.getActiveTable()) return false;
    if (isInsideModal(event.target)) return false;
    return !!state.selection || isInsideGrid(event.target) || event.type === 'paste';
  }

  function resolveSelectOption(text, field) {
    const values = field.options?.values || [];
    const options = values.map(v => {
      const label = typeof v === 'object' ? String(v?.label || '').trim() : String(v || '').trim();
      return { label };
    }).filter(o => o.label);
    const trimmed = text.trim();
    if (!trimmed) return { label: '', matched: true };
    let match = options.find(o => o.label.toLowerCase() === trimmed.toLowerCase());
    if (match) return { label: match.label, matched: true };
    match = options.find(o => o.label.toLowerCase().includes(trimmed.toLowerCase()) || trimmed.toLowerCase().includes(o.label.toLowerCase()));
    if (match) return { label: match.label, matched: true };
    const aliasMap = window.CG_SELECT_ALIASES || {};
    const aliased = aliasMap[trimmed];
    if (aliased) {
      match = options.find(o => o.label === aliased);
      if (match) return { label: match.label, matched: true };
    }
    return { label: text, matched: false };
  }

  async function copySelectionToClipboard(event) {
    const sel = state.selection;
    if (!sel) return false;
    const range = AppGridRender.selectionRange(sel);
    const t = AppGridRender.getActiveTable();
    if (!t) return false;
    const records = state.visibleRecords.length ? state.visibleRecords : t.records;
    const fields = state.visibleFields.length ? state.visibleFields : t.fields;
    const lines = [];
    for (let r = range.r1; r <= range.r2; r++) {
      const rec = records[r];
      if (!rec) continue;
      const cols = [];
      for (let c = range.c1; c <= range.c2; c++) {
        const f = fields[c];
        if (!f) continue;
        let v = AppGridRender.readDisplayValue(t, rec, f);
        cols.push(ClipboardTools.sanitizeCellForTsv(v));
      }
      lines.push(cols.join('\t'));
    }
    const text = lines.join('\n');
    try {
      if (event?.clipboardData) {
        event.clipboardData.setData('text/plain', text);
      } else {
        // 优先使用 execCommand（同步、无需权限），避免 navigator.clipboard 在部分环境下 pending
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;display:none;';
        document.body.appendChild(ta);
        let ok = false;
        try { ta.select(); ok = document.execCommand('copy'); }
        finally { ta.remove(); }
        if (!ok) throw new Error('execCommand copy failed');
      }
      const cells = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
      toast(`已复制 ${cells} 格到剪贴板`);
      return true;
    } catch (e) {
      toast('复制失败：' + e.message, 'err');
      return false;
    }
  }

  async function pasteIntoSelection(text, mode = 'selection') {
    const t = AppGridRender.getActiveTable();
    if (!t) return false;
    const rows = ClipboardTools.parseClipboardTable(text);
    if (!rows.length) return false;
    const useAppend = mode === 'append' || state.pasteAppendMode;
    const sel = useAppend ? null : state.selection;
    const records = state.visibleRecords.length ? state.visibleRecords : t.records;
    const fields = state.visibleFields.length ? state.visibleFields : t.fields;
    const startRow = sel ? AppGridRender.selectionRange(sel).r1 : t.records.length;
    const startCol = sel ? AppGridRender.selectionRange(sel).c1 : 0;
    let written = 0;
    let failed = 0;
    let createdRows = 0;
    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let rec = sel ? records[startRow + i] : t.records[startRow + i];
        if (!rec) {
          const created = await api('/api/tables/' + t.id + '/records', { method: 'POST', body: {} });
          rec = t.records.find(rr => rr.id === created.id);
          if (!rec) {
            rec = { id: created.id, table_id: t.id, height: 34, position: t.records.length, created_at: Date.now() };
            t.records.push(rec);
          }
          createdRows++;
        }
        for (let j = 0; j < row.length; j++) {
          const f = fields[startCol + j];
          if (!f) continue;
          if (f.locked || ['link', 'lookup', 'autoNumber', 'formula', 'textFormula', 'button', 'createdTime', 'lastModifiedTime', 'lastModifiedBy'].includes(f.type)) continue;
          if (f.type === 'select') {
            const resolved = resolveSelectOption(row[j], f);
            if (row[j] && !resolved.matched) { failed++; continue; }
            row[j] = resolved.label;
          }
          try {
            const ver = window.AppCellEdit && window.AppCellEdit.getCellVersion ? window.AppCellEdit.getCellVersion(rec.id, f.id) : undefined;
            await api(`/api/records/${rec.id}/cells/${f.id}`, { method: 'PUT', body: { value: row[j] || '', version: ver } });
            written++;
          } catch (e) { failed++; }
        }
      }
      await AppAuth.openBase(state.currentBaseId, t.id);
      state.pasteAppendMode = false;
      const parts = [`已粘贴 ${written} 格`];
      if (createdRows) parts.push(`新增 ${createdRows} 行`);
      if (failed) parts.push(`${failed} 格失败`);
      toast(parts.join('，'), failed ? 'warn' : undefined);
      return true;
    } catch (err) {
      await AppAuth.openBase(state.currentBaseId, t.id);
      state.pasteAppendMode = false;
      toast('批量粘贴部分失败：' + err.message, 'err');
      return false;
    }
  }

  async function handleDocumentCopy(event) {
    if (!shouldHandleTableClipboard(event) || !state.selection) return;
    // 编辑模式下让浏览器默认处理（input 内文字选中复制）
    if (state.editingCell) return;
    event.preventDefault();
    event.stopPropagation();
    await copySelectionToClipboard(event);
  }

  async function handleDocumentPaste(event) {
    if (!shouldHandleTableClipboard(event)) return;
    // 编辑模式下让浏览器默认处理（input 内粘贴）
    if (state.editingCell) return;
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text.trim()) return;
    event.preventDefault();
    event.stopPropagation();
    const appendMode = state.pasteAppendMode || !!event.target?.closest?.('.add-row');
    await pasteIntoSelection(text, appendMode ? 'append' : 'selection');
  }

  async function handleGridPaste(e) {
    if (state.editingCell) return; // 编辑模式让浏览器默认处理
    const text = e.clipboardData?.getData('text/plain') || '';
    if (!text.trim()) return;
    const table = AppGridRender.getActiveTable();
    if (!table) return;
    e.preventDefault();
    await pasteIntoSelection(text);
  }

  async function handleGridCopy(e) {
    if (state.editingCell) return; // 编辑模式让浏览器默认处理
    if (!state.selection) return;
    e.preventDefault();
    await copySelectionToClipboard(e);
  }

  window.AppClipboardOps = {
    copySelectionToClipboard, pasteIntoSelection,
    handleDocumentCopy, handleDocumentPaste, handleGridPaste, handleGridCopy
  };
})();
