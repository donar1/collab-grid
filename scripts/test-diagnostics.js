// test-diagnostics.js — 验证 diagnostics 字段映射修复
const { runDiagnostics } = require('./jobs/diagnostics');

async function main() {
  // 找一个有 销售订单表 的 base
  const db = require('./db');
  const tables = db.prepare('SELECT id, name FROM tables WHERE name=?', '销售订单表').all();
  if (!tables.length) {
    console.log('SKIP: 没有销售订单表');
    return;
  }
  const tableIds = [...new Set(tables.map(t => t.id))];
  // 查找 base_id 通过 records 表反向查找
  const bases = db.prepare('SELECT id FROM bases').all();
  if (!bases.length) {
    console.log('SKIP: 没有基地');
    return;
  }

  for (const base of bases) {
    const result = await runDiagnostics({ baseId: base.id });
    console.log('=== Base:', base.id, '===');
    console.log('Counts:', JSON.stringify(result.counts));
    console.log('Issues:', result.issueCount);
    for (const issue of result.issues) {
      console.log('  [' + issue.code + '] ' + issue.title + ' - ' + issue.count + ' 项');
    }
    console.log('');
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });