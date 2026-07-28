import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVE_INBOUND_QUOTA_SCRIPT,
  createRedisInboundQuota,
} from './storage/redis-inbound-quota.mjs';

const AT = Date.parse('2026-07-28T00:00:00.000Z');

test('inbound quota atomically reserves user and global daily count and bytes', async () => {
  let request;
  const quota = createRedisInboundQuota({
    client: {
      async eval(script, options) {
        request = { script, options };
        return [1, 1, 1024, 8, 4096];
      },
    },
    hashKey: Buffer.alloc(32, 9),
    now: () => AT,
  });
  assert.deepEqual(await quota.reserve({
    userId: '11111111-1111-4111-8111-111111111111',
    providerMessageId: 'provider-message-1',
    bytes: 1024,
  }), {
    allowed: true,
    duplicateReservation: false,
    userCount: 1,
    userBytes: 1024,
    globalCount: 8,
    globalBytes: 4096,
    day: '2026-07-28',
  });
  assert.equal(request.script, RESERVE_INBOUND_QUOTA_SCRIPT);
  assert.equal(request.options.keys.length, 3);
  assert.ok(request.options.keys.every((key) => key.startsWith('xiaobai:inbound:')));
  assert.ok(request.options.keys.every((key) => !key.includes('11111111')));
  assert.ok(request.options.keys.every((key) => !key.includes('provider-message-1')));
  assert.deepEqual(request.options.arguments, [
    '1024',
    '50',
    String(100 * 1024 * 1024),
    '200',
    String(500 * 1024 * 1024),
    '57600',
    '172800',
  ]);
});

test('inbound quota distinguishes rejection from an idempotent retry reservation', async () => {
  const responses = [
    [0, 50, 100, 200, 500],
    [2, 0, 0, 0, 0],
  ];
  const quota = createRedisInboundQuota({
    client: { eval: async () => responses.shift() },
    hashKey: Buffer.alloc(32, 4),
    now: () => AT,
  });
  const input = {
    userId: '11111111-1111-4111-8111-111111111111',
    providerMessageId: 'provider-message-2',
    bytes: 7,
  };
  assert.equal((await quota.reserve(input)).allowed, false);
  assert.deepEqual(await quota.reserve(input), {
    allowed: true,
    duplicateReservation: true,
    userCount: 0,
    userBytes: 0,
    globalCount: 0,
    globalBytes: 0,
    day: '2026-07-28',
  });
});

test('inbound quota rejects invalid sizes and malformed Redis responses', async () => {
  const quota = createRedisInboundQuota({
    client: { eval: async () => [9] },
    hashKey: Buffer.alloc(32, 2),
    now: () => AT,
  });
  await assert.rejects(quota.reserve({
    userId: 'user',
    providerMessageId: 'message',
    bytes: -1,
  }), /invalid-inbound-bytes/);
  await assert.rejects(quota.reserve({
    userId: 'user',
    providerMessageId: 'message',
    bytes: 1,
  }), /redis-bad-response/);
});
