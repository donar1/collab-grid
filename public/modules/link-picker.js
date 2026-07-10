// modules/link-picker.js — 关联记录选择器
(function() {
  'use strict';
  const { el, toast } = window;
  const { AppState: state } = window;
  const { api } = window;
  const FieldTools = window.CollabGridFields;
  const LinkTools = window.CollabGridLinks;
  const { AppGridRender } = window;
  const { AppAuth } = window;
  const { AppFieldModal } = window;

  function openLinkPicker(field, fromRecord) {
    const target = AppFieldModal.resolveLinkTargetTable(field, fromRecord);
    const multiple = FieldTools.linkAllowsMultiple(field);
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal' });
    modal.appendChild(el('h3', {}, LinkTools.pickerTitle(field)));
    if (!field.options?.tableId) {
      modal.appendChild(el('p', { class: 'desc' }, `这个关联字段还没有指定目标表。当前先使用「${target?.name || '无可用表'}」作为临时备选，建议点字段表头的「关联表」保存配置。`));
    } else {
      modal.appendChild(el('p', { class: 'desc' }, LinkTools.pickerDescription(target?.name, multiple)));
    }
    const searchInput = el('input', { class: 'link-search', placeholder: '搜索关联记录…' });
    modal.appendChild(searchInput);
    const summary = el('div', { class: 'link-picker-summary' });
    modal.appendChild(summary);
    const list = el('div', { class: 'link-choice-list' });

    const getActiveLinks = () => {
      const t = state.base.tables.find(tb => tb.records.some(rr => rr.id === fromRecord.id));
      if (!t) return [];
      return t.links.filter(l => l.field_id === field.id && l.from_record_id === fromRecord.id);
    };

    let searchTimer = null;
    const fetchChoices = async () => {
      if (!target) return;
      const q = searchInput.value.trim();
      const displayFieldId = field.options?.displayFieldId || '';
      try {
        const r = await api(`/api/tables/${target.id}/search?q=${encodeURIComponent(q)}&displayFieldId=${encodeURIComponent(displayFieldId)}&limit=50`);
        AppGridRender.mergeTableSearchResult(target, r);
        renderChoices(r.records.map(x => x.id), r.page);
      } catch (e) { toast(e.message, 'err'); }
    };

    const renderChoices = (candidateIds = null, pageInfo = null) => {
      list.innerHTML = '';
      const q = searchInput.value.trim().toLowerCase();
      if (!target) {
        list.appendChild(el('div', { class: 'empty-option' }, '没有可关联的数据表。请先新建另一张表，或点字段表头「关联表」重新配置。'));
        summary.textContent = '';
        return;
      }
      const linkedSet = new Set(getActiveLinks().map(l => l.to_record_id));
      summary.textContent = pageInfo ? `${LinkTools.summaryText(linkedSet.size, multiple)} · 搜到 ${pageInfo.total} 条，显示前 ${Math.min(pageInfo.total, pageInfo.limit)} 条` : LinkTools.summaryText(linkedSet.size, multiple);
      const sourceRecords = candidateIds ? candidateIds.map(id => target.records.find(r => r.id === id)).filter(Boolean) : target.records;
      const matched = candidateIds ? sourceRecords : sourceRecords.filter(r => AppGridRender.linkRecordTitle(field, r.id).toLowerCase().includes(q));
      if (!target.records.length) {
        list.appendChild(el('div', { class: 'empty-option' }, `「${target.name}」没有记录，先去那张表添加一行。`));
        return;
      }
      if (!matched.length) {
        list.appendChild(el('div', { class: 'empty-option' }, '没有匹配的记录'));
        return;
      }
      for (const r of matched) {
        const title = AppGridRender.linkRecordTitle(field, r.id);
        const isLinked = linkedSet.has(r.id);
        list.appendChild(el('button', {
          class: 'link-choice-btn' + (isLinked ? ' linked' : ''),
          onclick: async () => {
            try {
              if (isLinked) {
                const t = state.base.tables.find(tb => tb.records.some(rr => rr.id === fromRecord.id));
                const lk = t?.links.find(l => l.field_id === field.id && l.from_record_id === fromRecord.id && l.to_record_id === r.id);
                if (lk) await api('/api/links/' + lk.id, { method: 'DELETE' });
                if (AppAuth) await AppAuth.openBase(state.currentBaseId);
                renderChoices();
              } else {
                await api('/api/links', { method: 'POST', body: { fieldId: field.id, fromRecordId: fromRecord.id, toRecordId: r.id } });
                if (AppAuth) await AppAuth.openBase(state.currentBaseId);
                if (multiple) renderChoices();
                else mask.remove();
              }
            } catch (e) { toast(e.message, 'err'); }
          }
        }, isLinked ? `✓ ${multiple ? '已关联' : '当前'}：${title}` : title));
      }
    };
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(fetchChoices, 180);
    });
    fetchChoices();
    modal.appendChild(list);
    const actions = el('div', { class: 'actions' });
    actions.appendChild(el('button', { class: 'primary', onclick: () => mask.remove() }, '完成'));
    modal.appendChild(actions);
    mask.appendChild(modal); document.body.appendChild(mask);
    setTimeout(() => searchInput.focus(), 0);
  }

  window.AppLinkPicker = { openLinkPicker };
})();
