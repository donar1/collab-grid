// modules/field-modal.js — 新增字段弹窗 + 选项维护 + 关联配置 + Lookup配置 + 字段管理器 + 颜色选择器
(function() {
  'use strict';
  const { el, toast } = window;
  const { AppState: state } = window;
  const { api } = window;
  const { askText } = window.CollabGridModal || {};
  const FieldTools = window.CollabGridFields;
  const { AppGridRender } = window;
  const { AppAuth } = window;

  function parseOptionText(text) {
    return [...new Set(String(text || '').split(/\r?\n|,/).map(v => v.trim()).filter(Boolean))]
      .map(label => ({ label, color: '#64748b' }));
  }

  function collectSelectOptionRows(container) {
    const seen = new Set();
    const values = [];
    container.querySelectorAll('.option-row').forEach(row => {
      const label = row.querySelector('.option-label')?.value.trim();
      const color = row.querySelector('.option-color')?.value || '#64748b';
      if (!label || seen.has(label)) return;
      seen.add(label);
      values.push({ label, color });
    });
    return values;
  }

  function openSelectOptionsModal(f) {
    if (f.locked) return toast('字段已锁定，先解锁再修改选项', 'warn');
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal' });
    modal.appendChild(el('h3', {}, '维护单选项'));
    modal.appendChild(el('p', { class: 'desc' }, `字段「${f.name}」的选项。每个选项右侧都有一个独立的颜色块，点开调色板即可换色。`));
    const header = el('div', { class: 'option-row option-row-header' },
      el('span', { class: 'option-col-title' }, '选项名称'),
      el('span', { class: 'option-col-title' }, '颜色'),
      el('span', { class: 'option-col-title' }, '操作')
    );
    const rows = el('div', { class: 'option-editor' });
    rows.appendChild(header);
    const addOptionRow = (option = { label: '', color: '#64748b' }) => {
      const opt = FieldTools.normalizeSelectOption(option);
      const swatch = el('span', { class: 'option-swatch', style: { background: opt.color } });
      const colorInput = el('input', { class: 'option-color', type: 'color', value: opt.color, title: '点击选择颜色' });
      colorInput.addEventListener('input', () => { swatch.style.background = colorInput.value; });
      const colorBox = el('label', { class: 'option-color-box', title: '点击选择颜色' }, swatch, colorInput);
      const row = el('div', { class: 'option-row' },
        el('input', { class: 'option-label', value: opt.label, placeholder: '选项名称' }),
        colorBox,
        el('button', { class: 'option-remove', onclick: () => row.remove() }, '删除')
      );
      rows.appendChild(row);
    };
    const existing = AppGridRender.selectOptions(f);
    (existing.length ? existing : [{ label: '待处理', color: '#64748b' }]).forEach(addOptionRow);
    modal.appendChild(rows);
    modal.appendChild(el('button', { class: 'inline-add-btn', onclick: () => addOptionRow({ label: '', color: '#64748b' }) }, '+ 添加选项'));
    const actions = el('div', { class: 'actions' });
    actions.appendChild(el('button', { onclick: () => mask.remove() }, '取消'));
    actions.appendChild(el('button', { class: 'primary', onclick: async () => {
      const values = collectSelectOptionRows(rows);
      try {
        await api('/api/fields/' + f.id, { method: 'PATCH', body: { options: { values } } });
        if (AppAuth) await AppAuth.openBase(state.currentBaseId);
        mask.remove();
      } catch (e) { toast(e.message, 'err'); }
    } }, '保存选项'));
    modal.appendChild(actions);
    mask.appendChild(modal);
    document.body.appendChild(mask);
    setTimeout(() => rows.querySelector('input.option-label')?.focus(), 0);
  }

  function sourceTableOfRecord(recordId) {
    return state.base?.tables.find(t => t.records.some(r => r.id === recordId)) || null;
  }

  function resolveLinkTargetTable(field, fromRecord) {
    const configured = state.base?.tables.find(t => t.id === field.options?.tableId);
    if (configured) return configured;
    const source = fromRecord ? sourceTableOfRecord(fromRecord.id) : null;
    return state.base?.tables.find(t => t.id !== source?.id) || null;
  }

  function openLinkOptionsModal(f) {
    if (f.locked) return toast('字段已锁定，先解锁再修改关联表', 'warn');
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal' });
    modal.appendChild(el('h3', {}, '配置关联表'));
    modal.appendChild(el('p', { class: 'desc' }, `字段「${f.name}」会从目标表里选择记录，并在单元格里显示关联标签。`));
    modal.appendChild(el('label', {}, '关联到的表'));
    const tableSel = el('select');
    for (const tb of state.base.tables) {
      tableSel.appendChild(el('option', { value: tb.id, selected: f.options?.tableId === tb.id ? 'selected' : false }, tb.name));
    }
    const fallback = state.base.tables.find(t => t.id !== AppGridRender.getActiveTable()?.id) || state.base.tables[0];
    tableSel.value = f.options?.tableId || fallback?.id || '';
    modal.appendChild(tableSel);
    modal.appendChild(el('label', {}, '显示列'));
    const displaySel = el('select');
    const fillDisplayFields = () => {
      displaySel.innerHTML = '';
      const target = state.base.tables.find(t => t.id === tableSel.value);
      if (!target || !target.fields.length) {
        displaySel.appendChild(el('option', { value: '' }, '目标表暂无字段'));
        return;
      }
      for (const field of target.fields) {
        displaySel.appendChild(el('option', {
          value: field.id,
          selected: f.options?.displayFieldId === field.id ? 'selected' : false
        }, field.name));
      }
      displaySel.value = target.fields.some(field => field.id === f.options?.displayFieldId)
        ? f.options.displayFieldId
        : target.fields[0].id;
    };
    tableSel.addEventListener('change', fillDisplayFields);
    fillDisplayFields();
    modal.appendChild(displaySel);
    modal.appendChild(el('label', {}, '关联模式'));
    const multipleSel = el('select');
    multipleSel.appendChild(el('option', { value: 'single', selected: !FieldTools.linkAllowsMultiple(f) ? 'selected' : false }, '单选 — 每行只关联一条记录'));
    multipleSel.appendChild(el('option', { value: 'multiple', selected: FieldTools.linkAllowsMultiple(f) ? 'selected' : false }, '多选 — 每行可关联多条记录'));
    multipleSel.value = FieldTools.linkAllowsMultiple(f) ? 'multiple' : 'single';
    modal.appendChild(multipleSel);
    const actions = el('div', { class: 'actions' });
    actions.appendChild(el('button', { onclick: () => mask.remove() }, '取消'));
    actions.appendChild(el('button', { class: 'primary', onclick: async () => {
      if (!tableSel.value) return toast('没有可关联的数据表', 'warn');
      try {
        await api('/api/fields/' + f.id, { method: 'PATCH', body: { options: { tableId: tableSel.value, displayFieldId: displaySel.value, multiple: multipleSel.value === 'multiple' } } });
        if (AppAuth) await AppAuth.openBase(state.currentBaseId);
        mask.remove();
      } catch (e) { toast(e.message, 'err'); }
    } }, '保存'));
    modal.appendChild(actions);
    mask.appendChild(modal);
    document.body.appendChild(mask);
  }

  // ---------- field modal ----------
  function openFieldModal(tableId) {
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal' });
    modal.appendChild(el('h3', {}, '新增字段'));
    modal.appendChild(el('p', { class: 'desc' }, '选好类型后续不可修改（demo 限制）。link 类型用来关联其他表的记录；lookup 类型从已有的关联里把目标表某一列的值带过来，可以选「锁定」一次性快照或「联动」实时同步。'));
    modal.appendChild(el('label', {}, '名称'));
    const nameI = el('input', { value: '新字段' }); modal.appendChild(nameI);
    modal.appendChild(el('label', {}, '类型'));
    const typeS = el('select');
    for (const opt of [['text','文本'], ['multiLineText','多行文本'], ['number','数字'], ['currency','金额'], ['checkbox','复选框'], ['attachment','附件/图片'], ['date','日期'], ['createdTime','创建时间'], ['lastModifiedTime','最后修改时间'], ['lastModifiedBy','最后修改人'], ['autoNumber','自动编号'], ['formula','数字公式'], ['textFormula','合成文字'], ['button','按钮'], ['select','单选'], ['link','关联'], ['lookup','关联字段(lookup)']])
      typeS.appendChild(el('option', { value: opt[0] }, opt[1]));
    modal.appendChild(typeS);

    const autoBox = el('div', { style: { display: 'none' } });
    autoBox.appendChild(el('label', {}, '编号前缀'));
    const autoPrefix = el('input', { value: 'AUTO-' }); autoBox.appendChild(autoPrefix);
    autoBox.appendChild(el('label', {}, '补零位数'));
    const autoPad = el('input', { type: 'number', value: '4' }); autoBox.appendChild(autoPad);
    modal.appendChild(autoBox);

    const formulaBox = el('div', { style: { display: 'none' } });
    formulaBox.appendChild(el('label', {}, '公式表达式'));
    const formulaInput = el('input', { value: '{数量} * {单价}', placeholder: '例如：{数量} * {单价}' });
    formulaBox.appendChild(formulaInput);
    formulaBox.appendChild(el('p', { class: 'desc' }, '数字公式支持字段名占位符和 + - * / ()；合成文字支持 `{字段名}` 拼接，例如 `{名称} {规格} {地区}`。'));
    modal.appendChild(formulaBox);

    const currencyBox = el('div', { style: { display: 'none' } });
    currencyBox.appendChild(el('label', {}, '货币符号'));
    const currencySymbol = el('input', { value: '¥' }); currencyBox.appendChild(currencySymbol);
    modal.appendChild(currencyBox);

    const buttonBox = el('div', { style: { display: 'none' } });
    buttonBox.appendChild(el('label', {}, '按钮文字'));
    const buttonLabel = el('input', { value: '封账' }); buttonBox.appendChild(buttonLabel);
    buttonBox.appendChild(el('label', {}, '按钮动作'));
    const buttonAction = el('select');
    buttonAction.appendChild(el('option', { value: 'seal_record', selected: 'selected' }, '封账当前行'));
    buttonAction.appendChild(el('option', { value: 'unseal_record' }, '解除封账'));
    buttonAction.appendChild(el('option', { value: 'approve_resource' }, '资源审批通过'));
    buttonAction.appendChild(el('option', { value: 'approve_business_lock' }, '业务锁定审批通过'));
    buttonAction.appendChild(el('option', { value: 'approve_inventory_operation' }, '库存出入库审核通过'));
    buttonAction.appendChild(el('option', { value: 'seal_finance_record' }, '财务封账'));
    buttonAction.appendChild(el('option', { value: 'approve_finance_reversal' }, '财务红冲审核通过'));
    buttonAction.appendChild(el('option', { value: 'approve_order_refund' }, '订单退款审核通过'));
    buttonAction.appendChild(el('option', { value: 'approve_order_cancel' }, '订单撤单审核通过'));
    buttonBox.appendChild(buttonAction);
    modal.appendChild(buttonBox);

    const linkBox = el('div', { style: { display: 'none' } });
    linkBox.appendChild(el('label', {}, '关联到的表'));
    const linkSel = el('select');
    for (const tb of state.base.tables) linkSel.appendChild(el('option', { value: tb.id }, tb.name));
    linkBox.appendChild(linkSel);
    linkBox.appendChild(el('label', {}, '显示列'));
    const linkDisplaySel = el('select');
    const fillNewLinkDisplayFields = () => {
      linkDisplaySel.innerHTML = '';
      const target = state.base.tables.find(t => t.id === linkSel.value);
      if (!target || !target.fields.length) {
        linkDisplaySel.appendChild(el('option', { value: '' }, '目标表暂无字段'));
        return;
      }
      for (const field of target.fields) linkDisplaySel.appendChild(el('option', { value: field.id }, field.name));
    };
    linkSel.addEventListener('change', fillNewLinkDisplayFields);
    fillNewLinkDisplayFields();
    linkBox.appendChild(linkDisplaySel);
    linkBox.appendChild(el('label', {}, '关联模式'));
    const linkMultipleSel = el('select');
    linkMultipleSel.appendChild(el('option', { value: 'single', selected: 'selected' }, '单选 — 每行只关联一条记录'));
    linkMultipleSel.appendChild(el('option', { value: 'multiple' }, '多选 — 每行可关联多条记录'));
    linkBox.appendChild(linkMultipleSel);
    modal.appendChild(linkBox);

    // lookup config
    const lookupBox = el('div', { style: { display: 'none' } });
    lookupBox.appendChild(el('label', {}, '基于哪个关联字段（本表）'));
    const lookupLinkSel = el('select');
    lookupBox.appendChild(lookupLinkSel);
    lookupBox.appendChild(el('label', {}, '从目标表带哪一列过来'));
    const lookupSourceSel = el('select');
    lookupBox.appendChild(lookupSourceSel);
    lookupBox.appendChild(el('label', {}, '同步方式'));
    const lookupModeSel = el('select');
    lookupModeSel.appendChild(el('option', { value: 'live', selected: 'selected' }, '联动 — 跟随源数据变更'));
    lookupModeSel.appendChild(el('option', { value: 'snapshot' }, '锁定 — 建立关联那一刻的快照'));
    lookupBox.appendChild(lookupModeSel);
    modal.appendChild(lookupBox);

    const fillLookupSelectors = () => {
      lookupLinkSel.innerHTML = '';
      lookupSourceSel.innerHTML = '';
      const tbl = state.base.tables.find(t => t.id === tableId);
      if (!tbl) return;
      const linkFields = tbl.fields.filter(f => f.type === 'link');
      if (!linkFields.length) {
        lookupLinkSel.appendChild(el('option', { value: '' }, '本表暂无 link 字段，先新建一个'));
        lookupSourceSel.appendChild(el('option', { value: '' }, '—'));
        return;
      }
      for (const lf of linkFields) lookupLinkSel.appendChild(el('option', { value: lf.id }, lf.name));
      const refresh = () => {
        lookupSourceSel.innerHTML = '';
        const lf = tbl.fields.find(f => f.id === lookupLinkSel.value);
        const targetId = lf?.options?.tableId;
        const target = state.base.tables.find(t => t.id === targetId);
        if (!target) {
          lookupSourceSel.appendChild(el('option', { value: '' }, '该关联字段未配置目标表'));
          return;
        }
        for (const sf of target.fields) {
          if (sf.type === 'link' || sf.type === 'lookup') continue;
          lookupSourceSel.appendChild(el('option', { value: sf.id }, sf.name + (sf.type === 'select' ? '（单选）' : '')));
        }
      };
      lookupLinkSel.onchange = refresh;
      refresh();
    };

    const selectBox = el('div', { style: { display: 'none' } });
    selectBox.appendChild(el('label', {}, '单选项'));
    const newSelectRows = el('div', { class: 'option-editor' });
    newSelectRows.appendChild(el('div', { class: 'option-row option-row-header' },
      el('span', { class: 'option-col-title' }, '选项名称'),
      el('span', { class: 'option-col-title' }, '颜色'),
      el('span', { class: 'option-col-title' }, '操作')
    ));
    const addNewSelectOptionRow = (option = { label: '', color: '#64748b' }) => {
      const opt = FieldTools.normalizeSelectOption(option);
      const swatch = el('span', { class: 'option-swatch', style: { background: opt.color } });
      const colorInput = el('input', { class: 'option-color', type: 'color', value: opt.color, title: '点击选择颜色' });
      colorInput.addEventListener('input', () => { swatch.style.background = colorInput.value; });
      const colorBox = el('label', { class: 'option-color-box', title: '点击选择颜色' }, swatch, colorInput);
      const row = el('div', { class: 'option-row' },
        el('input', { class: 'option-label', value: opt.label, placeholder: '选项名称' }),
        colorBox,
        el('button', { class: 'option-remove', onclick: () => row.remove() }, '删除')
      );
      newSelectRows.appendChild(row);
    };
    addNewSelectOptionRow({ label: '待处理', color: '#64748b' });
    addNewSelectOptionRow({ label: '进行中', color: '#3b82f6' });
    addNewSelectOptionRow({ label: '已完成', color: '#10b981' });
    selectBox.appendChild(newSelectRows);
    selectBox.appendChild(el('button', { class: 'inline-add-btn', onclick: () => addNewSelectOptionRow({ label: '', color: '#64748b' }) }, '+ 添加选项'));
    modal.appendChild(selectBox);

    typeS.addEventListener('change', () => {
      linkBox.style.display = typeS.value === 'link' ? 'block' : 'none';
      selectBox.style.display = typeS.value === 'select' ? 'block' : 'none';
      lookupBox.style.display = typeS.value === 'lookup' ? 'block' : 'none';
      autoBox.style.display = typeS.value === 'autoNumber' ? 'block' : 'none';
      formulaBox.style.display = (typeS.value === 'formula' || typeS.value === 'textFormula') ? 'block' : 'none';
      currencyBox.style.display = typeS.value === 'currency' ? 'block' : 'none';
      buttonBox.style.display = typeS.value === 'button' ? 'block' : 'none';
      if (typeS.value === 'lookup') fillLookupSelectors();
    });

    const actions = el('div', { class: 'actions' });
    actions.appendChild(el('button', { onclick: () => mask.remove() }, '取消'));
    actions.appendChild(el('button', { class: 'primary', onclick: async () => {
      const body = { name: nameI.value.trim() || '新字段', type: typeS.value };
      if (typeS.value === 'autoNumber') body.options = { prefix: autoPrefix.value || 'AUTO-', pad: Number(autoPad.value) || 4, start: 1 };
      if (typeS.value === 'currency') body.options = { symbol: currencySymbol.value || '¥', precision: 2 };
      if (typeS.value === 'formula' || typeS.value === 'textFormula') body.options = { expression: formulaInput.value };
      if (typeS.value === 'button') body.options = { label: buttonLabel.value || '执行', action: buttonAction.value };
      if (typeS.value === 'link') body.options = { tableId: linkSel.value, displayFieldId: linkDisplaySel.value, multiple: linkMultipleSel.value === 'multiple' };
      if (typeS.value === 'select') body.options = { values: collectSelectOptionRows(newSelectRows) };
      if (typeS.value === 'lookup') {
        if (!lookupLinkSel.value || !lookupSourceSel.value) return toast('请先选择关联字段和源表列', 'warn');
        body.options = { linkFieldId: lookupLinkSel.value, sourceFieldId: lookupSourceSel.value, mode: lookupModeSel.value };
      }
      try {
        await api('/api/tables/' + tableId + '/fields', { method: 'POST', body });
        mask.remove();
      } catch (e) { toast(e.message, 'err'); }
    } }, '创建'));
    modal.appendChild(actions);
    mask.appendChild(modal);
    document.body.appendChild(mask);
  }

  function openLookupOptionsModal(f) {
    if (f.locked) return toast('字段已锁定，先解锁再修改', 'warn');
    const tableMeta = state.base.tables.find(t => t.fields.some(ff => ff.id === f.id));
    if (!tableMeta) return;
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal' });
    modal.appendChild(el('h3', {}, '配置关联字段(lookup)'));
    modal.appendChild(el('p', { class: 'desc' }, `字段「${f.name}」会顺着本表的关联字段，把目标表里某一列的内容带过来显示。`));
    modal.appendChild(el('label', {}, '基于哪个关联字段（本表）'));
    const linkSel = el('select');
    const linkFields = tableMeta.fields.filter(ff => ff.type === 'link');
    if (!linkFields.length) {
      modal.appendChild(el('p', { class: 'desc' }, '本表暂无 link 字段，需要先新建一个 link 字段。'));
    }
    for (const lf of linkFields) linkSel.appendChild(el('option', { value: lf.id, selected: f.options?.linkFieldId === lf.id ? 'selected' : false }, lf.name));
    if (linkFields.length && f.options?.linkFieldId) linkSel.value = f.options.linkFieldId;
    modal.appendChild(linkSel);
    modal.appendChild(el('label', {}, '从目标表带哪一列过来'));
    const sourceSel = el('select');
    modal.appendChild(sourceSel);
    modal.appendChild(el('label', {}, '同步方式'));
    const modeSel = el('select');
    modeSel.appendChild(el('option', { value: 'live', selected: (f.options?.mode || 'live') === 'live' ? 'selected' : false }, '联动 — 跟随源数据变更'));
    modeSel.appendChild(el('option', { value: 'snapshot', selected: f.options?.mode === 'snapshot' ? 'selected' : false }, '锁定 — 建立关联那一刻的快照'));
    if (f.options?.mode) modeSel.value = f.options.mode;
    modal.appendChild(modeSel);

    const fillSourceFields = () => {
      sourceSel.innerHTML = '';
      const lf = tableMeta.fields.find(ff => ff.id === linkSel.value);
      const targetId = lf?.options?.tableId;
      const target = state.base.tables.find(t => t.id === targetId);
      if (!target) {
        sourceSel.appendChild(el('option', { value: '' }, '该关联字段未配置目标表'));
        return;
      }
      for (const sf of target.fields) {
        if (sf.type === 'link' || sf.type === 'lookup') continue;
        sourceSel.appendChild(el('option', { value: sf.id, selected: f.options?.sourceFieldId === sf.id ? 'selected' : false }, sf.name + (sf.type === 'select' ? '（单选）' : '')));
      }
      if (f.options?.sourceFieldId && [...sourceSel.options].some(o => o.value === f.options.sourceFieldId)) {
        sourceSel.value = f.options.sourceFieldId;
      }
    };
    linkSel.addEventListener('change', fillSourceFields);
    fillSourceFields();

    const actions = el('div', { class: 'actions' });
    actions.appendChild(el('button', { onclick: () => mask.remove() }, '取消'));
    actions.appendChild(el('button', { class: 'primary', onclick: async () => {
      if (!linkSel.value || !sourceSel.value) return toast('请先完成关联字段和源表列的选择', 'warn');
      try {
        await api('/api/fields/' + f.id, { method: 'PATCH', body: { options: { linkFieldId: linkSel.value, sourceFieldId: sourceSel.value, mode: modeSel.value } } });
        if (AppAuth) await AppAuth.openBase(state.currentBaseId);
        mask.remove();
      } catch (e) { toast(e.message, 'err'); }
    } }, '保存'));
    modal.appendChild(actions);
    mask.appendChild(modal); document.body.appendChild(mask);
  }

  async function toggleLock(f) {
    try { await api('/api/fields/' + f.id + '/lock', { method: 'PATCH', body: { locked: !f.locked } }); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function renameField(f) {
    if (f.locked) return toast('字段已锁定', 'warn');
    const name = await askText({
      title: '重命名字段',
      label: '字段名称',
      value: f.name
    });
    if (!name || name === f.name) return;
    try { await api('/api/fields/' + f.id, { method: 'PATCH', body: { name } }); }
    catch (e) { toast(e.message, 'err'); }
  }

  function localAskConfirm(title, desc, okText, danger) {
    return new Promise(function(resolve) {
      var mask = el('div', { class: 'modal-mask', onclick: function(e) { if (e.target === mask) close(false); } });
      var modal = el('div', { class: 'modal' });
      function close(result) { mask.remove(); resolve(result); }
      modal.appendChild(el('h3', {}, title));
      if (desc) modal.appendChild(el('p', { class: 'desc' }, desc));
      var actions = el('div', { class: 'actions' });
      actions.appendChild(el('button', { onclick: function() { close(false); } }, '取消'));
      var confirmStyle = danger ? { background: 'var(--cg-danger)', borderColor: 'var(--cg-danger)' } : {};
      actions.appendChild(el('button', { class: 'primary', style: confirmStyle, onclick: function() { close(true); } }, okText || '确定'));
      modal.appendChild(actions);
      mask.appendChild(modal);
      document.body.appendChild(mask);
    });
  }

  async function deleteField(f) {
    if (f.locked) return toast('字段已锁定，先解锁再删除', 'warn');
    var ok = await localAskConfirm('删除字段？', '将删除字段「' + f.name + '」以及该字段下的所有单元格值。关联字段还会删除对应关联关系。这个操作不可恢复。', '删除字段', true);
    if (!ok) return;
    try { await api('/api/fields/' + f.id, { method: 'DELETE' }); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function openAutoNumberSettings(f) {
    if (f.locked) return toast('字段已锁定，先解锁再修改设置', 'warn');
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal' });
    modal.appendChild(el('h3', {}, '编号设置'));
    modal.appendChild(el('p', { class: 'desc' }, `字段「${f.name}」的自动编号规则。修改后新记录将使用新的编号规则。`));
    const currentOpts = f.options || {};
    modal.appendChild(el('label', {}, '编号前缀'));
    const prefixInput = el('input', { value: currentOpts.prefix || 'AUTO-' });
    modal.appendChild(prefixInput);
    modal.appendChild(el('label', {}, '补零位数'));
    const padInput = el('input', { type: 'number', value: String(currentOpts.pad || 4), min: '1', max: '10' });
    modal.appendChild(padInput);
    modal.appendChild(el('label', {}, '初始值'));
    const startInput = el('input', { type: 'number', value: String(currentOpts.start || 1), min: '1' });
    modal.appendChild(startInput);
    modal.appendChild(el('p', { class: 'desc' }, '预览：' + (currentOpts.prefix || 'AUTO-') + String(currentOpts.start || 1).padStart(currentOpts.pad || 4, '0')));
    const preview = modal.querySelector('p.desc:last-of-type');
    const updatePreview = () => {
      const p = prefixInput.value || 'AUTO-';
      const pad = Math.max(1, Math.min(10, Number(padInput.value) || 4));
      const start = Math.max(1, Number(startInput.value) || 1);
      preview.textContent = '预览：' + p + String(start).padStart(pad, '0');
    };
    prefixInput.addEventListener('input', updatePreview);
    padInput.addEventListener('input', updatePreview);
    startInput.addEventListener('input', updatePreview);
    const actions = el('div', { class: 'actions' });
    actions.appendChild(el('button', { onclick: () => mask.remove() }, '取消'));
    actions.appendChild(el('button', { class: 'primary', onclick: async () => {
      const prefix = prefixInput.value || 'AUTO-';
      const pad = Math.max(1, Math.min(10, Number(padInput.value) || 4));
      const start = Math.max(1, Number(startInput.value) || 1);
      try {
        await api('/api/fields/' + f.id, { method: 'PATCH', body: { options: { prefix, pad, start } } });
        if (AppAuth) await AppAuth.openBase(state.currentBaseId);
        mask.remove();
        toast('编号设置已更新');
      } catch (e) { toast(e.message, 'err'); }
    } }, '保存'));
    modal.appendChild(actions);
    mask.appendChild(modal);
    document.body.appendChild(mask);
    setTimeout(() => prefixInput.focus(), 0);
  }

  async function openTimeFieldSettings(f) {
    if (f.locked) return toast('字段已锁定，先解锁再修改设置', 'warn');
    const tableMeta = state.base.tables.find(t => t.fields.some(ff => ff.id === f.id));
    if (!tableMeta) return;
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal' });
    modal.appendChild(el('h3', {}, f.type === 'createdTime' ? '创建时间设置' : '最后修改时间设置'));
    modal.appendChild(el('p', { class: 'desc' }, `字段「${f.name}」的显示格式与选项。`));

    const currentOpts = f.options || {};

    // 显示秒开关
    modal.appendChild(el('label', {}, '显示秒'));
    const showSecondsCheck = el('input', { type: 'checkbox', checked: currentOpts.showSeconds !== false ? 'checked' : false });
    modal.appendChild(showSecondsCheck);

    // 自定义格式模板
    modal.appendChild(el('label', {}, '自定义格式模板（可选）'));
    const formatInput = el('input', { value: currentOpts.format || '', placeholder: '例如：yyyy-mm-dd HH:MM:ss' });
    modal.appendChild(formatInput);
    modal.appendChild(el('p', { class: 'desc' }, '占位符：yyyy=年 yy=年(两位) mm=月 dd=日 HH=时 MM=分 ss=秒。留空则使用默认格式。'));

    // lastModifiedTime 额外显示「监控范围」选择
    var monitorSelect = null;
    var monitorBox = null;
    if (f.type === 'lastModifiedTime') {
      monitorBox = el('div');
      monitorBox.appendChild(el('label', {}, '监控范围'));
      monitorSelect = el('select');
      monitorSelect.appendChild(el('option', { value: 'all', selected: (!currentOpts.monitor || currentOpts.monitor === 'all') ? 'selected' : false }, '全部字段'));
      monitorSelect.appendChild(el('option', { value: 'selected', selected: Array.isArray(currentOpts.monitor) ? 'selected' : false }, '指定字段'));
      monitorBox.appendChild(monitorSelect);

      // 指定字段多选框容器
      const selectedFieldsBox = el('div', { style: { display: Array.isArray(currentOpts.monitor) ? 'block' : 'none', marginTop: '8px' } });
      const currentMonitor = Array.isArray(currentOpts.monitor) ? currentOpts.monitor : [];
      for (const ff of tableMeta.fields) {
        if (ff.id === f.id) continue;
        const isChecked = currentMonitor.includes(ff.id);
        const row = el('label', { style: { display: 'block', margin: '4px 0' } },
          el('input', { type: 'checkbox', value: ff.id, checked: isChecked ? 'checked' : false, class: 'monitor-field-check' }),
          ff.name
        );
        selectedFieldsBox.appendChild(row);
      }
      monitorSelect.addEventListener('change', () => {
        selectedFieldsBox.style.display = monitorSelect.value === 'selected' ? 'block' : 'none';
      });
      monitorBox.appendChild(selectedFieldsBox);
      modal.appendChild(monitorBox);
    }

    const actions = el('div', { class: 'actions' });
    actions.appendChild(el('button', { onclick: () => mask.remove() }, '取消'));
    actions.appendChild(el('button', { class: 'primary', onclick: async () => {
      const showSeconds = showSecondsCheck.checked;
      const format = formatInput.value.trim();
      const options = { showSeconds, format };
      if (f.type === 'lastModifiedTime') {
        if (monitorSelect && monitorSelect.value === 'selected') {
          const checked = [];
          if (monitorBox) {
            monitorBox.querySelectorAll('.monitor-field-check').forEach(cb => {
              if (cb.checked) checked.push(cb.value);
            });
          }
          options.monitor = checked.length ? checked : 'all';
        } else {
          options.monitor = 'all';
        }
      }
      try {
        await api('/api/fields/' + f.id, { method: 'PATCH', body: { options } });
        if (AppAuth) await AppAuth.openBase(state.currentBaseId);
        mask.remove();
        toast('设置已更新');
      } catch (e) { toast(e.message, 'err'); }
    } }, '保存'));
    modal.appendChild(actions);
    mask.appendChild(modal);
    document.body.appendChild(mask);
  }

  window.AppFieldModal = {
    openSelectOptionsModal, openLinkOptionsModal, openFieldModal, openLookupOptionsModal,
    toggleLock, renameField, deleteField, resolveLinkTargetTable, sourceTableOfRecord,
    openAutoNumberSettings, openTimeFieldSettings
  };
})();
