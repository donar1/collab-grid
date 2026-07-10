// modules/dashboard.js — 数据大屏（KPI/图表/排行/库存预警）
(function() {
  'use strict';
  const { el } = window;
  const { AppState: state } = window;
  const { api } = window;

  function fmtMoney(v) {
    const n = Number(v || 0);
    return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }

  function dashboardBars(trend) {
    const max = Math.max(1, ...trend.map(x => Math.max(x.sales || 0, x.profit || 0)));
    return el('div', { class: 'dash-bars' }, ...trend.map(x => el('div', { class: 'dash-bar-day' },
      el('div', { class: 'dash-bar-stack' },
        el('span', { class: 'dash-bar sales', style: { height: `${Math.max(4, (x.sales || 0) / max * 100)}%` }, title: `销售额 ${fmtMoney(x.sales)}` }),
        el('span', { class: 'dash-bar profit', style: { height: `${Math.max(4, (x.profit || 0) / max * 100)}%` }, title: `毛利 ${fmtMoney(x.profit)}` })
      ),
      el('small', {}, x.date.slice(5)),
      el('b', {}, x.orders)
    )));
  }

  function rankList(items, valueLabel = '金额') {
    const max = Math.max(1, ...items.map(x => x.amount || 0));
    if (!items.length) return el('div', { class: 'dash-empty' }, '暂无数据');
    return el('div', { class: 'dash-rank-list' }, ...items.map((x, i) => el('div', { class: 'dash-rank-row' },
      el('span', { class: 'rank-no' }, String(i + 1).padStart(2, '0')),
      el('div', { class: 'rank-main' },
        el('div', { class: 'rank-title' }, x.name),
        el('div', { class: 'rank-track' }, el('i', { style: { width: `${Math.max(3, (x.amount || 0) / max * 100)}%` } }))
      ),
      el('span', { class: 'rank-value' }, `${valueLabel} ${fmtMoney(x.amount)}`)
    )));
  }

  function financePanel(title, data, tone) {
    const total = Number(data.total || 0);
    const done = Number(data.received ?? data.paid ?? 0);
    const pending = Number(data.unreceived ?? data.unpaid ?? 0);
    const pct = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
    return el('div', { class: `dash-finance-card ${tone}` },
      el('div', { class: 'dash-section-title' }, title),
      el('div', { class: 'dash-ring', style: { '--pct': `${pct}%` } }, el('strong', {}, `${pct}%`), el('span', {}, '完成')),
      el('div', { class: 'dash-finance-grid' },
        el('div', {}, el('span', {}, '总额'), el('b', {}, fmtMoney(total))),
        el('div', {}, el('span', {}, '已处理'), el('b', {}, fmtMoney(done))),
        el('div', {}, el('span', {}, '未处理'), el('b', {}, fmtMoney(pending))),
        el('div', {}, el('span', {}, '红冲'), el('b', {}, fmtMoney(data.reversed)))
      )
    );
  }

  async function openDashboardModal() {
    const mask = el('div', { class: 'dashboard-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const screen = el('div', { class: 'dashboard-screen' });
    screen.appendChild(el('div', { class: 'dashboard-loading' }, '数据大屏加载中…'));
    mask.appendChild(screen);
    document.body.appendChild(mask);
    try {
      const data = await api(`/api/bases/${state.currentBaseId}/dashboard/summary`);
      screen.innerHTML = '';
      screen.appendChild(el('div', { class: 'dashboard-header' },
        el('div', {}, el('h2', {}, '经营数据大屏'), el('p', {}, `数据日期 ${data.date} · JimuReport 风格总览`)),
        el('div', { class: 'dashboard-actions' },
          el('button', { onclick: async () => { mask.remove(); await openDashboardModal(); } }, '刷新'),
          el('button', { onclick: () => mask.remove() }, '关闭')
        )
      ));
      screen.appendChild(el('div', { class: 'dash-card-grid' }, ...(data.cards || []).map(card => el('div', { class: `dash-kpi ${card.key}` },
        el('span', {}, card.label),
        el('strong', {}, `${card.unit === '¥' ? '¥' : ''}${fmtMoney(card.value)}${card.unit && card.unit !== '¥' ? card.unit : ''}`),
        el('i', {}, card.key.includes('today') ? '今日' : card.key.includes('month') ? '本月' : '财务')
      ))));
      screen.appendChild(el('div', { class: 'dash-layout' },
        el('section', { class: 'dash-panel wide' },
          el('div', { class: 'dash-section-title' }, '最近 7 天订单 / 销售 / 毛利'),
          dashboardBars(data.trend || [])
        ),
        el('section', { class: 'dash-panel' }, financePanel('应收对账', data.finance?.receivable || {}, 'receivable')),
        el('section', { class: 'dash-panel' }, financePanel('应付对账', data.finance?.payable || {}, 'payable')),
        el('section', { class: 'dash-panel' }, el('div', { class: 'dash-section-title' }, '付款方排行'), rankList(data.rankings?.payer || [], '销售')),
        el('section', { class: 'dash-panel' }, el('div', { class: 'dash-section-title' }, '收款方排行'), rankList(data.rankings?.payee || [], '应付')),
        el('section', { class: 'dash-panel' },
          el('div', { class: 'dash-section-title' }, '库存预警'),
          ...(data.inventoryWarnings || []).length ? (data.inventoryWarnings || []).map(x => el('div', { class: `dash-warning ${x.level}` },
            el('b', {}, x.name),
            el('span', {}, `实际 ${x.actual} · 虚拟 ${x.virtual} · 预警 ${x.warning}`)
          )) : [el('div', { class: 'dash-empty' }, '暂无库存预警')]
        ),
        el('section', { class: 'dash-panel' },
          el('div', { class: 'dash-section-title' }, '异常中心'),
          ...(data.exceptions || []).length ? (data.exceptions || []).map(x => el('div', { class: 'dash-exception' },
            el('b', {}, x.type),
            el('span', {}, x.title),
            el('em', {}, x.status)
          )) : [el('div', { class: 'dash-empty' }, '暂无待处理异常')]
        )
      ));
    } catch (e) {
      screen.innerHTML = '';
      screen.appendChild(el('div', { class: 'dashboard-loading error' }, e.message));
      screen.appendChild(el('button', { onclick: () => mask.remove() }, '关闭'));
    }
  }

  window.AppDashboard = { openDashboardModal };
})();
