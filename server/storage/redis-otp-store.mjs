import crypto from 'node:crypto';
import { createClient } from 'redis';
import { positiveInteger, requireBase64Key, requireUrl } from './config.mjs';
import { createRedisInboundQuota } from './redis-inbound-quota.mjs';

export const ISSUE_OTP_SCRIPT = `
redis.call('HSET', KEYS[1],
  'code_hash', ARGV[1],
  'subject_hash', ARGV[2],
  'purpose', ARGV[3],
  'attempts_left', ARGV[4])
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
`;

export const CONSUME_OTP_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return {0, 0, -2}
end
local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts_left')) or 0
local ttl = redis.call('TTL', KEYS[1])
if redis.call('HGET', KEYS[1], 'subject_hash') ~= ARGV[1]
  or redis.call('HGET', KEYS[1], 'purpose') ~= ARGV[2] then
  return {2, attempts, ttl}
end
if redis.call('HGET', KEYS[1], 'code_hash') == ARGV[3] then
  redis.call('DEL', KEYS[1])
  return {1, attempts, ttl}
end
attempts = redis.call('HINCRBY', KEYS[1], 'attempts_left', -1)
if attempts <= 0 then
  redis.call('DEL', KEYS[1])
  return {3, 0, -2}
end
return {2, attempts, ttl}
`;

export const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if count <= tonumber(ARGV[2]) then
  return {1, count, ttl}
end
return {0, count, ttl}
`;

const SAFE_TOKEN = /^[a-z0-9][a-z0-9:_-]{0,79}$/i;
const STATUS = ['expired', 'consumed', 'invalid', 'attempts-exhausted'];

function requireToken(value, label) {
  if (typeof value !== 'string' || !SAFE_TOKEN.test(value)) throw new Error(`invalid-${label}`);
  return value;
}

function hmac(key, domain, value) {
  return crypto.createHmac('sha256', key).update(`${domain}\0${value}`, 'utf8').digest('hex');
}

function challengeKey(challengeId) {
  return `xiaobai:otp:challenge:${requireToken(challengeId, 'challenge-id')}`;
}

function rateKey(hashKey, scope, subject) {
  const safeScope = requireToken(scope, 'rate-limit-scope');
  return `xiaobai:otp:rate:${safeScope}:${hmac(hashKey, `rate:${safeScope}`, subject)}`;
}

export function createRedisOtpStore({ client, hashKey } = {}) {
  if (!client?.eval || !client?.ping) throw new Error('redis-client-required');
  if (!Buffer.isBuffer(hashKey) || hashKey.length !== 32) throw new Error('otp-hash-key-required');
  const inboundQuota = createRedisInboundQuota({ client, hashKey });

  async function healthCheck() {
    const startedAt = Date.now();
    if (await client.ping() !== 'PONG') throw new Error('redis-health-check-failed');
    return { healthy: true, latencyMs: Date.now() - startedAt, protocol: 2 };
  }

  function challengeHashes({ challengeId, subject, code, purpose }) {
    const safeChallenge = requireToken(challengeId, 'challenge-id');
    const safePurpose = requireToken(purpose, 'otp-purpose');
    if (typeof subject !== 'string' || subject.trim() === '') throw new Error('invalid-otp-subject');
    if (typeof code !== 'string' || !/^\d{4,8}$/.test(code)) throw new Error('invalid-otp-code');
    const subjectHash = hmac(hashKey, 'otp-subject', subject.trim());
    const codeHash = hmac(
      hashKey,
      'otp-code',
      `${safeChallenge}\0${safePurpose}\0${subjectHash}\0${code}`,
    );
    return { subjectHash, codeHash, safePurpose };
  }

  return Object.freeze({
    async connect() {
      if (client.isOpen === false && client.connect) await client.connect();
      return healthCheck();
    },

    async issue({
      challengeId,
      subject,
      code,
      purpose,
      ttlSeconds = 600,
      maxAttempts = 5,
    }) {
      const ttl = positiveInteger(ttlSeconds, 600, 'otp-ttl-seconds', 3_600);
      const attempts = positiveInteger(maxAttempts, 5, 'otp-max-attempts', 20);
      const hashes = challengeHashes({ challengeId, subject, code, purpose });
      const result = await client.eval(ISSUE_OTP_SCRIPT, {
        keys: [challengeKey(challengeId)],
        arguments: [
          hashes.codeHash,
          hashes.subjectHash,
          hashes.safePurpose,
          String(attempts),
          String(ttl),
        ],
      });
      return { issued: Number(result) === 1, ttlSeconds: ttl, maxAttempts: attempts };
    },

    async consume({ challengeId, subject, code, purpose }) {
      const hashes = challengeHashes({ challengeId, subject, code, purpose });
      const result = await client.eval(CONSUME_OTP_SCRIPT, {
        keys: [challengeKey(challengeId)],
        arguments: [hashes.subjectHash, hashes.safePurpose, hashes.codeHash],
      });
      if (!Array.isArray(result) || result.length !== 3) throw new Error('redis-bad-response');
      const statusCode = Number(result[0]);
      if (!STATUS[statusCode]) throw new Error('redis-bad-response');
      return {
        status: STATUS[statusCode],
        consumed: statusCode === 1,
        attemptsLeft: Number(result[1]),
        ttlSeconds: Math.max(0, Number(result[2])),
      };
    },

    async rateLimit({ scope, subject, limit, windowSeconds }) {
      if (typeof subject !== 'string' || subject.trim() === '') {
        throw new Error('invalid-rate-limit-subject');
      }
      const max = positiveInteger(limit, undefined, 'rate-limit', 100_000);
      const window = positiveInteger(windowSeconds, undefined, 'rate-limit-window', 86_400);
      const result = await client.eval(RATE_LIMIT_SCRIPT, {
        keys: [rateKey(hashKey, scope, subject.trim())],
        arguments: [String(window), String(max)],
      });
      if (!Array.isArray(result) || result.length !== 3) throw new Error('redis-bad-response');
      return {
        allowed: Number(result[0]) === 1,
        count: Number(result[1]),
        remaining: Math.max(0, max - Number(result[1])),
        retryAfterSeconds: Math.max(0, Number(result[2])),
      };
    },

    reserveInboundQuota: inboundQuota.reserve,

    async healthCheck() {
      return healthCheck();
    },

    async close() {
      if (client.isOpen !== false && client.quit) await client.quit();
    },
  });
}

export function redisClientOptionsFromEnv(env = process.env) {
  const url = requireUrl(env, 'REDIS_URL', ['redis:', 'rediss:']);
  if (env.NODE_ENV === 'production' && !url.startsWith('rediss://')) {
    const hostname = new URL(url).hostname;
    const privateAddress = hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    if (env.REDIS_ALLOW_PLAINTEXT !== 'true' || !privateAddress) {
      throw new Error('insecure-config:REDIS_URL');
    }
  }
  return {
    url,
    RESP: 2,
    disableClientInfo: true,
    maintNotifications: 'disabled',
    socket: {
      connectTimeout: positiveInteger(
        env.REDIS_CONNECT_TIMEOUT_MS,
        10_000,
        'REDIS_CONNECT_TIMEOUT_MS',
        60_000,
      ),
    },
  };
}

export function createRedisOtpStoreFromEnv(env = process.env, options = {}) {
  const clientOptions = redisClientOptionsFromEnv(env);
  const client = options.client ?? createClient(clientOptions);
  if (client.on) client.on('error', options.onError ?? (() => {}));
  return createRedisOtpStore({
    client,
    hashKey: options.hashKey ?? requireBase64Key(env, 'OTP_HMAC_KEY'),
  });
}
