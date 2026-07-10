// tests/unit/logger.test.js — logger.js 单元测试
const assert = require('assert');
const logger = require('../../logger');

describe('logger', () => {
  it('has required methods', () => {
    assert.strictEqual(typeof logger.debug, 'function');
    assert.strictEqual(typeof logger.info, 'function');
    assert.strictEqual(typeof logger.warn, 'function');
    assert.strictEqual(typeof logger.error, 'function');
    assert.strictEqual(typeof logger.getTraceId, 'function');
    assert.strictEqual(typeof logger.generateTraceId, 'function');
    assert.strictEqual(typeof logger.runWithTraceId, 'function');
  });

  it('generateTraceId returns a string', () => {
    const id = logger.generateTraceId();
    assert.strictEqual(typeof id, 'string');
    assert.ok(id.length > 10);
  });

  it('generateTraceId returns unique values', () => {
    const id1 = logger.generateTraceId();
    const id2 = logger.generateTraceId();
    assert.notStrictEqual(id1, id2);
  });

  it('runWithTraceId sets traceId in context', async () => {
    const testId = 'test-trace-123';
    await logger.runWithTraceId(async () => {
      const id = logger.getTraceId();
      assert.strictEqual(id, testId);
    }, testId);
  });

  it('getTraceId returns generated id outside context', () => {
    const id = logger.getTraceId();
    assert.strictEqual(typeof id, 'string');
    assert.ok(id.length > 10);
  });

  it('log methods do not throw', () => {
    assert.doesNotThrow(() => logger.debug('debug message', { foo: 'bar' }));
    assert.doesNotThrow(() => logger.info('info message', { foo: 'bar' }));
    assert.doesNotThrow(() => logger.warn('warn message', { foo: 'bar' }));
    assert.doesNotThrow(() => logger.error('error message', { foo: 'bar' }));
  });
});
