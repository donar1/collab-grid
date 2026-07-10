// 测试 AG Grid PoC 的数据链路
const BASE = process.env.CG_BASE_URL || 'http://localhost:3001';

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${data.error || data.message || text}`);
  return data;
}

async function run() {
  console.log('=== AG Grid PoC API 链路测试 ===\n');

  // 1. 注册
  const email = `poc_${Date.now()}@test.local`;
  console.log('1. 注册:', email);
  const reg = await call('POST', '/api/register', { email, password: 'Pass123456!@', displayName: 'PoC' });
  const token = reg.token;
  console.log('   Token:', token.slice(0, 20) + '...');

  // 2. 创建基地
  console.log('\n2. 创建基地');
  const base = await call('POST', '/api/bases', { name: 'AG Grid PoC' }, token);
  const baseId = base.id;
  console.log('   BaseId:', baseId);

  // 3. 初始化模板
  console.log('\n3. 初始化 business-core 模板');
  await call('POST', `/api/bases/${baseId}/templates/business-core`, {}, token);
  console.log('   OK');

  // 4. 获取表结构
  console.log('\n4. 获取表结构');
  const baseData = await call('GET', `/api/bases/${baseId}`, undefined, token);
  const sales = baseData.tables.find(t => t.name === '销售订单表');
  console.log('   销售订单表 ID:', sales.id);
  console.log('   字段数:', sales.fields.length);
  for (const f of sales.fields) {
    console.log(`   - ${f.name} (${f.type})`);
  }

  // 5. 创建记录
  console.log('\n5. 创建记录');
  const record = await call('POST', `/api/tables/${sales.id}/records`, {}, token);
  const recordId = record.id;
  console.log('   RecordId:', recordId);

  // 6. 写入单元格
  console.log('\n6. 写入单元格');
  const qtyField = sales.fields.find(f => f.name === '数量');
  const priceField = sales.fields.find(f => f.name === '单价');
  await call('PUT', `/api/records/${recordId}/cells/${qtyField.id}`, { value: '5' }, token);
  await call('PUT', `/api/records/${recordId}/cells/${priceField.id}`, { value: '200' }, token);
  console.log('   数量=5, 单价=200');

  // 7. 加载 page 数据
  console.log('\n7. 加载 page 数据');
  const page = await call('GET', `/api/tables/${sales.id}/page?offset=0&limit=20`, undefined, token);
  console.log('   Records:', page.records.length);
  console.log('   Cells:', page.cells.length);
  console.log('   Links:', (page.links || []).length);

  // 8. 检查公式计算
  console.log('\n8. 检查公式（总金额=数量*单价）');
  const totalField = sales.fields.find(f => f.name === '总金额');
  const totalCell = page.cells.find(c => c.record_id === recordId && c.field_id === totalField.id);
  console.log('   总金额:', totalCell?.value);
  if (totalCell?.value === '1000') {
    console.log('   ✓ 公式计算正确');
  } else {
    console.log('   ✗ 公式计算错误');
  }

  // 9. 检查 AG Grid 需要的字段映射
  console.log('\n9. AG Grid 字段映射验证');
  const cellMap = new Map(page.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  const rowData = page.records.map(r => {
    const row = { __recordId: r.id };
    for (const f of sales.fields) {
      row[f.id] = cellMap.get(`${r.id}:${f.id}`) || '';
    }
    return row;
  });
  console.log('   RowData[0]:', JSON.stringify(rowData[0], null, 2));

  // 10. select 字段选项
  console.log('\n10. Select 字段选项');
  const statusField = sales.fields.find(f => f.name === '订单状态');
  console.log('   选项:', (statusField.options?.values || []).map(o => typeof o === 'object' ? o.label : o));

  console.log('\n=== 测试完成 ===');
  console.log('\n结论:');
  console.log('- API 链路完整');
  console.log('- page API 返回 records + cells + links');
  console.log('- 需要转换为 AG Grid rowData（recordId 映射到 row.__recordId）');
  console.log('- select 字段选项可直接用于 agSelectCellEditor');
}

run().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
