import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminRbacRepository } from './storage/postgres/admin-rbac.mjs';

const ROLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PERMISSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('changing role permissions bumps members and revokes their sessions', async () => {
  const queries = [];
  const repository = createAdminRbacRepository({
    query: async (sql, values) => {
      queries.push({ sql, values });
      if (/UPDATE admin_roles/.test(sql)) {
        return {
          rows: [{
            id: ROLE_ID,
            code: 'support',
            name: 'Support',
            description: '',
            version: 2,
          }],
        };
      }
      if (/SELECT id, permission_key FROM admin_permissions/.test(sql)) {
        return {
          rows: [{
            id: PERMISSION_ID,
            permission_key: 'users.read',
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    },
  });
  await repository.updateRole(ROLE_ID, {
    name: 'Support',
    description: 'Read-only support',
    version: 1,
    permissionKeys: ['users.read'],
  });
  const invalidation = queries.find(({ sql }) => /WITH bumped AS/.test(sql));
  assert.ok(invalidation);
  assert.match(invalidation.sql, /session_version = a\.session_version \+ 1/);
  assert.match(invalidation.sql, /a\.is_owner = FALSE/);
  assert.match(invalidation.sql, /UPDATE admin_sessions s/);
  assert.match(invalidation.sql, /SET revoked_at = COALESCE\(s\.revoked_at, NOW\(\)\)/);
  assert.deepEqual(invalidation.values, [ROLE_ID]);
});
