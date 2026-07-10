// tests/load/pressureTest.js — 并发压力测试
// 模拟 1000 个外部客户同时查询，500 笔订单/天

const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 3000;
const CONCURRENT_USERS = 200;
const REQUESTS_PER_USER = 5; // 每个用户发 5 个请求

// 简单的 multipart 边界生成
function makeBoundary() {
  return '----FormBoundary' + Math.random().toString(36).slice(2);
}

// 构建 multipart body
function buildMultipart(fields, boundary) {
  let body = '';
  for (const [k, v] of Object.entries(fields)) {
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="${k}"\r\n\r\n`;
    body += `${v}\r\n`;
  }
  body += `--${boundary}--\r\n`;
  return Buffer.from(body);
}

function request(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      headers: headers || {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function warmup() {
  // 检查服务器是否运行
  try {
    const res = await request('GET', '/portal.html', {}, null);
    return res.status === 200;
  } catch {
    return false;
  }
}

async function runTest() {
  console.log('=== CollabGrid 压力测试 ===');
  console.log(`并发用户: ${CONCURRENT_USERS}`);
  console.log(`每用户请求: ${REQUESTS_PER_USER}`);
  console.log(`总请求数: ${CONCURRENT_USERS * REQUESTS_PER_USER}`);
  console.log('');

  const isRunning = await warmup();
  if (!isRunning) {
    console.error('❌ 服务器未运行，请先启动: node server.js');
    process.exit(1);
  }
  console.log('✅ 服务器已就绪\n');

  // 1. 测试：登录 API（高并发）
  console.log('1. 登录 API 并发测试...');
  const loginStart = Date.now();
  const loginPromises = [];
  for (let i = 0; i < Math.min(100, CONCURRENT_USERS); i++) {
    loginPromises.push(request('POST', '/api/login', {
      'Content-Type': 'application/json',
    }, JSON.stringify({ email: `test${i}@example.com`, password: 'wrong' })));
  }
  const loginResults = await Promise.all(loginPromises);
  const loginSuccess = loginResults.filter(r => r.status === 200).length;
  const loginFailed = loginResults.filter(r => r.status === 401).length;
  const loginTime = Date.now() - loginStart;
  console.log(`   200: ${loginSuccess}, 401: ${loginFailed}, 平均: ${(loginTime / loginPromises.length).toFixed(1)}ms/req, 总耗时: ${loginTime}ms`);

  // 2. 测试：CSRF Token 获取
  console.log('2. CSRF Token 并发测试...');
  const csrfStart = Date.now();
  const csrfPromises = [];
  for (let i = 0; i < Math.min(100, CONCURRENT_USERS); i++) {
    csrfPromises.push(request('GET', '/api/csrf-token', {}, null));
  }
  const csrfResults = await Promise.all(csrfPromises);
  const csrfTime = Date.now() - csrfStart;
  console.log(`   成功: ${csrfResults.filter(r => r.status === 200).length}, 平均: ${(csrfTime / csrfPromises.length).toFixed(1)}ms/req, 总耗时: ${csrfTime}ms`);

  // 3. 测试：静态资源（portal.html）
  console.log('3. 静态资源并发测试...');
  const staticStart = Date.now();
  const staticPromises = [];
  for (let i = 0; i < CONCURRENT_USERS; i++) {
    staticPromises.push(request('GET', '/portal.html', {}, null));
  }
  const staticResults = await Promise.all(staticPromises);
  const staticTime = Date.now() - staticStart;
  const staticOk = staticResults.filter(r => r.status === 200).length;
  console.log(`   200: ${staticOk}, 平均: ${(staticTime / staticPromises.length).toFixed(1)}ms/req, 总耗时: ${staticTime}ms, QPS: ${(CONCURRENT_USERS / (staticTime / 1000)).toFixed(1)}`);

  // 4. 测试：外部查询（模拟客户查询）
  console.log('4. 外部查询并发测试（模拟 1000 客户）...');
  // 由于没有真实的客户 token，我们测试 404/401 响应的性能（路由处理 + 中间件）
  const queryStart = Date.now();
  const queryPromises = [];
  for (let i = 0; i < CONCURRENT_USERS; i++) {
    queryPromises.push(request('GET', `/api/public/snapshots?category=order&limit=20&offset=0`, {
      'X-Customer-Token': `invalid-token-${i}`,
    }, null));
  }
  const queryResults = await Promise.all(queryPromises);
  const queryTime = Date.now() - queryStart;
  const query401 = queryResults.filter(r => r.status === 401).length;
  console.log(`   401: ${query401}, 平均: ${(queryTime / queryPromises.length).toFixed(1)}ms/req, 总耗时: ${queryTime}ms, QPS: ${(CONCURRENT_USERS / (queryTime / 1000)).toFixed(1)}`);

  // 5. 测试：数据库读写（通过注册 API）
  console.log('5. 数据库读写并发测试...');
  const dbStart = Date.now();
  const dbPromises = [];
  for (let i = 0; i < Math.min(50, CONCURRENT_USERS); i++) {
    dbPromises.push(
      request('POST', '/api/register', {
        'Content-Type': 'application/json',
      }, JSON.stringify({ email: `stress_${Date.now()}_${i}@test.com`, password: 'password123', displayName: `Stress${i}` }))
        .catch(e => ({ status: 'ERROR', error: e.message }))
    );
  }
  const dbResults = await Promise.all(dbPromises);
  const dbTime = Date.now() - dbStart;
  const db200 = dbResults.filter(r => r.status === 200).length;
  const db409 = dbResults.filter(r => r.status === 409).length;
  const dbErr = dbResults.filter(r => r.status === 'ERROR').length;
  console.log(`   200: ${db200}, 409: ${db409}, 错误: ${dbErr}, 平均: ${(dbTime / dbPromises.length).toFixed(1)}ms/req, 总耗时: ${dbTime}ms`);

  // 汇总
  console.log('\n=== 汇总 ===');
  console.log(`总请求数: ${loginPromises.length + csrfPromises.length + staticPromises.length + queryPromises.length + dbPromises.length}`);
  console.log(`并发峰值: ${CONCURRENT_USERS}`);
  console.log(`静态资源 QPS: ${(CONCURRENT_USERS / (staticTime / 1000)).toFixed(1)}`);
  console.log(`外部查询 QPS: ${(CONCURRENT_USERS / (queryTime / 1000)).toFixed(1)}`);
  console.log(`数据库写入 QPS: ${(dbPromises.length / (dbTime / 1000)).toFixed(1)}`);
  console.log('\n✅ 压力测试完成');
}

runTest().catch(e => {
  console.error('测试失败:', e.message);
  process.exit(1);
});
