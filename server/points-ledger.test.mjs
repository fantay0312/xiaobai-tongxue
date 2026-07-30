import assert from 'node:assert/strict';
import test from 'node:test';
import { createPointRepository } from './storage/postgres/points.mjs';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function ids() {
  let value = 1;
  return () => {
    const suffix = String(value).padStart(12, '0');
    value += 1;
    return `00000000-0000-4000-8000-${suffix}`;
  };
}

class PointQueryable {
  calls = [];
  wallets = [];
  operations = new Map();
  postings = [];
  lots = [];

  wallet(ownerType, subject) {
    return this.wallets.find((item) => item.owner_type === ownerType
      && (ownerType === 'user' ? item.user_id === subject : item.system_code === subject));
  }

  async query(text, values = []) {
    this.calls.push({ text, values });
    if (/pg_advisory_xact_lock/.test(text)) return { rows: [{ locked: true }] };
    if (/SELECT \* FROM point_operations WHERE idempotency_key/.test(text)) {
      const row = this.operations.get(values[0]);
      return { rows: row ? [row] : [] };
    }
    if (/INSERT INTO point_wallets/.test(text)) {
      const ownerType = /'user'/.test(text) ? 'user' : 'system';
      const subject = values[1];
      if (!this.wallet(ownerType, subject)) {
        this.wallets.push({
          id: values[0],
          owner_type: ownerType,
          user_id: ownerType === 'user' ? subject : null,
          system_code: ownerType === 'system' ? subject : null,
          available: '0',
          version: '1',
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT \* FROM point_wallets/.test(text)) {
      const row = this.wallet(values[0], values[1]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (/SELECT \* FROM point_lots/.test(text)) {
      return {
        rows: this.lots
          .filter((lot) => lot.wallet_id === values[0] && BigInt(lot.remaining_amount) > 0n)
          .map((lot) => ({ ...lot })),
      };
    }
    if (/UPDATE point_lots/.test(text)) {
      const lot = this.lots.find((item) => item.id === values[0]);
      lot.remaining_amount = (BigInt(lot.remaining_amount) - BigInt(values[1])).toString();
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO point_operations/.test(text)) {
      const row = {
        id: values[0],
        operation_kind: values[1],
        idempotency_key: values[2],
        request_hash: values[3],
        target_user_id: values[4],
        actor_admin_id: values[5],
        reason: values[6],
        metadata: JSON.parse(values[7]),
      };
      this.operations.set(row.idempotency_key, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }
    if (/UPDATE point_wallets/.test(text)) {
      const wallet = this.wallets.find((item) => item.id === values[0]);
      wallet.available = values[1];
      wallet.version = (BigInt(wallet.version) + 1n).toString();
      return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO point_postings/.test(text)) {
      this.postings.push(
        {
          id: values[0],
          operationId: values[1],
          walletId: values[2],
          amount: values[3],
          balanceAfter: values[4],
        },
        {
          id: values[5],
          operationId: values[1],
          walletId: values[6],
          amount: values[7],
          balanceAfter: values[8],
        },
      );
      return { rows: [], rowCount: 2 };
    }
    if (/INSERT INTO point_lots/.test(text)) {
      this.lots.push({
        id: values[0],
        wallet_id: values[1],
        source_operation_id: values[2],
        original_amount: values[3],
        remaining_amount: values[3],
        expires_at: values[4],
        created_at: new Date().toISOString(),
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected-query:${text.trim().slice(0, 60)}`);
  }
}

test('point posting locks idempotency and wallets, balances two postings, and replays safely', async () => {
  const queryable = new PointQueryable();
  const repository = createPointRepository(queryable, { uuid: ids() });
  const input = {
    userId: USER_ID,
    amount: '100',
    kind: 'admin_adjustment',
    idempotencyKey: 'adjustment:one',
    reason: '首次发放',
    metadata: { ticket: 'T-1' },
  };
  const posted = await repository.post(input);
  const replay = await repository.post(input);
  assert.equal(posted.replayed, false);
  assert.equal(posted.wallet.available, '100');
  assert.equal(replay.replayed, true);
  assert.equal(queryable.operations.size, 1);
  assert.equal(queryable.postings.length, 2);
  assert.equal(
    queryable.postings.reduce((sum, item) => sum + BigInt(item.amount), 0n),
    0n,
  );
  assert.equal(queryable.lots[0].remaining_amount, '100');
  assert.ok(queryable.calls.some((call) => /pg_advisory_xact_lock/.test(call.text)));
  assert.equal(
    queryable.calls.filter((call) => /point_wallets.*FOR UPDATE/s.test(call.text)).length,
    2,
  );
  await assert.rejects(
    repository.post({ ...input, amount: '101' }),
    /idempotency-conflict/,
  );
});

test('debits consume locked lots in earliest-expiry order and keep wallet/lot totals aligned', async () => {
  const queryable = new PointQueryable();
  const repository = createPointRepository(queryable, { uuid: ids() });
  await repository.post({
    userId: USER_ID,
    amount: '100',
    kind: 'admin_adjustment',
    idempotencyKey: 'credit:one',
    reason: '发放',
  });
  const debit = await repository.post({
    userId: USER_ID,
    amount: '-40',
    kind: 'consumption',
    idempotencyKey: 'consume:one',
    reason: '消费',
  });
  assert.equal(debit.wallet.available, '60');
  assert.equal(queryable.lots[0].remaining_amount, '60');
  assert.equal(
    queryable.lots.reduce((sum, lot) => sum + BigInt(lot.remaining_amount), 0n),
    60n,
  );
  const lotLock = queryable.calls.find((call) => /SELECT \* FROM point_lots/.test(call.text));
  assert.match(lotLock.text, /ORDER BY expires_at ASC NULLS LAST, created_at, id/);
  assert.match(lotLock.text, /FOR UPDATE/);
});

test('point repository declares the primitives needed for concurrent first-write safety', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('./storage/postgres/points.mjs', import.meta.url),
    'utf8',
  ));
  assert.match(source, /ON CONFLICT \(user_id\) WHERE owner_type = 'user' DO NOTHING/);
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
  assert.match(source, /SELECT \* FROM point_wallets[\s\S]+FOR UPDATE/);
  assert.match(source, /LEFT JOIN admin_accounts a ON a\.id = o\.actor_admin_id/);
  assert.match(source, /a\.email AS actor_admin_email/);
});
