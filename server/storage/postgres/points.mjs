import crypto from 'node:crypto';
import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { isPgBigInt, pgBigIntString } from '../../integer-bounds.mjs';
import { jsonValue, mapRow, requireText, validDate } from './repository-utils.mjs';

const OPERATION_KINDS = new Set([
  'admin_adjustment', 'cdk_redeem', 'subscription_bonus', 'consumption', 'refund', 'expiry',
]);

function amountValue(value) {
  return BigInt(pgBigIntString(value, 'point-amount', {
    allowNegative: true,
    nonZero: true,
    symmetric: true,
  }));
}

function requestDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function pageValues(page, pageSize) {
  const selectedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const selectedSize = Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100
    ? pageSize : 20;
  return { page: selectedPage, pageSize: selectedSize, offset: (selectedPage - 1) * selectedSize };
}

async function ensureWallet(queryable, { uuid, ownerType, userId = null, systemCode = null }) {
  if (ownerType === 'user') {
    await queryable.query(`
      INSERT INTO point_wallets (id, owner_type, user_id)
      VALUES ($1, 'user', $2)
      ON CONFLICT (user_id) WHERE owner_type = 'user' DO NOTHING
    `, [uuid(), userId]);
    const result = await queryable.query(
      'SELECT * FROM point_wallets WHERE owner_type = $1 AND user_id = $2 FOR UPDATE',
      ['user', userId],
    );
    return result.rows[0];
  }
  await queryable.query(`
    INSERT INTO point_wallets (id, owner_type, system_code)
    VALUES ($1, 'system', $2)
    ON CONFLICT (system_code) WHERE owner_type = 'system' DO NOTHING
  `, [uuid(), systemCode]);
  const result = await queryable.query(
    'SELECT * FROM point_wallets WHERE owner_type = $1 AND system_code = $2 FOR UPDATE',
    ['system', systemCode],
  );
  return result.rows[0];
}

