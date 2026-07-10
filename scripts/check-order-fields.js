// scripts/check-order-fields.js
// 查看销售订单表的所有字段
const BASE = 'http://localhost:3001';
async function call(method, path, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  return res.json();
}
(async () => {
  const login = await call('POST', '/api/login', { email: 'tester@frontend.local', password: 'FrontendTest123!' });
  const token = login.token;
  const basesRes = await call('GET', '/api/bases', token);
  const baseId = basesRes.bases?.[0]?.id;
  const detail = await call('GET', `/api/bases/${baseId}`, token);
  if (detail.error) { console.error('API error:', detail.error); return; }
  console.log('detail keys:', Object.keys(detail));
  const tables = detail.tables || detail.data?.tables || [];
  console.log('tables count:', tables.length, tables.map(t => t.name));
  const table = tables.find(t => t.name === '销售订单表');
  if (!table) { console.error('NOT FOUND'); return; }
  console.log('销售订单表 fields:');
  for (const f of table.fields) {
    console.log(`  ${f.name} (${f.type}) id=${f.id}`);
  }
})();
