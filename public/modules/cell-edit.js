// modules/cell-edit.js — 单元格鼠标交互 + 定位与编辑 + 键盘事件处理
(function() {
  'use strict';
  const { AppState: state } = window;
  const KeyboardTools = window.CollabGridKeyboard;
  const { AppGridRender } = window;
  const { AppLinkPicker } = window;
  const { AppClipboardOps } = window;

  function cellAt(row, col) {
    const t = AppGridRender.getActiveTable();
    const records = state.visibleRecords.length ? state.visibleRecords : (t?.records || []);
    const fields = state.visibleFields.length ? state.visibleFields : (t?.fields || []);
    if (!t || !records.length || !fields.length) return null;
    const nextRow = Math.max(0, Math.min(records.length - 1, row));
    const nextCol = Math.max(0, Math.min(fields.length - 1, col));
    const rec = records[nextRow];
    const field = fields[nextCol];
    if (!rec || !field) return null;
    const td = document.querySelector(`td[data-record="${rec.id}"][data-field="${field.id}"]`);
    if (!td) return null;
    return { table: t, row: nextRow, col: nextCol, record: rec, field, td };
  }

  // 获取 cell 的当前 version（乐观锁）
  function getCellVersion(recordId, fieldId) {
    const t = AppGridRender.getActiveTable();
    if (!t || !t.cells) return undefined;
    const cell = t.cells.find(c => c.record_id === recordId && c.field_id === fieldId);
    return cell ? (cell.version || 1) : undefined;
  }

  function cellControl(td) {
    return td.querySelector('input.cell:not(:disabled), select.cell:not(:disabled), .cell-view') || td;
  }

  function isEditingCell(row, col) {
    return !!state.editingCell && state.editingCell.row === row && state.editingCell.col === col;
  }

  function onCellMouseDown(e, row, col) {
    // ignore right-click
    if (e.button !== 0) return;
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === 'button' || tag === 'a') return;
    state.editingCell = null;
    if (e.shiftKey && state.selection) {
      state.selection = { anchor: state.selection.anchor, focus: { row, col } };
    } else {
      state.selection = { anchor: { row, col }, focus: { row, col } };
    }
    state.dragSelecting = true;
    AppGridRender.paintSelection();
    setTimeout(() => focusCell(row, col, false), 0); // 不重置 selection，保留拖拽起点
  }

  function onCellMouseOver(e, row, col) {
    if (!state.dragSelecting || !state.selection) return;
    if (state.selection.focus.row === row && state.selection.focus.col === col) return;
    state.selection = { anchor: state.selection.anchor, focus: { row, col } };
    AppGridRender.paintSelection();
  }

  function focusCell(row, col, resetSelection = true) {
    const meta = cellAt(row, col);
    if (!meta) return false;

    state.pasteAppendMode = false;
    state.editingCell = null;
    if (resetSelection) {
      state.selection = { anchor: { row: meta.row, col: meta.col }, focus: { row: meta.row, col: meta.col } };
    }
    AppGridRender.paintSelection();

    meta.td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setTimeout(() => {
      meta.td.focus?.({ preventScroll: true });
    }, 0);
    return true;
  }

  function startCellEdit(row, col, initialText = null) {
    const meta = cellAt(row, col);
    if (!meta || meta.field.locked || meta.record.locked || ['lookup', 'autoNumber', 'formula', 'textFormula', 'button', 'createdTime', 'lastModifiedTime', 'lastModifiedBy'].includes(meta.field.type)) return false;
    if (meta.field.type === 'link') {
      if (AppLinkPicker) AppLinkPicker.openLinkPicker(meta.field, meta.record);
      return true;
    }
    if (meta.field.type === 'select') {
      openSelectSearchDropdown(meta.field, meta.record, meta.td, meta.row, meta.col, initialText);
      return true;
    }

    state.pasteAppendMode = false;
    state.selection = { anchor: { row: meta.row, col: meta.col }, focus: { row: meta.row, col: meta.col } };
    const control = cellControl(meta.td);
    const original = control.value ?? '';
    state.editingCell = { row: meta.row, col: meta.col, recordId: meta.record.id, fieldId: meta.field.id, original };
    AppGridRender.paintSelection();

    if (control.tagName === 'INPUT') {
      control.readOnly = false;
      if (initialText != null) control.value = initialText;
    }
    setTimeout(() => {
      control.focus?.({ preventScroll: true });
      if (control.tagName === 'INPUT') {
        if (initialText == null) control.select?.();
        else control.setSelectionRange?.(control.value.length, control.value.length);
      }
    }, 0);
    return true;
  }

  // ── select 字段搜索下拉编辑器 ──
  function openSelectSearchDropdown(field, record, td, row, col, initialText) {
    const FieldTools = window.CollabGridFields;
    const normalize = FieldTools?.normalizeSelectOption || ((o) => {
      const label = typeof o === 'object' ? String(o?.label || '').trim() : String(o || '').trim();
      const color = typeof o === 'object' && /^#[0-9a-fA-F]{6}$/.test(o?.color || '') ? o.color : '#64748b';
      return { label, color };
    });
    const options = (field?.options?.values || []).map(normalize).filter(o => o.label);

    const currentValue = window.AppGridRender?.cellValue?.(window.AppGridRender.getActiveTable(), record.id, field.id) || '';
    const currentOpt = options.find(o => o.label === currentValue);

    state.pasteAppendMode = false;
    state.selection = { anchor: { row, col }, focus: { row, col } };
    state.editingCell = { row, col, recordId: record.id, fieldId: field.id, original: currentValue, isSelect: true };
    AppGridRender.paintSelection();

    // 隐藏原生 select
    const nativeSelect = td.querySelector('select.cell');
    if (nativeSelect) nativeSelect.style.display = 'none';

    const container = document.createElement('div');
    container.className = 'select-search-dropdown';
    container.style.cssText = 'position:absolute; left:0; top:0; right:0; bottom:0; z-index:50;';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cell select-search-input';
    input.placeholder = '搜索...';
    input.value = initialText != null ? initialText : (currentOpt ? currentOpt.name || currentOpt.label : '');
    input.style.cssText = 'width:100%; height:100%; border:0; padding:0 10px; outline:none; background:var(--cg-focus-bg); font-size:inherit; font-family:inherit;';
    container.appendChild(input);

    const list = document.createElement('div');
    list.className = 'select-search-list';
    list.style.cssText = 'position:absolute; top:100%; left:0; right:0; max-height:200px; overflow-y:auto; background:var(--cg-white); border:1px solid var(--cg-rule); border-radius:var(--cg-radius-md); box-shadow:0 4px 12px rgba(0,0,0,0.12); z-index:100; display:none; padding:4px 0;';
    container.appendChild(list);

    td.appendChild(container);
    td.classList.add('cell-editing');

    let selectedIndex = -1;

    function renderList(filter = '') {
      list.innerHTML = '';
      const filtered = options.filter(o => o.label.toLowerCase().includes(filter.toLowerCase()));
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:6px 12px; color:var(--cg-muted); font-size:13px;';
        empty.textContent = '无匹配选项';
        list.appendChild(empty);
        list.style.display = 'block';
        selectedIndex = -1;
        return;
      }
      filtered.forEach((opt, idx) => {
        const item = document.createElement('div');
        item.className = 'select-search-item';
        item.dataset.label = opt.label;
        item.style.cssText = 'padding:6px 12px; cursor:pointer; font-size:13px; display:flex; align-items:center; gap:8px;';
        const dot = document.createElement('span');
        dot.style.cssText = 'display:inline-block; width:10px; height:10px; border-radius:50%; background:' + (opt.color || '#64748b') + '; flex-shrink:0;';
        item.appendChild(dot);
        item.appendChild(document.createTextNode(opt.label));
        item.addEventListener('mouseenter', () => { selectedIndex = idx; highlightItem(); });
        item.addEventListener('click', () => { commitSelectEdit(opt.label); });
        list.appendChild(item);
      });
      list.style.display = 'block';
      selectedIndex = -1;
      highlightItem();
    }

    function highlightItem() {
      const items = list.querySelectorAll('.select-search-item');
      items.forEach((el, i) => {
        el.style.background = i === selectedIndex ? 'var(--cg-hover)' : 'transparent';
      });
    }

    function commitSelectEdit(newValue) {
      cleanup();
      if (newValue === currentValue) {
        state.editingCell = null;
        focusCell(row, col);
        return;
      }
      const { api } = window;
      const { toast } = window;
      api('/api/records/' + record.id + '/cells/' + field.id, {
        method: 'PUT',
        body: { value: newValue, version: getCellVersion(record.id, field.id) }
      })
        .then(res => {
          state.editingCell = null;
          // 更新本地 version
          if (res && res.version) updateLocalVersion(record.id, field.id, res.version);
          if (window.AppAuth?.openBase) {
            window.AppAuth.openBase(state.currentBaseId, window.AppGridRender.getActiveTable().id);
          } else {
            focusCell(row, col);
          }
        })
        .catch(async (e) => {
          state.editingCell = null;
          const handled = await handleVersionConflict(e, record.id, field.id, newValue);
          if (!handled) { toast(e.message, 'err'); focusCell(row, col); }
        });
    }

    function cancelSelectEdit() {
      cleanup();
      state.editingCell = null;
      focusCell(row, col);
    }

    function cleanup() {
      if (container.parentNode) container.parentNode.removeChild(container);
      if (nativeSelect) nativeSelect.style.display = '';
      td.classList.remove('cell-editing');
    }

    input.addEventListener('input', function() {
      renderList(this.value);
    });

    input.addEventListener('keydown', function(e) {
      const items = list.querySelectorAll('.select-search-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        highlightItem();
        if (selectedIndex >= 0 && items[selectedIndex]) {
          items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        highlightItem();
        if (selectedIndex >= 0 && items[selectedIndex]) {
          items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && items[selectedIndex]) {
          commitSelectEdit(items[selectedIndex].dataset.label);
        } else {
          // 尝试精确匹配输入文本
          const matched = options.find(o => o.label.toLowerCase() === input.value.trim().toLowerCase());
          if (matched) {
            commitSelectEdit(matched.label);
          } else {
            cancelSelectEdit();
          }
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelSelectEdit();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (selectedIndex >= 0 && items[selectedIndex]) {
          commitSelectEdit(items[selectedIndex].dataset.label);
        } else {
          cancelSelectEdit();
        }
      }
    });

    // 点击外部关闭
    function onOutsideClick(e) {
      if (!container.contains(e.target)) {
        cancelSelectEdit();
        document.removeEventListener('mousedown', onOutsideClick);
      }
    }
    setTimeout(() => document.addEventListener('mousedown', onOutsideClick), 0);

    input.focus();
    input.select();
    renderList(initialText != null ? initialText : '');
  }

  function finishCellEdit(targetRow, targetCol) {
    const edit = state.editingCell;
    if (!edit) return focusCell(targetRow, targetCol);
    if (edit.isSelect) {
      // select 搜索下拉由自身键盘事件处理，此处只需清理状态
      state.editingCell = null;
      const dropdown = document.querySelector('.select-search-dropdown');
      if (dropdown) {
        const td = dropdown.closest('td');
        const nativeSelect = td?.querySelector('select.cell');
        if (nativeSelect) nativeSelect.style.display = '';
        dropdown.remove();
        td?.classList.remove('cell-editing');
      }
      return focusCell(targetRow, targetCol);
    }
    const meta = cellAt(edit.row, edit.col);
    if (meta) {
      const control = cellControl(meta.td);
      if (control.tagName === 'INPUT') control.readOnly = true;
      control.blur?.();
    }
    state.editingCell = null;
    return focusCell(targetRow, targetCol);
  }

  function cancelCellEdit() {
    const edit = state.editingCell;
    if (!edit) return false;
    if (edit.isSelect) {
      state.editingCell = null;
      const dropdown = document.querySelector('.select-search-dropdown');
      if (dropdown) {
        const td = dropdown.closest('td');
        const nativeSelect = td?.querySelector('select.cell');
        if (nativeSelect) nativeSelect.style.display = '';
        dropdown.remove();
        td?.classList.remove('cell-editing');
      }
      focusCell(edit.row, edit.col);
      return true;
    }
    const meta = cellAt(edit.row, edit.col);
    if (meta) {
      const control = cellControl(meta.td);
      if ('value' in control) control.value = edit.original;
      if (control.tagName === 'INPUT') control.readOnly = true;
      control.blur?.();
      state.editingCell = null;
      focusCell(edit.row, edit.col);
      return true;
    }
    state.editingCell = null;
    return false;
  }

  async function clearSelectedCells() {
    const { api } = window;
    const { toast } = window;
    const t = AppGridRender.getActiveTable();
    const range = AppGridRender.selectionRange(state.selection);
    if (!t || !range) return;
    let cleared = 0;
    let skipped = 0;
    for (let r = range.r1; r <= range.r2; r++) {
      const rec = t.records[r];
      if (!rec) continue;
      for (let c = range.c1; c <= range.c2; c++) {
        const f = t.fields[c];
        if (!f || f.locked || ['link', 'lookup', 'autoNumber', 'formula', 'textFormula', 'button', 'createdTime', 'lastModifiedTime', 'lastModifiedBy'].includes(f.type)) { skipped++; continue; }
        try {
          await api(`/api/records/${rec.id}/cells/${f.id}`, {
            method: 'PUT',
            body: { value: '', version: getCellVersion(rec.id, f.id) }
          });
          cleared++;
        } catch (e) { skipped++; }
      }
    }
    const { AppAuth } = window;
    if (AppAuth) await AppAuth.openBase(state.currentBaseId, t.id);
    toast(`已清空 ${cleared} 格` + (skipped ? `，跳过 ${skipped} 格` : ''));
  }

  function onCellKeyDown(e, row, col) {
    if (e.defaultPrevented) return;
    const { $ } = window;
    if (isInsideModal(e.target)) return;
    const editing = isEditingCell(row, col);

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (editing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelCellEdit();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const t = AppGridRender.getActiveTable();
        const next = KeyboardTools.nextCellPosition({ row, col, key: e.key, shiftKey: e.shiftKey, rowCount: state.visibleRecords.length || t.records.length, colCount: state.visibleFields.length || t.fields.length });
        finishCellEdit(next.row, next.col);
        return;
      }
      // 编辑普通单元格时，方向键保存并移动到相邻单元格（select 下拉编辑器自行处理方向键）
      const edit = state.editingCell;
      if (edit && !edit.isSelect && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const t = AppGridRender.getActiveTable();
        const next = KeyboardTools.nextCellPosition({ row, col, key: e.key, shiftKey: e.shiftKey, rowCount: state.visibleRecords.length || t.records.length, colCount: state.visibleFields.length || t.fields.length });
        finishCellEdit(next.row, next.col);
        return;
      }
      return;
    }

    if (e.key === 'F2') {
      e.preventDefault();
      e.stopPropagation();
      startCellEdit(row, col);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      clearSelectedCells();
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      startCellEdit(row, col, e.key);
      return;
    }

    const t = AppGridRender.getActiveTable();
    const next = KeyboardTools.nextCellPosition({ row, col, key: e.key, shiftKey: e.shiftKey, rowCount: state.visibleRecords.length || t.records.length, colCount: state.visibleFields.length || t.fields.length });
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    focusCell(next.row, next.col);
  }

  function isInsideModal(node) {
    return !!node?.closest?.('.modal-mask, .modal');
  }

  function onGlobalMouseUp() {
    state.dragSelecting = false;
  }
  document.addEventListener('mouseup', onGlobalMouseUp);
  document.addEventListener('copy', (e) => { if (AppClipboardOps) AppClipboardOps.handleDocumentCopy(e); }, true);
  document.addEventListener('paste', (e) => { if (AppClipboardOps) AppClipboardOps.handleDocumentPaste(e); }, true);

  // 更新本地 cell version
  function updateLocalVersion(recordId, fieldId, newVersion) {
    const t = AppGridRender.getActiveTable();
    if (!t || !t.cells) return;
    const cell = t.cells.find(c => c.record_id === recordId && c.field_id === fieldId);
    if (cell) cell.version = newVersion;
  }

  // 处理 409 版本冲突
  async function handleVersionConflict(e, recordId, fieldId, intendedValue) {
    if (!e || e.status !== 409) return false;
    const detail = e.body || {};
    const msg = detail.message || '该单元格已被其他人修改';
    const currentVal = detail.currentValue || '(未知)';
    const confirmed = window.confirm(
      msg + '\n\n当前值: ' + currentVal + '\n你的修改: ' + intendedValue + '\n\n是否覆盖当前值？'
    );
    if (!confirmed) return true; // 用户取消，视为已处理
    try {
      const { api } = window;
      await api('/api/records/' + recordId + '/cells/' + fieldId, {
        method: 'PUT',
        body: { value: intendedValue } // 不传 version，强制覆盖
      });
      const { AppAuth } = window;
      if (AppAuth) await AppAuth.openBase(state.currentBaseId, AppGridRender.getActiveTable().id);
      return true;
    } catch (e2) {
      const { toast } = window;
      toast('覆盖失败: ' + (e2.message || '未知错误'), 'err');
      return true;
    }
  }

  window.AppCellEdit = {
    cellAt, cellControl, isEditingCell, onCellMouseDown, onCellMouseOver,
    focusCell, startCellEdit, finishCellEdit, cancelCellEdit, clearSelectedCells,
    onCellKeyDown, isInsideModal, getCellVersion, updateLocalVersion, handleVersionConflict
  };
})();
