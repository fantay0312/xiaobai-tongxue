import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createAdminAuthRepository } from './storage/postgres/admin-auth.mjs';

const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVITATION_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INVITATION_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CREATOR_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('invitation creation locks the account before replacing its active token', async () => {
  const queries = [];
  const repository = createAdminAuthRepository({
    query: async (sql) => {
      queries.push(sql);
      if (/SELECT id, status FROM admin_accounts/.test(sql)) {
        return { rows: [{ id: ACCOUNT_ID, status: 'pending' }] };
      }
      if (/INSERT INTO admin_invitations/.test(sql)) {
        return { rows: [{ id: INVITATION_A, account_id: ACCOUNT_ID }] };
      }
      return { rows: [], rowCount: 1 };
    },
  }, { uuid: () => INVITATION_A });
  await repository.createInvitation({
    accountId: ACCOUNT_ID,
    tokenHash: 'a'.repeat(64),
    createdBy: CREATOR_ID,
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.match(queries[0], /SELECT id, status FROM admin_accounts/);
  assert.match(queries[0], /FOR UPDATE/);
  assert.match(queries[1], /UPDATE admin_invitations/);
  assert.match(queries[2], /INSERT INTO admin_invitations/);
});

test('activating one token revokes every sibling so an older token cannot activate', async () => {
  const invitations = new Map([
    ['a'.repeat(64), {
      id: INVITATION_A,
      account_id: ACCOUNT_ID,
      token_hash: 'a'.repeat(64),
      account_status: 'pending',
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      revoked_at: null,
    }],
    ['b'.repeat(64), {
      id: INVITATION_B,
      account_id: ACCOUNT_ID,
      token_hash: 'b'.repeat(64),
      account_status: 'pending',
      expires_at: new Date(Date.now() + 60_000),
      consumed_at: null,
      revoked_at: null,
    }],
  ]);
  const queryable = {
    query: async (sql, params = []) => {
      if (/SELECT i\.\*, a\.status AS account_status/.test(sql)) {
        const invitation = invitations.get(params[0]);
        return { rows: invitation ? [{ ...invitation }] : [] };
      }
      if (/UPDATE admin_accounts/.test(sql)) {
        return {
          rows: [{
            id: ACCOUNT_ID,
            status: 'active',
            session_version: 2,
          }],
        };
      }
      if (/SET consumed_at = NOW\(\)/.test(sql)) {
        for (const invitation of invitations.values()) {
          if (invitation.id === params[0]) invitation.consumed_at = new Date();
        }
        return { rows: [], rowCount: 1 };
      }
      if (/WHERE account_id = \$1 AND id <> \$2/.test(sql)) {
        for (const invitation of invitations.values()) {
          if (invitation.account_id === params[0] && invitation.id !== params[1]
              && !invitation.consumed_at && !invitation.revoked_at) {
            invitation.revoked_at = new Date();
          }
        }
        return { rows: [], rowCount: 1 };
      }
      if (/UPDATE admin_sessions/.test(sql)) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected-query:${sql}`);
    },
  };
  const repository = createAdminAuthRepository(queryable);
  await repository.activate({
    tokenHash: 'a'.repeat(64),
    passwordHash: 'hash',
    passwordSalt: 'salt',
    passwordScheme: 'scrypt-v2',
    displayName: 'Member',
  });
  assert.ok(invitations.get('b'.repeat(64)).revoked_at);
  await assert.rejects(repository.activate({
    tokenHash: 'b'.repeat(64),
    passwordHash: 'new-hash',
    passwordSalt: 'new-salt',
    passwordScheme: 'scrypt-v2',
    displayName: 'Member',
  }), /invalid-or-expired-invitation/);
});

test('migration deduplicates active invitations before adding the partial unique index', async () => {
  const migration = await readFile(new URL(
    './storage/postgres/migrations/002_commercial_admin.sql',
    import.meta.url,
  ), 'utf8');
  const dedupe = migration.indexOf('ranked_active_invitations');
  const unique = migration.indexOf('admin_invitations_one_active_per_account_idx');
  assert.ok(dedupe > 0);
  assert.ok(unique > dedupe);
  assert.match(migration, new RegExp(
    'CREATE UNIQUE INDEX IF NOT EXISTS admin_invitations_one_active_per_account_idx'
      + '[\\s\\S]{0,180}WHERE consumed_at IS NULL AND revoked_at IS NULL',
  ));
});
