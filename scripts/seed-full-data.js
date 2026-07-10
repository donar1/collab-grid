// scripts/seed-full-data.js — 创建测试账号 + business-core 模板 + 测试数据
const assert = require('assert');
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
  if (!res.ok) {
    throw new Error(`${res.status}: ${data.error || data.message || text}`);
  }
  return data;
}

async function callRaw(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {}; try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return { status: res.status, data };
}

async function run() {
  console.log('=== CollabGrid 数据初始化 ===\n');

  // 1. 注册管理员账号
  const email = 'admin@test.local';
  const password = 'Admin123456!@';
  try {
    console.log('1. 注册管理员:', email);
    const reg = await call('POST', '/api/register', { email, password, displayName: '管理员' });
    var token = reg.token;
    console.log('   ✓ 注册成功');
  } catch (e) {
    // 可能已存在，尝试登录
    console.log('   已存在，尝试登录...');
    const login = await call('POST', '/api/login', { email, password });
    token = login.token;
    console.log('   ✓ 登录成功');
  }

  // 2. 获取或创建基地
  console.log('\n2. 获取基地列表');
  let baseId;
  try {
    const bases = await call('GET', '/api/bases', undefined, token);
    if (bases.bases && bases.bases.length > 0) {
      baseId = bases.bases[0].id;
      console.log('   已有基地:', bases.bases[0].name, '(' + baseId.slice(0, 8) + '...)');
    } else {
      throw new Error('no bases');
    }
  } catch (e) {
    console.log('   创建新基地...');
    const base = await call('POST', '/api/bases', { name: 'CollabGrid 测试空间' }, token);
    baseId = base.id;
    console.log('   ✓ 创建基地 (' + baseId.slice(0, 8) + '...)');
  }

  // 3. 获取表结构
  console.log('\n3. 获取表结构');
  let baseData;
  // 尝试每个基地直到找到一个可以访问的
  const allBases = await call('GET', '/api/bases', undefined, token);
  console.log('   共', allBases.bases?.length, '个基地');
  for (const b of allBases.bases || []) {
    const detail = await callRaw('GET', '/api/bases/' + b.id, undefined, token);
    console.log('   -', b.name, '(' + b.id.slice(0, 8) + '...)', '→', detail.status);
    if (detail.status === 200) {
      baseId = b.id;
      baseData = detail.data;
      console.log('   使用基地:', b.name, '(' + b.id.slice(0, 8) + '...)');
      break;
    }
  }
  if (!baseData) {
    throw new Error('所有基地都无法访问');
  }
  const tablesByName = {};
  for (const t of baseData.tables || []) {
    tablesByName[t.name] = t;
  }

  // 4. 如果没有表，初始化 business-core 模板
  if (Object.keys(tablesByName).length === 0) {
    console.log('   没有表，初始化 business-core 模板...');
    await call('POST', `/api/bases/${baseId}/templates/business-core`, {}, token);
    const refreshed = await call('GET', '/api/bases/' + baseId, undefined, token);
    for (const t of refreshed.tables || []) {
      tablesByName[t.name] = t;
    }
    console.log('   ✓ 模板初始化完成，共', Object.keys(tablesByName).length, '张表');
  } else {
    console.log('   已有', Object.keys(tablesByName).length, '张表');
    // 如果有表但有数据，跳过
    for (const [name, t] of Object.entries(tablesByName)) {
      const page = await call('GET', `/api/tables/${t.id}/page?offset=0&limit=5`, undefined, token);
      if (page.records && page.records.length > 0) {
        console.log(`   ${name}: 已有 ${page.records.length} 条记录，跳过数据填充`);
        // 如果所有表都有数据就不需要填充
      }
    }
    // 简单判断：如果产品表有数据就不填充
    const productCheck = await call('GET', `/api/tables/${tablesByName['产品表']?.id || 'nope'}/page?offset=0&limit=1`, undefined, token);
    if (productCheck.records && productCheck.records.length > 0) {
      console.log('\n   数据已存在，初始化完成');
      console.log('\n=== 完成 ===');
      console.log(`\n登录信息:`);
      console.log(`  邮箱: ${email}`);
      console.log(`  密码: ${password}`);
      console.log(`  地址: http://localhost:3001/`);
      return;
    }
  }

  // 5. 创建测试数据 — 产品
  console.log('\n4. 创建产品数据');
  const productTable = tablesByName['产品表'];
  const products = [
    { name: '云服务器 ECS', spec: '2核4G', price: '299', cost: '180', warn: '5' },
    { name: '对象存储 OSS', spec: '1TB标准包', price: '99', cost: '55', warn: '10' },
    { name: 'CDN加速', spec: '10TB流量包', price: '150', cost: '80', warn: '3' },
    { name: '域名注册', spec: '.com/年', price: '55', cost: '30', warn: '0' },
    { name: 'SSL证书', spec: 'DV单域名/年', price: '299', cost: '120', warn: '2' },
  ];
  const productIds = [];
  for (const p of products) {
    const rec = await call('POST', `/api/tables/${productTable.id}/records`, {}, token);
    const fields = Object.fromEntries(productTable.fields.map(f => [f.name, f.id]));
    await call('PUT', `/api/records/${rec.id}/cells/${fields['产品名称']}`, { value: p.name }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${fields['规格']}`, { value: p.spec }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${fields['销售单价']}`, { value: p.price }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${fields['成本单价']}`, { value: p.cost }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${fields['库存预警下限']}`, { value: p.warn }, token);
    productIds.push(rec.id);
    console.log(`   + ${p.name}`);
  }

  // 6. 创建测试数据 — 客户
  console.log('\n5. 创建客户数据');
  const customerTable = tablesByName['客户账户表'];
  const customers = [
    { name: '杭州启明科技', phone: '0571-8888-1234' },
    { name: '上海星云网络', phone: '021-6666-5678' },
    { name: '北京数联智能', phone: '010-9999-9012' },
    { name: '深圳鹏程数据', phone: '0755-7777-3456' },
  ];
  const customerIds = [];
  for (const c of customers) {
    const rec = await call('POST', `/api/tables/${customerTable.id}/records`, {}, token);
    const fields = Object.fromEntries(customerTable.fields.map(f => [f.name, f.id]));
    await call('PUT', `/api/records/${rec.id}/cells/${fields['客户名称']}`, { value: c.name }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${fields['联系电话']}`, { value: c.phone }, token);
    customerIds.push(rec.id);
    console.log(`   + ${c.name}`);
  }

  // 7. 创建测试数据 — 销售订单
  console.log('\n6. 创建销售订单');
  const salesTable = tablesByName['销售订单表'];
  const salesFields = Object.fromEntries(salesTable.fields.map(f => [f.name, f.id]));
  const orders = [
    { customer: 0, product: 0, qty: '10', status: '已发货' },   // 启明科技 x ECS x 10
    { customer: 0, product: 1, qty: '5', status: '待发货' },    // 启明科技 x OSS x 5
    { customer: 1, product: 2, qty: '20', status: '待发货' },   // 星云网络 x CDN x 20
    { customer: 1, product: 0, qty: '3', status: '已完成' },    // 星云网络 x ECS x 3
    { customer: 2, product: 4, qty: '8', status: '待发货' },    // 数联智能 x SSL x 8
    { customer: 2, product: 3, qty: '15', status: '已发货' },   // 数联智能 x 域名 x 15
    { customer: 3, product: 0, qty: '5', status: '已完成' },    // 鹏程数据 x ECS x 5
    { customer: 3, product: 2, qty: '50', status: '待发货' },   // 鹏程数据 x CDN x 50
  ];
  const orderIds = [];
  for (const o of orders) {
    const rec = await call('POST', `/api/tables/${salesTable.id}/records`, {}, token);
    await call('PUT', `/api/records/${rec.id}/cells/${salesFields['数量']}`, { value: o.qty }, token);
    await call('PUT', `/api/records/${rec.id}/cells/${salesFields['订单状态']}`, { value: o.status }, token);

    // 创建关联：客户
    const custField = salesTable.fields.find(f => f.name === '客户');
    if (custField && customerIds[o.customer]) {
      await call('POST', '/api/links', { fieldId: custField.id, fromRecordId: rec.id, toRecordId: customerIds[o.customer] }, token);
    }
    // 创建关联：产品
    const prodField = salesTable.fields.find(f => f.name === '产品');
    if (prodField && productIds[o.product]) {
      await call('POST', '/api/links', { fieldId: prodField.id, fromRecordId: rec.id, toRecordId: productIds[o.product] }, token);
    }
    orderIds.push(rec.id);
    console.log(`   + 订单 ${orders.indexOf(o) + 1}: ${customers[o.customer].name} x ${products[o.product].name} x ${o.qty}`);
  }

  // 8. 刷新获取完整数据（含公式计算）
  console.log('\n7. 验证公式计算');
  const salesPage = await call('GET', `/api/tables/${salesTable.id}/page?offset=0&limit=50`, undefined, token);
  const totalField = salesTable.fields.find(f => f.name === '总金额');
  for (const rec of salesPage.records || []) {
    const oIdx = orderIds.indexOf(rec.id);
    if (oIdx < 0) continue;
    const totalCell = salesPage.cells.find(c => c.record_id === rec.id && c.field_id === totalField.id);
    const expected = Number(products[orders[oIdx].product].price) * Number(orders[oIdx].qty);
    const actual = Number(totalCell?.value || 0);
    const ok = Math.abs(expected - actual) < 0.01;
    console.log(`   订单${oIdx + 1}: 总金额=${totalCell?.value} (期望 ${expected}) ${ok ? '✓' : '✗'}`);
  }

  // 9. 封账一个已完成订单
  console.log('\n8. 封账测试');
  const sealField = salesTable.fields.find(f => f.name === '封账');
  const completedOrderRec = salesPage.records.find(r => {
    const statusCell = salesPage.cells.find(c => c.record_id === r.id && c.field_id === salesFields['订单状态']);
    return statusCell?.value === '已完成';
  });
  if (completedOrderRec && sealField) {
    await call('POST', '/api/buttons/execute', { fieldId: sealField.id, recordId: completedOrderRec.id }, token);
    console.log('   ✓ 封账成功');

    // 验证锁定
    try {
      await call('PUT', `/api/records/${completedOrderRec.id}/cells/${salesFields['数量']}`, { value: '999' }, token);
      console.log('   ✗ 封账后仍可编辑');
    } catch (e) {
      if (e.message.includes('423') || e.message.includes('locked')) {
        console.log('   ✓ 封账后编辑被拒绝');
      } else {
        console.log('   ? 编辑被拒绝但原因不同:', e.message);
      }
    }
  }

  // 完成
  console.log('\n=== 初始化完成 ===');
  console.log(`\n登录信息:`);
  console.log(`  邮箱: ${email}`);
  console.log(`  密码: ${password}`);
  console.log(`  地址: http://localhost:3001/`);
  console.log(`\n数据概要:`);
  console.log(`  产品: ${products.length} 条`);
  console.log(`  客户: ${customers.length} 条`);
  console.log(`  订单: ${orders.length} 条`);
  console.log(`  关联: ${orders.length * 2} 条（每单关联客户+产品）`);
}

run().catch(e => {
  console.error('失败:', e.message);
  process.exit(1);
});
