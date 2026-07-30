import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { mapRow, optionalText, requireText, validDate } from './repository-utils.mjs';
import { createAdminSessionRepository } from './admin-sessions.mjs';

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function hashValue(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) throw new Error(`invalid-${label}`);
  return value;
}

function accountStatus(value) {
  if (!['pending', 'active', 'suspended'].includes(value)) {
    throw new Error('invalid-admin-status');
  }
  return value;
}

export function createAdminAuthRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    ...createAdminSessionRepository(queryable, { uuid, hashValue }),
    async ensureOwner({ email, displayName }) {
      const normalized = requireText(email, 'owner-email', 254).toLowerCase();
      const existingOwner = await queryable.query(
        'SELECT * FROM admin_accounts WHERE is_owner = TRUE FOR UPDATE',
      );
      if (existingOwner.rows[0]) {
        const owner = mapRow(existingOwner.rows[0]);
        if (owner.emailNormalized !== normalized) throw new Error('owner-email-conflict');
        return owner;
      }
      const existingEmail = await queryable.query(
        'SELECT * FROM admin_accounts WHERE email_normalized = $1 FOR UPDATE',
        [normalized],
      );
      if (existingEmail.rows[0]) {
        const result = await queryable.query(`
          UPDATE admin_accounts
          SET is_owner = TRUE, status = CASE WHEN status = 'suspended' THEN 'pending' ELSE status END,
              suspended_at = NULL, session_version = session_version + 1, updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `, [existingEmail.rows[0].id]);
        return mapRow(result.rows[0]);
      }
      const result = await queryable.query(`
        INSERT INTO admin_accounts (
          id, email, email_normalized, display_name, status, is_owner
        )
        VALUES ($1, $2, $2, $3, 'pending', TRUE)
        RETURNING *
      `, [uuid(), normalized, optionalText(displayName, 'owner-display-name', 120)]);
      return mapRow(result.rows[0]);
    },

    async findAccountByEmail(email) {
      const normalized = requireText(email, 'admin-email', 254).toLowerCase();
      const result = await queryable.query(
        'SELECT * FROM admin_accounts WHERE email_normalized = $1',
        [normalized],
      );
      return mapRow(result.rows[0]);
    },

    async findAccountById(rawId) {
      const id = assertUuid(rawId, 'admin-account-id');
      const result = await queryable.query('SELECT * FROM admin_accounts WHERE id = $1', [id]);
      return mapRow(result.rows[0]);
    },

    async lockAccountForSession(rawId) {
      const id = assertUuid(rawId, 'admin-account-id');
      const result = await queryable.query(
        'SELECT * FROM admin_accounts WHERE id = $1 FOR UPDATE',
        [id],
      );
      return mapRow(result.rows[0]);
    },

    async createAccount({ email, displayName = null, createdBy = null }) {
      const normalized = requireText(email, 'admin-email', 254).toLowerCase();
      if (createdBy) assertUuid(createdBy, 'creator-id');
      const result = await queryable.query(`
        INSERT INTO admin_accounts (
          id, email, email_normalized, display_name, status
        )
        VALUES ($1, $2, $2, $3, 'pending')
        RETURNING *
      `, [uuid(), normalized, optionalText(displayName, 'display-name', 120)]);
      return mapRow(result.rows[0]);
    },

    async createInvitation({ accountId: rawAccountId, tokenHash, createdBy, expiresAt }) {
      const accountId = assertUuid(rawAccountId, 'admin-account-id');
      const creator = createdBy ? assertUuid(createdBy, 'creator-id') : null;
      const account = await queryable.query(
        'SELECT id, status FROM admin_accounts WHERE id = $1 FOR UPDATE',
        [accountId],
      );
      if (!account.rows[0]) throw new Error('admin-account-not-found');
      if (account.rows[0].status !== 'pending') throw new Error('admin-already-active');
      await queryable.query(`
        UPDATE admin_invitations SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE account_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
      `, [accountId]);
      const result = await queryable.query(`
        INSERT INTO admin_invitations (
          id, account_id, token_hash, created_by, expires_at
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [
        uuid(),
        accountId,
        hashValue(tokenHash, 'invitation-token-hash'),
        creator,
        validDate(expiresAt, 'invitation-expiry'),
      ]);
      return mapRow(result.rows[0]);
    },

    async markInvitationSent(rawId) {
      const id = assertUuid(rawId, 'invitation-id');
      const result = await queryable.query(`
        UPDATE admin_invitations SET sent_at = COALESCE(sent_at, NOW())
        WHERE id = $1 AND revoked_at IS NULL AND consumed_at IS NULL
        RETURNING *
      `, [id]);
      return mapRow(result.rows[0]);
    },

    async revokeInvitation(rawId) {
      const id = assertUuid(rawId, 'invitation-id');
      const result = await queryable.query(`
        UPDATE admin_invitations SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE id = $1 AND consumed_at IS NULL
        RETURNING *
      `, [id]);
      return mapRow(result.rows[0]);
    },

    async activeInvitationForAccount(rawAccountId) {
      const accountId = assertUuid(rawAccountId, 'admin-account-id');
      const result = await queryable.query(`
        SELECT * FROM admin_invitations
        WHERE account_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
          AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1
      `, [accountId]);
      return mapRow(result.rows[0]);
    },

    async findInvitation(rawId) {
      const id = assertUuid(rawId, 'invitation-id');
      const result = await queryable.query(`
        SELECT i.*, a.email, a.display_name, a.status AS account_status
        FROM admin_invitations i
        JOIN admin_accounts a ON a.id = i.account_id
        WHERE i.id = $1
      `, [id]);
      return mapRow(result.rows[0]);
    },

    async invitationIsUsable(tokenHash) {
      const result = await queryable.query(`
        SELECT 1
        FROM admin_invitations i
        JOIN admin_accounts a ON a.id = i.account_id
        WHERE i.token_hash = $1 AND i.consumed_at IS NULL AND i.revoked_at IS NULL
          AND i.expires_at > NOW() AND a.status <> 'suspended'
      `, [hashValue(tokenHash, 'invitation-token-hash')]);
      return Boolean(result.rows[0]);
    },

    async activate({ tokenHash, passwordHash, passwordSalt, passwordScheme, displayName }) {
      const result = await queryable.query(`
        SELECT i.*, a.status AS account_status, a.is_owner
        FROM admin_invitations i
        JOIN admin_accounts a ON a.id = i.account_id
        WHERE i.token_hash = $1
        FOR UPDATE OF i, a
      `, [hashValue(tokenHash, 'invitation-token-hash')]);
      const invitation = result.rows[0];
      if (!invitation || invitation.consumed_at || invitation.revoked_at
          || new Date(invitation.expires_at).getTime() <= Date.now()) {
        throw new Error('invalid-or-expired-invitation');
      }
      if (invitation.account_status === 'suspended') throw new Error('account-suspended');
      const updated = await queryable.query(`
        UPDATE admin_accounts
        SET password_hash = $2, password_salt = $3, password_scheme = $4,
            display_name = COALESCE($5, display_name), status = 'active',
            activated_at = COALESCE(activated_at, NOW()), suspended_at = NULL,
            session_version = session_version + 1, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [
        invitation.account_id,
        requireText(passwordHash, 'password-hash'),
        requireText(passwordSalt, 'password-salt', 255),
        requireText(passwordScheme, 'password-scheme', 40),
        optionalText(displayName, 'display-name', 120),
      ]);
      await queryable.query(
        'UPDATE admin_invitations SET consumed_at = NOW() WHERE id = $1',
        [invitation.id],
      );
      await queryable.query(`
        UPDATE admin_invitations
        SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE account_id = $1 AND id <> $2
          AND consumed_at IS NULL AND revoked_at IS NULL
      `, [invitation.account_id, invitation.id]);
      await queryable.query(`
        UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE account_id = $1 AND revoked_at IS NULL
      `, [invitation.account_id]);
      return mapRow(updated.rows[0]);
    },

    async markLogin(rawAccountId) {
      const accountId = assertUuid(rawAccountId, 'admin-account-id');
      await queryable.query(
        'UPDATE admin_accounts SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1',
        [accountId],
      );
    },

    async setStatus(rawId, status) {
      const id = assertUuid(rawId, 'admin-account-id');
      const selected = accountStatus(status);
      const result = await queryable.query(`
        UPDATE admin_accounts
        SET status = $2,
            suspended_at = CASE WHEN $2 = 'suspended' THEN NOW() ELSE NULL END,
            session_version = session_version + 1, updated_at = NOW()
        WHERE id = $1 AND is_owner = FALSE
          AND ($2 <> 'active' OR password_hash IS NOT NULL)
        RETURNING *
      `, [id, selected]);
      if (!result.rows[0]) throw new Error('owner-protected-or-not-found');
      await queryable.query(`
        UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE account_id = $1 AND revoked_at IS NULL
      `, [id]);
      return mapRow(result.rows[0]);
    },
  });
}
