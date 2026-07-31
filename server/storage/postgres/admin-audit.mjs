import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import {
  jsonValue,
  mapRow,
  optionalText,
  requireText,
  validDate,
} from './repository-utils.mjs';

function pagination(page, pageSize) {
  const selectedPage = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const selectedSize = Number.isSafeInteger(pageSize) && pageSize > 0 && pageSize <= 100
    ? pageSize : 20;
  return {
    page: selectedPage,
    pageSize: selectedSize,
    offset: (selectedPage - 1) * selectedSize,
  };
}

function exclusiveUpperBound(value, parsed) {
  const increment = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? 86_400_000 : 1;
  return new Date(parsed.getTime() + increment);
}

export function createAdminAuditRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    async overview() {
      const result = await queryable.query(`
        SELECT
          (SELECT COUNT(*)::INTEGER FROM users) AS users,
          (SELECT COUNT(*)::INTEGER FROM user_subscriptions
            WHERE status IN ('trialing', 'active')
              AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW()))
            AS active_subscriptions,
          (SELECT COUNT(*)::INTEGER FROM admin_accounts WHERE status = 'active')
            AS active_admins,
          (SELECT COALESCE(SUM(p.amount), 0)::TEXT
            FROM point_postings p
            JOIN point_wallets w ON w.id = p.wallet_id
            WHERE w.owner_type = 'user' AND p.amount > 0) AS points_issued,
          (SELECT COUNT(*)::INTEGER FROM cdk_redemptions) AS cdk_redeemed
      `);
      return mapRow(result.rows[0]);
    },

    async recordAudit(input) {
      const result = await queryable.query(`
        INSERT INTO admin_audit_events (
          id, actor_account_id, action, target_type, target_id, outcome,
          request_id, ip_hash, user_agent_hash, before_state, after_state, details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::JSONB, $11::JSONB, $12::JSONB)
        RETURNING *
      `, [
        uuid(),
        input.actorAccountId ? assertUuid(input.actorAccountId, 'actor-id') : null,
        requireText(input.action, 'audit-action', 100),
        optionalText(input.targetType, 'target-type', 80),
        optionalText(input.targetId, 'target-id', 160),
        requireText(input.outcome, 'audit-outcome', 32),
        requireText(input.requestId, 'request-id', 80),
        input.ipHash ?? null,
        input.userAgentHash ?? null,
        input.beforeState == null ? null : jsonValue(input.beforeState, 'before-state'),
        input.afterState == null ? null : jsonValue(input.afterState, 'after-state'),
        jsonValue(input.details ?? {}, 'audit-details'),
      ]);
      return mapRow(result.rows[0]);
    },

    async listAudit({
      page,
      pageSize,
      action: actionInput = null,
      targetType: targetTypeInput = null,
      actor: actorInput = null,
      from: fromInput = null,
      to: toInput = null,
    }) {
      const paging = pagination(page, pageSize);
      const action = optionalText(actionInput, 'audit-action-filter', 100) ?? '';
      const targetType = optionalText(targetTypeInput, 'audit-target-filter', 80) ?? '';
      const actor = optionalText(actorInput, 'audit-actor-filter', 254) ?? '';
      const from = fromInput ? validDate(fromInput, 'audit-from') : null;
      const selectedTo = toInput ? validDate(toInput, 'audit-to') : null;
      if (from && selectedTo && from > selectedTo) throw new Error('invalid-audit-date-range');
      const to = selectedTo ? exclusiveUpperBound(toInput, selectedTo) : null;
      const values = [action, targetType, actor, from, to, paging.pageSize, paging.offset];
      const where = `
        WHERE ($1 = '' OR e.action = $1)
          AND ($2 = '' OR e.target_type = $2)
          AND (
            $3 = ''
            OR COALESCE(a.email_normalized, '') ILIKE '%' || LOWER($3) || '%'
            OR COALESCE(e.actor_account_id::TEXT, '') = $3
          )
          AND ($4::TIMESTAMPTZ IS NULL OR e.occurred_at >= $4)
          AND ($5::TIMESTAMPTZ IS NULL OR e.occurred_at < $5)
      `;
      const [rows, count] = await Promise.all([
        queryable.query(`
          SELECT e.*, a.email AS actor_email
          FROM admin_audit_events e
          LEFT JOIN admin_accounts a ON a.id = e.actor_account_id
          ${where}
          ORDER BY e.occurred_at DESC
          LIMIT $6 OFFSET $7
        `, values),
        queryable.query(`
          SELECT COUNT(*)::INTEGER AS total
          FROM admin_audit_events e
          LEFT JOIN admin_accounts a ON a.id = e.actor_account_id
          ${where}
        `, values.slice(0, 5)),
      ]);
      return {
        items: rows.rows.map(mapRow),
        total: count.rows[0].total,
        page: paging.page,
        pageSize: paging.pageSize,
      };
    },
  });
}
