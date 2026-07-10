// scripts/seed-business-data.js
// Phase 3 数据准备：初始化业务模板 + 灌测试订单
const BASE = process.env.CG_BASE_URL || 'http://localhost:3001';

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
  return [res.status, data];
}

async function seed() {
  const email = `seed_${Date.now()}@test.local`;
  console.log('Step 1: Register user', email);
  let [sc, data] = await call('POST', '/api/register', {
    email,
    password: 'SeedPass123!@',
    displayName: 'Seed Bot',
  });
  if (sc !== 200) throw new Error(`Register failed: ${sc} ${JSON.stringify(data)}`);
  const token = data.token;
  console.log('  OK, token acquired');

  console.log('Step 2: Create base');
  [sc, data] = await call('POST', '/api/bases', { name: '业务验证空间' }, token);
  if (sc !== 200) throw new Error(`Create base failed: ${sc} ${JSON.stringify(data)}`);
  const baseId = data.id;
  console.log('  OK, baseId:', baseId);

  console.log('Step 3: Init business-core template');
  [sc, data] = await call('POST', `/api/bases/${baseId}/templates/business-core`, {}, token);
  if (sc !== 200) throw new Error(`Template init failed: ${sc} ${JSON.stringify(data)}`);
  console.log('  OK');

  console.log('Step 4: Get base detail (tables & fields)');
  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  if (sc !== 200) throw new Error(`Get base failed: ${sc}`);
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const productTable = tables['产品表'];
  const customerTable = tables['客户账户表'];
  const salesTable = tables['销售订单表'];
  const inventoryTable = tables['库存表'];
  const settlementTable = tables['结算表'];
  console.log('  Tables:', Object.keys(tables).join(', '));

  const pf = Object.fromEntries(productTable.fields.map(f => [f.name, f]));
  const cf = Object.fromEntries(customerTable.fields.map(f => [f.name, f]));
  const sf = Object.fromEntries(salesTable.fields.map(f => [f.name, f]));
  const invf = Object.fromEntries(inventoryTable.fields.map(f => [f.name, f]));
  const setf = Object.fromEntries(settlementTable.fields.map(f => [f.name, f]));

  // Step 5: Seed products
  const products = [
    { name: '光纤熔接机 A型', spec: 'OTDR-100A', price: '15000', cost: '8000', warn: '5' },
    { name: '光功率计 B型', spec: 'OPM-200B', price: '3200', cost: '1500', warn: '10' },
    { name: '光纤切割刀 C型', spec: 'FC-300C', price: '880', cost: '400', warn: '20' },
    { name: 'OTDR 测试仪 D型', spec: 'OTDR-500D', price: '45000', cost: '25000', warn: '2' },
  ];
  const productRecords = [];
  for (const p of products) {
    [sc, data] = await call('POST', `/api/tables/${productTable.id}/records`, {}, token);
    const rid = data.id;
    await call('PUT', `/api/records/${rid}/cells/${pf['产品名称'].id}`, { value: p.name }, token);
    await call('PUT', `/api/records/${rid}/cells/${pf['规格'].id}`, { value: p.spec }, token);
    await call('PUT', `/api/records/${rid}/cells/${pf['销售单价'].id}`, { value: p.price }, token);
    await call('PUT', `/api/records/${rid}/cells/${pf['成本单价'].id}`, { value: p.cost }, token);
    await call('PUT', `/api/records/${rid}/cells/${pf['库存预警下限'].id}`, { value: p.warn }, token);
    productRecords.push({ id: rid, ...p });
  }
  console.log(`Step 5: Seeded ${productRecords.length} products`);

  // Step 6: Seed customers
  const customers = [
    { name: '张三（高新区办事处）', phone: '13800138001', balance: '50000', status: '正常' },
    { name: '李四（通信工程公司）', phone: '13900139002', balance: '120000', status: '正常' },
    { name: '王五（市政管网局）', phone: '13700137003', balance: '0', status: '冻结' },
  ];
  const customerRecords = [];
  for (const c of customers) {
    [sc, data] = await call('POST', `/api/tables/${customerTable.id}/records`, {}, token);
    const rid = data.id;
    await call('PUT', `/api/records/${rid}/cells/${cf['客户名称'].id}`, { value: c.name }, token);
    await call('PUT', `/api/records/${rid}/cells/${cf['联系电话'].id}`, { value: c.phone }, token);
    await call('PUT', `/api/records/${rid}/cells/${cf['账户余额'].id}`, { value: c.balance }, token);
    await call('PUT', `/api/records/${rid}/cells/${cf['状态'].id}`, { value: c.status }, token);
    customerRecords.push({ id: rid, ...c });
  }
  console.log(`Step 6: Seeded ${customerRecords.length} customers`);

  // Step 7: Seed sales orders (link to customer + product)
  const orders = [
    { customerIdx: 0, productIdx: 0, qty: '3', unitPrice: '15000', status: '待发货' },
    { customerIdx: 0, productIdx: 1, qty: '10', unitPrice: '3200', status: '已发货' },
    { customerIdx: 1, productIdx: 3, qty: '1', unitPrice: '45000', status: '已完成' },
    { customerIdx: 1, productIdx: 0, qty: '2', unitPrice: '15000', status: '待发货' },
    { customerIdx: 0, productIdx: 2, qty: '20', unitPrice: '880', status: '已发货' },
  ];
  const orderRecords = [];
  for (const o of orders) {
    [sc, data] = await call('POST', `/api/tables/${salesTable.id}/records`, {}, token);
    const rid = data.id;
    const custId = customerRecords[o.customerIdx].id;
    const prodId = productRecords[o.productIdx].id;

    // link fields: use linkRecordId
    await call('PUT', `/api/records/${rid}/cells/${sf['客户'].id}`, { linkRecordId: custId }, token);
    await call('PUT', `/api/records/${rid}/cells/${sf['产品'].id}`, { linkRecordId: prodId }, token);
    await call('PUT', `/api/records/${rid}/cells/${sf['数量'].id}`, { value: o.qty }, token);
    await call('PUT', `/api/records/${rid}/cells/${sf['单价'].id}`, { value: o.unitPrice }, token);
    await call('PUT', `/api/records/${rid}/cells/${sf['订单状态'].id}`, { value: o.status }, token);
    orderRecords.push({ id: rid, ...o });
  }
  console.log(`Step 7: Seeded ${orderRecords.length} sales orders`);

  // Step 8: Seed inventory
  for (let i = 0; i < productRecords.length; i++) {
    const p = productRecords[i];
    [sc, data] = await call('POST', `/api/tables/${inventoryTable.id}/records`, {}, token);
    const rid = data.id;
    await call('PUT', `/api/records/${rid}/cells/${invf['产品'].id}`, { linkRecordId: p.id }, token);
    await call('PUT', `/api/records/${rid}/cells/${invf['当前库存'].id}`, { value: String(50 + i * 10) }, token);
    await call('PUT', `/api/records/${rid}/cells/${invf['入库总量'].id}`, { value: String(100 + i * 20) }, token);
    await call('PUT', `/api/records/${rid}/cells/${invf['出库总量'].id}`, { value: String(50 + i * 10) }, token);
  }
  console.log(`Step 8: Seeded ${productRecords.length} inventory records`);

  // Step 9: Seed settlements (link to sales orders)
  for (let i = 0; i < Math.min(3, orderRecords.length); i++) {
    const o = orderRecords[i];
    const total = Number(o.qty) * Number(o.unitPrice);
    [sc, data] = await call('POST', `/api/tables/${settlementTable.id}/records`, {}, token);
    const rid = data.id;
    await call('PUT', `/api/records/${rid}/cells/${setf['销售订单'].id}`, { linkRecordId: o.id }, token);
    await call('PUT', `/api/records/${rid}/cells/${setf['应收金额'].id}`, { value: String(total) }, token);
    await call('PUT', `/api/records/${rid}/cells/${setf['实收金额'].id}`, { value: i === 2 ? String(total) : String(Math.floor(total * 0.5)) }, token);
    await call('PUT', `/api/records/${rid}/cells/${setf['结算状态'].id}`, { value: i === 2 ? '已结算' : '待结算' }, token);
  }
  console.log(`Step 9: Seeded 3 settlement records`);

  // Step 10: Verify a formula cell
  console.log('Step 10: Verify formula calculation');
  [sc, data] = await call('GET', `/api/tables/${salesTable.id}/page?offset=0&limit=20`, undefined, token);
  const cellMap = new Map(data.cells.map(c => [`${c.record_id}:${c.field_id}`, c.value]));
  const firstOrder = orderRecords[0];
  const totalCell = cellMap.get(`${firstOrder.id}:${sf['总金额'].id}`);
  console.log(`  Order 1 total amount: ${totalCell} (expected 45000)`);

  console.log('\n=== Seed complete ===');
  console.log('Base ID:', baseId);
  console.log('User email:', email);
  console.log('User token:', token.slice(0, 20) + '...');
  console.log('Tables ready for Phase 3 end-to-end testing');
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
