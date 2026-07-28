import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createClient } from 'redis';
import { createRedisOtpStore } from './storage/redis-otp-store.mjs';

const redisAvailable = spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0;

async function waitForSocket(socketPath, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error('redis-server-exited');
    if (await stat(socketPath).then(() => true, () => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('redis-server-timeout');
}

test('Redis Lua scripts consume once, expire attempts, and preserve TradingVane keys', {
  skip: !redisAvailable,
}, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'xiaobai-redis-'));
  const socketPath = path.join(directory, 'redis.sock');
  const child = spawn('redis-server', [
    '--port', '0',
    '--unixsocket', socketPath,
    '--save', '',
    '--appendonly', 'no',
    '--loglevel', 'warning',
  ], { stdio: 'ignore' });
  let client;
  try {
    await waitForSocket(socketPath, child);
    client = createClient({
      socket: { path: socketPath },
      RESP: 2,
      disableClientInfo: true,
      maintNotifications: 'disabled',
    });
    client.on('error', () => {});
    await client.connect();
    await client.set('TradingVane:sentinel', 'keep');
    const store = createRedisOtpStore({ client, hashKey: Buffer.alloc(32, 6) });

    assert.equal((await store.issue({
      challengeId: 'wrong-code',
      subject: '+8613800138000',
      code: '123456',
      purpose: 'login',
      maxAttempts: 2,
      ttlSeconds: 60,
    })).issued, true);
    assert.equal((await store.consume({
      challengeId: 'wrong-code',
      subject: '+8613800138000',
      code: '000000',
      purpose: 'login',
    })).status, 'invalid');
    assert.equal((await store.consume({
      challengeId: 'wrong-code',
      subject: '+8613800138000',
      code: '000000',
      purpose: 'login',
    })).status, 'attempts-exhausted');
    assert.equal((await store.consume({
      challengeId: 'wrong-code',
      subject: '+8613800138000',
      code: '123456',
      purpose: 'login',
    })).status, 'expired');

    await store.issue({
      challengeId: 'one-time',
      subject: '+8613800138000',
      code: '654321',
      purpose: 'reset-password',
      ttlSeconds: 60,
    });
    assert.equal((await store.consume({
      challengeId: 'one-time',
      subject: '+8613800138000',
      code: '654321',
      purpose: 'reset-password',
    })).status, 'consumed');
    assert.equal((await store.consume({
      challengeId: 'one-time',
      subject: '+8613800138000',
      code: '654321',
      purpose: 'reset-password',
    })).status, 'expired');

    const first = await store.rateLimit({
      scope: 'sms-send-ip',
      subject: 'hashed-ip-input',
      limit: 2,
      windowSeconds: 60,
    });
    const second = await store.rateLimit({
      scope: 'sms-send-ip',
      subject: 'hashed-ip-input',
      limit: 2,
      windowSeconds: 60,
    });
    const third = await store.rateLimit({
      scope: 'sms-send-ip',
      subject: 'hashed-ip-input',
      limit: 2,
      windowSeconds: 60,
    });
    assert.deepEqual([first.allowed, second.allowed, third.allowed], [true, true, false]);

    const quotaInput = {
      userId: '11111111-1111-4111-8111-111111111111',
      providerMessageId: 'provider-message-1',
      bytes: 6,
      userCountLimit: 2,
      userByteLimit: 10,
      globalCountLimit: 3,
      globalByteLimit: 20,
    };
    const firstQuota = await store.reserveInboundQuota(quotaInput);
    const retryQuota = await store.reserveInboundQuota(quotaInput);
    const rejectedQuota = await store.reserveInboundQuota({
      ...quotaInput,
      providerMessageId: 'provider-message-2',
    });
    const finalQuota = await store.reserveInboundQuota({
      ...quotaInput,
      providerMessageId: 'provider-message-3',
      bytes: 4,
    });
    assert.equal(firstQuota.allowed, true);
    assert.equal(retryQuota.duplicateReservation, true);
    assert.equal(rejectedQuota.allowed, false);
    assert.equal(finalQuota.allowed, true);
    assert.equal(finalQuota.userBytes, 10);
    assert.equal(await client.get('TradingVane:sentinel'), 'keep');
    const keys = await client.keys('*');
    assert.ok(keys.filter((key) => key !== 'TradingVane:sentinel')
      .every((key) => key.startsWith('xiaobai:')));
  } finally {
    if (client?.isOpen) await client.quit();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
