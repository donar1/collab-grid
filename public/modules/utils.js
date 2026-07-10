// modules/utils.js — 工具函数
const $ = (q, root = document) => root.querySelector(q);

const el = (tag, attrs = {}, ...children) => {
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
};

const fmtTime = (ts) => {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function toast(msg, type = 'info') {
  const t = el('div', { class: `toast ${type}`, style: { position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999' } }, msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

function confirmModal(title, message, okText = '确定', danger = false) {
  return new Promise((resolve) => {
    const mask = el('div', { class: 'modal-mask' });
    const modal = el('div', { class: 'modal' });
    const close = (v) => { mask.remove(); resolve(v); };
    modal.appendChild(el('h3', {}, title));
    if (message) modal.appendChild(el('p', {}, message));
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

// 挂载到 window，供 IIFE 模块通过 const { $, el, fmtTime, toast, confirmModal } = window; 解构使用
window.$ = $;
window.el = el;
window.fmtTime = fmtTime;
window.toast = toast;
window.confirmModal = confirmModal;
