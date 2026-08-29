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

test('custom multipart parsing returns a zero-copy file view', async () => {
  const boundary = '----xiaobai-test-boundary';
  const fileBytes = Buffer.from('%PDF-1.7\nlesson\n%%EOF');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fallback.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    fileBytes,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="fileName"\r\n\r\n课程/lesson.pdf`),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="asset_role"\r\n\r\nlecture`),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const responses = [];
  let upload = null;
  const router = createCustomContentRouter({
    service: {
      maxFileBytes: 80 * 1024 * 1024,
      async uploadAsset(_owner, courseId, input) {
        upload = { courseId, ...input };
        return { id: 'asset-id' };
      },
    },
    async resolveOwner() { return { id: 'owner-id', name: 'Owner' }; },
    send(_res, status, responseBody) { responses.push({ status, body: responseBody }); },
    async readJson() { return {}; },
    async readRaw() { return body; },
  });
  await router.handle({
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    resume() {},
  }, { headersSent: false }, '/api/xb/courses/course-id/assets');
  assert.equal(upload.courseId, 'course-id');
  assert.equal(upload.filename, '课程/lesson.pdf');
  assert.equal(upload.assetRole, 'lecture');
  assert.deepEqual(upload.bytes, fileBytes);
  assert.equal(upload.bytes.buffer, body.buffer, 'file bytes must remain a view over the single multipart buffer');
  assert.deepEqual(responses, [{ status: 202, body: { asset: { id: 'asset-id' } } }]);
});

test('custom JSON endpoints reject parsed primitives with a bounded 400', async () => {
  const responses = [];
  let compiled = false;
  const router = createCustomContentRouter({
    service: {
      maxFileBytes: 80 * 1024 * 1024,
      async startCompile() { compiled = true; },
    },
    async resolveOwner() { return { id: 'owner-id', name: 'Owner' }; },
    send(_res, status, body) { responses.push({ status, body }); },
    async readJson() { return false; },
    async readRaw() { return Buffer.alloc(0); },
  });
  await router.handle({ method: 'POST', headers: {}, resume() {} }, { headersSent: false }, '/api/xb/topics/compile');
  assert.equal(compiled, false);
  assert.deepEqual(responses, [{ status: 400, body: { error: 'json-object-required' } }]);
});
