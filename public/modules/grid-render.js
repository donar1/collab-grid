// modules/grid-render.js — 表格核心渲染 + 数据查询工具 + 选择区管理 + 显示值/样式系统 + 可见记录过滤 + 列宽/行高拖拽
(function() {
  'use strict';
  const { $, el, toast } = window;
  const { AppState: state } = window;
  const { api } = window;
  const ClipboardTools = window.CollabGridClipboard;
  const FieldTools = window.CollabGridFields;
  const { AppShell } = window;
  const { AppFieldModal } = window;

  // ---------- data helpers ----------
  function getActiveTable() { return state.base?.tables.find(t => t.id === state.activeTableId); }

  function cellValue(table, recordId, fieldId) {
    const c = table.cells.find(c => c.record_id === recordId && c.field_id === fieldId);
    return c?.value ?? '';
  }

  function normalizeSelectOption(opt) {
    return FieldTools.normalizeSelectOption(opt);
  }

  function selectOptions(field) {
    return (field.options?.values || []).map(normalizeSelectOption).filter(opt => opt.label);
  }

  function selectOptionForValue(field, value) {
    return selectOptions(field).find(opt => opt.label === value) || null;
  }

  function recordTitle(table, recordId) {
    if (!table) return recordId;
    const titleField = table.fields[0];
    if (!titleField) return recordId;
    const v = cellValue(table, recordId, titleField.id);
    return v || '(未命名)';
  }

  function linkRecordTitle(field, recordId) {
    const targetTable = state.base?.tables.find(tb => tb.records.some(rr => rr.id === recordId));
    if (!targetTable) return recordId;
    const displayField = targetTable.fields.find(f => f.id === field.options?.displayFieldId) || targetTable.fields[0];
    if (!displayField) return recordId;
    const v = cellValue(targetTable, recordId, displayField.id);
    return v || '(未命名)';
  }

  function mergeTableSearchResult(table, result) {
    if (!table || !result) return;
    for (const r of result.records || []) {
      const idx = table.records.findIndex(x => x.id === r.id);
      if (idx >= 0) table.records[idx] = { ...table.records[idx], ...r };
      else table.records.push(r);
    }
    for (const c of result.cells || []) {
      const idx = table.cells.findIndex(x => x.record_id === c.record_id && x.field_id === c.field_id);
      if (idx >= 0) table.cells[idx] = c;
      else table.cells.push(c);
    }
    for (const l of result.links || []) {
      if (!table.links.find(x => x.id === l.id)) table.links.push(l);
    }
  }

  function roleOptions() {
    return state.base?.roles || [
      { value: 'admin', label: '管理员' },
      { value: 'approver', label: '审批人' },
      { value: 'finance', label: '财务/结算' },
      { value: 'editor', label: '编辑' },
      { value: 'viewer', label: '只读' },
    ];
  }

  function findFieldEverywhere(fieldId) {
    if (!state.base) return null;
    for (const t of state.base.tables) {
      const f = t.fields.find(f => f.id === fieldId);
      if (f) return { table: t, field: f };
    }
    return null;
  }

  function lookupFieldDisplay(table, record, field) {
    const opts = field.options || {};
    if (!opts.linkFieldId || !opts.sourceFieldId) return '(未配置)';
    if (opts.mode === 'snapshot') {
      return cellValue(table, record.id, field.id) || '';
    }
    const linkField = table.fields.find(f => f.id === opts.linkFieldId);
    if (!linkField) return '(关联字段已删除)';
    const linksFor = table.links.filter(l => l.field_id === opts.linkFieldId && l.from_record_id === record.id);
    if (!linksFor.length) return '';
    const sourceMeta = findFieldEverywhere(opts.sourceFieldId);
    if (!sourceMeta) return '(源字段已删除)';
    const values = [];
    for (const lk of linksFor) {
      const v = cellValue(sourceMeta.table, lk.to_record_id, sourceMeta.field.id);
      if (v != null && v !== '') values.push(v);
    }
    return values.join(', ');
  }

  function textFormulaDisplay(table, record, field) {
    const expr = field.options?.expression || '';
    return expr.replace(/\{([^}]+)\}/g, (_, name) => {
      const f = table.fields.find(x => x.name === String(name).trim());
      if (!f || f.id === field.id) return '';
      return readDisplayValue(table, record, f);
    }).replace(/\s+/g, ' ').trim();
  }

  // ---------- selection ----------
  function clearSelection() {
    if (!state.selection) return;
    state.selection = null;
    state.editingCell = null;
    document.querySelectorAll('td.cell-selected, td.cell-active').forEach(td => {
      td.classList.remove('cell-selected');
      td.classList.remove('cell-active');
      td.classList.remove('cell-editing');
    });
  }

  function selectionRange(sel) {
    return ClipboardTools.selectionRange(sel);
  }

  function paintSelection() {
    document.querySelectorAll('td.cell-selected, td.cell-active, td.cell-editing').forEach(td => {
      td.classList.remove('cell-selected');
      td.classList.remove('cell-active');
      td.classList.remove('cell-editing');
    });
    const sel = state.selection;
    if (!sel) return;
    const range = selectionRange(sel);
    const t = getActiveTable();
    if (!t) return;
    for (let r = range.r1; r <= range.r2; r++) {
      const rec = t.records[r];
      if (!rec) continue;
      for (let c = range.c1; c <= range.c2; c++) {
        const f = t.fields[c];
        if (!f) continue;
        const td = document.querySelector(`td[data-record="${rec.id}"][data-field="${f.id}"]`);
        if (td) td.classList.add('cell-selected');
      }
    }
    const focusRec = t.records[sel.focus.row];
    const focusField = t.fields[sel.focus.col];
    if (focusRec && focusField) {
      const td = document.querySelector(`td[data-record="${focusRec.id}"][data-field="${focusField.id}"]`);
      if (td) {
        td.classList.add('cell-active');
        if (state.editingCell?.recordId === focusRec.id && state.editingCell?.fieldId === focusField.id) {
          td.classList.add('cell-editing');
        }
      }
    }
  }

  function readDisplayValue(t, record, field) {
    if (field.type === 'lookup') return lookupFieldDisplay(t, record, field);
    if (field.type === 'textFormula') return textFormulaDisplay(t, record, field);
    if (field.type === 'link') {
      const linksFor = t.links.filter(l => l.from_record_id === record.id && l.field_id === field.id);
      return linksFor.map(lk => linkRecordTitle(field, lk.to_record_id)).join(', ');
    }
    if (field.type === 'currency') {
      const raw = cellValue(t, record.id, field.id);
      if (raw === '') return '';
      const n = Number(raw);
      return Number.isFinite(n) ? `${field.options?.symbol || '¥'}${n.toFixed(field.options?.precision ?? 2)}` : raw;
    }
    return cellValue(t, record.id, field.id) || '';
  }

  // ---------- table views ----------
  function tableView(tableId) {
    if (!state.tableViews[tableId]) state.tableViews[tableId] = { filter: '', hiddenFields: {}, rule: 'all' };
    return state.tableViews[tableId];
  }

  function tableViewsStorageKey(baseId = state.currentBaseId) {
    return baseId ? `cg.tableViews.${baseId}` : '';
  }

  function loadTableViews(baseId) {
    const key = tableViewsStorageKey(baseId);
    if (!key) return;
    try { state.tableViews = JSON.parse(localStorage.getItem(key) || '{}') || {}; }
    catch (e) { state.tableViews = {}; }
  }

  function saveTableViews() {
    const key = tableViewsStorageKey();
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(state.tableViews)); } catch (e) { /* ignore */ }
  }

  function setFieldVisible(tableId, fieldId, visible) {
    const view = tableView(tableId);
    if (visible) delete view.hiddenFields[fieldId];
    else view.hiddenFields[fieldId] = true;
    saveTableViews();
  }

  function fieldByName(t, name) {
    return t.fields.find(f => f.name === name);
  }

  function isResourceArchiveTable(t) {
    return t?.name === '资源档案中心' && !!fieldByName(t, '审批状态') && !!fieldByName(t, '待办');
  }

  function resourceArchiveRuleOptions() {
    return [
      { value: 'all', label: '全部档案', fields: ['代码', '入档日期', '企业名称', '对接人姓名', '电话', '地址', '身份信息', '身份证明', '审批领导', '审批状态', '数据可使用', '建群对接', '业务备注', '待办', '审批通过'] },
      { value: 'pending', label: '待审批', status: '待审批', fields: ['代码', '入档日期', '企业名称', '对接人姓名', '电话', '身份证明', '审批领导', '审批状态', '待办', '审批通过'] },
      { value: 'leader', label: '领导审批', fields: ['代码', '企业名称', '身份证明', '审批领导', '审批状态', '审批意见', '审批通过'] },
      { value: 'approved', label: '已通过可用', status: '已通过', fields: ['代码', '企业名称', '对接人姓名', '电话', '审批领导', '审批状态', '数据可使用', '建群对接', '业务备注'] },
      { value: 'todo', label: '待办处理', fields: ['代码', '企业名称', '对接人姓名', '电话', '审批状态', '待办', '业务备注'] },
    ];
  }

  function applyResourceRule(t, ruleValue) {
    const view = tableView(t.id);
    const rule = resourceArchiveRuleOptions().find(r => r.value === ruleValue) || resourceArchiveRuleOptions()[0];
    const allowed = new Set(rule.fields);
    view.rule = rule.value;
    view.hiddenFields = Object.fromEntries(t.fields.filter(f => !allowed.has(f.name)).map(f => [f.id, true]));
    saveTableViews();
    state.selection = null;
    renderGrid();
  }

  function visibleFieldsFor(t) {
    const view = tableView(t.id);
    return t.fields.filter(f => !view.hiddenFields[f.id]);
  }

  // ---------- style system ----------
  function fieldStyle(field) {
    return field.options?.style || {};
  }

  function fieldCssStyle(field) {
    const s = fieldStyle(field);
    const out = {};
    if (s.fontSize) out.fontSize = `${s.fontSize}px`;
    if (s.textColor) out.color = s.textColor;
    if (s.bgColor) out.backgroundColor = s.bgColor;
    return out;
  }

  function normalizeStyleObject(style) {
    const out = {};
    const fontSize = Number.parseInt(style?.fontSize || '', 10);
    if (Number.isFinite(fontSize)) out.fontSize = Math.max(10, Math.min(28, fontSize));
    if (/^#[0-9a-fA-F]{6}$/.test(String(style?.textColor || ''))) out.textColor = style.textColor;
    if (/^#[0-9a-fA-F]{6}$/.test(String(style?.bgColor || ''))) out.bgColor = style.bgColor;
    return out;
  }

  function parseCellStyle(cell) {
    if (!cell?.style_json) return {};
    if (typeof cell.style_json === 'object') return cell.style_json || {};
    try { return JSON.parse(cell.style_json) || {}; } catch (e) { return {}; }
  }

  function cellStyle(t, recordId, fieldId) {
    return parseCellStyle(t.cells.find(c => c.record_id === recordId && c.field_id === fieldId));
  }

  function cssFromStyle(style) {
    const out = {};
    if (style.fontSize) out.fontSize = `${style.fontSize}px`;
    if (style.textColor) out.color = style.textColor;
    if (style.bgColor) out.backgroundColor = style.bgColor;
    return out;
  }

  function focusedCellMeta() {
    const t = getActiveTable();
    const sel = state.selection;
    if (!t || !sel) return null;
    const record = state.visibleRecords[sel.focus.row];
    const field = state.visibleFields[sel.focus.col];
    if (!record || !field) return null;
    return { table: t, record, field };
  }

  async function updateFocusedCellStyle(stylePatch) {
    const meta = focusedCellMeta();
    if (!meta) { toast('请先选中一个单元格', 'warn'); return false; }
    const current = cellStyle(meta.table, meta.record.id, meta.field.id);
    const nextStyle = normalizeStyleObject({ ...current, ...stylePatch });
    try {
      const res = await api(`/api/records/${meta.record.id}/cells/${meta.field.id}/style`, { method: 'PATCH', body: { style: nextStyle } });
      const idx = meta.table.cells.findIndex(c => c.record_id === meta.record.id && c.field_id === meta.field.id);
      const style_json = Object.keys(res.style || {}).length ? JSON.stringify(res.style) : null;
      if (idx >= 0) meta.table.cells[idx] = { ...meta.table.cells[idx], style_json };
      else meta.table.cells.push({ record_id: meta.record.id, field_id: meta.field.id, value: '', style_json });
      renderGrid();
      return true;
    } catch (e) { toast(e.message, 'err'); return false; }
  }

  async function reorderField(tableId, fieldId, delta) {
    const t = state.base?.tables?.find(t => t.id === tableId);
    if (!t) return;
    const fields = [...t.fields].sort((a, b) => (a.position || 0) - (b.position || 0));
    const idx = fields.findIndex(f => f.id === fieldId);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= fields.length) return;
    const [moved] = fields.splice(idx, 1);
    fields.splice(nextIdx, 0, moved);
    const updates = fields.map((f, i) => ({ ...f, position: i * 10 }));
    try {
      await Promise.all(updates.map(f => api('/api/fields/' + f.id, { method: 'PATCH', body: { position: f.position } })));
      t.fields = updates;
      state.selection = null;
      renderGrid();
      toast('字段顺序已更新');
    } catch (e) { toast(e.message, 'err'); }
  }

  function openCellColorModal(kind) {
    const meta = focusedCellMeta();
    if (!meta) { toast('请先选中一个单元格', 'warn'); return; }
    const isText = kind === 'text';
    const key = isText ? 'textColor' : 'bgColor';
    const title = isText ? '字体颜色' : '单元格颜色';
    const current = cellStyle(meta.table, meta.record.id, meta.field.id);
    const value = current[key] || (isText ? '#1a1f2c' : '#ffffff');
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal cell-color-modal' });
    const input = el('input', { type: 'color', value });
    const swatch = el('span', { class: 'color-swatch large', style: { backgroundColor: value } });
    const code = el('code', {}, value);
    const preview = el('div', { class: 'field-format-preview', style: cssFromStyle({ ...current, [key]: value }) }, `预览：${title}`);
    const sync = () => {
      swatch.style.backgroundColor = input.value;
      code.textContent = input.value;
      if (isText) preview.style.color = input.value;
      else preview.style.backgroundColor = input.value;
    };
    input.addEventListener('input', sync);
    modal.appendChild(el('h3', {}, title));
    modal.appendChild(el('p', { class: 'desc' }, `当前单元格：${meta.field.name}`));
    modal.appendChild(el('button', { type: 'button', class: 'color-picker-btn large', onclick: () => input.click() },
      swatch,
      el('span', {}, `选择${title}`),
      code,
      input
    ));
    modal.appendChild(preview);
    modal.appendChild(el('div', { class: 'actions' },
      el('button', { onclick: () => mask.remove() }, '取消'),
      el('button', { class: 'primary', onclick: async () => {
        const ok = await updateFocusedCellStyle({ [key]: input.value });
        if (ok) { toast(`已应用${title}`); mask.remove(); }
      } }, '确认')
    ));
    mask.appendChild(modal);
    document.body.appendChild(mask);
  }

  function openFieldManagerModal() {
    const t = getActiveTable();
    if (!t) return;
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal field-manager-modal' });
    let selected = t.fields[0] || null;
    const view = tableView(t.id);
    const list = el('div', { class: 'field-manager-list' });

    const renderList = () => {
      list.innerHTML = '';
      t.fields.sort((a, b) => (a.position || 0) - (b.position || 0)).forEach((f, idx) => {
        const checkbox = el('input', {
          type: 'checkbox',
          checked: view.hiddenFields[f.id] ? false : 'checked',
          onclick: (e) => e.stopPropagation(),
          onchange: (e) => {
            setFieldVisible(t.id, f.id, e.target.checked);
            state.selection = null;
            renderGrid();
            renderList();
          }
        });
        const row = el('div', { class: 'field-manager-row' + (selected?.id === f.id ? ' active' : ''), onclick: () => { selected = f; renderList(); } },
          checkbox,
          el('span', { title: f.name }, f.name),
          el('small', {}, f.type),
          el('div', { class: 'field-order-actions', onclick: (e) => e.stopPropagation() },
            el('button', { disabled: idx === 0 ? 'disabled' : undefined, onclick: async () => { await reorderField(t.id, f.id, -1); renderList(); } }, '上移'),
            el('button', { disabled: idx === t.fields.length - 1 ? 'disabled' : undefined, onclick: async () => { await reorderField(t.id, f.id, 1); renderList(); } }, '下移')
          )
        );
        list.appendChild(row);
      });
    };

    modal.appendChild(el('h3', {}, '字段统一管理'));
    modal.appendChild(el('p', { class: 'desc' }, '这里只管理字段显示/隐藏。颜色设置请使用表格工具栏上的独立按钮。'));
    modal.appendChild(el('div', { class: 'field-manager-body single' }, list));
    modal.appendChild(el('div', { class: 'actions' },
      el('button', { onclick: () => { t.fields.forEach(f => setFieldVisible(t.id, f.id, true)); state.selection = null; renderGrid(); renderList(); } }, '全部显示'),
      el('button', { class: 'primary', onclick: () => mask.remove() }, '关闭')
    ));
    mask.appendChild(modal);
    document.body.appendChild(mask);
    renderList();
  }

  function visibleRecordsFor(t, fields) {
    const view = tableView(t.id);
    const rule = isResourceArchiveTable(t) ? resourceArchiveRuleOptions().find(r => r.value === view.rule) : null;
    const keyword = view.filter.trim().toLowerCase();
    return t.records.filter(r => {
      if (rule?.status) {
        const statusField = fieldByName(t, '审批状态');
        if (statusField && readDisplayValue(t, r, statusField) !== rule.status) return false;
      }
      if (rule?.value === 'todo') {
        const todoField = fieldByName(t, '待办');
        if (todoField && readDisplayValue(t, r, todoField) === '已完成') return false;
      }
      if (!keyword) return true;
      return fields.some(f => String(readDisplayValue(t, r, f)).toLowerCase().includes(keyword));
    });
  }

  // ---------- column/row sizing ----------
  function fieldWidth(f) {
    return Math.max(80, Math.min(600, Number(f.width) || 160));
  }

  function recordHeight(r) {
    return Math.max(28, Math.min(240, Number(r.height) || 34));
  }

  function startResizeField(e, field) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = fieldWidth(field);
    let nextWidth = startWidth;

    const applyLocalWidth = () => {
      document.querySelectorAll(`[data-field="${field.id}"]`).forEach(cell => {
        cell.style.width = nextWidth + 'px';
        cell.style.minWidth = nextWidth + 'px';
        cell.style.maxWidth = nextWidth + 'px';
      });
    };
    const onMove = (ev) => {
      nextWidth = Math.max(80, Math.min(600, startWidth + ev.clientX - startX));
      field.width = nextWidth;
      applyLocalWidth();
    };
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing-column');
      const rounded = Math.round(nextWidth);
      field.width = rounded;
      try {
        await api('/api/fields/' + field.id, { method: 'PATCH', body: { width: rounded } });
      } catch (err) {
        toast(err.message, 'err');
        const { AppAuth } = window;
        if (AppAuth) await AppAuth.openBase(state.currentBaseId);
      }
    };
    document.body.classList.add('resizing-column');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function startResizeRecord(e, record) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startHeight = recordHeight(record);
    let nextHeight = startHeight;

    const applyLocalHeight = () => {
      document.querySelectorAll(`[data-record="${record.id}"]`).forEach(cell => {
        cell.style.height = nextHeight + 'px';
        cell.style.minHeight = nextHeight + 'px';
      });
    };
    const onMove = (ev) => {
      nextHeight = Math.max(28, Math.min(240, startHeight + ev.clientY - startY));
      record.height = nextHeight;
      applyLocalHeight();
    };
    const onUp = async () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing-row');
      const rounded = Math.round(nextHeight);
      record.height = rounded;
      try {
        await api('/api/records/' + record.id, { method: 'PATCH', body: { height: rounded } });
      } catch (err) {
        toast(err.message, 'err');
        const { AppAuth } = window;
        if (AppAuth) await AppAuth.openBase(state.currentBaseId);
      }
    };
    document.body.classList.add('resizing-row');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ---------- grid render ----------
  var VIRTUAL_SCROLL_THRESHOLD = 100; // 记录数超过此值时启用虚拟滚动

  /**
   * 渲染单行记录（提取为独立函数，供虚拟滚动和普通模式复用）
   * @param {Object} r - 记录对象
   * @param {number} rowIdx - 行索引（在 visibleRecords 中的索引）
   * @param {Object} ctx - 上下文 { t, visibleFields, AppCellEdit, AppRecordOps, AppLinkPicker }
   * @returns {HTMLTableRowElement}
   */
  function renderSingleRow(r, rowIdx, ctx) {
    var t = ctx.t;
    var visibleFields = ctx.visibleFields;
    var AppCellEdit = ctx.AppCellEdit;
    var AppRecordOps = ctx.AppRecordOps;
    var AppLinkPicker = ctx.AppLinkPicker;

    var heightStyle = { height: recordHeight(r) + 'px', minHeight: recordHeight(r) + 'px' };
    var tr = el('tr', { style: heightStyle, class: r.locked ? 'record-locked' : '' });
    visibleFields.forEach(function(f, colIdx) {
      var formatStyle = cssFromStyle(cellStyle(t, r.id, f.id));
      var widthStyle = {
        width: fieldWidth(f) + 'px',
        minWidth: fieldWidth(f) + 'px',
        maxWidth: fieldWidth(f) + 'px',
        height: recordHeight(r) + 'px',
        minHeight: recordHeight(r) + 'px'
      };
      var td = el('td', {
        'data-record': r.id,
        'data-field': f.id,
        'data-row': String(rowIdx),
        'data-col': String(colIdx),
        tabindex: '0',
        style: { ...widthStyle, ...formatStyle },
        onmousedown: (e) => { if (AppCellEdit) AppCellEdit.onCellMouseDown(e, rowIdx, colIdx); },
        onmouseover: (e) => { if (AppCellEdit) AppCellEdit.onCellMouseOver(e, rowIdx, colIdx); },
        onkeydown: (e) => { if (AppCellEdit) AppCellEdit.onCellKeyDown(e, rowIdx, colIdx); },
        ondblclick: () => { if (AppCellEdit) AppCellEdit.startCellEdit(rowIdx, colIdx); },
      });
      if (f.locked || r.locked) td.classList.add('locked');
      if (f.type === 'link') {
        td.classList.add('link-cell');
        var view = el('div', { class: 'cell-view', tabindex: '0', onclick: () => { if (f.locked) { toast('字段已锁定', 'warn'); } else if (AppLinkPicker) AppLinkPicker.openLinkPicker(f, r); } });
        var linksFor = t.links.filter(l => l.from_record_id === r.id && l.field_id === f.id);
        if (linksFor.length === 0) view.classList.add('empty'), view.appendChild(document.createTextNode('点击关联…'));
        for (const lk of linksFor) {
          var title = linkRecordTitle(f, lk.to_record_id);
          var tag = el('span', { class: 'link-tag' }, title,
            el('button', { onclick: (e) => { e.stopPropagation(); deleteLink(lk.id); } }, '×')
          );
          view.appendChild(tag);
        }
        td.appendChild(view);
      } else if (f.type === 'lookup') {
        td.classList.add('lookup-cell');
        var text = lookupFieldDisplay(t, r, f);
        var view = el('div', { class: 'cell-view lookup-view', tabindex: '0', title: f.options?.mode === 'snapshot' ? '锁定快照（建立关联那一刻的值）' : '联动同步（随源数据变更）' },
          el('span', { class: 'lookup-mode-badge ' + (f.options?.mode === 'snapshot' ? 'snapshot' : 'live') }, f.options?.mode === 'snapshot' ? '锁' : '联'),
          el('span', { class: 'lookup-value' }, text || '')
        );
        if (!text) view.classList.add('empty');
        td.appendChild(view);
      } else if (f.type === 'createdTime' || f.type === 'lastModifiedTime') {
        td.classList.add('lookup-cell');
        var timeVal = cellValue(t, r.id, f.id) || '';
        var timeEl = el('div', {
          class: 'cell-view readonly-view',
          title: timeVal,
          onclick: (e) => { e.stopPropagation(); toast('该字段为系统自动生成，不支持编辑'); }
        }, timeVal || '-');
        td.appendChild(timeEl);
      } else if (['autoNumber', 'formula', 'textFormula', 'lastModifiedBy'].includes(f.type)) {
        td.classList.add('lookup-cell');
        var text = readDisplayValue(t, r, f);
        td.appendChild(el('div', { class: 'cell-view lookup-view readonly-view', tabindex: '0' },
          el('span', { class: 'lookup-value' }, text || '')
        ));
      } else if (f.type === 'button') {
        var opts = f.options || {};
        var action = opts.action || 'seal_record';
        var isSealed = !!r.locked;
        // 封账按钮：已封账显示"解封"，未封账显示"封账"
        var btnLabel, btnClass;
        if (action === 'seal_record') {
          btnLabel = isSealed ? '解封' : '封账';
          btnClass = 'cell-button' + (isSealed ? ' unseal-btn' : '');
        } else {
          btnLabel = opts.label || '执行';
          btnClass = 'cell-button';
        }
        td.appendChild(el('button', {
          class: btnClass,
          onclick: (e) => { e.stopPropagation(); if (AppRecordOps) AppRecordOps.executeButton(f, r); }
        }, btnLabel));
      } else if (f.type === 'attachment') {
        var current = cellValue(t, r.id, f.id);
        var isLocked = (f.locked || r.locked);
        var original = current;

        // --- helper: upload file and return attachment ids string ---
        async function uploadAttachment(file) {
          var fd = new FormData();
          fd.append('file', file);
          fd.append('recordId', r.id);
          fd.append('fieldId', f.id);
          fd.append('baseId', state.currentBaseId || '');
          var csrf = state.csrfToken || '';
          var resp = await fetch(API.attachmentUpload, {
            method: 'POST',
            credentials: 'same-origin',
            headers: csrf ? { 'X-CSRF-Token': csrf } : {},
            body: fd,
          });
          var data = await resp.json().catch(function() { return {}; });
          if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
          return data;
        }

        // --- helper: build thumbnail from value ---
        function buildPreview(val) {
          if (!val) return null;
          // value may be comma-separated attachment ids or a url
          var items = String(val).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
          var container = el('div', { class: 'attachment-preview-row' });
          items.forEach(function(item) {
            // if it looks like a URL, show image thumbnail
            if (/^https?:\/\/.+/i.test(item) && /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(item)) {
              container.appendChild(el('img', { class: 'attachment-thumb', src: item, alt: '附件预览' }));
            } else {
              // attachment id — try to build a link to the attachment endpoint
              var link = el('a', {
                class: 'attachment-id-link',
                href: API.attachment(item),
                target: '_blank',
                title: item,
              }, item.length > 12 ? item.slice(0, 12) + '...' : item);
              container.appendChild(link);
            }
          });
          return container;
        }

        // --- build cell content ---
        var previewContainer = buildPreview(current);
        var input = el('input', {
          class: 'cell attachment-input',
          type: 'text',
          placeholder: '粘贴图片/凭证链接',
          value: current,
          disabled: isLocked ? 'disabled' : false,
          readonly: 'readonly',
        });
        var fileInput = el('input', {
          type: 'file',
          accept: 'image/*,.pdf,.doc,.docx,.xls,.xlsx',
          style: 'display:none',
        });
        var uploadBtn = el('button', {
          class: 'attachment-upload-btn',
          type: 'button',
          title: '上传附件',
          disabled: isLocked ? 'disabled' : false,
        }, '\uD83D\uDCE7');

        var wrapper = el('div', { class: 'attachment-cell' }, previewContainer, input, uploadBtn, fileInput);

        // --- upload handler ---
        async function handleFileUpload(file) {
          if (!file) return;
          uploadBtn.disabled = true;
          uploadBtn.textContent = '...';
          try {
            var data = await uploadAttachment(file);
            var ids = [];
            if (data.files && Array.isArray(data.files)) {
              ids = data.files.map(function(f) { return f.id; });
            } else {
              ids = data.ids || data.attachmentIds || (data.id ? [data.id] : []);
            }
            var newVal = ids.join(',');
            if (current) newVal = current + ',' + newVal;
            input.value = newVal;
            await api('/api/records/' + r.id + '/cells/' + f.id, { method: 'PUT', body: { value: newVal } });
            original = newVal;
            current = newVal;
            // refresh preview
            if (previewContainer && previewContainer.parentNode) previewContainer.parentNode.removeChild(previewContainer);
            previewContainer = buildPreview(current);
            if (previewContainer) wrapper.insertBefore(previewContainer, input);
            toast('附件上传成功');
          } catch (e) {
            toast(e.message, 'err');
          } finally {
            uploadBtn.disabled = isLocked ? 'disabled' : false;
            uploadBtn.textContent = '\uD83D\uDCE7';
          }
        }

        // --- click upload button -> trigger file picker ---
        uploadBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          if (isLocked) return;
          fileInput.click();
        });

        // --- file chosen ---
        fileInput.addEventListener('change', function(e) {
          var files = e.target.files;
          if (files && files.length > 0) {
            handleFileUpload(files[0]);
          }
          fileInput.value = '';
        });

        // --- paste image (on wrapper because input is readonly) ---
        wrapper.addEventListener('paste', function(e) {
          if (isLocked) return;
          var items = (e.clipboardData || {}).items;
          if (!items) return;
          for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') === 0) {
              e.preventDefault();
              var file = items[i].getAsFile();
              if (file) handleFileUpload(file);
              return;
            }
          }
          // non-image paste: let default behaviour handle text paste
        });

        input.addEventListener('mousedown', function(e) {
          if (AppCellEdit && !AppCellEdit.isEditingCell(rowIdx, colIdx)) e.preventDefault();
        });
        input.addEventListener('blur', async function() {
          if (input.value === original) return;
          try {
            const ver = AppCellEdit && AppCellEdit.getCellVersion ? AppCellEdit.getCellVersion(r.id, f.id) : undefined;
            await api('/api/records/' + r.id + '/cells/' + f.id, { method: 'PUT', body: { value: input.value, version: ver } });
            original = input.value;
            current = input.value;
            // refresh preview
            if (previewContainer && previewContainer.parentNode) previewContainer.parentNode.removeChild(previewContainer);
            previewContainer = buildPreview(current);
            if (previewContainer) wrapper.insertBefore(previewContainer, input);
          } catch (e) { input.value = original; toast(e.message, 'err'); }
        });

        td.appendChild(wrapper);
      } else if (f.type === 'select') {
        var select = el('select', {
          class: 'cell select-cell',
          disabled: (f.locked || r.locked) ? 'disabled' : false,
        });
        var current = cellValue(t, r.id, f.id);
        var options = selectOptions(f);
        select.appendChild(el('option', { value: '' }, options.length ? '未选择' : '先添加选项'));
        for (const opt of options) {
          select.appendChild(el('option', { value: opt.label, selected: current === opt.label ? 'selected' : false }, opt.label));
        }
        var applySelectColor = () => {
          var opt = selectOptionForValue(f, select.value);
          select.style.borderLeft = opt ? `8px solid ${opt.color}` : '';
          select.style.backgroundColor = opt ? `${opt.color}22` : '';
        };
        var original = current;
        select.value = current;
        applySelectColor();
        select.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          if (AppCellEdit && !AppCellEdit.isEditingCell(rowIdx, colIdx)) {
            AppCellEdit.startCellEdit(rowIdx, colIdx);
          }
        });
        select.addEventListener('focus', () => {
          if (AppCellEdit && !AppCellEdit.isEditingCell(rowIdx, colIdx)) original = select.value;
        });
        select.addEventListener('change', async () => {
          if (select.value === original) return;
          try {
            const ver = AppCellEdit && AppCellEdit.getCellVersion ? AppCellEdit.getCellVersion(r.id, f.id) : undefined;
            await api(`/api/records/${r.id}/cells/${f.id}`, { method: 'PUT', body: { value: select.value, version: ver } });
            original = select.value;
            applySelectColor();
          } catch (e) {
            select.value = original;
            applySelectColor();
            toast(e.message, 'err');
          }
        });
        td.appendChild(select);
      } else {
        var input = el('input', {
          class: 'cell',
          type: (f.type === 'number' || f.type === 'currency') ? 'number' : (f.type === 'date' ? 'date' : (f.type === 'checkbox' ? 'checkbox' : 'text')),
          value: f.type === 'checkbox' ? undefined : cellValue(t, r.id, f.id),
          checked: f.type === 'checkbox' && cellValue(t, r.id, f.id) === 'true' ? 'checked' : false,
          disabled: (f.locked || r.locked) ? 'disabled' : false,
          readonly: 'readonly',
        });
        var original = f.type === 'checkbox' ? String(input.checked) : input.value;
        input.addEventListener('focus', () => {
          if (AppCellEdit && !AppCellEdit.isEditingCell(rowIdx, colIdx)) original = f.type === 'checkbox' ? String(input.checked) : input.value;
        });
        input.addEventListener('mousedown', (e) => {
          if (AppCellEdit && !AppCellEdit.isEditingCell(rowIdx, colIdx)) e.preventDefault();
        });
        input.addEventListener('blur', async () => {
          var nextValue = f.type === 'checkbox' ? input.checked : input.value;
          if (String(nextValue) === String(original)) return;
          try {
            const ver = AppCellEdit && AppCellEdit.getCellVersion ? AppCellEdit.getCellVersion(r.id, f.id) : undefined;
            await api(`/api/records/${r.id}/cells/${f.id}`, { method: 'PUT', body: { value: nextValue, version: ver } });
            original = String(nextValue);
          }
          catch (e) { if (f.type === 'checkbox') input.checked = original === 'true'; else input.value = original; toast(e.message, 'err'); }
        });
        td.appendChild(input);
      }
      tr.appendChild(td);
    });
    tr.appendChild(el('td', { class: 'row-action', 'data-record': r.id, style: heightStyle },
      el('button', {
        class: 'row-delete-btn',
        title: r.locked ? '解除封账' : '封账',
        onclick: (e) => { e.stopPropagation(); if (AppRecordOps) AppRecordOps.toggleRecordLock(r); }
      }, r.locked ? '解封' : '封账'),
      el('button', {
        class: 'row-delete-btn',
        title: '删除行',
        onclick: (e) => { e.stopPropagation(); if (AppRecordOps) AppRecordOps.deleteRecord(r.id); },
        disabled: r.locked ? 'disabled' : false
      }, '删除'),
      el('span', {
        class: 'row-resize-handle',
        title: '拖动调整行高',
        onmousedown: (e) => startResizeRecord(e, r)
      })
    ));
    return tr;
  }

  function renderGrid() {
    const main = $('#main'); if (!main) return;
    const oldWrap = main.querySelector('.grid-wrap'); if (oldWrap) oldWrap.remove();
    const t = getActiveTable();
    if (!t) { main.appendChild(el('div', { class: 'empty-hint' }, '没有数据表，新建一个吧')); return; }

    const { AppCellEdit } = window;
    const { AppRecordOps } = window;
    const { AppLinkPicker } = window;
    const { AppAudit } = window;
    const { AppClipboardOps } = window;

    const wrap = el('div', { class: 'grid-wrap', tabindex: '0', onpaste: (e) => { if (AppClipboardOps) AppClipboardOps.handleGridPaste(e); }, oncopy: (e) => { if (AppClipboardOps) AppClipboardOps.handleGridCopy(e); } });
    const view = tableView(t.id);
    const visibleFields = visibleFieldsFor(t);
    const visibleRecords = visibleRecordsFor(t, visibleFields);
    state.visibleFields = visibleFields;
    state.visibleRecords = visibleRecords;
    const toolbar = el('div', { class: 'grid-toolbar' },
      isResourceArchiveTable(t) ? el('select', {
        class: 'view-rule-select',
        value: view.rule || 'all',
        onchange: (e) => applyResourceRule(t, e.target.value)
      }, resourceArchiveRuleOptions().map(rule => el('option', { value: rule.value, selected: (view.rule || 'all') === rule.value ? 'selected' : false }, rule.label))) : null,
      el('input', {
        class: 'grid-filter',
        placeholder: '筛选当前页内容…',
        value: view.filter,
        oninput: (e) => {
          view.filter = e.target.value;
          state.selection = null;
          renderGrid();
        }
      }),
      el('button', { onclick: openFieldManagerModal }, '字段管理'),
      el('button', { onclick: () => openCellColorModal('text') }, '字体颜色'),
      el('button', { onclick: () => openCellColorModal('bg') }, '单元格颜色'),
      view.filter ? el('button', { onclick: () => { view.filter = ''; state.selection = null; renderGrid(); } }, '清空筛选') : null,
      el('span', { class: 'grid-count' }, `当前显示 ${visibleRecords.length} / ${t.records.length} 行`)
    );
    wrap.appendChild(toolbar);
    const table = el('table', { class: 'grid' });
    const thead = el('thead'); const headRow = el('tr');
    for (const f of visibleFields) {
      const widthStyle = { width: fieldWidth(f) + 'px', minWidth: fieldWidth(f) + 'px', maxWidth: fieldWidth(f) + 'px' };
      const head = el('div', { class: 'field-head' },
        el('span', { class: 'field-title', ondblclick: () => { if (AppFieldModal) AppFieldModal.renameField(f); }, title: `${f.name} · 双击重命名，右键打开字段菜单` }, f.name),
        el('span', { class: 'type' }, '· ' + f.type),
        el('button', {
          class: 'lock-btn' + (f.locked ? ' on' : ''),
          title: f.locked ? '已锁定（点击解锁）' : '锁定字段',
          onclick: () => { if (AppRecordOps) AppRecordOps.toggleLock(f); }
        }, f.locked ? '🔒' : '🔓'),
        el('span', { class: 'resize-handle', title: '拖动调整字段宽度', onmousedown: (e) => startResizeField(e, f) })
      );
      headRow.appendChild(el('th', {
        'data-field': f.id,
        style: widthStyle,
        oncontextmenu: (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (AppShell) AppShell.openFieldContextMenu(f, e.clientX, e.clientY);
        }
      }, head));
    }
    headRow.appendChild(el('th', { class: 'action' }, ''));
    thead.appendChild(headRow); table.appendChild(thead);

    // 共享上下文，供 renderSingleRow 使用
    var rowCtx = { t: t, visibleFields: visibleFields, AppCellEdit: AppCellEdit, AppRecordOps: AppRecordOps, AppLinkPicker: AppLinkPicker };

    // 判断是否启用虚拟滚动
    var useVirtualScroll = visibleRecords.length > VIRTUAL_SCROLL_THRESHOLD && typeof window.AppVirtualScroll !== 'undefined';

    if (useVirtualScroll) {
      // ---- 虚拟滚动模式 ----
      // 表头固定，tbody 区域由虚拟滚动接管
      var tbodyContainer = el('div', { class: 'cg-virtual-tbody-container' });
      table.appendChild(tbodyContainer);
      wrap.appendChild(table);

      // 添加行 footer 放在虚拟滚动容器之后
      var addRowDiv = el('div', {
        class: 'add-row cg-virtual-add-row',
        title: '也可以从 Excel/表格复制多行后点这里粘贴',
        tabindex: '0',
        onmousedown: () => { clearSelection(); state.pasteAppendMode = true; },
        onfocus: () => { clearSelection(); state.pasteAppendMode = true; },
        onclick: (e) => {
          if (e.shiftKey) { if (AppRecordOps) AppRecordOps.addMultipleRecords(t.id); }
          else { if (AppRecordOps) AppRecordOps.addRecord(t.id); }
        }
      }, '+ 添加一行 / 粘贴多行 (Shift+点击添加多行)');
      wrap.appendChild(addRowDiv);

      // 创建虚拟滚动实例
      window.AppVirtualScroll.createVirtualScroll(tbodyContainer, visibleRecords, function(record, index) {
        return renderSingleRow(record, index, rowCtx);
      }, {
        rowHeight: 36,
        buffer: 5,
        onScroll: function() {
          // 滚动后重新绘制选中高亮
          paintSelection();
        }
      });
    } else {
      // ---- 普通模式（记录数 <= 阈值） ----
      var tbody = el('tbody');
      visibleRecords.forEach((r, rowIdx) => {
        var tr = renderSingleRow(r, rowIdx, rowCtx);
        tbody.appendChild(tr);
      });

      // add row footer
      var addTr = el('tr');
      var addTd = el('td', {
        class: 'add-row',
        colspan: visibleFields.length + 1,
        title: '也可以从 Excel/表格复制多行后点这里粘贴',
        tabindex: '0',
        onmousedown: () => { clearSelection(); state.pasteAppendMode = true; },
        onfocus: () => { clearSelection(); state.pasteAppendMode = true; },
        onclick: (e) => {
          if (e.shiftKey) { if (AppRecordOps) AppRecordOps.addMultipleRecords(t.id); }
          else { if (AppRecordOps) AppRecordOps.addRecord(t.id); }
        }
      }, '+ 添加一行 / 粘贴多行 (Shift+点击添加多行)');
      addTr.appendChild(addTd); tbody.appendChild(addTr);

      table.appendChild(tbody);
      wrap.appendChild(table);
    }

    if (t.page && t.page.total > t.page.limit) {
      const start = t.page.offset + 1;
      const end = Math.min(t.page.offset + t.records.length, t.page.total);
      const { AppAuth } = window;
      wrap.appendChild(el('div', { class: 'pager' },
        el('button', { disabled: t.page.offset <= 0 ? 'disabled' : false, onclick: () => { if (AppAuth) AppAuth.loadTablePage(t.id, Math.max(0, t.page.offset - t.page.limit)); } }, '上一页'),
        el('span', {}, `${start}-${end} / ${t.page.total}`),
        el('button', { disabled: end >= t.page.total ? 'disabled' : false, onclick: () => { if (AppAuth) AppAuth.loadTablePage(t.id, t.page.offset + t.page.limit); } }, '下一页')
      ));
    }
    main.appendChild(wrap);

    // restore selection highlight after re-render
    paintSelection();

    if (state.showAudit && AppAudit) AppAudit.renderAuditPanel();
  }

  async function deleteLink(id) {
    try { await api('/api/links/' + id, { method: 'DELETE' }); } catch (e) { toast(e.message, 'err'); }
  }

  window.AppGridRender = {
    getActiveTable, cellValue, selectOptions, selectOptionForValue, recordTitle, linkRecordTitle,
    mergeTableSearchResult, roleOptions, findFieldEverywhere, lookupFieldDisplay, textFormulaDisplay,
    clearSelection, selectionRange, paintSelection, readDisplayValue,
    tableView, loadTableViews, saveTableViews, setFieldVisible, fieldByName,
    isResourceArchiveTable, resourceArchiveRuleOptions, applyResourceRule, visibleFieldsFor,
    fieldStyle, fieldCssStyle, normalizeStyleObject, parseCellStyle, cellStyle, cssFromStyle,
    focusedCellMeta, updateFocusedCellStyle, reorderField, openCellColorModal, openFieldManagerModal,
    visibleRecordsFor, fieldWidth, recordHeight, startResizeField, startResizeRecord,
    renderGrid, renderSingleRow, deleteLink, normalizeSelectOption
  };
})();
