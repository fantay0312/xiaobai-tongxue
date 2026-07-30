import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCommerceService } from './commerce/service.mjs';
import {
  createFeatureRepository,
  MANAGED_FEATURE_KEYS,
} from './storage/postgres/features.mjs';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function commerceWith(features) {
  const repositories = {
    userAccess: { activeRestriction: async () => null },
    subscriptions: {
      effectiveEntitlements: async () => [],
      effectiveFeatures: async () => features,
    },
  };
  return createCommerceService({
    postgres: {
      ...repositories,
      withTransaction: async (work) => work(repositories),
    },
  });
}

test('every runtime feature scope is fixed and missing rows fail closed', async () => {
  assert.deepEqual(MANAGED_FEATURE_KEYS, [
    'login', 'chat', 'asr', 'vision', 'state', 'transcript', 'commerce',
  ]);
  const missing = commerceWith([]);
  for (const scope of MANAGED_FEATURE_KEYS) {
    assert.deepEqual(await missing.accessDecision({ id: USER_ID }, scope), {
      allowed: false,
      error: 'feature-disabled',
      reason: 'feature-not-configured',
    });
  }
  assert.deepEqual(await missing.accessDecision({ id: USER_ID }, 'all'), {
    allowed: true,
  });
});

test('a configured feature can allow or deny its exact API scope', async () => {
  const enabled = commerceWith([{
    key: 'chat',
    enabled: true,
    reason: '',
  }]);
  assert.deepEqual(await enabled.accessDecision({ id: USER_ID }, 'chat'), {
    allowed: true,
  });
  const disabled = commerceWith([{
    key: 'chat',
    enabled: false,
    reason: 'maintenance',
  }]);
  assert.deepEqual(await disabled.accessDecision({ id: USER_ID }, 'chat'), {
    allowed: false,
    error: 'feature-disabled',
    reason: 'maintenance',
  });
  await assert.rejects(
    enabled.accessDecision({ id: USER_ID }, 'chta'),
    /invalid-access-scope/,
  );
});

test('feature writes reject typo keys before any query', async () => {
  let queries = 0;
  const repository = createFeatureRepository({
    query: async () => {
      queries += 1;
      return { rows: [] };
    },
  });
  await assert.rejects(repository.upsert('chta', {
    name: 'Typo',
    enabled: false,
    reason: 'test',
  }, ACTOR_ID), /unknown-feature-key/);
  assert.equal(queries, 0);
});

test('feature storage keeps only the public reason, never the internal change reason', async () => {
  let captured;
  const repository = createFeatureRepository({
    query: async (sql, params) => {
      captured = { sql, params };
      return {
        rows: [{
          feature_key: 'chat',
          enabled: false,
          public_reason: '维护窗口',
        }],
      };
    },
  });
  const result = await repository.upsert('chat', {
    name: 'AI 对话',
    enabled: false,
    publicReason: '维护窗口',
    changeReason: '内部工单 SEC-42',
  }, ACTOR_ID);
  assert.equal(result.publicReason, '维护窗口');
  assert.match(captured.sql, /public_reason/);
  assert.equal(captured.params.includes('维护窗口'), true);
  assert.equal(captured.params.includes('内部工单 SEC-42'), false);
});

test('migration seeds all managed feature rows enabled for compatibility', async () => {
  const migration = await readFile(new URL(
    './storage/postgres/migrations/002_commercial_admin.sql',
    import.meta.url,
  ), 'utf8');
  for (const key of MANAGED_FEATURE_KEYS) {
    assert.match(migration, new RegExp(`'${key}'[^\\n]+TRUE`));
  }
  assert.match(migration, /ON CONFLICT \(feature_key\) DO NOTHING/);
});
