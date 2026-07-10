// portal.js — 客户门户前端逻辑（从 portal.html 提取，避免 CSP 内联脚本拦截）
(function() {
  'use strict';

  // XSS 防护：转义用户输入数据
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // P3-2: fetch 超时保护（AbortController + 30s）
  async function fetchWithTimeout(url, opts = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(id);
    }
  }

  let token = localStorage.getItem('cg_customer_token') || '';
  let customer = null;
  let currentData = [];
  let offset = 0;
  const limit = 20;
  let total = 0;

  if (token) { document.getElementById('tokenInput').value = token; login(); }

  function showError(msg) {
    const box = document.getElementById('errorBox');
    box.innerHTML = msg ? `<div class="error">${escapeHtml(msg)}</div>` : '';
  }

  async function login() {
    token = document.getElementById('tokenInput').value.trim();
    if (!token) return showError('请输入令牌');
    showError('');
    try {
      const res = await fetchWithTimeout('/api/public/me', { headers: { 'X-Customer-Token': token } });
      if (!res.ok) throw new Error('令牌无效或已过期');
      customer = await res.json();
      localStorage.setItem('cg_customer_token', token);
      document.getElementById('customerInfo').textContent = `${customer.displayName || customer.customerKey} · ${customer.baseId}`;
      document.getElementById('tabs').style.display = 'flex';
      document.getElementById('filters').style.display = 'flex';
      document.getElementById('stats').style.display = 'grid';
      document.getElementById('pagination').style.display = 'flex';
      fillProfile();
      loadData(0);
    } catch (e) {
      showError(e.message);
      logout();
    }
  }

  function logout() {
    token = '';
    customer = null;
    localStorage.removeItem('cg_customer_token');
    document.getElementById('tokenInput').value = '';
    document.getElementById('customerInfo').textContent = '';
    document.getElementById('tabs').style.display = 'none';
    document.getElementById('filters').style.display = 'none';
    document.getElementById('stats').style.display = 'none';
    document.getElementById('pagination').style.display = 'none';
    document.getElementById('tableArea').innerHTML = '';
    showError('');
  }

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('panel-' + name).classList.add('active');
  }

  function fillProfile() {
    if (!customer) return;
    document.getElementById('profileCard').style.display = 'block';
    document.getElementById('pKey').value = customer.customerKey;
    document.getElementById('pName').value = customer.displayName || '-';
    document.getElementById('pBase').value = customer.baseId;
    document.getElementById('pExpires').value = customer.expiresAt ? new Date(customer.expiresAt).toLocaleString() : '永久有效';
  }

  function resetFilters() {
    document.getElementById('fDateFrom').value = '';
    document.getElementById('fDateTo').value = '';
    document.getElementById('fStatus').value = '';
    document.getElementById('fMinAmount').value = '';
    document.getElementById('fMaxAmount').value = '';
    document.getElementById('fKeyword').value = '';
    loadData(0);
  }

  async function loadData(newOffset) {
    if (!token) return;
    offset = newOffset;
    const params = new URLSearchParams();
    params.set('limit', limit);
    params.set('offset', offset);
    const df = document.getElementById('fDateFrom').value;
    const dt = document.getElementById('fDateTo').value;
    const st = document.getElementById('fStatus').value;
    const minA = document.getElementById('fMinAmount').value;
    const maxA = document.getElementById('fMaxAmount').value;
    const kw = document.getElementById('fKeyword').value;
    if (df) params.set('dateFrom', df);
    if (dt) params.set('dateTo', dt);
    if (st) params.set('status', st);
    if (minA) params.set('minAmount', minA);
    if (maxA) params.set('maxAmount', maxA);
    if (kw) params.set('keyword', kw);

    try {
      const res = await fetchWithTimeout('/api/public/snapshots?' + params.toString(), {
        headers: { 'X-Customer-Token': token }
      });
      if (!res.ok) throw new Error('查询失败: ' + res.status);
      const data = await res.json();
      total = data.total || 0;
      currentData = data.snapshots || [];
      renderTable();
      renderStats();
      renderPagination();
    } catch (e) {
      showError(e.message);
    }
  }

  function renderTable() {
    const area = document.getElementById('tableArea');
    if (!currentData.length) {
      area.innerHTML = '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg><div>暂无数据</div></div>';
      return;
    }
    let html = '<table><thead><tr><th>订单号</th><th>状态</th><th>产品</th><th>应收</th><th>应付</th><th>毛利</th><th>完结日期</th></tr></thead><tbody>';
    for (const row of currentData) {
      const d = row.data || {};
      const status = d.status || d.orderStatus || '-';
      let badgeClass = 'badge-info';
      if (status === '已完结') badgeClass = 'badge-success';
      else if (status === '草稿') badgeClass = 'badge-warn';
      html += `<tr>
          <td>${escapeHtml(d.orderNo || row.refId)}</td>
          <td><span class="badge ${badgeClass}">${escapeHtml(status)}</span></td>
          <td>${escapeHtml(d.productName || '-')}</td>
          <td>¥${d.receivable != null ? Number(d.receivable).toFixed(2) : '-'}</td>
          <td>¥${d.payable != null ? Number(d.payable).toFixed(2) : '-'}</td>
          <td>¥${d.snapshotProfit != null ? Number(d.snapshotProfit).toFixed(2) : '-'}</td>
          <td>${escapeHtml(d.completedDate || '-')}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    area.innerHTML = html;
  }

  function renderStats() {
    let totalReceivable = 0, totalPayable = 0, totalProfit = 0;
    for (const row of currentData) {
      const d = row.data || {};
      totalReceivable += Number(d.receivable || 0);
      totalPayable += Number(d.payable || 0);
      totalProfit += Number(d.snapshotProfit || 0);
    }
    document.getElementById('statTotal').textContent = total;
    document.getElementById('statReceivable').textContent = '¥' + totalReceivable.toFixed(2);
    document.getElementById('statPayable').textContent = '¥' + totalPayable.toFixed(2);
    document.getElementById('statProfit').textContent = '¥' + totalProfit.toFixed(2);
  }

  function renderPagination() {
    const maxPage = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    document.getElementById('pageInfo').textContent = `第 ${currentPage} / ${maxPage} 页 (共 ${total} 条)`;
    document.querySelector('.pagination button:first-child').disabled = offset <= 0;
    document.querySelector('.pagination button:last-child').disabled = offset + limit >= total;
  }

  function prevPage() { if (offset >= limit) loadData(offset - limit); }
  function nextPage() { if (offset + limit < total) loadData(offset + limit); }

  // 对账系统
  let reconOffset = 0;
  let reconTotal = 0;
  let reconData = [];

  async function loadRecon(newOffset) {
    if (!token) return;
    reconOffset = newOffset;
    const params = new URLSearchParams();
    params.set('limit', limit);
    params.set('offset', reconOffset);
    const df = document.getElementById('rDateFrom').value;
    const dt = document.getElementById('rDateTo').value;
    const cat = document.getElementById('rCategory').value;
    if (df) params.set('dateFrom', df);
    if (dt) params.set('dateTo', dt);
    if (cat) params.set('category', cat);

    try {
      const res = await fetchWithTimeout('/api/public/reconciliation?' + params.toString(), {
        headers: { 'X-Customer-Token': token }
      });
      if (!res.ok) throw new Error('查询失败: ' + res.status);
      const data = await res.json();
      reconTotal = data.total || 0;
      reconData = data.results || [];
      document.getElementById('reconStats').style.display = 'grid';
      document.getElementById('reconPagination').style.display = 'flex';
      document.getElementById('rDebit').textContent = '¥' + (data.summary?.totalDebit || 0).toFixed(2);
      document.getElementById('rCredit').textContent = '¥' + (data.summary?.totalCredit || 0).toFixed(2);
      document.getElementById('rNet').textContent = '¥' + (data.summary?.netBalance || 0).toFixed(2);
      renderReconTable();
      renderReconPagination();
    } catch (e) {
      showError(e.message);
    }
  }

  function renderReconTable() {
    const area = document.getElementById('reconArea');
    if (!reconData.length) {
      area.innerHTML = '<div class="empty"><div>暂无对账数据</div></div>';
      return;
    }
    let html = '<table><thead><tr><th>日期</th><th>类型</th><th>描述</th><th>借方</th><th>贷方</th><th>余额</th><th>状态</th></tr></thead><tbody>';
    for (const row of reconData) {
      let badgeClass = 'badge-info';
      if (row.status === 'settled') badgeClass = 'badge-success';
      else if (row.status === 'overdue') badgeClass = 'badge-warn';
      html += `<tr>
          <td>${escapeHtml(row.recordDate)}</td>
          <td>${escapeHtml(row.category)}</td>
          <td>${escapeHtml(row.description || '-')}</td>
          <td>${row.debit > 0 ? '¥' + row.debit.toFixed(2) : '-'}</td>
          <td>${row.credit > 0 ? '¥' + row.credit.toFixed(2) : '-'}</td>
          <td>¥${row.balance.toFixed(2)}</td>
          <td><span class="badge ${badgeClass}">${row.status}</span></td>
        </tr>`;
    }
    html += '</tbody></table>';
    area.innerHTML = html;
  }

  function renderReconPagination() {
    const maxPage = Math.ceil(reconTotal / limit);
    const currentPage = Math.floor(reconOffset / limit) + 1;
    document.getElementById('reconPageInfo').textContent = `第 ${currentPage} / ${maxPage} 页 (共 ${reconTotal} 条)`;
    document.querySelector('#reconPagination button:first-child').disabled = reconOffset <= 0;
    document.querySelector('#reconPagination button:last-child').disabled = reconOffset + limit >= reconTotal;
  }

  function prevReconPage() { if (reconOffset >= limit) loadRecon(reconOffset - limit); }
  function nextReconPage() { if (reconOffset + limit < reconTotal) loadRecon(reconOffset + limit); }

  // 数据大屏
  async function loadDashboard() {
    if (!token) return;
    try {
      const res = await fetchWithTimeout('/api/public/dashboard', {
        headers: { 'X-Customer-Token': token }
      });
      if (!res.ok) throw new Error('查询失败: ' + res.status);
      const data = await res.json();
      document.getElementById('dOrders').textContent = data.orders?.count || 0;
      document.getElementById('dReceivable').textContent = '¥' + (data.orders?.receivable || 0).toFixed(2);
      document.getElementById('dPayable').textContent = '¥' + (data.orders?.payable || 0).toFixed(2);
      document.getElementById('dProfit').textContent = '¥' + (data.orders?.profit || 0).toFixed(2);
      document.getElementById('dSpecial').textContent = data.products?.specialCount || 0;
      document.getElementById('dOutOfStock').textContent = data.products?.outOfStock || 0;
      renderTrendChart(data.trend || []);
    } catch (e) {
      showError(e.message);
    }
  }

  function renderTrendChart(trend) {
    const chart = document.getElementById('trendChart');
    if (!trend.length) {
      chart.innerHTML = '<div style="width:100%;text-align:center;color:var(--muted)">暂无数据</div>';
      return;
    }
    const maxAmount = Math.max(...trend.map(t => t.amount), 1);
    let html = '';
    for (const t of trend) {
      const height = Math.max(4, (t.amount / maxAmount) * 180);
      const title = `${t.date}: ${t.count}笔 ¥${t.amount.toFixed(2)}`;
      html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px" title="${title}">
          <div style="width:100%;background:var(--primary);border-radius:3px 3px 0 0;opacity:.7;height:${height}px"></div>
          <div style="font-size:9px;color:var(--muted);transform:rotate(-45deg);white-space:nowrap">${t.date.slice(5)}</div>
        </div>`;
    }
    chart.innerHTML = html;
  }

  // 重写 switchTab 以加载数据
  const originalSwitchTab = switchTab;
  switchTab = function(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('panel-' + name).classList.add('active');
    if (name === 'dashboard') loadDashboard();
    if (name === 'recon') loadRecon(0);
    if (name === 'products') loadProducts();
    if (name === 'stock') loadStock();
    if (name === 'tracking') loadTracking();
  };

  // 产品查询
  async function loadProducts() {
    if (!token) return;
    const type = document.getElementById('pfType').value;
    const kw = document.getElementById('pfKeyword').value;
    const params = new URLSearchParams();
    params.set('category', 'product');
    params.set('limit', 200);
    if (kw) params.set('keyword', kw);

    try {
      const res = await fetchWithTimeout('/api/public/snapshots?' + params.toString(), {
        headers: { 'X-Customer-Token': token }
      });
      const data = await res.json();
      let items = data.snapshots || [];
      if (type === 'special') items = items.filter(i => i.data?.isSpecialOffer);
      if (type === 'in_stock') items = items.filter(i => (i.data?.availableQty || 0) > 0);

      const area = document.getElementById('productsArea');
      if (!items.length) { area.innerHTML = '<div class="empty"><div>暂无数据</div></div>'; return; }
      let html = '<table><thead><tr><th>产品ID</th><th>名称</th><th>规格</th><th>地区</th><th>单价</th><th>库存</th><th>特价</th></tr></thead><tbody>';
      for (const row of items) {
        const d = row.data || {};
        html += `<tr>
            <td>${escapeHtml(d.productId || '-')}</td>
            <td>${escapeHtml(d.name || d.title || '-')}</td>
            <td>${escapeHtml(d.spec || '-')}</td>
            <td>${escapeHtml(d.region || '-')}</td>
            <td>¥${d.price != null ? Number(d.price).toFixed(2) : '-'}</td>
            <td>${d.availableQty != null ? d.availableQty : '-'}</td>
            <td>${d.isSpecialOffer ? '<span class="badge badge-warn">特价</span>' : '-'}</td>
          </tr>`;
      }
      html += '</tbody></table>';
      area.innerHTML = html;
    } catch (e) { showError(e.message); }
  }

  // 库存预警查询
  async function loadStock() {
    if (!token) return;
    try {
      const res = await fetchWithTimeout('/api/public/snapshots?category=stock_alert&limit=200', {
        headers: { 'X-Customer-Token': token }
      });
      const data = await res.json();
      const items = data.snapshots || [];
      const outOfStock = items.filter(i => i.data?.type === 'out_of_stock');
      const lowStock = items.filter(i => i.data?.type === 'low_stock');

      document.getElementById('statOutOfStock').textContent = outOfStock.length;
      document.getElementById('statLowStock').textContent = lowStock.length;

      const area = document.getElementById('stockArea');
      let html = '<h4 style="margin:16px 0 8px;font-size:14px">断货商品</h4>';
      if (!outOfStock.length) html += '<div class="empty" style="padding:20px"><div>暂无断货商品</div></div>';
      else {
        html += '<table><thead><tr><th>产品ID</th><th>产品名称</th><th>预警日期</th></tr></thead><tbody>';
        for (const row of outOfStock) {
          const d = row.data || {};
          html += `<tr><td>${escapeHtml(d.productId || '-')}</td><td>${escapeHtml(d.productName || '-')}</td><td>${escapeHtml(d.alertDate || '-')}</td></tr>`;
        }
        html += '</tbody></table>';
      }
      html += '<h4 style="margin:16px 0 8px;font-size:14px">低库存商品</h4>';
      if (!lowStock.length) html += '<div class="empty" style="padding:20px"><div>暂无低库存商品</div></div>';
      else {
        html += '<table><thead><tr><th>产品ID</th><th>产品名称</th><th>可用库存</th><th>安全库存</th></tr></thead><tbody>';
        for (const row of lowStock) {
          const d = row.data || {};
          html += `<tr><td>${escapeHtml(d.productId || '-')}</td><td>${escapeHtml(d.productName || '-')}</td><td>${d.availableQty}</td><td>${d.minStock}</td></tr>`;
        }
        html += '</tbody></table>';
      }
      area.innerHTML = html;
    } catch (e) { showError(e.message); }
  }

  // 物流查询
  async function loadTracking() {
    if (!token) return;
    const orderNo = document.getElementById('tfOrderNo').value.trim();
    const trackingNo = document.getElementById('tfTrackingNo').value.trim();
    const params = new URLSearchParams();
    params.set('category', 'order');
    params.set('limit', 200);
    if (orderNo) params.set('keyword', orderNo);

    try {
      const res = await fetchWithTimeout('/api/public/snapshots?' + params.toString(), {
        headers: { 'X-Customer-Token': token }
      });
      const data = await res.json();
      let items = data.snapshots || [];
      if (trackingNo) items = items.filter(i => i.data?.trackingNo?.includes(trackingNo));

      const area = document.getElementById('trackingArea');
      if (!items.length) { area.innerHTML = '<div class="empty"><div>未找到匹配记录</div></div>'; return; }
      let html = '<table><thead><tr><th>订单号</th><th>物流单号</th><th>物流备注</th><th>更新日期</th></tr></thead><tbody>';
      for (const row of items) {
        const d = row.data || {};
        html += `<tr>
            <td>${escapeHtml(d.orderNo || '-')}</td>
            <td><code>${escapeHtml(d.trackingNo || '未发货')}</code></td>
            <td>${escapeHtml(d.trackingNote || '-')}</td>
            <td>${escapeHtml(d.trackingUpdatedAt || '-')}</td>
          </tr>`;
      }
      html += '</tbody></table>';
      area.innerHTML = html;
    } catch (e) { showError(e.message); }
  }

  // 预留：客户主动下单
  async function placeOrder() {
    alert('下单功能即将上线');
  }

  // 暴露全局函数供 HTML onclick 调用
  window.portalLogin = login;
  window.portalLogout = logout;
  window.portalSwitchTab = switchTab;
  window.portalResetFilters = resetFilters;
  window.portalPrevPage = prevPage;
  window.portalNextPage = nextPage;
  window.portalPrevReconPage = prevReconPage;
  window.portalNextReconPage = nextReconPage;
  window.portalLoadProducts = loadProducts;
  window.portalPlaceOrder = placeOrder;
})();
