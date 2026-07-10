// modules/grid/clipboard.js — 复制粘贴模块（基于玄同 demo，2026-07-08）
// 依赖：state.selection（anchor/focus 的 row/col 索引）
//       window.api, window.API, window.AppState
//       grid DOM 结构：td[data-record][data-field]

(() => {
  const { api, API, AppState: state } = window;

  const READONLY_TYPES = new Set(['link', 'formula', 'lookup']);
  const MAX_BATCH = 500;

  // ── select 字段选项解析 ──
  function getSelectOptions(field) {
    const FieldTools = window.CollabGridFields;
    const normalize = FieldTools?.normalizeSelectOption || ((o) => {
      const label = typeof o === 'object' ? String(o?.label || '').trim() : String(o || '').trim();
      const color = typeof o === 'object' && /^#[0-9a-fA-F]{6}$/.test(o?.color || '') ? o.color : '#64748b';
      return { label, color };
    });
    return (field?.options?.values || []).map(normalize).filter(o => o.label);
  }

  function resolveSelectOption(text, field) {
    const options = getSelectOptions(field);
    const trimmed = text.trim();
    if (!trimmed) return { label: '', matched: true };

    // 1. 精确匹配（忽略大小写、去首尾空格）
    let match = options.find(o => o.label.trim().toLowerCase() === trimmed.toLowerCase());
    if (match) return { label: match.label, matched: true };

    // 2. 包含匹配
    match = options.find(o =>
      o.label.toLowerCase().includes(trimmed.toLowerCase()) ||
      trimmed.toLowerCase().includes(o.label.toLowerCase())
    );
    if (match) return { label: match.label, matched: true };

    // 3. 别名映射（全局可配置）
    const aliasMap = window.CG_SELECT_ALIASES || {};
    const aliased = aliasMap[trimmed];
    if (aliased) {
      match = options.find(o => o.label === aliased);
      if (match) return { label: match.label, matched: true };
    }

    return { label: text, matched: false };
  }

  // ── 选区范围 ──
  function getSelectionRange() {
    const sel = state.selection;
    if (!sel || sel.anchor.row === undefined || sel.anchor.col === undefined) return null;
    const r1 = Math.min(sel.anchor.row, sel.focus.row);
    const r2 = Math.max(sel.anchor.row, sel.focus.row);
    const c1 = Math.min(sel.anchor.col, sel.focus.col);
    const c2 = Math.max(sel.anchor.col, sel.focus.col);
    return { r1, r2, c1, c2 };
  }

  function getActiveTable() {
    const t = window.AppGridRender?.getActiveTable?.();
    return t;
  }

  // ── TSV 文本生成 ──
  function getSelectionTSV() {
    const range = getSelectionRange();
    if (!range) return '';
    const t = getActiveTable();
    if (!t) return '';
    const { r1, r2, c1, c2 } = range;
    const rows = [];
    for (let r = r1; r <= r2; r++) {
      const rec = t.records[r];
      if (!rec) continue;
      const cols = [];
      for (let c = c1; c <= c2; c++) {
        const f = t.fields[c];
        if (!f) continue;
        const cell = findCell(rec.id, f.id);
        const val = cell ? (cell.value ?? '') : '';
        cols.push(tsvEscape(String(val)));
      }
      if (cols.length) rows.push(cols.join('\t'));
    }
    return rows.join('\n');
  }

  function tsvEscape(s) {
    if (s.includes('\t') || s.includes('\n') || s.includes('"')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function findCell(recordId, fieldId) {
    const t = getActiveTable();
    if (!t) return null;
    const cells = t.cells || [];
    return cells.find(c => c.record_id === recordId && c.field_id === fieldId);
  }

  // ── 剪贴板适配（Electron 用原生 clipboard API，浏览器用 navigator.clipboard） ──
  function clipReadText() {
    if (window.electron?.clipboard) return window.electron.clipboard.readText();
    return navigator.clipboard.readText();
  }
  function clipWriteText(text) {
    if (window.electron?.clipboard) return window.electron.clipboard.writeText(text);
    return navigator.clipboard.writeText(text);
  }

  // ── 复制 ──
  async function copy() {
    const text = getSelectionTSV();
    if (!text) return;
    try {
      await clipWriteText(text);
      window.toast?.('已复制到剪贴板');
    } catch (e) {
      // 降级：textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); window.toast?.('已复制到剪贴板'); }
      catch (e2) { window.toast?.('复制失败', 'err'); }
      ta.remove();
    }
  }

  // ── 粘贴 ──
  async function paste() {
    const range = getSelectionRange();
    if (!range) return;
    let text = '';
    try {
      text = await clipReadText();
    } catch (e) {
      // 降级：hidden contenteditable div
      text = await pasteViaHiddenDiv();
    }
    if (!text || !text.trim()) return;
    await pasteIntoSelection(text);
  }

  async function pasteViaHiddenDiv() {
    return new Promise((resolve) => {
      const div = document.getElementById('clipboard-paste-target');
      if (!div) { resolve(''); return; }
      div.focus();
      div.textContent = '';
      const timer = setTimeout(() => { resolve(div.textContent || ''); }, 100);
      const onPaste = (e) => {
        clearTimeout(timer);
        const t = e.clipboardData?.getData('text/plain') || '';
        div.removeEventListener('paste', onPaste);
        div.textContent = '';
        resolve(t);
      };
      div.addEventListener('paste', onPaste);
      document.execCommand('paste');
    });
  }

  async function pasteIntoSelection(text) {
    const t = getActiveTable();
    if (!t) return;
    const range = getSelectionRange();
    if (!range) return;
    const rows = text.split(/\r?\n/).filter(r => r.trim() !== '' || r === '');
    // 重新解析：允许空行
    const parsedRows = text.split(/\r?\n/).map(r => {
      // 处理 TSV 引号转义
      const cells = [];
      let cell = '';
      let inQuote = false;
      for (let i = 0; i < r.length; i++) {
        const ch = r[i];
        if (inQuote) {
          if (ch === '"') {
            if (r[i + 1] === '"') { cell += '"'; i++; }
            else { inQuote = false; }
          } else { cell += ch; }
        } else {
          if (ch === '"') { inQuote = true; }
          else if (ch === '\t') { cells.push(cell); cell = ''; }
          else { cell += ch; }
        }
      }
      cells.push(cell);
      return cells;
    }).filter(r => r.some(c => c.trim() !== ''));

    if (!parsedRows.length) return;

    const startRow = range.r1;
    const startCol = range.c1;
    const pasteRows = parsedRows.length;
    const pasteCols = Math.max(...parsedRows.map(r => r.length));
    const totalRecords = t.records?.length || 0;
    const totalFields = t.fields?.length || 0;

    // 网格限制：粘贴区域不能超出字段数
    const effectiveCols = Math.min(pasteCols, totalFields - startCol);
    if (effectiveCols <= 0) return;

    // 如果行数不够，先扩表
    const neededRows = startRow + pasteRows;
    if (neededRows > totalRecords) {
      const addCount = neededRows - totalRecords;
      try {
        await api(API.tableRecords(t.id), { method: 'POST', body: { count: addCount } });
        // 刷新表数据以获取新的 records
        if (window.AppAuth?.openBase) {
          await window.AppAuth.openBase(state.currentBaseId, t.id);
        }
      } catch (e) {
        window.toast?.('扩表失败：' + e.message, 'err');
        return;
      }
    }

    // 重新获取表数据（因为扩表后 records 可能变了）
    const t2 = getActiveTable();
    if (!t2) return;

    // 构建批量更新
    const updates = [];
    const failedItems = [];
    for (let dr = 0; dr < pasteRows; dr++) {
      const targetRow = startRow + dr;
      if (targetRow >= t2.records.length) break;
      const rec = t2.records[targetRow];
      if (!rec) continue;
      for (let dc = 0; dc < effectiveCols; dc++) {
        const targetCol = startCol + dc;
        if (targetCol >= t2.fields.length) break;
        const f = t2.fields[targetCol];
        if (!f) continue;
        // 跳过只读字段类型
        if (READONLY_TYPES.has(f.type)) continue;
        const rawVal = (parsedRows[dr] || [])[dc];
        if (rawVal === undefined || rawVal === null) continue;
        let val = rawVal;
        // select 字段：文本 → 选项映射
        if (f.type === 'select') {
          const resolved = resolveSelectOption(rawVal, f);
          if (!resolved.matched) {
            failedItems.push({ row: targetRow, col: targetCol, fieldName: f.name, text: rawVal });
            continue;
          }
          val = resolved.label;
        }
        // 数字字段：跳过非数字
        if (f.type === 'number' && isNaN(Number(val))) continue;
        updates.push({ type: 'cell.update', recordId: rec.id, fieldId: f.id, value: val });
      }
    }

    if (!updates.length && !failedItems.length) return;

    try {
      // 分批发送（每批最多 500）
      for (let i = 0; i < updates.length; i += MAX_BATCH) {
        const batch = updates.slice(i, i + MAX_BATCH);
        console.log('[clipboard] paste batch:', JSON.stringify(batch));
        const res = await api(API.batch, { method: 'POST', body: { updates: batch } });
        console.log('[clipboard] paste response:', JSON.stringify(res));
      }
      let msg = `已粘贴 ${updates.length} 格`;
      if (failedItems.length > 0) {
        msg += `，${failedItems.length} 格未匹配（选项不存在）`;
        console.warn('[clipboard] paste unmatched:', failedItems);
      }
      window.toast?.(msg);
      // 刷新以显示最新数据
      if (window.AppAuth?.openBase) await window.AppAuth.openBase(state.currentBaseId, t2.id);
    } catch (e) {
      console.error('[clipboard] paste error:', e.message, e);
      window.toast?.('粘贴失败：' + e.message, 'err');
    }
  }

  // ── 剪切 ──
  async function cut() {
    await copy();
    const range = getSelectionRange();
    if (!range) return;
    const t = getActiveTable();
    if (!t) return;
    const { r1, r2, c1, c2 } = range;
    const updates = [];
    for (let r = r1; r <= r2; r++) {
      const rec = t.records[r];
      if (!rec) continue;
      for (let c = c1; c <= c2; c++) {
        const f = t.fields[c];
        if (!f) continue;
        if (READONLY_TYPES.has(f.type)) continue;
        updates.push({ type: 'cell.update', recordId: rec.id, fieldId: f.id, value: '' });
      }
    }
    if (!updates.length) return;
    try {
      for (let i = 0; i < updates.length; i += MAX_BATCH) {
        const batch = updates.slice(i, i + MAX_BATCH);
        await api(API.batch, { method: 'POST', body: { updates: batch } });
      }
      if (window.AppAuth?.openBase) await window.AppAuth.openBase(state.currentBaseId, t.id);
    } catch (e) {
      window.toast?.('剪切失败：' + e.message, 'err');
    }
  }

  // ── 清除选中 ──
  function clearSelectedCells() {
    const range = getSelectionRange();
    if (!range) return;
    const t = getActiveTable();
    if (!t) return;
    const { r1, r2, c1, c2 } = range;
    const updates = [];
    for (let r = r1; r <= r2; r++) {
      const rec = t.records[r];
      if (!rec) continue;
      for (let c = c1; c <= c2; c++) {
        const f = t.fields[c];
        if (!f) continue;
        if (READONLY_TYPES.has(f.type)) continue;
        updates.push({ type: 'cell.update', recordId: rec.id, fieldId: f.id, value: '' });
      }
    }
    if (!updates.length) return;
    api(API.batch, { method: 'POST', body: { updates } }).catch(e => {
      window.toast?.('清除失败：' + e.message, 'err');
    });
  }

  // ── 挂载 ──
  window.CollabGrid = window.CollabGrid || {};
  window.CollabGrid.clipboard = {
    getSelectionRange,
    getSelectionTSV,
    clearSelectedCells,
    pasteIntoSelection,
    copy,
    paste,
    cut,
  };
})();