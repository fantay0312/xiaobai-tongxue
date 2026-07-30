import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleAdminFinanceRoute } from './admin/finance-router.mjs';
import { publicError } from './admin/http.mjs';
import { createCommerceService } from './commerce/service.mjs';

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ACTOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const KEY = 'campaign:create:2026';
const CDK_KEY = Buffer.alloc(32, 7);
const EXPORT_KEY = Buffer.alloc(32, 9);

function request(overrides = {}) {
  return {
    name: '开学季',
    quantity: 2,
    rewards: [{ type: 'points', amount: '50', label: '50 积分' }],
    expiresAt: '2027-01-01T00:00:00.000Z',
    reason: '开学运营活动',
    idempotencyKey: KEY,
    ...overrides,
  };
}

function memoryStore(clock) {
  const state = {
    campaigns: [],
    codes: [],
    operations: new Map(),
  };
  let transactionTail = Promise.resolve();

  function operationKey(input) {
    return `${input.actorId}:${input.idempotencyKey}`;
  }

  const cdk = {
    async clearExpiredCampaignExports() {
      for (const operation of state.operations.values()) {
        if (operation.exportExpiresAt?.getTime() <= clock.now) {
          operation.exportNonce = null;
          operation.exportTag = null;
          operation.exportCiphertext = null;
        }
      }
    },
    async lockCampaignCreation(input) {
      const operation = state.operations.get(operationKey(input));
      if (!operation) return { replayed: false };
      if (operation.requestHash !== input.requestHash) {
        throw new Error('idempotency-conflict');
      }
      return { replayed: true, ...operation };
    },
    async reserveCampaignCreation(input) {
      state.operations.set(operationKey(input), { ...input });
    },
    async createCampaign(input) {
      const campaign = {
        id: `00000000-0000-4000-8000-${String(state.campaigns.length + 1).padStart(12, '0')}`,
        name: input.name,
        status: 'active',
        rewards: input.rewards.items,
        codeCount: input.codes.length,
        createdAt: new Date(clock.now).toISOString(),
      };
      state.campaigns.push(campaign);
      state.codes.push(...input.codes);
      return campaign;
    },
    async completeCampaignCreation(input) {
      const operation = state.operations.get(operationKey(input));
      if (!operation || operation.completedAt) throw new Error('idempotency-conflict');
      Object.assign(operation, {
        campaignId: input.campaignId,
        exportNonce: input.nonce,
        exportTag: input.tag,
        exportCiphertext: input.ciphertext,
        exportExpiresAt: new Date(clock.now + 15 * 60_000),
        completedAt: new Date(clock.now),
      });
    },
    async expireCampaignCreation(input) {
      const operation = state.operations.get(operationKey(input));
      if (!operation) return false;
      operation.exportNonce = null;
      operation.exportTag = null;
      operation.exportCiphertext = null;
      return true;
    },
  };
  const postgres = {
    cdk,
    async withTransaction(work) {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        return await work({ cdk });
      } finally {
        release();
      }
    },
  };
  return { postgres, state };
}

function serviceFor(store, clock, exportKey = EXPORT_KEY) {
  return createCommerceService({
    postgres: store.postgres,
    cdkKeys: new Map([[3, CDK_KEY]]),
    currentCdkVersion: 3,
    cdkExportRootKey: exportKey,
    now: () => clock.now,
  });
}

test('same actor and key replay exactly one encrypted CDK batch', async () => {
  const clock = { now: Date.parse('2026-08-01T00:00:00.000Z') };
  const store = memoryStore(clock);
  const service = serviceFor(store, clock);
  const first = await service.createCampaign(request(), ACTOR_ID);
  const replay = await service.createCampaign(request({
    name: '  开学季 ',
    quantity: '2',
    expiresAt: '2027-01-01T00:00:00Z',
    reason: ' 开学运营活动 ',
  }), ACTOR_ID);

  assert.deepEqual(replay, first);
  assert.equal(store.state.campaigns.length, 1);
  assert.equal(store.state.codes.length, 2);
  const operation = [...store.state.operations.values()][0];
  assert.equal(operation.exportNonce.length, 12);
  assert.equal(operation.exportTag.length, 16);
  for (const code of first.codes) {
    assert.equal(operation.exportCiphertext.includes(Buffer.from(code)), false);
    assert.equal(JSON.stringify(store.state.codes).includes(code), false);
  }
  await assert.rejects(
    serviceFor(store, clock, Buffer.alloc(32, 10)).createCampaign(request(), ACTOR_ID),
    /cdk-export-unavailable/,
  );
});

