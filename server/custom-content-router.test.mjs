import assert from 'node:assert/strict';
import test from 'node:test';
import { createCustomContentRouter } from './custom-content/router.mjs';

test('custom content owner resolution failures return a bounded 503 response', async () => {
  const responses = [];
  const logs = [];
  let resumed = 0;
  const router = createCustomContentRouter({
    service: { maxFileBytes: 80 * 1024 * 1024, async status() { return { healthy: true }; } },
    async resolveOwner() { throw new Error('invalid-access-scope'); },
    send(_res, status, body) { responses.push({ status, body }); },
    async readJson() { return {}; },
    async readRaw() { return Buffer.alloc(0); },
    logger: { error(...values) { logs.push(values); } },
  });
  const req = {
    method: 'GET',
    headers: {},
    resume() { resumed += 1; },
  };
  const res = { headersSent: false };
  await router.handle(req, res, '/api/xb/status');
  assert.equal(resumed, 1);
  assert.deepEqual(responses, [{ status: 503, body: { error: 'custom-content-auth-unavailable' } }]);
  assert.equal(logs.length, 1);
});

test('custom uploads use an idle timeout and size-scaled total deadline', async () => {
  const responses = [];
  let timeoutConfig = null;
  const router = createCustomContentRouter({
    service: { maxFileBytes: 80 * 1024 * 1024 },
    async resolveOwner() { return { id: 'owner-id', name: 'Owner' }; },
    send(_res, status, body) { responses.push({ status, body }); },
    async readJson() { return {}; },
    async readRaw(_req, _limit, timeout) {
      timeoutConfig = timeout;
      throw new Error('body-timeout');
    },
  });
  const req = {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=test' },
    resume() {},
  };
  await router.handle(req, { headersSent: false }, '/api/xb/courses/course-id/assets');
  assert.equal(timeoutConfig.idleTimeoutMs, 120_000);
  assert.ok(timeoutConfig.totalTimeoutMs >= 20 * 60_000);
  assert.deepEqual(responses, [{ status: 408, body: { error: 'body-timeout' } }]);
});
