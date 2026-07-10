// scripts/seed-frontend-test.js
// 前端功能测试专用数据集 — 覆盖所有业务场景
const BASE = 'http://localhost:3001';

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
  // === 1. 注册测试账户 ===
  const email = 'tester@frontend.local';
  const password = 'FrontendTest123!';
  let [sc, data] = await call('POST', '/api/register', { email, password, displayName: '前端测试员' });
  let token;
  if (sc === 200) {
    token = data.token;
    console.log('Created account:', email);
  } else if (data.error && (data.error.includes('already exists') || data.error.includes('already registered'))) {
    const login = await call('POST', '/api/login', { email, password });
    token = login[1].token;
    console.log('Logged in:', email);
  } else {
    throw new Error('Register failed: ' + JSON.stringify(data));
  }

  // === 2. 创建 Base ===
  [sc, data] = await call('POST', '/api/bases', { name: '前端功能测试空间' }, token);
  const baseId = data.id;
  console.log('Base ID:', baseId);

  // === 3. 初始化 business-core 模板 ===
  await call('POST', `/api/bases/${baseId}/templates/business-core`, {}, token);
  console.log('Template initialized');

  // === 4. 获取表和字段 ===
  [sc, data] = await call('GET', `/api/bases/${baseId}`, undefined, token);
  const tables = Object.fromEntries(data.tables.map(t => [t.name, t]));
  const T = {
    product: tables['产品表'],
    customer: tables['客户账户表'],
    sales: tables['销售订单表'],
    purchase: tables['采购订单表'],
    inventory: tables['库存表'],
    settlement: tables['结算表'],
    refund: tables['退款表'],
    fund: tables['资金流水表'],
    preDevice: tables['预存设备表'],
    deviceUse: tables['设备使用记录表'],
  };
  const F = {};
  for (const [k, t] of Object.entries(T)) {
    if (t) F[k] = Object.fromEntries(t.fields.map(f => [f.name, f]));
  }

  // === 5. 供应商名称列表（采购订单直接填 text） ===
  const supplierNames = ['深圳光电科技', '武汉光纤制造厂', '上海精密仪器', '北京通信设备'];
  console.log('Suppliers:', supplierNames.length);

  // === 6. 灌入产品 ===
  const products = [
    { name: '光纤熔接机 A型', spec: 'OTDR-100A', unit: '台', price: '15000', cost: '8000', warn: '5' },
    { name: '光功率计 B型', spec: 'OPM-200B', unit: '台', price: '3200', cost: '1500', warn: '10' },
    { name: '光纤切割刀 C型', spec: 'FC-300C', unit: '把', price: '880', cost: '400', warn: '20' },
    { name: 'OTDR 测试仪 D型', spec: 'OTDR-500D', unit: '台', price: '45000', cost: '25000', warn: '2' },
    { name: '光纤跳线 E型', spec: 'SC-SC-3M', unit: '条', price: '45', cost: '15', warn: '100' },
    { name: '光纤配线架 F型', spec: 'ODF-24口', unit: '个', price: '680', cost: '300', warn: '15' },
  ];
  const productRecs = [];
  for (const p of products) {
    [, data] = await call('POST', `/api/tables/${T.product.id}/records`, {}, token);
    const rid = data.id;
    await call('PUT', `/api/records/${rid}/cells/${F.product['产品名称'].id}`, { value: p.name }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.product['规格'].id}`, { value: p.spec }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.product['销售单价'].id}`, { value: p.price }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.product['成本单价'].id}`, { value: p.cost }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.product['库存预警下限'].id}`, { value: p.warn }, token);
    productRecs.push({ id: rid, ...p });
  }
  console.log('Products:', productRecs.length);

  // === 7. 灌入客户 ===
  const customers = [
    { name: '张三（高新区办事处）', phone: '13800138001', balance: '50000', status: '正常' },
    { name: '李四（通信工程公司）', phone: '13900139002', balance: '120000', status: '正常' },
    { name: '王五（市政管网局）', phone: '13700137003', balance: '0', status: '冻结' },
    { name: '赵六（电力设计院）', phone: '13600136004', balance: '80000', status: '正常' },
    { name: '孙七（铁路信号段）', phone: '13500135005', balance: '20000', status: '正常' },
  ];
  const customerRecs = [];
  for (const c of customers) {
    [, data] = await call('POST', `/api/tables/${T.customer.id}/records`, {}, token);
    const rid = data.id;
    await call('PUT', `/api/records/${rid}/cells/${F.customer['客户名称'].id}`, { value: c.name }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.customer['联系电话'].id}`, { value: c.phone }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.customer['账户余额'].id}`, { value: c.balance }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.customer['状态'].id}`, { value: c.status }, token);
    customerRecs.push({ id: rid, ...c });
  }
  console.log('Customers:', customerRecs.length);

  // === 8. 创建销售订单（多种状态） ===
  const orderDefs = [
    { c: 0, p: 0, qty: '3', price: '15000', status: '待发货' },
    { c: 0, p: 1, qty: '10', price: '3200', status: '已发货' },
    { c: 1, p: 3, qty: '1', price: '45000', status: '已完成' },
    { c: 1, p: 0, qty: '2', price: '15000', status: '待发货' },
    { c: 0, p: 2, qty: '20', price: '880', status: '已发货' },
    { c: 3, p: 4, qty: '100', price: '45', status: '待发货' },
    { c: 4, p: 5, qty: '5', price: '680', status: '已发货' },
    { c: 1, p: 1, qty: '5', price: '3200', status: '已完成' },
    { c: 2, p: 0, qty: '1', price: '15000', status: '已取消' },
    { c: 2, p: 2, qty: '3', price: '880', status: '已取消' },
    { c: 3, p: 3, qty: '2', price: '45000', status: '待发货' },
    { c: 4, p: 0, qty: '1', price: '15000', status: '已完成' },
  ];
  const orderRecs = [];
  for (const o of orderDefs) {
    [, data] = await call('POST', `/api/tables/${T.sales.id}/records`, {}, token);
    const rid = data.id;
    // Create links via proper API
    if (F.sales['客户']) {
      await call('POST', '/api/links', { fieldId: F.sales['客户'].id, fromRecordId: rid, toRecordId: customerRecs[o.c].id }, token);
    }
    if (F.sales['产品']) {
      await call('POST', '/api/links', { fieldId: F.sales['产品'].id, fromRecordId: rid, toRecordId: productRecs[o.p].id }, token);
    }
    await call('PUT', `/api/records/${rid}/cells/${F.sales['数量'].id}`, { value: o.qty }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.sales['单价'].id}`, { value: o.price }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.sales['订单状态'].id}`, { value: o.status }, token);
    orderRecs.push({ id: rid, ...o });
  }
  console.log('Sales orders:', orderRecs.length);

  // === 9. 创建采购订单 ===
  const purchaseDefs = [
    { s: 0, p: 0, qty: '50', price: '7500', status: '待收货' },
    { s: 1, p: 1, qty: '100', price: '1600', status: '已入库' },
    { s: 2, p: 3, qty: '10', price: '24000', status: '待收货' },
    { s: 0, p: 4, qty: '500', price: '25', status: '已入库' },
    { s: 3, p: 5, qty: '30', price: '350', status: '待收货' },
  ];
  const purchaseRecs = [];
  for (const o of purchaseDefs) {
    [, data] = await call('POST', `/api/tables/${T.purchase.id}/records`, {}, token);
    const rid = data.id;
    if (F.purchase['供应商']) {
      await call('PUT', `/api/records/${rid}/cells/${F.purchase['供应商'].id}`, { value: supplierNames[o.s] }, token);
    }
    if (F.purchase['产品']) {
      await call('POST', '/api/links', { fieldId: F.purchase['产品'].id, fromRecordId: rid, toRecordId: productRecs[o.p].id }, token);
    }
    await call('PUT', `/api/records/${rid}/cells/${F.purchase['数量'].id}`, { value: o.qty }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.purchase['采购单价'].id}`, { value: o.price }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.purchase['入库状态'].id}`, { value: o.status }, token);
    purchaseRecs.push({ id: rid, ...o });
  }
  console.log('Purchase orders:', purchaseRecs.length);

  // === 10. 库存记录 ===
  for (let i = 0; i < productRecs.length; i++) {
    const p = productRecs[i];
    [, data] = await call('POST', `/api/tables/${T.inventory.id}/records`, {}, token);
    const rid = data.id;
    if (F.inventory['产品']) {
      await call('POST', '/api/links', { fieldId: F.inventory['产品'].id, fromRecordId: rid, toRecordId: p.id }, token);
    }
    const stock = i === 2 ? '2' : String(50 + i * 15); // 光纤切割刀设为低库存
    const inTotal = String(100 + i * 30);
    const outTotal = String(parseInt(inTotal) - parseInt(stock));
    await call('PUT', `/api/records/${rid}/cells/${F.inventory['当前库存'].id}`, { value: stock }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.inventory['入库总量'].id}`, { value: inTotal }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.inventory['出库总量'].id}`, { value: String(outTotal) }, token);
  }
  console.log('Inventory: 6 records');

  // === 11. 结算记录 ===
  for (let i = 0; i < 8; i++) {
    const o = orderDefs[i];
    const total = Number(o.qty) * Number(o.price);
    [, data] = await call('POST', `/api/tables/${T.settlement.id}/records`, {}, token);
    const rid = data.id;
    if (F.settlement['销售订单']) {
      await call('POST', '/api/links', { fieldId: F.settlement['销售订单'].id, fromRecordId: rid, toRecordId: orderRecs[i].id }, token);
    }
    const received = i < 3 ? String(Math.floor(total * 0.5)) : (i === 2 ? String(total) : '0');
    const status = i === 2 ? '已结算' : '待结算';
    await call('PUT', `/api/records/${rid}/cells/${F.settlement['应收金额'].id}`, { value: String(total) }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.settlement['实收金额'].id}`, { value: received }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.settlement['结算状态'].id}`, { value: status }, token);
  }
  console.log('Settlements: 8 records');

  // === 12. 退款记录 ===
  for (let i = 0; i < 3; i++) {
    [, data] = await call('POST', `/api/tables/${T.refund.id}/records`, {}, token);
    const rid = data.id;
    if (F.refund['销售订单']) {
      await call('POST', '/api/links', { fieldId: F.refund['销售订单'].id, fromRecordId: rid, toRecordId: orderRecs[i].id }, token);
    }
    const amounts = ['5000', '3200', '15000'];
    const reasons = ['产品质量问题', '规格不符', '客户取消订单'];
    await call('PUT', `/api/records/${rid}/cells/${F.refund['退款金额'].id}`, { value: amounts[i] }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.refund['原因'].id}`, { value: reasons[i] }, token);
  }
  console.log('Refunds: 3 records');

  // === 13. 资金流水 ===
  const fundTypes = ['收入', '支出', '收入', '支出', '收入'];
  const fundAmounts = ['45000', '25000', '16000', '12000', '32000'];
  for (let i = 0; i < 5; i++) {
    [, data] = await call('POST', `/api/tables/${T.fund.id}/records`, {}, token);
    const rid = data.id;
    await call('PUT', `/api/records/${rid}/cells/${F.fund['交易类型'].id}`, { value: fundTypes[i] }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.fund['交易金额'].id}`, { value: fundAmounts[i] }, token);
  }
  console.log('Fund flow: 5 records');

  // === 14. 预存设备 ===
  // === 14. 预存设备 ===
  const devices = [
    { code: 'OTDR-100A-001', total: '100', used: '30', remain: '70' },
    { code: 'OPM-200B-002', total: '50', used: '10', remain: '40' },
    { code: 'OTDR-500D-003', total: '20', used: '5', remain: '15' },
  ];
  for (let i = 0; i < devices.length; i++) {
    const d = devices[i];
    [, data] = await call('POST', `/api/tables/${T.preDevice.id}/records`, {}, token);
    const rid = data.id;
    if (F.preDevice['客户账户']) {
      await call('POST', '/api/links', { fieldId: F.preDevice['客户账户'].id, fromRecordId: rid, toRecordId: customerRecs[i].id }, token);
    }
    await call('PUT', `/api/records/${rid}/cells/${F.preDevice['设备编号'].id}`, { value: d.code }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.preDevice['预存总量'].id}`, { value: d.total }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.preDevice['已使用量'].id}`, { value: d.used }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.preDevice['剩余量'].id}`, { value: d.remain }, token);
  }
  console.log('Pre-stored devices: 3 records');

  // === 15. 设备使用记录 ===
  const usages = [
    { pIdx: 0, qty: '1', amount: '15000' },
    { pIdx: 1, qty: '2', amount: '6400' },
    { pIdx: 3, qty: '1', amount: '45000' },
  ];
  for (const u of usages) {
    [, data] = await call('POST', `/api/tables/${T.deviceUse.id}/records`, {}, token);
    const rid = data.id;
    if (F.deviceUse['设备']) {
      await call('POST', '/api/links', { fieldId: F.deviceUse['设备'].id, fromRecordId: rid, toRecordId: productRecs[u.pIdx].id }, token);
    }
    await call('PUT', `/api/records/${rid}/cells/${F.deviceUse['使用量'].id}`, { value: u.qty }, token);
    await call('PUT', `/api/records/${rid}/cells/${F.deviceUse['使用金额'].id}`, { value: u.amount }, token);
  }
  console.log('Device usage: 3 records');

  // === Summary ===
  console.log('\n=== Seed Complete ===');
  console.log('Account:', email, '/', password);
  console.log('Base ID:', baseId);
  console.log('URL: http://localhost:3001');
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
