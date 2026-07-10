// modules/templates.js — 7个模板初始化函数
(function() {
  'use strict';
  const { el, toast } = window;
  const { AppState: state } = window;
  const { api } = window;
  const { askConfirm } = window.CollabGridModal || {};

  async function initBusinessTemplate() {
    const { AppAuth } = window;
    const ok = await askConfirm({
      title: '初始化业务模板？',
      desc: '会在当前工作空间中创建产品、订单、采购、库存、结算、退款、账户、流水、预存设备等业务表。已有同名表时不会继续。',
      okText: '创建业务模板'
    });
    if (!ok) return;
    try {
      await api(`/api/bases/${state.currentBaseId}/templates/business-core`, { method: 'POST', body: {} });
      if (AppAuth) await AppAuth.openBase(state.currentBaseId);
      toast('业务模板已创建');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function initResourceArchiveTemplate() {
    const { AppAuth } = window;
    const ok = await askConfirm({
      title: '初始化资源档案中心？',
      desc: '会创建一张「资源档案中心」底表，包含自动代码、入档日期、身份信息、身份证明、审批领导、业务备注、待办和审批按钮，并支持同表规则视图。',
      okText: '创建资源档案'
    });
    if (!ok) return;
    try {
      await api(`/api/bases/${state.currentBaseId}/templates/resource-archive`, { method: 'POST', body: {} });
      if (AppAuth) await AppAuth.openBase(state.currentBaseId);
      toast('资源档案中心已创建');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function initProductInfoTemplate() {
    const { AppAuth } = window;
    const ok = await askConfirm({
      title: '初始化产品信息区？',
      desc: '会创建「产品名称数据源区」和「产品信息区」。产品信息区的名称从数据源区选择，货号从数据源区联动引用，标题自动合并名称、规格、地区、销售规则、产品状态、货号。',
      okText: '创建产品信息'
    });
    if (!ok) return;
    try {
      await api(`/api/bases/${state.currentBaseId}/templates/product-info`, { method: 'POST', body: {} });
      if (AppAuth) await AppAuth.openBase(state.currentBaseId);
      toast('产品信息区已创建');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function initBusinessLockTemplate() {
    const { AppAuth } = window;
    const ok = await askConfirm({
      title: '初始化业务锁定区？',
      desc: '会创建「业务锁定区」，并在缺失时创建「员工档案中心」「状态变更日志」。业务锁定区会关联资源档案中心、产品信息区和员工档案中心，用于渠道关系绑定、申请审批、资源状态和奖金字段。',
      okText: '创建业务锁定'
    });
    if (!ok) return;
    try {
      await api(`/api/bases/${state.currentBaseId}/templates/business-lock`, { method: 'POST', body: {} });
      if (AppAuth) await AppAuth.openBase(state.currentBaseId);
      toast('业务锁定区已创建');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function initOrderManagementTemplate() {
    const { AppAuth } = window;
    const ok = await askConfirm({
      title: '初始化订单管理区？',
      desc: '会创建「订单管理区」，关联产品信息区和资源档案中心。产品选择后会带出应收金额、应付金额和默认收款方，并预留完结快照、佣金批次、退款原订单等字段。',
      okText: '创建订单管理'
    });
    if (!ok) return;
    try {
      await api(`/api/bases/${state.currentBaseId}/templates/order-management`, { method: 'POST', body: {} });
      if (AppAuth) await AppAuth.openBase(state.currentBaseId);
      toast('订单管理区已创建');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function initInventoryTemplate() {
    const { AppAuth } = window;
    const ok = await askConfirm({
      title: '初始化库存系统？',
      desc: '会创建「库存商品区」「出入库操作区」「库存流水区」。只有库存商品区关联的产品才参与库存；所属仓储为单选列；出入库必须审核通过才会写库存；出库仅付款方为自营时扣减实际库存。',
      okText: '创建库存系统'
    });
    if (!ok) return;
    try {
      await api(`/api/bases/${state.currentBaseId}/templates/inventory`, { method: 'POST', body: {} });
      if (AppAuth) await AppAuth.openBase(state.currentBaseId);
      toast('库存系统已创建');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function initFinanceReconciliationTemplate() {
    const { AppAuth } = window;
    const ok = await askConfirm({
      title: '初始化财务对账体系？',
      desc: '会创建财务结算对象、应收/应付明细、应收/应付结算单、收付款流水、财务红冲处理，以及订单侧退款/撤单处理区。订单体系只处理退款/撤单，财务体系只处理红冲。',
      okText: '创建财务对账'
    });
    if (!ok) return;
    try {
      await api(`/api/bases/${state.currentBaseId}/templates/finance-reconciliation`, { method: 'POST', body: {} });
      if (AppAuth) await AppAuth.openBase(state.currentBaseId);
      toast('财务对账体系已创建');
    } catch (e) { toast(e.message, 'err'); }
  }

  window.AppTemplates = {
    initBusinessTemplate, initResourceArchiveTemplate, initProductInfoTemplate,
    initBusinessLockTemplate, initOrderManagementTemplate, initInventoryTemplate,
    initFinanceReconciliationTemplate
  };
})();
