import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRedisOtpStore,
  createRedisOtpStoreFromEnv,
  redisClientOptionsFromEnv,
} from './storage/redis-otp-store.mjs';

class FakeRedis {
  calls = [];
  replies = [1, [2, 4, 500], [0, 6, 50], [1, 0, 1, 60, 1, 60]];
  isOpen = false;

  async connect() {
    this.calls.push({ method: 'connect' });
    this.isOpen = true;
  }

  async eval(script, options) {
    this.calls.push({ method: 'eval', script, options });
    return this.replies.shift();
  }

  async ping() {
    this.calls.push({ method: 'ping' });
    return 'PONG';
  }

  async quit() {
    this.calls.push({ method: 'quit' });
    this.isOpen = false;
  }
}

test('OTP operations are atomic, hashed, and isolated to xiaobai keys', async () => {
  const client = new FakeRedis();
  const store = createRedisOtpStore({ client, hashKey: Buffer.alloc(32, 5) });
  await store.connect();
  const issued = await store.issue({
    challengeId: 'challenge-1',
    subject: '+8613800138000',
    code: '123456',
    purpose: 'login',
  });
  assert.equal(issued.issued, true);
  const consumed = await store.consume({
    challengeId: 'challenge-1',
    subject: '+8613800138000',
    code: '000000',
    purpose: 'login',
  });
  assert.deepEqual(consumed, {
    status: 'invalid',
    consumed: false,
    attemptsLeft: 4,
    ttlSeconds: 500,
  });
  const limited = await store.rateLimit({
    scope: 'sms-send-phone',
    subject: '+8613800138000',
    limit: 5,
    windowSeconds: 60,
  });
  assert.equal(limited.allowed, false);
  assert.equal(limited.remaining, 0);
  const reserved = await store.rateLimitMany([
    { scope: 'custom-owner', subject: 'owner-1', limit: 5, windowSeconds: 60 },
    { scope: 'custom-global', subject: 'global', limit: 50, windowSeconds: 60 },
  ]);
  assert.equal(reserved.allowed, true);
  assert.deepEqual(reserved.reservations.map((item) => item.remaining), [4, 49]);
  await assert.rejects(
    store.rateLimitMany([
      { scope: 'duplicate', subject: 'same', limit: 2, windowSeconds: 60 },
      { scope: 'duplicate', subject: 'same', limit: 2, windowSeconds: 60 },
    ]),
    /duplicate-rate-limit-reservation/,
  );

  const evalCalls = client.calls.filter((call) => call.method === 'eval');
  for (const call of evalCalls) {
    assert.ok(call.options.keys.every((key) => key.startsWith('xiaobai:')));
    assert.ok(call.options.keys.every((key) => !key.includes('TradingVane')));
    assert.equal(call.options.keys.some((key) => key.includes('+8613800138000')), false);
    assert.equal(call.options.arguments.includes('123456'), false);
  }
  await store.close();
});

test('Redis production configuration explicitly selects RESP2 and fails closed', () => {
  const options = redisClientOptionsFromEnv({
    NODE_ENV: 'production',
    REDIS_URL: 'rediss://redis.internal:6380',
  });
  assert.equal(options.RESP, 2);
  assert.equal(options.disableClientInfo, true);
  assert.equal(options.maintNotifications, 'disabled');
  assert.throws(() => redisClientOptionsFromEnv({}), /REDIS_URL/);
  assert.throws(
    () => redisClientOptionsFromEnv({
      NODE_ENV: 'production',
      REDIS_URL: 'redis://redis.internal:6379',
    }),
    /insecure-config/,
  );
  assert.equal(redisClientOptionsFromEnv({
    NODE_ENV: 'production',
    REDIS_URL: 'redis://10.0.0.8:6379',
    REDIS_ALLOW_PLAINTEXT: 'true',
  }).RESP, 2);
  assert.throws(() => redisClientOptionsFromEnv({
    NODE_ENV: 'production',
    REDIS_URL: 'redis://redis.public.invalid:6379',
    REDIS_ALLOW_PLAINTEXT: 'true',
  }), /insecure-config/);
  assert.throws(() => createRedisOtpStoreFromEnv({
    REDIS_URL: 'redis://localhost:6379',
    NODE_ENV: 'test',
  }), /OTP_HMAC_KEY/);
});