test('same key conflicts on another request while another actor remains isolated', async () => {
  const clock = { now: Date.parse('2026-08-01T00:00:00.000Z') };
  const store = memoryStore(clock);
  const service = serviceFor(store, clock);
  await service.createCampaign(request(), ACTOR_ID);
  await assert.rejects(
    service.createCampaign(request({ quantity: 3 }), ACTOR_ID),
    /idempotency-conflict/,
  );
  await service.createCampaign(request(), OTHER_ACTOR_ID);
  assert.equal(store.state.campaigns.length, 2);
});

test('concurrent identical requests create one campaign and replay one code export', async () => {
  const clock = { now: Date.parse('2026-08-01T00:00:00.000Z') };
  const store = memoryStore(clock);
  const service = serviceFor(store, clock);
  const [left, right] = await Promise.all([
    service.createCampaign(request(), ACTOR_ID),
    service.createCampaign(request(), ACTOR_ID),
  ]);
  assert.deepEqual(left, right);
  assert.equal(store.state.campaigns.length, 1);
});

test('expired export becomes a ciphertext-free tombstone and never creates again', async () => {
  const clock = { now: Date.parse('2026-08-01T00:00:00.000Z') };
  const store = memoryStore(clock);
  const service = serviceFor(store, clock);
  const first = await service.createCampaign(request(), ACTOR_ID);
  clock.now += 15 * 60_000 + 1;

  await assert.rejects(
    service.createCampaign(request(), ACTOR_ID),
    /cdk-export-expired/,
  );
  assert.equal(store.state.campaigns.length, 1);
  const operation = [...store.state.operations.values()][0];
  assert.equal(operation.campaignId, first.campaign.id);
  assert.equal(operation.exportCiphertext, null);
});

test('migration enforces actor-key uniqueness and immutable AES-GCM export tombstones', async () => {
  const [migration, repository] = await Promise.all([
    readFile(new URL(
      './storage/postgres/migrations/003_cdk_campaign_idempotency.sql',
      import.meta.url,
    ), 'utf8'),
    readFile(new URL(
      './storage/postgres/cdk-creation-operations.mjs',
      import.meta.url,
    ), 'utf8'),
  ]);
  assert.match(migration, /UNIQUE \(created_by, idempotency_key\)/);
  assert.match(migration, /export_nonce BYTEA/);
  assert.match(
    migration,
    /export_nonce IS NOT NULL\s+AND export_tag IS NOT NULL\s+AND export_ciphertext IS NOT NULL/,
  );
  assert.match(migration, /OCTET_LENGTH\(export_nonce\) = 12/);
  assert.match(migration, /OCTET_LENGTH\(export_tag\) = 16/);
  assert.match(migration, /export_expires_at = completed_at \+ INTERVAL '15 minutes'/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(migration, /cdk-campaign-operation-immutable/);
  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(
    repository,
    /SET export_nonce = NULL, export_tag = NULL, export_ciphertext = NULL/,
  );
  assert.doesNotMatch(migration, /codes?\s+(TEXT|JSONB)/i);
});

test('admin CDK API requires and forwards the normalized idempotency key', async () => {
  let received = null;
  const base = {
    req: { method: 'POST' },
    pathname: '/api/admin/v1/cdk/campaigns',
    url: new URL('https://admin.example.com/api/admin/v1/cdk/campaigns'),
    principal: { permissions: ['cdk.write'], account: { id: ACTOR_ID } },
    postgres: {},
    commerce: {
      createCampaign: async (input) => {
        received = input;
        return { campaign: { id: 'campaign' }, codes: [] };
      },
    },
    send() {},
    mutate: async (_audit, work) => work(),
  };
  await handleAdminFinanceRoute({
    ...base,
    body: async () => request(),
  });
  assert.equal(received.idempotencyKey, KEY);

  await assert.rejects(
    handleAdminFinanceRoute({
      ...base,
      body: async () => request({ idempotencyKey: 'short' }),
    }),
    /invalid-idempotency-key/,
  );
  assert.deepEqual(
    publicError(new Error('cdk-export-expired')),
    { status: 410, code: 'cdk-export-expired' },
  );
});