export function createPointRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    async getWallet(rawUserId) {
      const userId = assertUuid(rawUserId, 'user-id');
      const result = await queryable.query(
        'SELECT * FROM point_wallets WHERE owner_type = $1 AND user_id = $2',
        ['user', userId],
      );
      return mapRow(result.rows[0]);
    },

    async post(input) {
      const userId = assertUuid(input.userId, 'user-id');
      const actor = input.actorAdminId ? assertUuid(input.actorAdminId, 'actor-id') : null;
      if (!OPERATION_KINDS.has(input.kind)) throw new Error('invalid-point-operation-kind');
      const idempotencyKey = requireText(input.idempotencyKey, 'idempotency-key', 160);
      const amount = amountValue(input.amount);
      const expiresAt = input.expiresAt ? validDate(input.expiresAt, 'point-expiry') : null;
      if (expiresAt && expiresAt <= new Date()) throw new Error('invalid-point-expiry');
      const requestHash = requestDigest({
        userId,
        amount: amount.toString(),
        kind: input.kind,
        reason: input.reason,
        metadata: input.metadata ?? {},
        expiresAt: expiresAt?.toISOString() ?? null,
      });
      await queryable.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`xiaobai:points:${idempotencyKey}`],
      );
      const existing = await queryable.query(
        'SELECT * FROM point_operations WHERE idempotency_key = $1',
        [idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) throw new Error('idempotency-conflict');
        const walletResult = await queryable.query(
          'SELECT * FROM point_wallets WHERE owner_type = $1 AND user_id = $2',
          ['user', userId],
        );
        return {
          operation: mapRow(existing.rows[0]),
          wallet: mapRow(walletResult.rows[0]),
          replayed: true,
        };
      }
      const userWallet = await ensureWallet(queryable, {
        uuid, ownerType: 'user', userId,
      });
      const systemWallet = await ensureWallet(queryable, {
        uuid, ownerType: 'system', systemCode: 'issuance',
      });
      const userBalance = BigInt(userWallet.available) + amount;
      if (userBalance < 0n) throw new Error('insufficient-points');
      const systemBalance = BigInt(systemWallet.available) - amount;
      if (!isPgBigInt(userBalance) || !isPgBigInt(systemBalance)) {
        throw new Error('point-balance-overflow');
      }
      if (amount < 0n) {
        const lots = await queryable.query(`
          SELECT * FROM point_lots
          WHERE wallet_id = $1 AND remaining_amount > 0
          ORDER BY expires_at ASC NULLS LAST, created_at, id
          FOR UPDATE
        `, [userWallet.id]);
        let remaining = -amount;
        for (const lot of lots.rows) {
          if (remaining === 0n) break;
          const available = BigInt(lot.remaining_amount);
          const consumed = available < remaining ? available : remaining;
          await queryable.query(`
            UPDATE point_lots
            SET remaining_amount = remaining_amount - $2::BIGINT
            WHERE id = $1
          `, [lot.id, consumed.toString()]);
          remaining -= consumed;
        }
        if (remaining !== 0n) throw new Error('point-lot-invariant-violation');
      }
      const operationId = uuid();
      const operation = await queryable.query(`
        INSERT INTO point_operations (
          id, operation_kind, idempotency_key, request_hash,
          target_user_id, actor_admin_id, reason, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::JSONB)
        RETURNING *
      `, [
        operationId,
        input.kind,
        idempotencyKey,
        requestHash,
        userId,
        actor,
        requireText(input.reason, 'point-reason', 2_000),
        jsonValue(input.metadata ?? {}, 'point-metadata'),
      ]);
      await queryable.query(`
        UPDATE point_wallets
        SET available = $2::BIGINT, version = version + 1, updated_at = NOW()
        WHERE id = $1
      `, [userWallet.id, userBalance.toString()]);
      await queryable.query(`
        UPDATE point_wallets
        SET available = $2::BIGINT, version = version + 1, updated_at = NOW()
        WHERE id = $1
      `, [systemWallet.id, systemBalance.toString()]);
      await queryable.query(`
        INSERT INTO point_postings (id, operation_id, wallet_id, amount, balance_after)
        VALUES
          ($1, $2, $3, $4::BIGINT, $5::BIGINT),
          ($6, $2, $7, $8::BIGINT, $9::BIGINT)
      `, [
        uuid(),
        operationId,
        userWallet.id,
        amount.toString(),
        userBalance.toString(),
        uuid(),
        systemWallet.id,
        (-amount).toString(),
        systemBalance.toString(),
      ]);
      if (amount > 0n) {
        await queryable.query(`
          INSERT INTO point_lots (
            id, wallet_id, source_operation_id, original_amount,
            remaining_amount, expires_at
          )
          VALUES ($1, $2, $3, $4::BIGINT, $4::BIGINT, $5)
        `, [
          uuid(),
          userWallet.id,
          operationId,
          amount.toString(),
          expiresAt,
        ]);
      }
      return {
        operation: mapRow(operation.rows[0]),
        wallet: mapRow({
          ...userWallet,
          available: userBalance.toString(),
          version: BigInt(userWallet.version) + 1n,
        }),
        replayed: false,
      };
    },

    async listForUser(rawUserId, { page, pageSize }) {
      const userId = assertUuid(rawUserId, 'user-id');
      const selected = pageValues(page, pageSize);
      const [rows, count] = await Promise.all([
        queryable.query(`
          SELECT
            o.id, o.operation_kind, o.status, o.target_user_id,
            o.actor_admin_id, o.reason, o.metadata, o.created_at,
            a.email AS actor_admin_email,
            p.amount, p.balance_after
          FROM point_operations o
          JOIN point_postings p ON p.operation_id = o.id
          JOIN point_wallets w ON w.id = p.wallet_id
          LEFT JOIN admin_accounts a ON a.id = o.actor_admin_id
          WHERE w.owner_type = 'user' AND w.user_id = $1
          ORDER BY o.created_at DESC
          LIMIT $2 OFFSET $3
        `, [userId, selected.pageSize, selected.offset]),
        queryable.query(`
          SELECT COUNT(*)::INTEGER AS total
          FROM point_operations o
          JOIN point_postings p ON p.operation_id = o.id
          JOIN point_wallets w ON w.id = p.wallet_id
          WHERE w.owner_type = 'user' AND w.user_id = $1
        `, [userId]),
      ]);
      return {
        items: rows.rows.map(mapRow),
        total: count.rows[0].total,
        page: selected.page,
        pageSize: selected.pageSize,
      };
    },
  });
}
