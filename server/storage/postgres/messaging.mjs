import { assertUuid, stableUuid } from '../contact-crypto.mjs';
import {
  jsonValue,
  mapRow,
  requireText,
  validDate,
} from './repository-utils.mjs';

const HASH_PATTERN = /^[0-9a-f]{64}$/i;

function optionalHash(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) throw new Error(`invalid-${label}`);
  return value.toLowerCase();
}

function optionalBody(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 5_000_000 || value.includes('\u0000')) {
    throw new Error(`invalid-${label}`);
  }
  return value.normalize('NFC');
}

export function createInboundEmailRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    async create(input) {
      const id = assertUuid(input.id ?? uuid(), 'inbound-email-id');
      const userId = assertUuid(input.userId, 'user-id');
      const providerMessageId = requireText(input.providerMessageId, 'provider-message-id', 255);
      const fromAddress = requireText(input.fromAddress, 'from-address', 1_000);
      if (!Array.isArray(input.toAddresses) || input.toAddresses.length === 0) {
        throw new Error('invalid-to-addresses');
      }
      const toAddresses = input.toAddresses
        .map((value) => requireText(value, 'to-address', 1_000));
      const subject = typeof input.subject === 'string'
        ? input.subject.normalize('NFC').slice(0, 10_000)
        : '';
      if (subject.includes('\u0000')) throw new Error('invalid-subject');
      const textBody = optionalBody(input.textBody, 'text-body');
      const htmlBody = optionalBody(input.htmlBody, 'html-body');
      const headers = jsonValue(input.headers ?? {}, 'email-headers');
      const receivedAt = validDate(input.receivedAt, 'received-at');
      const result = await queryable.query(`
        INSERT INTO inbound_emails (
          id, user_id, provider_message_id, from_address, to_addresses,
          subject, text_body, html_body, headers, received_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::JSONB, $10)
        ON CONFLICT (provider_message_id) DO NOTHING
        RETURNING *
      `, [
        id,
        userId,
        providerMessageId,
        fromAddress,
        toAddresses,
        subject,
        textBody,
        htmlBody,
        headers,
        receivedAt,
      ]);
      return mapRow(result.rows[0]);
    },

    async findByProviderId(value) {
      const providerMessageId = requireText(value, 'provider-message-id', 255);
      const result = await queryable.query(
        'SELECT * FROM inbound_emails WHERE provider_message_id = $1',
        [providerMessageId],
      );
      return mapRow(result.rows[0]);
    },
  });
}

export function createAuthAuditRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    async record(input) {
      const id = assertUuid(input.id ?? uuid(), 'audit-id');
      const userId = input.userId ? assertUuid(input.userId, 'user-id') : null;
      const action = requireText(input.action, 'audit-action', 80);
      const outcome = requireText(input.outcome, 'audit-outcome', 40);
      const actorHash = optionalHash(input.actorHash, 'actor-hash');
      const ipHash = optionalHash(input.ipHash, 'ip-hash');
      const details = jsonValue(input.details ?? {}, 'audit-details');
      const result = await queryable.query(`
        INSERT INTO auth_audit_events (
          id, user_id, action, outcome, actor_hash, ip_hash, details, occurred_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, COALESCE($8, NOW()))
        RETURNING *
      `, [
        id,
        userId,
        action,
        outcome,
        actorHash,
        ipHash,
        details,
        input.occurredAt ? validDate(input.occurredAt, 'occurred-at') : null,
      ]);
      return mapRow(result.rows[0]);
    },
  });
}
