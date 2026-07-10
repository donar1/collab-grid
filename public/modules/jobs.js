// modules/jobs.js — 作业中心 + 诊断中心
(function() {
  'use strict';
  const { el, toast } = window;
  const { AppState: state } = window;
  const { api } = window;

  async function openJobsModal() {
    const { AppAuth } = window;
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal wide' });
    modal.appendChild(el('h3', {}, '作业中心'));
    modal.appendChild(el('p', { class: 'desc' }, '先试算再执行。试算只生成报告，不会写资源状态、奖金、流水或订单结算标记。'));
    const dateInput = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const dryRunInput = el('input', { type: 'checkbox', checked: 'checked' });
    const resultBox = el('pre', { class: 'job-result' }, '执行结果会显示在这里');
    const runsBox = el('div', { class: 'member-list' });
    const runJob = async (jobKey) => {
      try {
        const r = await api(`/api/bases/${state.currentBaseId}/jobs/${jobKey}/run`, {
          method: 'POST',
          body: { businessDate: dateInput.value, dryRun: dryRunInput.checked }
        });
        resultBox.textContent = JSON.stringify(r.summary || r, null, 2);
        await loadRuns();
        toast(dryRunInput.checked ? '试算完成' : '作业执行完成');
        if (AppAuth) await AppAuth.openBase(state.currentBaseId);
      } catch (e) { toast(e.message, 'err'); resultBox.textContent = e.message; }
    };
    const loadRuns = async () => {
      const data = await api(`/api/bases/${state.currentBaseId}/jobs/runs?limit=10`);
      runsBox.innerHTML = '';
      for (const r of data.runs || []) {
        runsBox.appendChild(el('div', { class: 'member-row' },
          el('div', {}, el('strong', {}, `${r.job_key} · ${r.business_date}`), el('div', { class: 'desc' }, `${r.status} · 扫描 ${r.scanned_count} · 变更 ${r.changed_count}`)),
          el('span', { class: 'badge' }, r.mode)
        ));
      }
    };
    modal.appendChild(el('label', {}, '业务日期'));
    modal.appendChild(dateInput);
    modal.appendChild(el('label', {}, dryRunInput, ' 试算模式'));
    modal.appendChild(el('div', { class: 'actions' },
      el('button', { onclick: () => runJob('status_update') }, '资源状态作业'),
      el('button', { onclick: () => runJob('commission_settlement') }, '佣金结算作业')
    ));
    modal.appendChild(resultBox);

    // ===== 定时执行设置 =====
    modal.appendChild(el('h4', {}, '定时执行设置'));
    modal.appendChild(el('p', { class: 'desc' }, '开启后系统会在每天指定时间自动跑这个作业，用于产出日报。时间使用本机所在时区（24 小时制）。'));
    const scheduleBox = el('div', { class: 'schedule-list' }, '加载中…');
    modal.appendChild(scheduleBox);

    const JOB_LABEL = { status_update: '资源状态作业', commission_settlement: '佣金结算作业' };
    const formatTs = (ts) => {
      if (!ts) return '从未运行';
      const d = new Date(Number(ts));
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    const loadConfigs = async () => {
      try {
        const data = await api(`/api/bases/${state.currentBaseId}/jobs/configs`);
        scheduleBox.innerHTML = '';
        for (const cfg of data.configs || []) {
          const label = JOB_LABEL[cfg.job_key] || cfg.job_key;
          const enableInput = el('input', { type: 'checkbox' });
          if (cfg.schedule_enabled) enableInput.checked = true;
          const timeInput = el('input', { type: 'time', value: cfg.schedule_time || '08:00', step: '60' });
          const modeSelect = el('select', {});
          for (const opt of [['today', '当天'], ['yesterday', '昨天']]) {
            const o = el('option', { value: opt[0] }, opt[1]);
            if ((cfg.schedule_business_date_mode || 'today') === opt[0]) o.selected = true;
            modeSelect.appendChild(o);
          }
          const scheduleDryRun = el('input', { type: 'checkbox' });
          if (cfg.schedule_dry_run) scheduleDryRun.checked = true;

          const statusText = cfg.schedule_last_run_at
            ? `上次：${formatTs(cfg.schedule_last_run_at)} · ${cfg.schedule_last_run_status || '-'}`
            : '尚未自动执行过';

          const saveBtn = el('button', { class: 'primary' }, '保存定时');
          saveBtn.onclick = async () => {
            const t = timeInput.value;
            if (enableInput.checked && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) {
              return toast('请输入正确的时间（HH:MM）', 'warn');
            }
            try {
              await api(`/api/bases/${state.currentBaseId}/jobs/configs/${cfg.job_key}`, {
                method: 'PATCH',
                body: {
                  schedule_enabled: enableInput.checked,
                  schedule_time: t,
                  schedule_business_date_mode: modeSelect.value,
                  schedule_dry_run: scheduleDryRun.checked,
                }
              });
              toast('定时设置已保存');
              await loadConfigs();
            } catch (e) { toast(e.message, 'err'); }
          };

          scheduleBox.appendChild(el('div', { class: 'schedule-row member-row' },
            el('div', { class: 'schedule-row-main' },
              el('strong', {}, label),
              el('div', { class: 'schedule-fields' },
                el('label', { class: 'inline' }, enableInput, ' 开启定时'),
                el('label', { class: 'inline' }, ' 时间 ', timeInput),
                el('label', { class: 'inline' }, ' 业务日期 ', modeSelect),
                el('label', { class: 'inline' }, scheduleDryRun, ' 试算模式'),
              ),
              el('div', { class: 'desc' }, statusText)
            ),
            el('div', { class: 'schedule-row-actions' }, saveBtn)
          ));
        }
        if (!(data.configs || []).length) {
          scheduleBox.appendChild(el('div', { class: 'empty' }, '暂无作业'));
        }
      } catch (e) {
        scheduleBox.textContent = e.message;
      }
    };

    modal.appendChild(el('h4', {}, '最近执行'));
    modal.appendChild(runsBox);
    modal.appendChild(el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: () => mask.remove() }, '关闭')));
    mask.appendChild(modal); document.body.appendChild(mask);
    try { await loadRuns(); } catch (e) { runsBox.textContent = e.message; }
    await loadConfigs();
  }

  async function openDiagnosticsModal() {
    const mask = el('div', { class: 'modal-mask', onclick: (e) => { if (e.target === mask) mask.remove(); } });
    const modal = el('div', { class: 'modal wide' });
    modal.appendChild(el('h3', {}, '诊断中心'));
    modal.appendChild(el('p', { class: 'desc' }, '检查完结订单、快照、佣金流水、退款原订单、已解绑佣金和失败作业。诊断只读，不会修改数据。'));
    const dateInput = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const summary = el('div', { class: 'diag-summary' }, '尚未诊断');
    const list = el('div', { class: 'member-list' });
    const run = async () => {
      try {
        const data = await api(`/api/bases/${state.currentBaseId}/diagnostics?businessDate=${encodeURIComponent(dateInput.value)}`);
        summary.textContent = `订单 ${data.counts.orders} · 绑定 ${data.counts.locks} · 流水 ${data.counts.ledgers} · 问题 ${data.issueCount}`;
        list.innerHTML = '';
        if (!(data.issues || []).length) list.appendChild(el('div', { class: 'empty' }, '没有发现诊断问题'));
        for (const item of data.issues || []) {
          list.appendChild(el('div', { class: 'member-row diag-row' },
            el('div', {},
              el('strong', {}, `${item.title}（${item.count}）`),
              el('div', { class: 'desc' }, item.suggest || ''),
              el('pre', { class: 'diag-samples' }, JSON.stringify(item.samples || [], null, 2))
            ),
            el('span', { class: `badge sev-${item.severity}` }, item.severity)
          ));
        }
      } catch (e) { toast(e.message, 'err'); summary.textContent = e.message; }
    };
    modal.appendChild(el('label', {}, '业务日期'));
    modal.appendChild(dateInput);
    modal.appendChild(el('div', { class: 'actions' }, el('button', { onclick: run }, '开始诊断')));
    modal.appendChild(summary);
    modal.appendChild(list);
    modal.appendChild(el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: () => mask.remove() }, '关闭')));
    mask.appendChild(modal); document.body.appendChild(mask);
    await run();
  }

  window.AppJobs = { openJobsModal, openDiagnosticsModal };
})();
