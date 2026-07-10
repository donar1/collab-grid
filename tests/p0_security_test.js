const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.CG_BASE_URL || 'http://localhost:3000';
const ENV_PATH = path.join(process.cwd(), '.env');
const ENV_BAK = ENV_PATH + '.bak';

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
  return [res.status, data, res.headers];
}

async function run() {
  // 临时移走 .env 以避免 dotenvx 自动加载 JWT_SECRET
  fs.renameSync(ENV_PATH, ENV_BAK);
  try {
    const authProbe = spawnSync(process.execPath, ['-e', "process.env.NODE_ENV='production'; require('./auth')"], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10000,
      env: { NODE_ENV: 'production', ALLOWED_ORIGINS: 'http://localhost:3000', PATH: process.env.PATH },
    });
    assert.notStrictEqual(authProbe.status, 0, '生产环境缺少 JWT_SECRET 时必须启动失败');
    assert.match(authProbe.stderr + authProbe.stdout, /JWT_SECRET/);

    const corsProbe = spawnSync(process.execPath, ['-e', "process.env.NODE_ENV='production'; process.env.JWT_SECRET='test-secret-32-characters-long-enough'; require('./server')"], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10000,
      env: { NODE_ENV: 'production', JWT_SECRET: 'test-secret-32-characters-long-enough', PATH: process.env.PATH },
    });
    assert.notStrictEqual(corsProbe.status, 0, '生产环境缺少 ALLOWED_ORIGINS 时必须启动失败');
    assert.match(corsProbe.stderr + corsProbe.stdout, /ALLOWED_ORIGINS/);
  } finally {
    fs.renameSync(ENV_BAK, ENV_PATH);
  }

  const email = `p0sec_${Date.now()}@test.local`;
  let sc, data, headers;
  [sc, data, headers] = await call('POST', '/api/register', { email, password: 'Pass123456!@', displayName: 'Security Tester' });
  assert.strictEqual(sc, 200, JSON.stringify(data));
  assert.strictEqual(headers.get('x-content-type-options'), 'nosniff');
  const token = data.token;

  [sc] = await call('GET', `/api/me?token=${encodeURIComponent(token)}`);
  assert.strictEqual(sc, 401, '不再允许通过 query token 鉴权');

  let got429 = false;
  for (let i = 0; i < 12; i += 1) {
    [sc] = await call('POST', '/api/login', { email, password: `wrong-${i}` });
    if (sc === 429) got429 = true;
  }
  assert.strictEqual(got429, true, '登录接口应触发限流保护');

  console.log('P0 security tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
