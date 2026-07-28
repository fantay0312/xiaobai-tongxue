import crypto from 'node:crypto';

export const RESERVE_INBOUND_QUOTA_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return {2, 0, 0, 0, 0}
end
local requested = tonumber(ARGV[1])
local user_count = tonumber(redis.call('HGET', KEYS[2], 'count')) or 0
local user_bytes = tonumber(redis.call('HGET', KEYS[2], 'bytes')) or 0
local global_count = tonumber(redis.call('HGET', KEYS[3], 'count')) or 0
local global_bytes = tonumber(redis.call('HGET', KEYS[3], 'bytes')) or 0
if user_count + 1 > tonumber(ARGV[2])
  or user_bytes + requested > tonumber(ARGV[3])
  or global_count + 1 > tonumber(ARGV[4])
  or global_bytes + requested > tonumber(ARGV[5]) then
  return {0, user_count, user_bytes, global_count, global_bytes}
end
user_count = redis.call('HINCRBY', KEYS[2], 'count', 1)
user_bytes = redis.call('HINCRBY', KEYS[2], 'bytes', requested)
global_count = redis.call('HINCRBY', KEYS[3], 'count', 1)
global_bytes = redis.call('HINCRBY', KEYS[3], 'bytes', requested)
redis.call('EXPIRE', KEYS[2], ARGV[6])
redis.call('EXPIRE', KEYS[3], ARGV[6])
redis.call('SET', KEYS[1], '1', 'EX', ARGV[7])
return {1, user_count, user_bytes, global_count, global_bytes}
`;

function boundedInteger(value, label, maximum, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`invalid-${label}`);
  }
  return value;
}

function digest(key, domain, value) {
  return crypto.createHmac('sha256', key)
    .update(`${domain}\0${value}`, 'utf8')
    .digest('hex');
}

function shanghaiDay(at) {
  const offsetMs = 8 * 60 * 60 * 1_000;
  const shifted = new Date(at + offsetMs);
  const day = shifted.toISOString().slice(0, 10);
  const nextMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  ) - offsetMs;
  return {
    day,
    ttlSeconds: Math.max(1, Math.ceil((nextMidnight - at) / 1_000)),
  };
}

export function createRedisInboundQuota({ client, hashKey, now = Date.now } = {}) {
  if (!client?.eval) throw new Error('redis-client-required');
  if (!Buffer.isBuffer(hashKey) || hashKey.length !== 32) {
    throw new Error('inbound-quota-hash-key-required');
  }
  if (typeof now !== 'function') throw new Error('inbound-quota-clock-required');

  return Object.freeze({
    async reserve({
      userId,
      providerMessageId,
      bytes,
      userCountLimit = 50,
      userByteLimit = 100 * 1024 * 1024,
      globalCountLimit = 200,
      globalByteLimit = 500 * 1024 * 1024,
    }) {
      if (typeof userId !== 'string' || userId === '') throw new Error('invalid-inbound-user');
      if (typeof providerMessageId !== 'string' || providerMessageId === '') {
        throw new Error('invalid-inbound-message');
      }
      const requestedBytes = boundedInteger(bytes, 'inbound-bytes', 1024 ** 3, 0);
      const limits = [
        boundedInteger(userCountLimit, 'inbound-user-count-limit', 10_000),
        boundedInteger(userByteLimit, 'inbound-user-byte-limit', 10 * 1024 ** 3),
        boundedInteger(globalCountLimit, 'inbound-global-count-limit', 100_000),
        boundedInteger(globalByteLimit, 'inbound-global-byte-limit', 10 * 1024 ** 3),
      ];
      const at = now();
      if (!Number.isFinite(at) || at <= 0) throw new Error('invalid-inbound-quota-time');
      const { day, ttlSeconds } = shanghaiDay(at);
      const userHash = digest(hashKey, 'inbound-user', userId);
      const messageHash = digest(hashKey, 'inbound-message', providerMessageId);
      const result = await client.eval(RESERVE_INBOUND_QUOTA_SCRIPT, {
        keys: [
          `xiaobai:inbound:reservation:${messageHash}`,
          `xiaobai:inbound:quota:${day}:user:${userHash}`,
          `xiaobai:inbound:quota:${day}:global`,
        ],
        arguments: [
          String(requestedBytes),
          ...limits.map(String),
          String(ttlSeconds),
          String(Math.max(172_800, ttlSeconds + 86_400)),
        ],
      });
      if (!Array.isArray(result) || result.length !== 5) throw new Error('redis-bad-response');
      const status = Number(result[0]);
      if (![0, 1, 2].includes(status)) throw new Error('redis-bad-response');
      return {
        allowed: status !== 0,
        duplicateReservation: status === 2,
        userCount: Number(result[1]),
        userBytes: Number(result[2]),
        globalCount: Number(result[3]),
        globalBytes: Number(result[4]),
        day,
      };
    },
  });
}
