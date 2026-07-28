import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createContactProtector,
  createContactProtectorFromEnv,
  normalizeContact,
  stableUuid,
} from './storage/contact-crypto.mjs';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const KEY = Buffer.alloc(32, 7);

test('contact protector normalizes, hashes, encrypts, and authenticates PII', () => {
  const protector = createContactProtector({ key: KEY });
  const first = protector.protect({ userId: USER_ID, kind: 'phone', value: '138 0013 8000' });
  const second = protector.protect({ userId: USER_ID, kind: 'phone', value: '+86 13800138000' });

  assert.equal(first.lookupHash, second.lookupHash);
  assert.notDeepEqual(first.nonce, second.nonce);
  assert.notDeepEqual(first.ciphertext, Buffer.from('+8613800138000'));
  assert.equal(protector.reveal({ userId: USER_ID, kind: 'phone', ...first }), '+8613800138000');
  assert.equal(normalizeContact('email', ' User@Example.COM '), 'user@example.com');

  const tampered = Buffer.from(first.ciphertext);
  tampered[0] ^= 1;
  assert.throws(
    () => protector.reveal({
      userId: USER_ID,
      kind: 'phone',
      ...first,
      ciphertext: tampered,
    }),
    /contact-decryption-failed/,
  );
});

test('contact configuration and generated IDs fail closed', () => {
  assert.throws(() => createContactProtectorFromEnv({}), /CONTACT_ENCRYPTION_KEY/);
  assert.throws(
    () => createContactProtectorFromEnv({ CONTACT_ENCRYPTION_KEY: 'not-a-key' }),
    /invalid-config/,
  );
  assert.equal(
    stableUuid(() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
  assert.throws(() => stableUuid(() => 'predictable-id'), /invalid-generated-id/);
});
