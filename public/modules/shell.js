// modules/shell.js — 侧边栏渲染 + Topbar渲染 + 右键菜单系统
(function() {
  'use strict';
  const { $, el, toast } = window;
  const { AppState: state } = window;
  const { askText, askConfirm } = window.CollabGridModal || {};
  const { api } = window;
  const { API } = window;

  const initials = (str) => (str || '?').slice(0, 1).toUpperCase();

  /* ---------- sidebar collapse state ---------- */
  let sidebarCollapsed = false;

  /* ---------- base expand state (persisted in session) ---------- */
  const expandedBases = new Set();

  function ensureBaseExpanded(baseId) {
    expandedBases.add(baseId);
  }

  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    const shell = document.querySelector('.shell');
    if (shell) {
      if (sidebarCollapsed) shell.classList.add('sidebar-collapsed');
      else shell.classList.remove('sidebar-collapsed');
    }
  }

  function toggleBaseExpand(baseId) {
    if (expandedBases.has(baseId)) expandedBases.delete(baseId);
    else expandedBases.add(baseId);
    renderShell();
  }

  function renderShell() {
    const root = $('#app');
    root.innerHTML = '';
    const sidebar = el('aside', { class: 'sidebar' });
    sidebar.appendChild(el('div', { class: 'brand' }, 'CollabGrid', el('small', {}, 'demo')));
    const sec = el('div', { class: 'section-title' }, '工作空间',
      el('button', { onclick: createBase }, '+ 新建')
    );
    sidebar.appendChild(sec);
    const list = el('ul', { class: 'base-tree' });
    for (const b of state.bases) {
      const isExpanded = expandedBases.has(b.id);
      const isActive = state.currentBaseId === b.id;

      // 工作空间头部（可点击展开/收起）
      const expandIcon = el('span', { class: 'tree-expand-icon' }, isExpanded ? '▼' : '▶');
      const name = el('span', { class: 'base-name' }, b.name);
      const meta = el('span', { class: 'base-meta' },
        el('small', {}, b.role),
        b.role === 'owner' ? el('button', {
          title: '重命名工作空间',
          onclick: (e) => { e.stopPropagation(); renameBase(b); }
        }, '改') : null,
        b.role === 'owner' ? el('button', {
          class: 'danger',
          title: '删除工作空间',
          onclick: (e) => { e.stopPropagation(); deleteBase(b); }
        }, '删') : null
      );

      const header = el('div', {
        class: 'tree-header' + (isActive ? ' active' : ''),
        onclick: () => {
          if (isActive) {
            toggleBaseExpand(b.id);
          } else {
            ensureBaseExpanded(b.id);
            const { AppAuth } = window;
            if (AppAuth) AppAuth.openBase(b.id);
          }
        }
      }, expandIcon, name, meta);

      const li = el('li', { class: 'tree-item' }, header);

      // 展开后显示数据表列表
      if (isExpanded) {
        const tableList = el('ul', { class: 'table-sublist' });
        const baseTables = isActive ? (state.base?.tables || []) : [];
        if (baseTables.length === 0) {
          tableList.appendChild(el('li', { class: 'table-subitem empty' }, isActive ? '暂无数据表' : '（进入工作空间查看）'));
        } else {
          for (const t of baseTables) {
            if (t.hidden) continue; // 隐藏的表格不显示在侧边栏
            const isTableActive = isActive && state.activeTableId === t.id;

            const tableName = el('span', { class: 'table-name' }, t.name);
            const tableActions = hasStructurePermission() ? el('span', { class: 'table-actions' },
              el('button', {
                title: '重命名表格',
                onclick: async (e) => {
                  e.stopPropagation();
                  const newName = await askText({ title: '重命名表格', desc: '修改表格名称。', label: '表格名称', value: t.name });
                  if (!newName || newName === t.name) return;
                  try {
                    await api(API.table(t.id), { method: 'PATCH', body: { name: newName } });
                    t.name = newName;
                    renderShell();
                    toast('表格已重命名');
                  } catch (err) { toast(err.message, 'err'); }
                }
              }, '改'),
              el('button', {
                class: 'danger',
                title: '删除表格',
                onclick: async (e) => {
                  e.stopPropagation();
                  if (!await askConfirm({ title: '删除表格？', desc: `将删除表格「${t.name}」及其所有字段、记录、关联。此操作不可恢复。`, okText: '删除', danger: true })) return;
                  try {
                    await api(API.table(t.id), { method: 'DELETE' });
                    const idx = state.base.tables.findIndex(x => x.id === t.id);
                    if (idx >= 0) state.base.tables.splice(idx, 1);
                    if (state.activeTableId === t.id) {
                      state.activeTableId = state.base.tables.find(x => !x.hidden)?.id || null;
                    }
                    renderShell();
                    toast('表格已删除');
                  } catch (err) { toast(err.message, 'err'); }
                }
              }, '删')
            ) : null;

            const tableLi = el('li', {
              class: 'table-subitem' + (isTableActive ? ' active' : ''),
              onclick: () => {
                const { AppAuth } = window;
                if (AppAuth) {
                  if (!isActive) AppAuth.openBase(b.id, t.id);
                  else { state.activeTableId = t.id; renderShell(); }
                }
              }
            }, tableName, tableActions);
            tableList.appendChild(tableLi);
          }
        }
        li.appendChild(tableList);
      }

      list.appendChild(li);
    }
    if (state.bases.length === 0) {
      list.appendChild(el('li', { style: { color: 'var(--muted)', cursor: 'default' } }, '点击「+ 新建」开始'));
    }
    sidebar.appendChild(list);
    sidebar.appendChild(el('div', { class: 'user' },
      (state.me?.displayName || state.me?.email || '我'),
      el('a', { onclick: () => { const { AppAuth } = window; if (AppAuth) AppAuth.logout(); } }, '退出')
    ));

    const main = el('section', { class: 'main', id: 'main' });
    const shell = el('div', { class: 'shell' + (sidebarCollapsed ? ' sidebar-collapsed' : '') }, sidebar, main);

    /* sidebar toggle button — 放在 shell 层级，避免被 sidebar 边界截断 */
    const toggleBtn = el('button', {
      class: 'sidebar-toggle',
      title: sidebarCollapsed ? '展开侧边栏' : '收起侧边栏',
      onclick: () => {
        toggleSidebar();
        toggleBtn.textContent = sidebarCollapsed ? '>' : '<';
        toggleBtn.title = sidebarCollapsed ? '展开侧边栏' : '收起侧边栏';
      }
    }, sidebarCollapsed ? '>' : '<');
    shell.appendChild(toggleBtn);
    root.appendChild(shell);

    if (!state.base) {
      main.appendChild(el('div', { class: 'topbar' }));
      main.appendChild(el('div', { class: 'empty-hint' }, '左侧创建一个工作空间开始'));
      return;
    }
    // 添加 navbar
    const navbar = el('div', { class: 'navbar' },
      el('button', {
        class: 'nav-btn' + (state.showAudit ? ' active' : ''),
        onclick: toggleAuditPanel
      }, '审计'),
      el('button', {
        class: 'nav-btn',
        onclick: openDashboardModal
      }, '大屏'),
      el('button', {
        class: 'nav-btn',
        onclick: openJobsModal
      }, '作业')
    );
    main.appendChild(navbar);
    renderTopbar();
    const { AppGridRender } = window;
    if (AppGridRender) AppGridRender.renderGrid();
  }

  /* ---------- helpers ---------- */
  function hasStructurePermission() {
    const role = state.base?.role;
    const sysRole = state.me?.systemRole || '';
    return role === 'owner' || role === 'admin' || ['sys_admin', 'manager', 'data_engineer', 'data_clerk'].includes(sysRole);
  }

  function toggleAuditPanel() {
    state.showAudit = !state.showAudit;
    if (state.showAudit) {
      if (window.AppAudit) AppAudit.loadAudit();
    } else {
      document.querySelector('.audit-panel')?.remove();
    }
  }

  function openDashboardModal() {
    if (window.AppDashboard) AppDashboard.openDashboardModal();
  }

  function openJobsModal() {
    if (window.AppJobs) AppJobs.openJobsModal();
  }

  /* ---------- topbar ---------- */
  function renderTopbar() {
    const main = $('#main'); if (!main || !state.base) return;
    const old = main.querySelector('.topbar'); if (old) old.remove();

    // 如果当前激活的表格被隐藏了，自动切换到第一个可见表格
    const visibleTables = state.base.tables.filter(t => !t.hidden);
    if (state.activeTableId && visibleTables.length && !visibleTables.some(t => t.id === state.activeTableId)) {
      state.activeTableId = visibleTables[0]?.id || null;
    }

    const tabs = el('div', {
      class: 'tabs',
      title: '右键打开数据表菜单，横向滚动查看更多表',
      oncontextmenu: (e) => {
        e.preventDefault();
        openTableContextMenu(e.clientX, e.clientY);
      }
    });

    for (const t of state.base.tables) {
      const isHidden = !!t.hidden;
      if (isHidden) continue; // 隐藏的表格不在 Topbar 显示
      const tabClass = 'tab' + (t.id === state.activeTableId ? ' active' : '');
      const tabEl = el('div', {
        class: tabClass,
        title: t.name,
        draggable: true,
        'data-table-id': t.id,
        onclick: () => { state.activeTableId = t.id; renderShell(); }
      }, t.name);
      /* drag events */
      tabEl.addEventListener('dragstart', (e) => {
        tabEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', t.id);
      });
      tabEl.addEventListener('dragend', () => {
        tabEl.classList.remove('dragging');
        tabs.querySelectorAll('.tab.drag-over').forEach(elm => elm.classList.remove('drag-over'));
      });
      tabEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      tabEl.addEventListener('dragenter', (e) => {
        e.preventDefault();
        tabEl.classList.add('drag-over');
      });
      tabEl.addEventListener('dragleave', () => {
        tabEl.classList.remove('drag-over');
      });
      tabEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        tabEl.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === t.id) return;
        const fromIdx = state.base.tables.findIndex(tb => tb.id === draggedId);
        const toIdx = state.base.tables.findIndex(tb => tb.id === t.id);
        if (fromIdx < 0 || toIdx < 0) return;
        const [moved] = state.base.tables.splice(fromIdx, 1);
        state.base.tables.splice(toIdx, 0, moved);
        try {
          await api(API.tablePosition(draggedId), { method: 'PATCH', body: { position: toIdx } });
        } catch (err) { toast(err.message, 'err'); }
        renderShell();
      });
      tabs.appendChild(tabEl);
    }
    tabs.appendChild(el('div', { class: 'tab', style: { color: 'var(--muted)' }, onclick: createTable }, '+ 新表'));

    const presence = el('div', { class: 'presence' });
    const seen = new Set([state.me?.id]);
    for (const [uid, email] of state.presence.entries()) {
      if (seen.has(uid)) continue; seen.add(uid);
      presence.appendChild(el('div', { class: 'dot', title: email }, initials(email)));
    }

    // 通知铃铛
    const notifyBadge = el('span', { class: 'notify-badge', style: 'display:none;' });
    const notifyBtn = el('button', {
      class: 'notify-bell',
      title: '通知',
      onclick: (e) => { e.stopPropagation(); toggleNotifyPanel(); }
    }, '🔔', notifyBadge);
    const notifyPanel = el('div', { class: 'notify-panel', style: 'display:none;' });

    async function loadNotifications() {
      try {
        const res = await api('/api/notifications?limit=20');
        state.notifications = res.notifications || [];
        state.unreadCount = res.unread || 0;
        renderNotifyPanel();
        updateNotifyBadge();
      } catch (e) { /* noop */ }
    }

    function updateNotifyBadge() {
      if (state.unreadCount > 0) {
        notifyBadge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
        notifyBadge.style.display = '';
      } else {
        notifyBadge.style.display = 'none';
      }
    }

    function renderNotifyPanel() {
      notifyPanel.innerHTML = '';
      if (!state.notifications?.length) {
        notifyPanel.appendChild(el('div', { class: 'notify-empty' }, '暂无通知'));
        return;
      }
      const header = el('div', { class: 'notify-header' },
        el('span', {}, '通知'),
        el('button', {
          class: 'notify-readall',
          onclick: async (e) => {
            e.stopPropagation();
            await api('/api/notifications/read-all', { method: 'PATCH' });
            state.notifications.forEach(n => n.read = 1);
            state.unreadCount = 0;
            renderNotifyPanel();
            updateNotifyBadge();
          }
        }, '全部已读')
      );
      notifyPanel.appendChild(header);
      const list = el('div', { class: 'notify-list' });
      for (const n of state.notifications) {
        const item = el('div', { class: 'notify-item' + (n.read ? ' read' : '') },
          el('div', { class: 'notify-title' }, n.title),
          el('div', { class: 'notify-time' }, n.created_at ? new Date(n.created_at).toLocaleString('zh-CN') : '')
        );
        item.onclick = async (e) => {
          e.stopPropagation();
          if (!n.read) {
            await api('/api/notifications/' + n.id + '/read', { method: 'PATCH' });
            n.read = 1;
            state.unreadCount = Math.max(0, state.unreadCount - 1);
            renderNotifyPanel();
            updateNotifyBadge();
          }
          // 点击通知跳转到对应 Base
          if (n.base_id && n.base_id !== state.currentBaseId) {
            if (window.AppAuth?.openBase) window.AppAuth.openBase(n.base_id, null);
          }
        };
        const delBtn = el('button', { class: 'notify-delete', title: '删除' }, '×');
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          await api('/api/notifications/' + n.id, { method: 'DELETE' });
          state.notifications = state.notifications.filter(x => x.id !== n.id);
          if (!n.read) state.unreadCount = Math.max(0, state.unreadCount - 1);
          renderNotifyPanel();
          updateNotifyBadge();
        };
        item.appendChild(delBtn);
        list.appendChild(item);
      }
      notifyPanel.appendChild(list);
    }

    function toggleNotifyPanel() {
      const isVisible = notifyPanel.style.display !== 'none';
      notifyPanel.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) loadNotifications();
    }

    // 点击外部关闭通知面板（只绑定一次，防止 renderTopbar 重复调用时泄漏）
    if (!window._notifyOutsideClickBound) {
      window._notifyOutsideClickBound = true;
      document.addEventListener('click', (e) => {
        if (notifyPanel.style.display !== 'none' && !notifyBtn.contains(e.target) && !notifyPanel.contains(e.target)) {
          notifyPanel.style.display = 'none';
        }
      });
    }

    const actions = el('div', { class: 'actions' },
      presence,
      notifyBtn,
      notifyPanel,
      el('span', { class: 'context-hint' }, '表名栏右键打开菜单'),
      el('button', { class: 'primary', onclick: () => { const { AppFieldModal } = window; if (AppFieldModal) AppFieldModal.openFieldModal(state.activeTableId); } }, '+ 字段'),
      el('button', { onclick: openTableMgmtModal }, '表格管理')
    );
    main.prepend(el('div', { class: 'topbar' }, tabs, actions));

    // 初始化加载通知数量
    loadNotifications();
    // 实时通知由 socket.js 的 notification:new 事件驱动，不再需要轮询
  }

  /* ---------- table management modal ---------- */
  function openTableMgmtModal() {
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal wide table-mgmt-modal' });
    modal.appendChild(el('h3', {}, '表格管理'));
    modal.appendChild(el('p', { class: 'desc' }, '拖拽调整顺序，点击眼睛图标显示/隐藏表格，点击锁图标设置权限。'));

    const list = el('div', { class: 'table-mgmt-list' });
    const tables = state.base?.tables || [];

    function renderList() {
      list.innerHTML = '';
      for (const t of tables) {
        const row = el('div', {
          class: 'table-row' + (t.hidden ? ' hidden-indicator' : ''),
          draggable: true,
          'data-table-id': t.id
        });
        /* drag handle */
        const dragHandle = el('span', { class: 'drag-handle', title: '拖拽排序' }, '☰');
        /* name */
        const nameSpan = el('span', { class: 'table-name', style: { flex: 1 } }, t.name);
        /* visibility toggle */
        const eyeBtn = el('button', {
          class: 'visibility-btn',
          title: t.hidden ? '显示表格' : '隐藏表格',
          onclick: async (e) => {
            e.stopPropagation();
            try {
              await api(API.tableVisibility(t.id), { method: 'PATCH', body: { hidden: !t.hidden } });
              t.hidden = !t.hidden;
              renderList();
              renderShell();
            } catch (err) { toast(err.message, 'err'); }
          }
        }, t.hidden ? '🙈' : '👁');
        /* permission button */
        const permBtn = el('button', {
          class: 'perm-btn',
          title: '权限设置',
          onclick: (e) => {
            e.stopPropagation();
            openTablePermissionModal(t);
          }
        }, '🔒');
        /* delete button */
        const delBtn = el('button', {
          class: 'delete-btn',
          title: '删除表格',
          onclick: async (e) => {
            e.stopPropagation();
            if (!await askConfirm({ title: '删除表格？', desc: `将删除表格「${t.name}」及其所有字段、记录、关联。此操作不可恢复。`, okText: '删除', danger: true })) return;
            try {
              await api(API.table(t.id), { method: 'DELETE' });
              const idx = tables.findIndex(x => x.id === t.id);
              if (idx >= 0) tables.splice(idx, 1);
              renderList();
              renderShell();
              toast('表格已删除');
            } catch (err) { toast(err.message, 'err'); }
          }
        }, '🗑');

        row.appendChild(dragHandle);
        row.appendChild(nameSpan);
        row.appendChild(eyeBtn);
        row.appendChild(permBtn);
        row.appendChild(delBtn);

        /* drag-and-drop for row reordering inside modal */
        row.addEventListener('dragstart', (e) => {
          row.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', t.id);
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('dragging');
          list.querySelectorAll('.table-row.drag-over').forEach(elm => elm.classList.remove('drag-over'));
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        });
        row.addEventListener('dragenter', (e) => {
          e.preventDefault();
          row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => {
          row.classList.remove('drag-over');
        });
        row.addEventListener('drop', async (e) => {
          e.preventDefault();
          row.classList.remove('drag-over');
          const draggedId = e.dataTransfer.getData('text/plain');
          if (!draggedId || draggedId === t.id) return;
          const fromIdx = tables.findIndex(x => x.id === draggedId);
          const toIdx = tables.findIndex(x => x.id === t.id);
          if (fromIdx < 0 || toIdx < 0) return;
          try {
            await api(API.tablePosition(draggedId), { method: 'PATCH', body: { position: toIdx } });
            const [moved] = tables.splice(fromIdx, 1);
            tables.splice(toIdx, 0, moved);
            renderList();
            renderShell();
          } catch (err) { toast(err.message, 'err'); }
        });

        list.appendChild(row);
      }
    }

    renderList();
    modal.appendChild(list);
    modal.appendChild(el('div', { class: 'actions' },
      el('button', { onclick: () => mask.remove() }, '关闭')
    ));
    mask.appendChild(modal);
    document.body.appendChild(mask);
  }

  /* ---------- table permission modal ---------- */
  function openTablePermissionModal(table) {
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal wide' });
    modal.appendChild(el('h3', {}, `权限设置 — ${table.name}`));
    modal.appendChild(el('p', { class: 'desc' }, '设置哪些角色可以访问此表格。'));

    const list = el('div', { class: 'member-list' });
    const roles = state.base?.roles || [
      { value: 'admin', label: '管理员' },
      { value: 'approver', label: '审批人' },
      { value: 'finance', label: '财务/结算' },
      { value: 'editor', label: '编辑' },
      { value: 'viewer', label: '只读' }
    ];

    async function loadPerms() {
      try {
        const data = await api(API.tablePermissions(state.currentBaseId, table.id));
        const allowed = new Set((data.allowedRoles || []));
        list.innerHTML = '';
        for (const r of roles) {
          const checkbox = el('input', {
            type: 'checkbox',
            checked: allowed.has(r.value) ? 'checked' : false,
            onchange: async () => {
              const next = Array.from(list.querySelectorAll('input[type="checkbox"]'))
                .map((cb, i) => cb.checked ? roles[i].value : null)
                .filter(Boolean);
              try {
                await api(API.tablePermissions(state.currentBaseId, table.id), { method: 'PATCH', body: { allowedRoles: next } });
                toast('权限已更新');
              } catch (err) { toast(err.message, 'err'); }
            }
          });
          list.appendChild(el('div', { class: 'member-row' },
            el('div', {}, el('strong', {}, r.label)),
            checkbox
          ));
        }
      } catch (err) {
        list.textContent = '加载失败: ' + err.message;
      }
    }

    loadPerms();
    modal.appendChild(list);
    modal.appendChild(el('div', { class: 'actions' },
      el('button', { class: 'primary', onclick: () => mask.remove() }, '关闭')
    ));
    mask.appendChild(modal);
    document.body.appendChild(mask);
  }

  /* ---------- context menus ---------- */
  function placeContextMenu(menu, x, y) {
    $('.context-menu')?.remove();
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
    setTimeout(() => {
      const close = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
      document.addEventListener('mousedown', close);
    }, 0);
  }

  function openTableContextMenu(x, y) {
    const { AppAudit } = window;
    const { AppMembers } = window;
    const { AppTemplates } = window;
    const { AppDashboard } = window;
    const { AppJobs } = window;
    const { AppFieldModal } = window;
    $('.context-menu')?.remove();
    const items = [
      ['操作日志', () => { state.showAudit = !state.showAudit; if (state.showAudit) { if (AppAudit) AppAudit.loadAudit(); } else $('.audit-panel')?.remove(); }],
      ['成员', () => { if (AppMembers) AppMembers.openMembersModal(); }],
      (['sys_admin', 'manager', 'data_clerk', 'data_engineer'].includes(state.me?.systemRole || '') ? ['用户管理', () => { if (AppMembers) AppMembers.openUserMgmtModal(); }] : null),
      ['邀请', () => { if (AppMembers) AppMembers.createInvite(); }],
      ['业务模板', () => { if (AppTemplates) AppTemplates.initBusinessTemplate(); }],
      ['资源档案', () => { if (AppTemplates) AppTemplates.initResourceArchiveTemplate(); }],
      ['产品信息', () => { if (AppTemplates) AppTemplates.initProductInfoTemplate(); }],
      ['业务锁定', () => { if (AppTemplates) AppTemplates.initBusinessLockTemplate(); }],
      ['订单管理', () => { if (AppTemplates) AppTemplates.initOrderManagementTemplate(); }],
      ['库存系统', () => { if (AppTemplates) AppTemplates.initInventoryTemplate(); }],
      ['财务对账', () => { if (AppTemplates) AppTemplates.initFinanceReconciliationTemplate(); }],
      ['数据大屏', () => { if (AppDashboard) AppDashboard.openDashboardModal(); }],
      ['作业中心', () => { if (AppJobs) AppJobs.openJobsModal(); }],
      ['诊断中心', () => { if (AppJobs) AppJobs.openDiagnosticsModal(); }],
      ['新建字段', () => { if (AppFieldModal) AppFieldModal.openFieldModal(state.activeTableId); }],
    ];
    const menu = el('div', { class: 'context-menu' });
    for (const [label, handler] of items.filter(Boolean)) {
      menu.appendChild(el('button', {
        onclick: () => { menu.remove(); handler(); }
      }, label));
    }
    placeContextMenu(menu, x, y);
  }

  function openFieldContextMenu(field, x, y) {
    const { AppFieldModal } = window;
    const { AppRecordOps } = window;
    $('.context-menu')?.remove();
    const items = [
      (field.type !== 'createdTime' && field.type !== 'lastModifiedTime') ? ['重命名字段', () => { if (AppFieldModal) AppFieldModal.renameField(field); }] : null,
      field.type === 'select' ? ['维护单选项', () => { if (AppFieldModal) AppFieldModal.openSelectOptionsModal(field); }] : null,
      field.type === 'link' ? ['配置关联表', () => { if (AppFieldModal) AppFieldModal.openLinkOptionsModal(field); }] : null,
      field.type === 'lookup' ? ['配置关联字段', () => { if (AppFieldModal) AppFieldModal.openLookupOptionsModal(field); }] : null,
      [field.locked ? '解锁字段' : '锁定字段', () => { if (AppRecordOps) AppRecordOps.toggleLock(field); }],
      ['调整字段宽度：请拖动表头右侧边缘', () => toast('拖动字段表头右侧边缘可调整宽度')],
      hasStructurePermission() ? ['删除字段', () => { if (AppFieldModal) AppFieldModal.deleteField(field); }] : null,
      field.type === 'autoNumber' ? ['编号设置', () => { if (AppFieldModal) AppFieldModal.openAutoNumberSettings(field); }] : null,
      (field.type === 'createdTime' || field.type === 'lastModifiedTime') ? ['字段设置', () => { if (AppFieldModal) AppFieldModal.openTimeFieldSettings(field); }] : null,
    ].filter(Boolean);
    const menu = el('div', { class: 'context-menu field-context-menu' });
    menu.appendChild(el('div', { class: 'context-menu-title', title: field.name }, field.name));
    for (const [label, handler] of items) {
      menu.appendChild(el('button', {
        class: label === '删除字段' ? 'danger' : '',
        onclick: () => { menu.remove(); handler(); }
      }, label));
    }
    placeContextMenu(menu, x, y);
  }

  // ---------- mutations ----------
  async function createBase() {
    const name = await askText({
      title: '新建工作空间',
      desc: '工作空间会承载多张数据表、成员和操作日志。',
      label: '工作空间名称',
      value: '我的工作空间'
    });
    if (!name) return;
    const { AppAuth } = window;
    const r = await api('/api/bases', { method: 'POST', body: { name } });
    await AppAuth.loadBases(); await AppAuth.openBase(r.id);
  }

  async function renameBase(base) {
    const name = await askText({
      title: '重命名工作空间',
      desc: '只有 owner 可以修改工作空间名称。',
      label: '工作空间名称',
      value: base.name
    });
    if (!name || name === base.name) return;
    const { AppAuth } = window;
    try {
      await api('/api/bases/' + base.id, { method: 'PATCH', body: { name } });
      await AppAuth.loadBases();
      if (state.currentBaseId === base.id) {
        state.base.name = name;
      }
      renderShell();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function deleteBase(base) {
    const ok = await askConfirm({
      title: '删除工作空间？',
      desc: `将删除「${base.name}」里的所有数据表、字段、行、单元格、关联、邀请链接和成员关系。这个操作不可恢复。`,
      okText: '删除工作空间',
      danger: true
    });
    if (!ok) return;
    const { AppAuth } = window;
    try {
      await api('/api/bases/' + base.id, { method: 'DELETE' });
      state.bases = state.bases.filter(b => b.id !== base.id);
      if (state.currentBaseId === base.id) {
        state.base = null;
        state.currentBaseId = null;
        state.activeTableId = null;
        if (state.bases.length) await AppAuth.openBase(state.bases[0].id);
        else renderShell();
      } else {
        renderShell();
      }
    } catch (e) { toast(e.message, 'err'); }
  }

  async function createTable() {
    const name = await askText({
      title: '新建数据表',
      desc: '同一个工作空间里可以用关联字段连接多张表。',
      label: '数据表名称',
      value: '新表'
    });
    if (!name) return;
    const { AppAuth } = window;
    const r = await api('/api/bases/' + state.currentBaseId + '/tables', { method: 'POST', body: { name } });
    await AppAuth.openBase(state.currentBaseId, r.id);
  }

  window.AppShell = { renderShell, renderTopbar, openFieldContextMenu, placeContextMenu, toggleAuditPanel, openDashboardModal, openJobsModal };
})();
