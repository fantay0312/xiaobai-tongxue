import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { mapRow, optionalText, requireText } from './repository-utils.mjs';
import { createAdminAuditRepository } from './admin-audit.mjs';

function roleCode(value) {
  const code = requireText(value, 'role-code', 80).toLowerCase();
  if (!/^[a-z][a-z0-9._-]*$/.test(code)) throw new Error('invalid-role-code');
  return code;
}

function permissionKey(value) {
  const key = requireText(value, 'permission-key', 100).toLowerCase();
  if (!/^[a-z][a-z0-9._-]*$/.test(key)) throw new Error('invalid-permission-key');
  return key;
}

async function replacePermissions(queryable, roleId, keys) {
  if (!Array.isArray(keys) || keys.length > 200) throw new Error('invalid-permissions');
  const normalized = [...new Set(keys.map(permissionKey))];
  await queryable.query('DELETE FROM admin_role_permissions WHERE role_id = $1', [roleId]);
  if (normalized.length === 0) return;
  const result = await queryable.query(
    'SELECT id, permission_key FROM admin_permissions WHERE permission_key = ANY($1::TEXT[])',
    [normalized],
  );
  if (result.rows.length !== normalized.length) throw new Error('unknown-permission');
  for (const row of result.rows) {
    await queryable.query(`
      INSERT INTO admin_role_permissions (role_id, permission_id)
      VALUES ($1, $2)
    `, [roleId, row.id]);
  }
}

async function invalidateRoleMembers(queryable, roleId) {
  await queryable.query(`
    WITH bumped AS (
      UPDATE admin_accounts a
      SET session_version = a.session_version + 1, updated_at = NOW()
      WHERE a.is_owner = FALSE AND EXISTS (
        SELECT 1 FROM admin_account_roles ar
        WHERE ar.account_id = a.id AND ar.role_id = $1
      )
      RETURNING a.id
    )
    UPDATE admin_sessions s
    SET revoked_at = COALESCE(s.revoked_at, NOW())
    WHERE s.revoked_at IS NULL AND s.account_id IN (SELECT id FROM bumped)
  `, [roleId]);
}

