import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleAdminFinanceRoute } from './admin/finance-router.mjs';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SUBSCRIPTION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BONUS_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const IDEMPOTENCY_KEY = 'subscription-test-key-0001';

function store() {
  const state = {
    operation: null,
    creates: 0,
    bonusPosts: 0,
  };
  const repositories = {
    subscriptions: {
      findAssignment: async (input) => {
        if (!state.operation) return { replayed: false };
        if (state.operation.requestHash !== input.requestHash
            || state.operation.userId !== input.userId
            || state.operation.actorId !== input.actorId) {
          throw new Error('idempotency-conflict');
        }
        return {
          replayed: true,
          responseSnapshot: state.operation.responseSnapshot,
        };
      },
      lockAssignment: async (input) => {
        if (!state.operation) return { replayed: false };
        if (state.operation.requestHash !== input.requestHash) {
          throw new Error('idempotency-conflict');
        }
        return {
          replayed: true,
          responseSnapshot: state.operation.responseSnapshot,
        };
      },
      assignmentBonusPoints: async () => '25',
      reserveAssignment: async (input) => {
        state.operation = { ...input, responseSnapshot: null };
      },
      create: async () => {
        state.creates += 1;
        return {
          subscription: {
            id: SUBSCRIPTION_ID,
            userId: USER_ID,
            planId: PLAN_ID,
            status: 'active',
          },
          bonusPoints: '25',
        };
      },
      completeAssignment: async (input) => {
        state.operation.responseSnapshot = input.responseSnapshot;
      },
    },
    points: {
      post: async () => {
        state.bonusPosts += 1;
        return { operation: { id: BONUS_ID } };
      },
    },
  };
  return {
    state,
    postgres: {
      ...repositories,
      withTransaction: async (work) => work(repositories),
    },
  };
}

async function assign(postgres, overrides = {}, permissions = [
  'subscriptions.write',
  'points.adjust',
]) {
  let response;
  let audit;
  const input = {
    userId: USER_ID,
    planId: PLAN_ID,
    status: 'active',
    reason: '人工订阅审批',
    idempotencyKey: IDEMPOTENCY_KEY,
    ...overrides,
  };
  await handleAdminFinanceRoute({
    req: { method: 'POST' },
    pathname: '/api/admin/v1/subscriptions',
    url: new URL('https://admin.example.com/api/admin/v1/subscriptions'),
    principal: {
      account: { id: ADMIN_ID },
      permissions,
    },
    postgres,
    commerce: {},
    body: async () => input,
    mutate: async (inputAudit, work) => {
      audit = inputAudit;
      return work();
    },
    send: (status, payload) => { response = { status, payload }; },
  });
  return { ...response, audit };
}

test('lost subscription responses replay without a second subscription or bonus', async () => {
  const { postgres, state } = store();
  const first = await assign(postgres);
  const replay = await assign(postgres);
  assert.equal(first.status, 201);
  assert.equal(first.payload.replayed, false);
  assert.equal(first.audit.details.bonusPoints, '25');
  assert.equal(replay.payload.replayed, true);
  assert.deepEqual(replay.payload.subscription, first.payload.subscription);
  assert.equal(state.creates, 1);
  assert.equal(state.bonusPosts, 1);
});

test('the same key with a different assignment request conflicts', async () => {
  const { postgres, state } = store();
  await assign(postgres);
  await assert.rejects(
    assign(postgres, { planId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }),
    /idempotency-conflict/,
  );
  assert.equal(state.creates, 1);
  assert.equal(state.bonusPosts, 1);
});

test('subscription assignment requires a client idempotency key', async () => {
  const { postgres, state } = store();
  await assert.rejects(
    assign(postgres, { idempotencyKey: undefined }),
    /invalid-idempotency-key/,
  );
  assert.equal(state.creates, 0);
  assert.equal(state.bonusPosts, 0);
});

test('a bonus plan requires points.adjust before any business write', async () => {
  const { postgres, state } = store();
  await assert.rejects(
    assign(postgres, {}, ['subscriptions.write']),
    /permission-denied/,
  );
  assert.equal(state.operation, null);
  assert.equal(state.creates, 0);
  assert.equal(state.bonusPosts, 0);
});

test('assignment storage is locked, hashed, unique, and immutable after completion', async () => {
  const [repository, migration] = await Promise.all([
    readFile(new URL(
      './storage/postgres/subscription-assignments.mjs',
      import.meta.url,
    ), 'utf8'),
    readFile(new URL(
      './storage/postgres/migrations/002_commercial_admin.sql',
      import.meta.url,
    ), 'utf8'),
  ]);
  assert.match(repository, /pg_advisory_xact_lock/);
  assert.match(repository, /operation\.requestHash !== expected\.hash/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS subscription_assignment_operations/);
  assert.match(migration, /idempotency_key VARCHAR\(160\) NOT NULL UNIQUE/);
  assert.match(migration, /subscription_assignment_operations_immutable_guard/);
});
