import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import { mapRow, optionalText, requireText, validDate } from './repository-utils.mjs';

const SCOPES = new Set([
  'all', 'login', 'chat', 'asr', 'vision', 'state', 'transcript', 'commerce',
]);
const SAFE_USER_COLUMNS = `
  u.id, u.source, u.username, u.display_name,
  u.disabled_at, u.created_at, u.updated_at
`;

function paging(page, pageSize) {
  const selectedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const selectedSize = Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100
    ? pageSize : 20;
  return { page: selectedPage, pageSize: selectedSize, offset: (selectedPage - 1) * selectedSize };
}

export function createUserAccessRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    async listUsers({ page, pageSize, query = '', status: statusInput = '' }) {
      const selected = paging(page, pageSize);
      const search = typeof query === 'string' ? query.trim().slice(0, 120) : '';
      const status = typeof statusInput === 'string' ? statusInput.trim() : '';
      if (status && !['active', 'banned'].includes(status)) throw new Error('invalid-user-status');
      const [rows, count] = await Promise.all([
        queryable.query(`
          SELECT ${SAFE_USER_COLUMNS},
            COALESCE(
              JSONB_AGG(
                JSONB_BUILD_OBJECT(
                  'id', r.id, 'scope', r.scope, 'reason', r.reason,
                  'publicReason', r.public_reason, 'startsAt', r.starts_at,
                  'expiresAt', r.expires_at, 'createdAt', r.created_at
                ) ORDER BY r.created_at DESC
              ) FILTER (
                WHERE r.id IS NOT NULL AND r.revoked_at IS NULL
                  AND r.starts_at <= NOW() AND (r.expires_at IS NULL OR r.expires_at > NOW())
              ),
              '[]'::JSONB
            ) AS restrictions
          FROM users u
          LEFT JOIN user_restrictions r ON r.user_id = u.id
          WHERE ($1 = '' OR u.username_normalized LIKE '%' || LOWER($1) || '%'
            OR COALESCE(u.display_name, '') ILIKE '%' || $1 || '%')
            AND ($4 = ''
              OR ($4 = 'active' AND u.disabled_at IS NULL)
              OR ($4 = 'banned' AND u.disabled_at IS NOT NULL))
          GROUP BY u.id
          ORDER BY u.created_at DESC
          LIMIT $2 OFFSET $3
        `, [search, selected.pageSize, selected.offset, status]),
        queryable.query(`
          SELECT COUNT(*)::INTEGER AS total
          FROM users
          WHERE ($1 = '' OR username_normalized LIKE '%' || LOWER($1) || '%'
            OR COALESCE(display_name, '') ILIKE '%' || $1 || '%')
            AND ($2 = ''
              OR ($2 = 'active' AND disabled_at IS NULL)
              OR ($2 = 'banned' AND disabled_at IS NOT NULL))
        `, [search, status]),
      ]);
      return {
        items: rows.rows.map(mapRow),
        total: count.rows[0].total,
        page: selected.page,
        pageSize: selected.pageSize,
      };
    },

    async setDisabled(rawUserId, disabled) {
      const userId = assertUuid(rawUserId, 'user-id');
      const result = await queryable.query(`
        UPDATE users
        SET disabled_at = CASE WHEN $2::BOOLEAN THEN COALESCE(disabled_at, NOW()) ELSE NULL END,
            session_version = session_version + 1, updated_at = NOW()
        WHERE id = $1
        RETURNING id, source, username, display_name, disabled_at, created_at, updated_at
      `, [userId, disabled === true]);
      if (!result.rows[0]) throw new Error('user-not-found');
      return mapRow(result.rows[0]);
    },

    async addRestriction(input) {
      const userId = assertUuid(input.userId, 'user-id');
      const actorId = assertUuid(input.createdBy, 'actor-id');
      if (!SCOPES.has(input.scope)) throw new Error('invalid-restriction-scope');
      const startsAt = input.startsAt ? validDate(input.startsAt, 'restriction-start') : new Date();
      const expiresAt = input.expiresAt ? validDate(input.expiresAt, 'restriction-expiry') : null;
      if (expiresAt && expiresAt <= startsAt) throw new Error('invalid-restriction-expiry');
      const result = await queryable.query(`
        INSERT INTO user_restrictions (
          id, user_id, scope, reason, public_reason,
          starts_at, expires_at, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        uuid(),
        userId,
        input.scope,
        requireText(input.reason, 'restriction-reason', 2_000),
        optionalText(input.publicReason, 'public-reason', 500) ?? '',
        startsAt,
        expiresAt,
        actorId,
      ]);
      return mapRow(result.rows[0]);
    },

    async revokeRestriction(rawUserId, rawRestrictionId, actorId) {
      const userId = assertUuid(rawUserId, 'user-id');
      const id = assertUuid(rawRestrictionId, 'restriction-id');
      const actor = assertUuid(actorId, 'actor-id');
      const result = await queryable.query(`
        UPDATE user_restrictions
        SET revoked_at = COALESCE(revoked_at, NOW()), revoked_by = $3
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
        RETURNING *
      `, [id, userId, actor]);
      if (!result.rows[0]) throw new Error('restriction-not-found');
      return mapRow(result.rows[0]);
    },

    async listActiveRestrictions() {
      const result = await queryable.query(`
        SELECT * FROM user_restrictions
        WHERE revoked_at IS NULL AND starts_at <= NOW()
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY user_id, scope, created_at
      `);
      return result.rows.map(mapRow);
    },

    async activeRestriction(rawUserId, scope) {
      const userId = assertUuid(rawUserId, 'user-id');
      if (!SCOPES.has(scope)) throw new Error('invalid-restriction-scope');
      const result = await queryable.query(`
        SELECT * FROM user_restrictions
        WHERE user_id = $1 AND scope IN ('all', $2)
          AND revoked_at IS NULL AND starts_at <= NOW()
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY CASE WHEN scope = 'all' THEN 0 ELSE 1 END, created_at DESC
        LIMIT 1
      `, [userId, scope]);
      return mapRow(result.rows[0]);
    },
  });
}
