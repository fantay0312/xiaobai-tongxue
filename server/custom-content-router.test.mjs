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

test('custom owner and global quotas use one atomic reservation', async () => {
  const responses = [];
  let reservations = null;
  const router = createCustomContentRouter({
    service: {
      maxFileBytes: 80 * 1024 * 1024,
      async createCourse() { return { id: 'course-id', title: '原子配额' }; },
    },
    async resolveOwner() { return { id: 'owner-id', name: 'Owner' }; },
    send(_res, status, body) { responses.push({ status, body }); },
    async readJson() { return { title: '原子配额' }; },
    async readRaw() { return Buffer.alloc(0); },
    async rateLimit() { throw new Error('sequential-rate-limit-must-not-run'); },
    async rateLimitMany(inputs) {
      reservations = inputs;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  });
  await router.handle({ method: 'POST', headers: {}, resume() {} }, { headersSent: false }, '/api/xb/courses');
  assert.equal(reservations.length, 2);
  assert.deepEqual(reservations.map((item) => item.subject), ['owner-id', 'global']);
  assert.deepEqual(responses, [{
    status: 201,
    body: { course: { id: 'course-id', title: '原子配额' } },
  }]);
});

test('semantic evaluation has atomic burst limits and an owner inflight gate', async () => {
  const responses = [];
  const reservations = [];
  let releaseEvaluations;
  const evaluationsPending = new Promise((resolve) => { releaseEvaluations = resolve; });
  const router = createCustomContentRouter({
    service: {
      maxFileBytes: 80 * 1024 * 1024,
      async evaluateTopic() {
        await evaluationsPending;
        return { reasoning: 'ok' };
      },
    },
    async resolveOwner() { return { id: 'owner-id', name: 'Owner' }; },
    send(_res, status, body, headers) { responses.push({ status, body, headers }); },
    async readJson() { return { utterance: '讲解' }; },
    async readRaw() { return Buffer.alloc(0); },
    async rateLimitMany(inputs) {
      reservations.push(inputs);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    clientIp: () => '198.51.100.7',
  });
  const request = () => router.handle(
    { method: 'POST', headers: {}, resume() {} },
    { headersSent: false },
    '/api/xb/topics/topic-id/evaluate',
  );

  const first = request();
  const second = request();
  await new Promise((resolve) => setImmediate(resolve));
  await request();

  assert.equal(reservations.length, 3);
  assert.deepEqual(reservations[0].map(({ subject, limit, windowSeconds }) => (
    { subject, limit, windowSeconds }
  )), [
    { subject: 'owner-id', limit: 12, windowSeconds: 60 },
    { subject: '198.51.100.7', limit: 30, windowSeconds: 60 },
    { subject: 'global', limit: 120, windowSeconds: 60 },
    { subject: 'owner-id', limit: 2_000, windowSeconds: 86_400 },
    { subject: 'global', limit: 20_000, windowSeconds: 86_400 },
  ]);
  assert.deepEqual(responses, [{
    status: 429,
    body: { error: 'evaluator-busy', retryAfter: 1 },
    headers: { 'Retry-After': '1' },
  }]);

  releaseEvaluations();
  await Promise.all([first, second]);
  assert.equal(responses.filter(({ status }) => status === 200).length, 2);
});
