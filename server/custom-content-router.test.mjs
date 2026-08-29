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
