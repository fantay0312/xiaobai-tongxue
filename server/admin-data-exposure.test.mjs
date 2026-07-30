import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { handleAdminBusinessRoute } from './admin/business-router.mjs';

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('admin user JSON cannot expose password or session credentials', async () => {
  let response;
  const handled = await handleAdminBusinessRoute({
    req: { method: 'GET' },
    pathname: '/api/admin/v1/users',
    url: new URL('https://admin.example.com/api/admin/v1/users'),
    principal: { permissions: ['users.read'] },
    postgres: {
      userAccess: {
        listUsers: async () => ({
          items: [{
            id: USER_ID,
            source: 'postgres',
            username: 'student',
            displayName: 'Student',
            disabledAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-07-30T00:00:00.000Z',
            restrictions: [],
            passwordHash: 'must-not-leak',
            passwordSalt: 'must-not-leak',
            passwordScheme: 'must-not-leak',
            sessionVersion: 99,
          }],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      },
    },
    send: (status, payload) => { response = { status, payload }; },
  });
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  const json = JSON.stringify(response.payload);
  for (const forbidden of [
    'passwordHash', 'passwordSalt', 'passwordScheme', 'sessionVersion', 'must-not-leak',
  ]) {
    assert.equal(json.includes(forbidden), false);
  }
});

test('admin list repositories select explicit safe columns', async () => {
  const [users, rbac] = await Promise.all([
    readFile(new URL('./storage/postgres/user-access.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./storage/postgres/admin-rbac.mjs', import.meta.url), 'utf8'),
  ]);
  const userListing = users.slice(0, users.indexOf('async addRestriction'));
  assert.doesNotMatch(userListing, /SELECT\s+u\.\*/i);
  assert.doesNotMatch(userListing, /RETURNING\s+\*/i);
  const operators = rbac.slice(
    rbac.indexOf('async listOperators'),
    rbac.indexOf('async overview'),
  );
  assert.doesNotMatch(operators, /SELECT\s+a\.\*/i);
  assert.doesNotMatch(operators, /SELECT\s+i\.\*/i);
  assert.doesNotMatch(operators, /token_hash|password_hash|password_salt|password_scheme/i);
});
