// tests/unit/auth.test.js — auth.js 单元测试
const assert = require('assert');
const { sign, verify, COOKIE_NAME } = require('../../auth');

describe('auth', () => {
  const user = { id: 'u1', email: 'test@example.com' };

  it('sign generates a JWT string', () => {
    const token = sign(user);
    assert.strictEqual(typeof token, 'string');
    assert.ok(token.length > 20);
  });

  it('verify returns payload for valid token', () => {
    const token = sign(user);
    const payload = verify(token);
    assert.ok(payload);
    assert.strictEqual(payload.uid, user.id);
    assert.strictEqual(payload.email, user.email);
  });

  it('verify returns null for invalid token', () => {
    const payload = verify('invalid.token.here');
    assert.strictEqual(payload, null);
  });

  it('verify returns null for empty string', () => {
    assert.strictEqual(verify(''), null);
    assert.strictEqual(verify(null), null);
  });

  it('token expires after 7 days', () => {
    const token = sign(user);
    const payload = verify(token);
    const nowSec = Math.floor(Date.now() / 1000);
    // exp 应该在 7 天左右（允许 60 秒误差）
    assert.ok(payload.exp > nowSec + 6 * 86400);
    assert.ok(payload.exp < nowSec + 8 * 86400);
  });

  it('COOKIE_NAME is cg_token', () => {
    assert.strictEqual(COOKIE_NAME, 'cg_token');
  });
});
