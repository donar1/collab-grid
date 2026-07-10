// modules/members.js — 邀请 + 成员管理
(function() {
  'use strict';
  const { el, toast } = window;
  const { AppState: state } = window;
  const { api } = window;
  const { API } = window;
  const { AppGridRender } = window;
  const { AppAuth } = window;

  async function createInvite() {
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal' });
    modal.appendChild(el('h3', {}, '邀请协作者'));
    modal.appendChild(el('p', { class: 'desc' }, '先选择对方加入后的角色，再生成邀请链接。只读不能改数据，审批人可以处理审批，财务/结算预留给订单和结算系统。'));
    const roleSelect = el('select', { class: 'role-select' }, AppGridRender.roleOptions().filter(r => r.value !== 'owner').map(r => el('option', { value: r.value, selected: r.value === 'editor' ? 'selected' : false }, r.label)));
    const box = el('div', { class: 'invite-box' }, '邀请链接会显示在这里');
    modal.appendChild(el('label', {}, '邀请角色'));
    modal.appendChild(roleSelect);
    modal.appendChild(box);
    const actions = el('div', { class: 'actions' });
    actions.appendChild(el('button', { onclick: async () => {
      try {
        const r = await api('/api/bases/' + state.currentBaseId + '/invites', { method: 'POST', body: { role: roleSelect.value } });
        const url = location.origin + r.url;
        box.innerHTML = '';
        box.append('邀请链接：', el('code', {}, url));
        navigator.clipboard?.writeText(url);
        toast('邀请链接已生成并复制');
      } catch (e) { toast(e.message, 'err'); }
    } }, '生成链接'));
    actions.appendChild(el('button', { class: 'primary', onclick: () => mask.remove() }, '完成'));
    modal.appendChild(actions);
    mask.appendChild(modal); document.body.appendChild(mask);
  }

  function openMembersModal() {
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal wide' });
    modal.appendChild(el('h3', {}, '成员权限'));
    modal.appendChild(el('p', { class: 'desc' }, '成员权限按工作区生效。建议：普通录入用编辑，审批流用审批人，结算相关用财务/结算，只查看数据用只读。'));
    const canManage = ['owner', 'admin'].includes(state.base?.role);
    const list = el('div', { class: 'member-list' });
    for (const m of state.base?.members || []) {
      const select = el('select', { class: 'role-select', disabled: (!canManage || m.role === 'owner' || m.id === state.me?.id) ? 'disabled' : false },
        AppGridRender.roleOptions().filter(r => r.value !== 'owner').map(r => el('option', { value: r.value, selected: r.value === m.role ? 'selected' : false }, r.label))
      );
      select.onchange = async () => {
        try {
          await api(`/api/bases/${state.currentBaseId}/members/${m.id}`, { method: 'PATCH', body: { role: select.value } });
          if (AppAuth) await AppAuth.openBase(state.currentBaseId);
          mask.remove();
          toast('成员角色已更新');
        } catch (e) { toast(e.message, 'err'); }
      };
      list.appendChild(el('div', { class: 'member-row' },
        el('div', {}, el('strong', {}, m.displayName || m.email), el('div', { class: 'desc' }, m.email)),
        m.role === 'owner' ? el('span', { class: 'badge' }, '所有者') : select
      ));
    }
    modal.appendChild(list);
    const actions = el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: () => mask.remove() }, '关闭'));
    modal.appendChild(actions);
    mask.appendChild(modal); document.body.appendChild(mask);
  }

  async function openUserMgmtModal() {
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal wide' });
    modal.appendChild(el('h3', {}, '用户管理'));
    modal.appendChild(el('p', { class: 'desc' }, '管理系统注册用户及其系统角色。sys_admin 拥有全部权限，manager 可管理其他用户但不可被降权，data_engineer 可操作结构，data_clerk 可操作数据和结构。'));

    const container = el('div', { class: 'member-list' });
    modal.appendChild(container);

    async function loadUsers() {
      try {
        const data = await api(API.users);
        container.innerHTML = '';
        const systemRoles = [
          { value: 'sys_admin', label: '系统管理员' },
          { value: 'manager', label: '管理员' },
          { value: 'data_engineer', label: '数据工程师' },
          { value: 'data_clerk', label: '数据员' },
          { value: 'none', label: '普通用户' },
        ];
        for (const u of data.users || []) {
          const row = el('div', { class: 'member-row' });
          const info = el('div', {},
            el('strong', {}, u.display_name || u.email),
            el('div', { class: 'desc' }, u.email + (u.must_change_password ? ' (需改密)' : ''))
          );
          const roleLabel = systemRoles.find(r => r.value === (u.system_role || 'none'));
          const isMe = u.id === state.me?.id;
          const isManager = u.system_role === 'manager';
          const isSysAdmin = u.system_role === 'sys_admin';

          if (isMe) {
            row.append(info, el('span', { class: 'badge' }, roleLabel ? roleLabel.label : u.system_role));
          } else {
            const select = el('select', { class: 'role-select' },
              systemRoles.map(r => el('option', { value: r.value, selected: r.value === (u.system_role || 'none') ? 'selected' : false }, r.label))
            );
            // manager 不可降为普通用户（后端也会校验，前端仅提示）
            if (isManager) {
              select.title = '管理员不可降为普通用户';
            }
            select.onchange = async () => {
              try {
                await api(API.userSystemRole(u.id), { method: 'PATCH', body: { systemRole: select.value } });
                toast('系统角色已更新');
                loadUsers();
              } catch (e) {
                toast(e.message, 'err');
                select.value = u.system_role || 'none';
              }
            };
            row.append(info, select);
          }
          container.appendChild(row);
        }
      } catch (e) {
        container.textContent = '加载失败: ' + e.message;
      }
    }

    loadUsers();
    const actions = el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: () => mask.remove() }, '关闭'));
    modal.appendChild(actions);
    mask.appendChild(modal); document.body.appendChild(mask);
  }

  window.AppMembers = { createInvite, openMembersModal, openUserMgmtModal };
})();
