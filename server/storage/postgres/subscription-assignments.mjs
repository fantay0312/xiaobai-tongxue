import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { jsonValue, mapRow, requireText } from './repository-utils.mjs';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{16,160}$/;

function assignmentKey(value) {
  const key = requireText(value, 'idempotency-key', 160);
  if (!KEY_PATTERN.test(key)) throw new Error('invalid-idempotency-key');
  return key;
}

function requestHash(value) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error('invalid-request-hash');
  }
  return value;
}

export function createSubscriptionAssignmentRepository(
  queryable,
  { uuid = stableUuid } = {},
) {
  function identity(input) {
    return {
      key: assignmentKey(input.idempotencyKey),
      hash: requestHash(input.requestHash),
      userId: assertUuid(input.userId, 'user-id'),
      actorId: assertUuid(input.actorId, 'actor-id'),
    };
  }

  function replay(row, expected) {
    if (!row) return { replayed: false };
    const operation = mapRow(row);
    if (operation.requestHash !== expected.hash
        || operation.userId !== expected.userId
        || operation.createdBy !== expected.actorId) {
      throw new Error('idempotency-conflict');
    }
    if (!operation.responseSnapshot || !operation.subscriptionId) {
      throw new Error('idempotency-incomplete');
    }
    return {
      replayed: true,
      responseSnapshot: operation.responseSnapshot,
      subscriptionId: operation.subscriptionId,
      bonusOperationId: operation.bonusOperationId,
    };
  }

  return Object.freeze({
    async findAssignment(input) {
      const expected = identity(input);
      const result = await queryable.query(`
        SELECT * FROM subscription_assignment_operations
        WHERE idempotency_key = $1
      `, [expected.key]);
      return replay(result.rows[0], expected);
    },

    async lockAssignment(input) {
      const expected = identity(input);
      await queryable.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('subscription-assignment:' || $1, 0))",
        [expected.key],
      );
      const existing = await queryable.query(`
        SELECT * FROM subscription_assignment_operations
        WHERE idempotency_key = $1
        FOR UPDATE
      `, [expected.key]);
      return replay(existing.rows[0], expected);
    },

    async reserveAssignment(input) {
      const expected = identity(input);
      await queryable.query(`
        INSERT INTO subscription_assignment_operations (
          id, idempotency_key, request_hash, user_id, created_by
        )
        VALUES ($1, $2, $3, $4, $5)
      `, [
        uuid(),
        expected.key,
        expected.hash,
        expected.userId,
        expected.actorId,
      ]);
    },

    async assignmentBonusPoints(input) {
      const planId = assertUuid(input.planId, 'plan-id');
      const plan = await queryable.query(`
        SELECT p.current_version_id
        FROM subscription_plans p
        JOIN subscription_plan_versions v ON v.id = p.current_version_id
        WHERE p.id = $1 AND p.status = 'active' AND v.status = 'published'
        FOR SHARE OF p, v
      `, [planId]);
      if (!plan.rows[0]) throw new Error('active-plan-not-found');
      if (!input.priceId) return '0';
      const price = await queryable.query(`
        SELECT bonus_points
        FROM subscription_prices
        WHERE id = $1 AND plan_version_id = $2 AND status = 'active'
        FOR SHARE
      `, [
        assertUuid(input.priceId, 'price-id'),
        plan.rows[0].current_version_id,
      ]);
      if (!price.rows[0]) throw new Error('price-not-found');
      return String(price.rows[0].bonus_points);
    },

    async completeAssignment(input) {
      const key = assignmentKey(input.idempotencyKey);
      const subscriptionId = assertUuid(input.subscriptionId, 'subscription-id');
      const bonusId = input.bonusOperationId
        ? assertUuid(input.bonusOperationId, 'point-operation-id')
        : null;
      const result = await queryable.query(`
        UPDATE subscription_assignment_operations
        SET subscription_id = $2,
            bonus_operation_id = $3,
            response_snapshot = $4::JSONB,
            completed_at = NOW()
        WHERE idempotency_key = $1 AND response_snapshot IS NULL
        RETURNING *
      `, [
        key,
        subscriptionId,
        bonusId,
        jsonValue(input.responseSnapshot, 'subscription-response-snapshot'),
      ]);
      if (!result.rows[0]) throw new Error('idempotency-conflict');
      return mapRow(result.rows[0]);
    },
  });
}
