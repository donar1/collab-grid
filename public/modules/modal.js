// modules/modal.js — 模态框和通知组件 (v20260624-p9)
(function (global) {
  const $ = global.$ || ((q, root = document) => root.querySelector(q));
  const el = global.el || ((tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(c) : c);
    }
    return e;
  });

  function toast(msg, kind) {
    const t = el('div', { class: 'toast' + (kind ? ' ' + kind : '') }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2400);
  }

  function askText({ title, desc = '', label = '名称', value = '', placeholder = '' }) {
    return new Promise((resolve) => {
      const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) close(null); } });
      const modal = el('div', { class: 'modal' });
      const input = el('input', { value, placeholder });

      function close(result) {
        mask.remove();
        resolve(result);
      }

      modal.appendChild(el('h3', {}, title));
      if (desc) modal.appendChild(el('p', { class: 'desc' }, desc));
      modal.appendChild(el('label', {}, label));
      modal.appendChild(input);
      const actions = el('div', { class: 'actions' });
      actions.appendChild(el('button', { onclick: () => close(null) }, '取消'));
      actions.appendChild(el('button', { class: 'primary', onclick: () => close(input.value.trim()) }, '确定'));
      modal.appendChild(actions);
      mask.appendChild(modal);
      document.body.appendChild(mask);
      setTimeout(() => { input.focus(); input.select(); }, 0);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') close(input.value.trim());
        if (e.key === 'Escape') close(null);
      });
    });
  }

  function askConfirm({ title, desc = '', okText = '确定', danger = false }) {
    return new Promise((resolve) => {
      const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) close(false); } });
      const modal = el('div', { class: 'modal' });

      function close(result) {
        mask.remove();
        resolve(result);
      }

      modal.appendChild(el('h3', {}, title));
      if (desc) modal.appendChild(el('p', { class: 'desc' }, desc));
      const actions = el('div', { class: 'actions' });
      actions.appendChild(el('button', { onclick: () => close(false) }, '取消'));
      actions.appendChild(el('button', {
        class: 'primary',
        style: danger ? { background: 'var(--cg-danger)', borderColor: 'var(--cg-danger)' } : {},
        onclick: () => close(true)
      }, okText));
      modal.appendChild(actions);
      mask.appendChild(modal);
      document.body.appendChild(mask);
    });
  }

  global.CollabGridModal = { toast, askText, askConfirm };
})(window);