export function createAdminRbacRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    ...createAdminAuditRepository(queryable, { uuid }),
    async ensurePermissions(items) {
      for (const item of items) {
        await queryable.query(`
          INSERT INTO admin_permissions (id, permission_key, name, description)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (permission_key) DO UPDATE SET
            name = EXCLUDED.name, description = EXCLUDED.description
        `, [
          uuid(),
          permissionKey(item.key),
          requireText(item.name, 'permission-name', 120),
          optionalText(item.description, 'permission-description', 2_000) ?? '',
        ]);
      }
    },

    async listPermissions() {
      const result = await queryable.query(
        'SELECT * FROM admin_permissions ORDER BY permission_key',
      );
      return result.rows.map(mapRow);
    },

    async accountAccess(rawAccountId) {
      const accountId = assertUuid(rawAccountId, 'admin-account-id');
      const roles = await queryable.query(`
        SELECT r.*
        FROM admin_roles r
        JOIN admin_account_roles ar ON ar.role_id = r.id
        WHERE ar.account_id = $1
        ORDER BY r.name, r.code
      `, [accountId]);
      const permissions = await queryable.query(`
        SELECT DISTINCT p.permission_key
        FROM admin_permissions p
        JOIN admin_role_permissions rp ON rp.permission_id = p.id
        JOIN admin_account_roles ar ON ar.role_id = rp.role_id
        WHERE ar.account_id = $1
        ORDER BY p.permission_key
      `, [accountId]);
      return {
        roles: roles.rows.map(mapRow),
        permissions: permissions.rows.map((row) => row.permission_key),
      };
    },

    async listRoles() {
      const result = await queryable.query(`
        SELECT r.*,
          COALESCE(
            JSONB_AGG(p.permission_key ORDER BY p.permission_key)
              FILTER (WHERE p.permission_key IS NOT NULL),
            '[]'::JSONB
          ) AS permission_keys,
          COUNT(DISTINCT ar.account_id)::INTEGER AS member_count
        FROM admin_roles r
        LEFT JOIN admin_role_permissions rp ON rp.role_id = r.id
        LEFT JOIN admin_permissions p ON p.id = rp.permission_id
        LEFT JOIN admin_account_roles ar ON ar.role_id = r.id
        GROUP BY r.id
        ORDER BY r.name, r.code
      `);
      return result.rows.map(mapRow);
    },

    async createRole(input) {
      const id = uuid();
      const creator = assertUuid(input.createdBy, 'creator-id');
      const result = await queryable.query(`
        INSERT INTO admin_roles (id, code, name, description, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [
        id,
        roleCode(input.code),
        requireText(input.name, 'role-name', 120),
        optionalText(input.description, 'role-description', 2_000) ?? '',
        creator,
      ]);
      await replacePermissions(queryable, id, input.permissionKeys ?? []);
      return mapRow(result.rows[0]);
    },

    async updateRole(rawId, input) {
      const id = assertUuid(rawId, 'role-id');
      const version = Number(input.version);
      if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalid-role-version');
      const result = await queryable.query(`
        UPDATE admin_roles
        SET name = $2, description = $3, version = version + 1, updated_at = NOW()
        WHERE id = $1 AND version = $4
        RETURNING *
      `, [
        id,
        requireText(input.name, 'role-name', 120),
        optionalText(input.description, 'role-description', 2_000) ?? '',
        version,
      ]);
      if (!result.rows[0]) throw new Error('role-conflict-or-not-found');
      if (input.permissionKeys) {
        await replacePermissions(queryable, id, input.permissionKeys);
        await invalidateRoleMembers(queryable, id);
      }
      return mapRow(result.rows[0]);
    },

    async replaceRolePermissions(rawRoleId, keys) {
      const roleId = assertUuid(rawRoleId, 'role-id');
      await replacePermissions(queryable, roleId, keys);
      await invalidateRoleMembers(queryable, roleId);
    },

    async assignRoles(rawAccountId, roleIds, assignedBy) {
      const accountId = assertUuid(rawAccountId, 'admin-account-id');
      const actorId = assertUuid(assignedBy, 'assigner-id');
      if (!Array.isArray(roleIds) || roleIds.length > 50) throw new Error('invalid-role-ids');
      const unique = [...new Set(roleIds.map((id) => assertUuid(id, 'role-id')))];
      await queryable.query('DELETE FROM admin_account_roles WHERE account_id = $1', [accountId]);
      if (unique.length === 0) return;
      const found = await queryable.query(
        'SELECT id FROM admin_roles WHERE id = ANY($1::UUID[])',
        [unique],
      );
      if (found.rows.length !== unique.length) throw new Error('unknown-role');
      for (const roleId of unique) {
        await queryable.query(`
          INSERT INTO admin_account_roles (account_id, role_id, assigned_by)
          VALUES ($1, $2, $3)
        `, [accountId, roleId, actorId]);
      }
      await queryable.query(`
        UPDATE admin_accounts
        SET session_version = session_version + 1, updated_at = NOW()
        WHERE id = $1 AND is_owner = FALSE
      `, [accountId]);
    },

    async listOperators() {
      const result = await queryable.query(`
        SELECT a.id, a.email, a.display_name, a.status, a.is_owner,
          a.activated_at, a.last_login_at, a.created_at,
          COALESCE(
            JSONB_AGG(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL),
            '[]'::JSONB
          ) AS roles
        FROM admin_accounts a
        LEFT JOIN admin_account_roles ar ON ar.account_id = a.id
        LEFT JOIN admin_roles r ON r.id = ar.role_id
        GROUP BY a.id
        ORDER BY a.is_owner DESC, a.created_at
      `);
      return result.rows.map(mapRow);
    },

    async listInvitations() {
      const result = await queryable.query(`
        SELECT i.id, i.account_id, i.created_by, i.expires_at,
          i.consumed_at, i.revoked_at, i.sent_at, i.created_at,
          a.email, a.display_name
        FROM admin_invitations i
        JOIN admin_accounts a ON a.id = i.account_id
        ORDER BY i.created_at DESC
        LIMIT 200
      `);
      return result.rows.map(mapRow);
    },

  });
}
