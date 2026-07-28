import { stableUuid, assertUuid } from '../contact-crypto.mjs';
import { mapRow, optionalText, requireText, validDate } from './repository-utils.mjs';

function normalizeUsername(value) {
  return requireText(value, 'username', 80).toLocaleLowerCase('en-US');
}

function normalizeSource(value) {
  const source = value ?? 'registered';
  if (!['configured', 'registered'].includes(source)) throw new Error('invalid-user-source');
  return source;
}

function mapContact(row, protector) {
  const contact = mapRow(row);
  if (!contact) return null;
  return {
    ...contact,
    value: protector.reveal({
      userId: contact.userId,
      kind: contact.kind,
      ciphertext: contact.ciphertext,
      nonce: contact.nonce,
      authTag: contact.authTag,
    }),
  };
}

export function createUserRepository(queryable, { uuid = stableUuid } = {}) {
  return Object.freeze({
    async create(input) {
      const id = assertUuid(input.id ?? uuid(), 'user-id');
      const username = requireText(input.username, 'username', 80);
      const usernameNormalized = normalizeUsername(username);
      const source = normalizeSource(input.source);
      const displayName = optionalText(input.displayName, 'display-name', 120);
      const credentials = [input.passwordHash, input.passwordSalt, input.passwordScheme];
      if (credentials.some((item) => item != null) && credentials.some((item) => item == null)) {
        throw new Error('incomplete-password-credentials');
      }
      const passwordHash = input.passwordHash == null
        ? null
        : requireText(input.passwordHash, 'password-hash', 1_000);
      const passwordSalt = input.passwordSalt == null
        ? null
        : requireText(input.passwordSalt, 'password-salt', 255);
      const passwordScheme = input.passwordScheme == null
        ? null
        : requireText(input.passwordScheme, 'password-scheme', 40);
      const values = [
        id,
        source,
        username,
        usernameNormalized,
        displayName,
        passwordHash,
        passwordSalt,
        passwordScheme,
      ];
      const result = await queryable.query(`
        INSERT INTO users (
          id, source, username, username_normalized, display_name,
          password_hash, password_salt, password_scheme
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, values);
      return mapRow(result.rows[0]);
    },

    async list() {
      const result = await queryable.query(
        'SELECT * FROM users WHERE disabled_at IS NULL ORDER BY created_at, username_normalized',
      );
      return result.rows.map(mapRow);
    },

    async findById(rawId) {
      const id = assertUuid(rawId, 'user-id');
      const result = await queryable.query('SELECT * FROM users WHERE id = $1', [id]);
      return mapRow(result.rows[0]);
    },

    async findByUsername(value) {
      const normalized = normalizeUsername(value);
      const result = await queryable.query(
        'SELECT * FROM users WHERE username_normalized = $1',
        [normalized],
      );
      return mapRow(result.rows[0]);
    },

    async updatePassword(rawId, credentials) {
      const id = assertUuid(rawId, 'user-id');
      const hash = requireText(credentials.passwordHash, 'password-hash', 1_000);
      const salt = requireText(credentials.passwordSalt, 'password-salt', 255);
      const scheme = requireText(credentials.passwordScheme, 'password-scheme', 40);
      const result = await queryable.query(`
        UPDATE users
        SET password_hash = $2, password_salt = $3, password_scheme = $4,
            session_version = session_version + 1, updated_at = NOW()
        WHERE id = $1 AND disabled_at IS NULL
        RETURNING *
      `, [id, hash, salt, scheme]);
      return mapRow(result.rows[0]);
    },

    async disable(rawId) {
      const id = assertUuid(rawId, 'user-id');
      const result = await queryable.query(`
        UPDATE users
        SET disabled_at = COALESCE(disabled_at, NOW()),
            session_version = session_version + 1, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [id]);
      return mapRow(result.rows[0]);
    },
  });
}

export function createContactRepository(queryable, protector, { uuid = stableUuid } = {}) {
  if (!protector?.protect || !protector?.reveal || !protector?.hash) {
    throw new Error('contact-protector-required');
  }
  return Object.freeze({
    async upsert({ id: rawId, userId: rawUserId, kind, value, verifiedAt = new Date() }) {
      const id = assertUuid(rawId ?? uuid(), 'contact-id');
      const userId = assertUuid(rawUserId, 'user-id');
      const protectedContact = protector.protect({ userId, kind, value });
      const verified = validDate(verifiedAt, 'verified-at');
      const result = await queryable.query(`
        INSERT INTO contacts (
          id, user_id, kind, lookup_hash, ciphertext, nonce, auth_tag, verified_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (user_id, kind) DO UPDATE SET
          lookup_hash = EXCLUDED.lookup_hash,
          ciphertext = EXCLUDED.ciphertext,
          nonce = EXCLUDED.nonce,
          auth_tag = EXCLUDED.auth_tag,
          verified_at = EXCLUDED.verified_at,
          updated_at = NOW()
        RETURNING *
      `, [
        id,
        userId,
        kind,
        protectedContact.lookupHash,
        protectedContact.ciphertext,
        protectedContact.nonce,
        protectedContact.authTag,
        verified,
      ]);
      return mapContact(result.rows[0], protector);
    },

    async findByValue(kind, value) {
      const lookupHash = protector.hash(kind, value);
      const result = await queryable.query(`
        SELECT
          c.id AS contact_id, c.user_id, c.kind, c.lookup_hash, c.ciphertext,
          c.nonce, c.auth_tag, c.verified_at, c.created_at AS contact_created_at,
          u.id, u.username, u.username_normalized, u.display_name,
          u.password_hash, u.password_salt, u.password_scheme,
          u.session_version, u.disabled_at, u.created_at, u.updated_at
        FROM contacts c
        JOIN users u ON u.id = c.user_id
        WHERE c.kind = $1 AND c.lookup_hash = $2
      `, [kind, lookupHash]);
      if (!result.rows[0]) return null;
      const row = result.rows[0];
      const contact = mapContact({
        id: row.contact_id,
        user_id: row.user_id,
        kind: row.kind,
        lookup_hash: row.lookup_hash,
        ciphertext: row.ciphertext,
        nonce: row.nonce,
        auth_tag: row.auth_tag,
        verified_at: row.verified_at,
        created_at: row.contact_created_at,
      }, protector);
      const userRow = { ...row };
      for (const key of [
        'contact_id', 'kind', 'lookup_hash', 'ciphertext', 'nonce', 'auth_tag',
        'verified_at', 'contact_created_at', 'user_id',
      ]) delete userRow[key];
      return { user: mapRow(userRow), contact };
    },

    async listForUser(rawUserId) {
      const userId = assertUuid(rawUserId, 'user-id');
      const result = await queryable.query(
        'SELECT * FROM contacts WHERE user_id = $1 ORDER BY kind',
        [userId],
      );
      return result.rows.map((row) => mapContact(row, protector));
    },

    async remove(rawUserId, kind) {
      const userId = assertUuid(rawUserId, 'user-id');
      if (!['email', 'phone'].includes(kind)) throw new Error('invalid-contact-kind');
      const result = await queryable.query(
        'DELETE FROM contacts WHERE user_id = $1 AND kind = $2 RETURNING id',
        [userId, kind],
      );
      return result.rowCount === 1;
    },
  });
}
