import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminAuditRepository } from './storage/postgres/admin-audit.mjs';

test('date-only audit upper bound includes the full selected UTC day', async () => {
  const calls = [];
  const queryable = {
    async query(text, values) {
      calls.push({ text, values });
      return /COUNT\(\*\)/.test(text) ? { rows: [{ total: 0 }] } : { rows: [] };
    },
  };
  const repository = createAdminAuditRepository(queryable);
  await repository.listAudit({
    page: 1,
    pageSize: 20,
    from: '2026-07-30',
    to: '2026-07-30',
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].values[3].toISOString(), '2026-07-30T00:00:00.000Z');
  assert.equal(calls[0].values[4].toISOString(), '2026-07-31T00:00:00.000Z');
  assert.match(calls[0].text, /e\.occurred_at < \$5/);
});

test('audit date range still rejects an upper date before the lower date', async () => {
  const repository = createAdminAuditRepository({ query: async () => ({ rows: [] }) });
  await assert.rejects(repository.listAudit({
    page: 1,
    pageSize: 20,
    from: '2026-07-31',
    to: '2026-07-30',
  }), /invalid-audit-date-range/);
});

test('timestamped start can use the remainder of a date-only upper day', async () => {
  const calls = [];
  const queryable = {
    async query(text, values) {
      calls.push({ text, values });
      return /COUNT\(\*\)/.test(text) ? { rows: [{ total: 0 }] } : { rows: [] };
    },
  };
  const repository = createAdminAuditRepository(queryable);
  await repository.listAudit({
    page: 1,
    pageSize: 20,
    from: '2026-07-30T12:00:00.000Z',
    to: '2026-07-30',
  });

  assert.equal(calls[0].values[3].toISOString(), '2026-07-30T12:00:00.000Z');
  assert.equal(calls[0].values[4].toISOString(), '2026-07-31T00:00:00.000Z');
});

test('inclusive local-day timestamps become one exclusive SQL upper bound', async () => {
  const calls = [];
  const queryable = {
    async query(text, values) {
      calls.push({ text, values });
      return /COUNT\(\*\)/.test(text) ? { rows: [{ total: 0 }] } : { rows: [] };
    },
  };
  const repository = createAdminAuditRepository(queryable);
  await repository.listAudit({
    page: 1,
    pageSize: 20,
    from: '2026-07-29T16:00:00.000Z',
    to: '2026-07-30T15:59:59.999Z',
  });

  assert.equal(calls[0].values[3].toISOString(), '2026-07-29T16:00:00.000Z');
  assert.equal(calls[0].values[4].toISOString(), '2026-07-30T16:00:00.000Z');
  assert.match(calls[0].text, /e\.occurred_at < \$5/);
});
