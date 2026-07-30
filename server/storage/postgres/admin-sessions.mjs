import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { mapRow, validDate } from './repository-utils.mjs';

export function createAdminSessionRepository(
  queryable,
  { uuid = stableUuid, hashValue } = {},
) {
  if (!hashValue) throw new Error('admin-session-hash-validator-required');
  return Object.freeze({
    async createSession(input) {
      const accountId = assertUuid(input.accountId, 'admin-account-id');
      const result = await queryable.query(`
        INSERT INTO admin_sessions (
          id, account_id, token_hash, csrf_hash, session_version,
          ip_hash, user_agent_hash, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        uuid(),
        accountId,
        hashValue(input.tokenHash, 'session-token-hash'),
        hashValue(input.csrfHash, 'csrf-hash'),
        input.sessionVersion,
        input.ipHash ? hashValue(input.ipHash, 'ip-hash') : null,
        input.userAgentHash ? hashValue(input.userAgentHash, 'user-agent-hash') : null,
        validDate(input.expiresAt, 'session-expiry'),
      ]);
      return mapRow(result.rows[0]);
    },

    async findSession(tokenHash) {
      const result = await queryable.query(`
        SELECT s.*, a.email, a.email_normalized, a.display_name, a.status,
               a.is_owner, a.session_version AS account_session_version
        FROM admin_sessions s
        JOIN admin_accounts a ON a.id = s.account_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
      `, [hashValue(tokenHash, 'session-token-hash')]);
      return mapRow(result.rows[0]);
    },

    async touchSession(rawId) {
      const id = assertUuid(rawId, 'admin-session-id');
      await queryable.query(
        'UPDATE admin_sessions SET last_seen_at = NOW() WHERE id = $1 AND revoked_at IS NULL',
        [id],
      );
    },

    async rotateCsrf(rawId, csrfHash) {
      const id = assertUuid(rawId, 'admin-session-id');
      const result = await queryable.query(`
        UPDATE admin_sessions
        SET csrf_hash = $2, last_seen_at = NOW()
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING *
      `, [id, hashValue(csrfHash, 'csrf-hash')]);
      if (!result.rows[0]) throw new Error('admin-session-expired');
      return mapRow(result.rows[0]);
    },

    async revokeSession(tokenHash) {
      const result = await queryable.query(`
        UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE token_hash = $1 RETURNING id
      `, [hashValue(tokenHash, 'session-token-hash')]);
      return result.rowCount > 0;
    },

    async revokeAccountSessions(rawAccountId) {
      const accountId = assertUuid(rawAccountId, 'admin-account-id');
      const result = await queryable.query(`
        UPDATE admin_sessions SET revoked_at = COALESCE(revoked_at, NOW())
        WHERE account_id = $1 AND revoked_at IS NULL
      `, [accountId]);
      return result.rowCount;
    },
  });
}
