const BASE = 'http://localhost:3001';
async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {}; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status}: ${data.error || text.slice(0,100)}`);
  return data;
}

async function run() {
  console.log('=== CollabGrid 数据初始化 ===\n');

  // 1. 登录
  const login = await call('POST', '/api/login', { email: 'admin@test.local', password: 'Admin123456!@' });
  const token = login.token;
  console.log('1. ✓ 登录成功');

  // 2. 获取基地
  const basesData = await call('GET', '/api/bases', undefined, token);
  let baseId = basesData.bases[0].id;
  console.log('2. 基地:', baseId.slice(0, 8));

  // 3. 获取表结构
  const baseData = await call('GET', '/api/bases/' + baseId, undefined, token);
  const tablesByName = {};
  for (const t of baseData.tables || []) { tablesByName[t.name] = t; }

  // 4. 如果没有 business-core 表，初始化模板
  if (!tablesByName['产品表']) {
    console.log('3. 初始化 business-core 模板...');
    await call('POST', `/api/bases/${baseId}/templates/business-core`, {}, token);
    const refreshed = await call('GET', '/api/bases/' + baseId, undefined, token);
    for (const t of refreshed.tables || []) { tablesByName[t.name] = t; }
    console.log('   ✓', Object.keys(tablesByName).length, '张表');
  } else {
    console.log('3. 已有', Object.keys(tablesByName).length, '张表');
  }

  // 5. 检查是否已有产品数据
  const productTable = tablesByName['产品表'];
  const productPage = await call('GET', `/api/tables/${productTable.id}/page?offset=0&limit=1`, undefined, token);
  if (productPage.records && productPage.records.length > 0) {
    console.log('\n   数据已存在，跳过');
    console.log('\n=== 完成 ===');
    console.log(`  邮箱: admin@test.local`);
    console.log(`  密码: Admin123456!@`);
    console.log(`  地址: http://localhost:3001/`);
    return;
  }

  // 6. 创建产品
  console.log('\n4. 创建产品...');
  const products = [
    { name: '云服务器 ECS', spec: '2核4G', price: '299', cost: '180', warn: '5' },
    { name: '对象存储 OSS', spec: '1TB标准包', price: '99', cost: '55', warn: '10' },
    { name: 'CDN加速', spec: '10TB流量包', price: '150', cost: '80', warn: '3' },
    { name: '域名注册', spec: '.com/年', price: '55', cost: '30', warn: '0' },
    { name: 'SSL证书', spec: 'DV单域名/年', price: '299', cost: '120', warn: '2' },
  ];
  const fieldsOf = (t) => Object.fromEntries(t.fields.map(f => [f.name, f.id]));
  const productIds = [];
  const pf = fieldsOf(productTable);
  for (const p of products) {
    const rec = await call('POST', `/api/tables/${productTable.id}/records`, {}, token);
    await call('PUT', `/api/records/${rec.id}/cells/${pf['产品名称']}`, { value: p.name }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${pf['规格']}`, { value: p.spec }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${pf['销售单价']}`, { value: p.price }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${pf['成本单价']}`, { value: p.cost }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${pf['库存预警下限']}`, { value: p.warn }, token);
    productIds.push(rec.id);
    console.log('   +', p.name);
  }

  // 7. 创建客户
  console.log('\n5. 创建客户...');
  const customerTable = tablesByName['客户账户表'];
  const customers = [
    { name: '杭州启明科技', phone: '0571-8888-1234' },
    { name: '上海星云网络', phone: '021-6666-5678' },
    { name: '北京数联智能', phone: '010-9999-9012' },
    { name: '深圳鹏程数据', phone: '0755-7777-3456' },
  ];
  const customerIds = [];
  const cf = fieldsOf(customerTable);
  for (const c of customers) {
    const rec = await call('POST', `/api/tables/${customerTable.id}/records`, {}, token);
    await call('PUT', `/api/records/${rec.id}/cells/${cf['客户名称']}`, { value: c.name }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${cf['联系电话']}`, { value: c.phone }, token);
    customerIds.push(rec.id);
    console.log('   +', c.name);
  }

  // 8. 创建销售订单
  console.log('\n6. 创建订单...');
  const salesTable = tablesByName['销售订单表'];
  const sf = fieldsOf(salesTable);
  const orders = [
    { ci: 0, pi: 0, qty: '10', status: '已发货' },
    { ci: 0, pi: 1, qty: '5', status: '待发货' },
    { ci: 1, pi: 2, qty: '20', status: '待发货' },
    { ci: 1, pi: 0, qty: '3', status: '已完成' },
    { ci: 2, pi: 4, qty: '8', status: '待发货' },
    { ci: 2, pi: 3, qty: '15', status: '已发货' },
    { ci: 3, pi: 0, qty: '5', status: '已完成' },
    { ci: 3, pi: 2, qty: '50', status: '待发货' },
  ];
  const orderIds = [];
  const custField = salesTable.fields.find(f => f.name === '客户');
  const prodField = salesTable.fields.find(f => f.name === '产品');
  for (const o of orders) {
    const rec = await call('POST', `/api/tables/${salesTable.id}/records`, {}, token);
    await call('PUT', `/api/records/${rec.id}/cells/${sf['数量']}`, { value: o.qty }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${sf['订单状态']}`, { value: o.status }, token);
    if (custField) await call('POST', '/api/links', { fieldId: custField.id, fromRecordId: rec.id, toRecordId: customerIds[o.ci] }, token);
    if (prodField) await call('POST', '/api/links', { fieldId: prodField.id, fromRecordId: rec.id, toRecordId: productIds[o.pi] }, token);
    orderIds.push(rec.id);
    console.log(`   + ${customers[o.ci].name} x ${products[o.pi].name} x ${o.qty}`);
  }

  // 9. 验证公式
  console.log('\n7. 验证公式...');
  const salesPage = await call('GET', `/api/tables/${salesTable.id}/page?offset=0&limit=50`, undefined, token);
  const totalField = salesTable.fields.find(f => f.name === '总金额');
  let formulaOk = 0;
  for (const rec of salesPage.records || []) {
    const oIdx = orderIds.indexOf(rec.id);
    if (oIdx < 0) continue;
    const tc = salesPage.cells.find(c => c.record_id === rec.id && c.field_id === totalField.id);
    const expected = Number(products[orders[oIdx].pi].price) * Number(orders[oIdx].qty);
    if (Math.abs(Number(tc?.value || 0) - expected) < 0.01) formulaOk++;
  }
  console.log(`   公式验证: ${formulaOk}/${orders.length} 正确`);

  // 10. 封账测试
  console.log('\n8. 封账测试...');
  const sealField = salesTable.fields.find(f => f.name === '封账');
  const completedRec = salesPage.records.find(r => {
    const sc = salesPage.cells.find(c => c.record_id === r.id && c.field_id === sf['订单状态']);
    return sc?.value === '已完成';
  });
  if (completedRec && sealField) {
    await call('POST', '/api/buttons/execute', { fieldId: sealField.id, recordId: completedRec.id }, token);
    console.log('   ✓ 封账成功');
    try {
      await call('PUT', `/api/records/${completedRec.id}/cells/${sf['数量']}`, { value: '999' }, token);
      console.log('   ✗ 封账后仍可编辑');
    } catch (e) {
      console.log('   ✓ 封账后编辑被拒绝');
    }
  }

  console.log('\n=== 完成 ===');
  console.log(`  邮箱: admin@test.local`);
  console.log(`  密码: Admin123456!@`);
  console.log(`  地址: http://localhost:3001/`);
  console.log(`  产品: ${products.length} | 客户: ${customers.length} | 订单: ${orders.length}`);
}

run().catch(e => { console.error('失败:', e.message); process.exit(1); });
