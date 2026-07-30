import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminIngress,
  createAdminSessionToken,
} from './admin/ingress.mjs';

const TOKEN_KEY = Buffer.alloc(32, 8);
const limits = {
  anonymous: { local: 2, ip: 10, token: 10, global: 1 },
  member: {
    local: 2, ip: 10, token: 10, global: 1, session: 10, actor: 10,
  },
  owner: {
    local: 1, ip: 10, token: 10, global: 1, session: 10, actor: 10,
  },
};

function request() {
  return { socket: { remoteAddress: '198.51.100.60' } };
}

test('member global exhaustion cannot consume the reserved Owner global bucket', async () => {
  const counts = new Map();
  const scopes = [];
  const ingress = createAdminIngress({
    rateLimit: async (input) => {
      scopes.push(input.scope);
      const key = `${input.scope}\0${input.subject}`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { allowed: count <= input.limit };
    },
    clientIp: (req) => req.socket.remoteAddress,
    tokenKey: TOKEN_KEY,
    limits,
  });
  const memberToken = createAdminSessionToken(TOKEN_KEY, {
    isOwner: false,
    expiresAt: Date.now() + 60_000,
  });
  (await ingress.enter(
    request(), memberToken, '/api/admin/v1/auth/me',
  )).release();
  await assert.rejects(
    ingress.enter(request(), memberToken, '/api/admin/v1/auth/me'),
    /too-many-attempts/,
  );
  const ownerToken = createAdminSessionToken(TOKEN_KEY, {
    isOwner: true,
    expiresAt: Date.now() + 60_000,
  });
  (await ingress.enter(
    request(), ownerToken, '/api/admin/v1/auth/me',
  )).release();
  assert.equal(
    scopes.filter((scope) => scope === 'admin-ingress-member-admin-global').length,
    2,
  );
  assert.equal(
    scopes.filter((scope) => scope === 'admin-ingress-owner-admin-global').length,
    1,
  );
});
