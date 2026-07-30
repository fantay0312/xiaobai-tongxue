import crypto from 'node:crypto';
import { normalizeEmail } from '../email-auth.mjs';
import { createAuditAdmission } from './audit-admission.mjs';
import { ADMIN_PERMISSIONS, hmacHex, randomToken } from './config.mjs';
import { createAdminIngress } from './ingress.mjs';
import {
  createKdfRunner,
  credentials,
  passwordValue,
  safeAdmin,
} from './service-utils.mjs';

export function createAdminService({
  postgres,
  config,
  passwordService,
  sendInvitation,
  rateLimit,
  clientIp,
  authGate,
} = {}) {
  if (!postgres?.withTransaction || !config || !passwordService || !sendInvitation
      || typeof rateLimit !== 'function' || typeof clientIp !== 'function'
      || !authGate?.acquireConcurrency || !authGate?.admitGlobal) {
    throw new Error('admin-service-dependencies-required');
  }

  const admitAudit = createAuditAdmission({ rateLimit, clientIp });
  const ingress = createAdminIngress({ rateLimit, clientIp, tokenKey: config.tokenKey });
  const tokenHash = (token, domain) => hmacHex(config.tokenKey, domain, token);
  const runKdf = createKdfRunner(authGate);
  const actorHashes = (req) => ({
    ipHash: tokenHash(clientIp(req), 'admin-ip'),
    userAgentHash: tokenHash(String(req.headers['user-agent'] ?? ''), 'admin-user-agent'),
  });

  async function requireAuthIngress(scope, subject, limit, windowSeconds) {
    let decision;
    try {
      decision = await rateLimit({ scope, subject, limit, windowSeconds });
    } catch {
      throw new Error('admin-ingress-unavailable');
    }
    if (decision?.allowed !== true) throw new Error('too-many-attempts');
  }

  async function access(account, store = postgres) {
    const assigned = await store.adminRbac.accountAccess(account.id);
    return {
      roles: assigned.roles.map((role) => ({
        id: role.id, code: role.code, name: role.name,
      })),
      permissions: account.isOwner
        ? ADMIN_PERMISSIONS.map(([key]) => key)
        : assigned.permissions,
    };
  }

  async function issueSession(account, req, store = postgres) {
    const csrfToken = randomToken();
    const hashes = actorHashes(req);
    const expiresAt = new Date(Date.now() + config.sessionTtlMs);
    const token = ingress.issueSessionToken({
      isOwner: account.isOwner,
      expiresAt,
    });
    await store.adminAuth.createSession({
      accountId: account.id,
      tokenHash: tokenHash(token, 'admin-session'),
      csrfHash: tokenHash(csrfToken, 'admin-csrf'),
      sessionVersion: account.sessionVersion,
      ...hashes,
      expiresAt,
    });
    const assigned = await access(account, store);
    return {
      token,
      csrfToken,
      payload: { admin: safeAdmin(account), ...assigned, csrfToken },
    };
  }

  async function sendFreshInvitation(account, createdBy = null) {
    const rawToken = randomToken(36);
    const invitation = await postgres.withTransaction(
      (tx) => tx.adminAuth.createInvitation({
        accountId: account.id,
        tokenHash: tokenHash(rawToken, 'admin-invitation'),
        createdBy,
        expiresAt: new Date(Date.now() + config.invitationTtlMs),
      }),
    );
    const activationUrl = `${config.origin}/admin/#/activate?token=${encodeURIComponent(rawToken)}`;
    try {
      await sendInvitation({
        email: account.email,
        activationUrl,
        idempotencyKey: `xiaobai-admin-invite-${invitation.id}`,
      });
      await postgres.adminAuth.markInvitationSent(invitation.id);
      return {
        ...invitation,
        email: account.email,
        displayName: account.displayName,
      };
    } catch (error) {
      await postgres.adminAuth.revokeInvitation(invitation.id).catch(() => {});
      throw error;
    }
  }

  async function ensureBootstrap() {
    const owner = await postgres.withTransaction(async (tx) => {
      await tx.adminRbac.ensurePermissions(
        ADMIN_PERMISSIONS.map(([key, name]) => ({ key, name, description: name })),
      );
      return tx.adminAuth.ensureOwner({
        email: config.ownerEmail,
        displayName: 'Owner',
      });
    });
    if (owner.status === 'active') return { owner, invited: false };
    const current = await postgres.adminAuth.activeInvitationForAccount(owner.id);
    if (current?.sentAt) return { owner, invited: false };
    if (current) await postgres.adminAuth.revokeInvitation(current.id);
    await sendFreshInvitation(owner);
    return { owner, invited: true };
  }

  async function current(req, rawToken) {
    const signed = ingress.readSessionToken(rawToken);
    if (!signed) return null;
    const session = await postgres.adminAuth.findSession(
      tokenHash(rawToken, 'admin-session'),
    );
    if (!session || session.status !== 'active'
        || Number(session.accountSessionVersion) !== Number(session.sessionVersion)
        || signed.isOwner !== (session.isOwner === true)) {
      if (session) await postgres.adminAuth.revokeSession(
        tokenHash(rawToken, 'admin-session'),
      ).catch(() => {});
      return null;
    }
    const principal = {
      session,
      account: {
        id: session.accountId,
        email: session.email,
        displayName: session.displayName,
        status: session.status,
        isOwner: session.isOwner,
        sessionVersion: session.accountSessionVersion,
      },
    };
    await ingress.admitPrincipal(req, principal);
    return {
      ...principal,
      ...(await access(principal.account)),
    };
  }

  async function rotateCsrf(principal) {
    const csrfToken = randomToken();
    await postgres.adminAuth.rotateCsrf(
      principal.session.id,
      tokenHash(csrfToken, 'admin-csrf'),
    );
    return {
      admin: safeAdmin(principal.account),
      roles: principal.roles,
      permissions: principal.permissions,
      csrfToken,
    };
  }

  async function login({ email, password }, req) {
    const normalized = normalizeEmail(email);
    await requireAuthIngress(
      'admin-login-id',
      tokenHash(normalized ?? String(email ?? ''), 'admin-login-identity'),
      10,
      900,
    );
    const validShape = typeof password === 'string' && password.length > 0 && password.length <= 128;
    if (!validShape) throw new Error('invalid-credentials');
    const { account, verified } = await runKdf(async () => {
      const selected = normalized
        ? await postgres.adminAuth.findAccountByEmail(normalized) : null;
      return {
        account: selected,
        verified: await passwordService.verify(credentials(selected), password),
      };
    });
    if (!verified || account?.status !== 'active') throw new Error('invalid-credentials');
    return postgres.withTransaction(async (tx) => {
      const locked = await tx.adminAuth.lockAccountForSession(account.id);
      if (!locked || locked.status !== 'active'
          || locked.passwordHash !== account.passwordHash
          || locked.passwordSalt !== account.passwordSalt
          || locked.passwordScheme !== account.passwordScheme) {
        throw new Error('invalid-credentials');
      }
      await tx.adminAuth.markLogin(locked.id);
      return issueSession(locked, req, tx);
    });
  }

  async function activate({ token, password, displayName }, req) {
    if (typeof token !== 'string' || token.length < 32 || token.length > 200) {
      throw new Error('invalid-or-expired-invitation');
    }
    const invitationHash = tokenHash(token, 'admin-invitation');
    await requireAuthIngress('admin-activate-invitation', invitationHash, 10, 900);
    const selectedPassword = passwordValue(password);
    const { hashed, invitationUsable } = await runKdf(async () => ({
      invitationUsable: await postgres.adminAuth.invitationIsUsable(invitationHash),
      hashed: await passwordService.hash(selectedPassword),
    }));
    if (!invitationUsable) throw new Error('invalid-or-expired-invitation');
    return postgres.withTransaction(async (tx) => {
      const account = await tx.adminAuth.activate({
        tokenHash: invitationHash,
        passwordHash: hashed.hash,
        passwordSalt: hashed.salt,
        passwordScheme: hashed.passwordScheme,
        displayName,
      });
      return issueSession(account, req, tx);
    });
  }

  async function verifyCsrf(principal, value) {
    if (typeof value !== 'string' || value.length < 20 || value.length > 200) return false;
    const candidate = tokenHash(value, 'admin-csrf');
    const expected = principal.session.csrfHash;
    return expected.length === candidate.length
      && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate));
  }

  async function inviteOperator(principal, input) {
    if (!principal.account.isOwner) throw new Error('owner-required');
    const email = normalizeEmail(input.email);
    if (!email) throw new Error('invalid-admin-email');
    let account = await postgres.adminAuth.findAccountByEmail(email);
    if (account?.status === 'active') throw new Error('admin-already-active');
    account = await postgres.withTransaction(async (tx) => {
      const selected = account ?? await tx.adminAuth.createAccount({
        email,
        displayName: input.displayName,
        createdBy: principal.account.id,
      });
      await tx.adminRbac.assignRoles(
        selected.id,
        input.roleIds ?? [],
        principal.account.id,
      );
      return tx.adminAuth.findAccountById(selected.id);
    });
    const invitation = await sendFreshInvitation(account, principal.account.id);
    return { invitation, account: safeAdmin(account) };
  }

  async function resendInvitation(principal, invitationId) {
    if (!principal.account.isOwner) throw new Error('owner-required');
    const existing = await postgres.adminAuth.findInvitation(invitationId);
    if (!existing || existing.accountStatus === 'active') throw new Error('invitation-not-found');
    await postgres.adminAuth.revokeInvitation(existing.id);
    const account = await postgres.adminAuth.findAccountById(existing.accountId);
    return sendFreshInvitation(account, principal.account.id);
  }

  async function audit(req, principal, input) {
    return postgres.adminRbac.recordAudit({
      actorAccountId: principal?.account?.id ?? null,
      requestId: req.adminRequestId,
      ...actorHashes(req),
      ...input,
    });
  }

  return Object.freeze({
    config,
    ensureBootstrap,
    current,
    rotateCsrf,
    login,
    activate,
    verifyCsrf,
    inviteOperator,
    resendInvitation,
    enterRequest: ingress.enter,
    admitAudit,
    audit,
    revokeSession: (token) => postgres.adminAuth.revokeSession(
      tokenHash(token, 'admin-session'),
    ),
  });
}
