import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContactProtector } from './storage/contact-crypto.mjs';
import {
  createPostgresPoolFromEnv,
  createPostgresStore,
  createPostgresStoreFromEnv,
} from './storage/postgres/index.mjs';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';

class FakePool {
  calls = [];
  ended = false;

  async query(text, values = []) {
    this.calls.push({ target: 'pool', text, values });
    if (/SELECT 1 AS healthy/.test(text)) return { rows: [{ healthy: 1 }], rowCount: 1 };
    if (/INSERT INTO users/.test(text)) {
      return {
        rows: [{
          id: values[0],
          source: values[1],
          username: values[2],
          username_normalized: values[3],
          display_name: values[4],
        }],
        rowCount: 1,
      };
    }
    if (/INSERT INTO contacts/.test(text)) {
      return {
        rows: [{
          id: values[0],
          user_id: values[1],
          kind: values[2],
          lookup_hash: values[3],
          ciphertext: values[4],
          nonce: values[5],
          auth_tag: values[6],
          verified_at: values[7],
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  }

  async connect() {
    const pool = this;
    return {
      async query(text, values = []) {
        pool.calls.push({ target: 'client', text, values });
        return { rows: [], rowCount: 0 };
      },
      release() {
        pool.calls.push({ target: 'client', text: 'RELEASE', values: [] });
      },
    };
  }

  async end() {
    this.ended = true;
  }
}

test('PostgreSQL repositories parameterize input and never persist contact plaintext', async () => {
  const pool = new FakePool();
  const protector = createContactProtector({ key: Buffer.alloc(32, 9) });
  const ids = [USER_ID, CONTACT_ID];
  const store = createPostgresStore({
    pool,
    contactProtector: protector,
    uuid: () => ids.shift(),
  });
  const malicious = "alice'); DROP TABLE users; --";
  const user = await store.users.create({ username: malicious });
  assert.equal(user.id, USER_ID);

  const phone = '13800138000';
  const contact = await store.contacts.upsert({
    userId: USER_ID,
    kind: 'phone',
    value: phone,
    verifiedAt: '2026-07-28T00:00:00.000Z',
  });
  assert.equal(contact.id, CONTACT_ID);
  assert.equal(contact.value, '+8613800138000');

  const userCall = pool.calls.find((call) => /INSERT INTO users/.test(call.text));
  assert.equal(userCall.text.includes(malicious), false);
  assert.equal(userCall.values[2], malicious);
  const contactCall = pool.calls.find((call) => /INSERT INTO contacts/.test(call.text));
  assert.equal(contactCall.text.includes(phone), false);
  assert.equal(contactCall.values.some((value) => value === phone || value === `+86${phone}`), false);
  assert.ok(Buffer.isBuffer(contactCall.values[4]));
  assert.equal(contactCall.values[3].length, 64);
});

test('PostgreSQL transactions commit, roll back, and health-check', async () => {
  const pool = new FakePool();
  const store = createPostgresStore({
    pool,
    contactProtector: createContactProtector({ key: Buffer.alloc(32, 3) }),
  });
  await store.withTransaction(async () => 'done');
  await assert.rejects(
    store.withTransaction(async () => {
      throw new Error('stop');
    }),
    /stop/,
  );
  assert.equal(
    pool.calls.filter((call) => call.target === 'client' && call.text === 'COMMIT').length,
    1,
  );
  assert.equal(
    pool.calls.filter((call) => call.target === 'client' && call.text === 'ROLLBACK').length,
    1,
  );
  assert.equal((await store.healthCheck()).healthy, true);
  await store.close();
  assert.equal(pool.ended, true);
});

test('PostgreSQL configuration and schema are fail-closed and complete', async () => {
  assert.throws(() => createPostgresStoreFromEnv({}), /CONTACT_ENCRYPTION_KEY/);
  const privatePool = createPostgresPoolFromEnv({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:password@10.0.0.14:5432/xiaobai',
    DATABASE_SSL_MODE: 'disable',
    DATABASE_ALLOW_PRIVATE_PLAINTEXT: 'true',
  });
  await privatePool.end();
  assert.throws(() => createPostgresPoolFromEnv({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:password@db.public.invalid:5432/xiaobai',
    DATABASE_SSL_MODE: 'disable',
    DATABASE_ALLOW_PRIVATE_PLAINTEXT: 'true',
  }), /insecure-config/);
  const migration = await readFile(
    new URL('./storage/postgres/migrations/001_initial.sql', import.meta.url),
    'utf8',
  );
  for (const table of [
    'users',
    'contacts',
    'learning_states',
    'user_files',
    'inbound_emails',
    'auth_audit_events',
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(migration, /UNIQUE \(kind, lookup_hash\)/);
  assert.doesNotMatch(migration, /phone_number|email_address/i);
});
