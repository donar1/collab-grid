// modules/auth.js — 登录/注册界面 + boot启动流程
(function() {
  'use strict';
  const { $, el, toast, api, fetchCsrfToken } = window;
  const { AppState: state } = window;
  const { askText } = window.CollabGridModal || {};

  // ---------- routing ----------
  function checkInviteFromUrl() {
    const m = location.pathname.match(/^\/invite\/([\w-]+)$/);
    if (m) state.pendingInvite = m[1];
  }

  // ---------- auth screen ----------
  function renderAuth(mode = 'login') {
    const root = $('#app');
    root.innerHTML = '';
    const card = el('div', { class: 'auth-card' });
    card.appendChild(el('h1', {}, mode === 'login' ? '欢迎回来' : '创建账号'));
    card.appendChild(el('p', { class: 'sub' }, 'CollabGrid · 多维协作表'));

    const form = el('form');
    const errBox = el('div', { class: 'auth-err' });
    let nameInput;
    if (mode === 'register') {
      form.appendChild(el('label', {}, '昵称'));
      nameInput = el('input', { type: 'text', placeholder: '随便起一个' });
      form.appendChild(nameInput);
    }
    form.appendChild(el('label', {}, '邮箱'));
    const emailInput = el('input', { type: 'email', placeholder: 'you@example.com', required: 'required' });
    form.appendChild(emailInput);
    form.appendChild(el('label', {}, '密码'));
    const pwdInput = el('input', { type: 'password', placeholder: '至少 6 位', required: 'required', minlength: 6 });
    form.appendChild(pwdInput);
    form.appendChild(errBox);
    form.appendChild(el('button', { class: 'primary', type: 'submit' }, mode === 'login' ? '登录' : '注册'));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const body = { email: emailInput.value.trim(), password: pwdInput.value };
        if (mode === 'register') body.displayName = nameInput.value.trim();
        const data = await api('/api/' + mode, { method: 'POST', body });
        state.me = data.user;
        await fetchCsrfToken(); // 登录后获取 CSRF token
        await afterLogin();
      } catch (err) { errBox.textContent = err.message; }
    });
    card.appendChild(form);

    const switchLine = el('div', { class: 'switch' },
      mode === 'login' ? '还没账号？' : '已有账号？',
      el('a', { onclick: () => renderAuth(mode === 'login' ? 'register' : 'login') },
        mode === 'login' ? '立刻注册' : '直接登录')
    );
    card.appendChild(switchLine);

    const wrap = el('div', { class: 'auth-wrap' }, card);
    root.appendChild(wrap);
  }

  // ---------- main shell ----------
  async function afterLogin() {
    const { AppShell } = window;
    if (state.pendingInvite) {
      try {
        const r = await api('/api/invites/' + state.pendingInvite + '/accept', { method: 'POST' });
        history.replaceState(null, '', '/');
        state.pendingInvite = null;
        await loadBases();
        await openBase(r.baseId);
        return;
      } catch (e) { toast('邀请无效或已过期', 'err'); state.pendingInvite = null; history.replaceState(null, '', '/'); }
    }
    await loadBases();
    if (state.bases.length) await openBase(state.bases[0].id);
    else if (AppShell) AppShell.renderShell();
  }

  async function loadMe() {
    const r = await api('/api/me');
    state.me = r.user;
  }

  async function loadBases() {
    const r = await api('/api/bases');
    state.bases = r.bases;
  }

  async function openBase(baseId, preferredTableId = null) {
    const { AppSocket } = window;
    const { AppShell } = window;
    const previousTableId = preferredTableId || (state.currentBaseId === baseId ? state.activeTableId : null);
    state.currentBaseId = baseId;
    const snap = await api('/api/bases/' + baseId);
    state.base = snap;
    loadTableViews(baseId);
    state.activeTableId = snap.tables.some(t => t.id === previousTableId) ? previousTableId : (snap.tables[0]?.id || null);
    if (AppSocket) AppSocket.connectSocket(baseId);
    if (AppShell) AppShell.renderShell();
  }

  function loadTableViews(baseId) {
    const { AppGridRender } = window;
    if (AppGridRender) AppGridRender.loadTableViews(baseId);
  }

  async function loadTablePage(tableId, offset) {
    const { AppGridRender } = window;
    const t = state.base?.tables.find(t => t.id === tableId);
    if (!t) return;
    const limit = t.page?.limit || 200;
    const page = await api(`/api/tables/${tableId}/page?offset=${Math.max(0, offset)}&limit=${limit}`);
    t.records = page.records;
    t.cells = page.cells;
    t.links = page.links;
    t.page = page.page;
    state.selection = null;
    state.editingCell = null;
    if (AppGridRender) AppGridRender.renderGrid();
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* noop */ }
    state.me = null; state.bases = []; state.base = null; state.csrfToken = '';
    state.socket?.disconnect(); state.socket = null;
    renderAuth('login');
  }

  // ---------- boot ----------
  async function boot() {
    checkInviteFromUrl();
    await fetchCsrfToken();
    try {
      await loadMe();
      await afterLogin();
    } catch {
      renderAuth('login');
    }
  }

  window.AppAuth = { renderAuth, afterLogin, loadMe, loadBases, openBase, loadTablePage, logout, boot };
})();
