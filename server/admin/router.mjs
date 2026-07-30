import crypto from 'node:crypto';
import { handleAdminBusinessRoute } from './business-router.mjs';
import { publicError, requireReason } from './http.mjs';
import { handleAdminTeamRoute } from './team-router.mjs';
const PREFIX = '/api/admin/v1';
const AUTH_METHODS = new Map([
  [`${PREFIX}/auth/login`, 'POST'], [`${PREFIX}/auth/activate`, 'POST'],
  [`${PREFIX}/auth/me`, 'GET'], [`${PREFIX}/auth/logout`, 'POST'],
]);
function cookieValue(name, token, ttlSeconds, secure) {
  return `${name}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ttlSeconds}`
    + (secure ? '; Secure' : '');
}
function clearCookie(name, secure) {
  return `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
    + (secure ? '; Secure' : '');
}
export function createAdminRouter({
  service,
  postgres,
  commerce,
  readJson,
  send,
  getCookie,
  hasJsonContentType,
  onUserAccessChanged,
  allowInsecure = false,
} = {}) {
  if (!service || typeof service.admitAudit !== 'function'
      || typeof service.enterRequest !== 'function'
      || !postgres || !commerce || !readJson || !send || !getCookie) {
    throw new Error('admin-router-dependencies-required');
  }
  const secure = !allowInsecure;
  const cookieName = secure ? '__Host-xiaobai_admin_sid' : 'xiaobai_admin_sid';
  const auditAdmissions = new WeakMap();
  const commonHeaders = (req) => ({ 'X-Request-Id': req.adminRequestId });
  function requireOrigin(req) {
    if (req.headers.origin !== service.config.origin) throw new Error('origin-required');
  }

  async function body(req) {
    if (!hasJsonContentType(req)) throw new Error('invalid-json-content-type');
    return readJson(req);
  }
  async function principal(req) {
    const token = req.adminRawToken ?? getCookie(req, cookieName);
    const current = await service.current(req, token);
    if (!current) throw new Error('login-required');
    return { ...current, token };
  }

  async function unsafePrincipal(req) {
    requireOrigin(req);
    const current = await principal(req);
    req.adminAuditPrincipal = current;
    if (!await service.verifyCsrf(current, req.headers['x-csrf-token'])) {
      throw new Error('csrf-invalid');
    }
    return current;
  }

  function auditErrorCode(error) {
    const code = error instanceof Error ? error.message : 'internal-error';
    return /^[a-z0-9][a-z0-9-]{0,79}$/.test(code) ? code : 'internal-error';
  }

  async function auditAllowed(req, current, input, required = false) {
    let decision = auditAdmissions.get(req);
    if (!decision) {
      try {
        decision = {
          allowed: await service.admitAudit(req, current, {
            action: input.action,
            outcome: input.outcome,
            error: input.details?.error,
          }) === true,
          unavailable: false,
        };
      } catch {
        decision = { allowed: false, unavailable: true };
      }
      auditAdmissions.set(req, decision);
    }
    if (!decision.allowed && required) {
      throw new Error(
        decision.unavailable ? 'audit-admission-unavailable' : 'too-many-attempts',
      );
    }
    return decision.allowed;
  }

  async function recordAuditSafely(req, current, input) {
    if (!await auditAllowed(req, current, input)) return false;
    try {
      await service.audit(req, current, input);
      return true;
    } catch {
      // 业务提交或鉴权结果不能因审计存储短暂故障被伪装成失败。
      console.error('[admin-audit] 审计事件写入失败');
      return false;
    }
  }

  async function auditedAuth(req, action, work) {
    try {
      const result = await work();
      await recordAuditSafely(req, { account: result.payload.admin }, {
        action,
        targetType: 'admin-account',
        targetId: result.payload.admin.id,
        outcome: 'success',
      });
      req.adminAuthAuditRecorded = true;
      return result;
    } catch (error) {
      req.adminAuthAuditRecorded = true;
      await recordAuditSafely(req, null, {
        action,
        targetType: 'admin-account',
        outcome: 'failure',
        details: { error: auditErrorCode(error) },
      });
      throw error;
    }
  }

  function authAction(method, pathname) {
    if (method !== 'POST') return null;
    if (pathname === `${PREFIX}/auth/login`) return 'admin.auth.login';
    if (pathname === `${PREFIX}/auth/activate`) return 'admin.auth.activate';
    if (pathname === `${PREFIX}/auth/logout`) return 'admin.auth.logout';
    return null;
  }

  async function auditedMutation(req, current, auditInput, work) {
    const normalizedAudit = {
      ...auditInput,
      details: {
        ...(auditInput.details ?? {}),
        reason: requireReason(auditInput.details?.reason),
      },
    };
    await auditAllowed(req, current, {
      action: normalizedAudit.action,
      outcome: 'attempt',
    }, true);
    await service.audit(req, current, {
      ...normalizedAudit,
      outcome: 'attempt',
    });
    try {
      const result = await work();
      await recordAuditSafely(req, current, {
        ...normalizedAudit,
        outcome: 'success',
        afterState: normalizedAudit.afterState ?? null,
      });
      return result;
    } catch (error) {
      await recordAuditSafely(req, current, {
        ...normalizedAudit,
        outcome: 'failure',
        details: {
          ...normalizedAudit.details,
          error: auditErrorCode(error),
        },
      });
      throw error;
    }
  }

  async function handle(req, res, pathname) {
    if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;
    req.adminRequestId = crypto.randomUUID();
    let ingressPermit = null;
    try {
      req.adminRawToken = getCookie(req, cookieName);
      ingressPermit = await service.enterRequest(req, req.adminRawToken, pathname);
      req.adminIngressAdmitted = true;
      const expectedMethod = AUTH_METHODS.get(pathname);
      if (expectedMethod && req.method !== expectedMethod) {
        if (req.method !== 'GET') req.resume();
        send(res, 405, { error: 'method-not-allowed' }, {
          ...commonHeaders(req),
          Allow: expectedMethod,
        });
        return true;
      }
      if (pathname === `${PREFIX}/auth/login` && req.method === 'POST') {
        requireOrigin(req);
        const result = await auditedAuth(
          req,
          'admin.auth.login',
          async () => service.login(await body(req), req),
        );
        send(res, 200, result.payload, {
          ...commonHeaders(req),
          'Set-Cookie': cookieValue(
            cookieName,
            result.token,
            Math.floor(service.config.sessionTtlMs / 1_000),
            secure,
          ),
        });
        return true;
      }
      if (pathname === `${PREFIX}/auth/activate` && req.method === 'POST') {
        requireOrigin(req);
        const result = await auditedAuth(
          req,
          'admin.auth.activate',
          async () => service.activate(await body(req), req),
        );
        send(res, 200, result.payload, {
          ...commonHeaders(req),
          'Set-Cookie': cookieValue(
            cookieName,
            result.token,
            Math.floor(service.config.sessionTtlMs / 1_000),
            secure,
          ),
        });
        return true;
      }
      if (pathname === `${PREFIX}/auth/me` && req.method === 'GET') {
        const current = await principal(req);
        send(res, 200, await service.rotateCsrf(current), commonHeaders(req));
        return true;
      }
      if (pathname === `${PREFIX}/auth/logout` && req.method === 'POST') {
        const current = await unsafePrincipal(req);
        await service.revokeSession(current.token);
        await recordAuditSafely(req, current, {
          action: 'admin.auth.logout',
          targetType: 'admin-account',
          targetId: current.account.id,
          outcome: 'success',
        });
        req.adminAuthAuditRecorded = true;
        send(res, 200, { ok: true }, {
          ...commonHeaders(req),
          'Set-Cookie': clearCookie(cookieName, secure),
        });
        return true;
      }

      const current = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
        ? await unsafePrincipal(req)
        : await principal(req);
      const context = {
        req,
        res,
        pathname,
        url: new URL(req.url, 'http://localhost'),
        principal: current,
        postgres,
        commerce,
        body: () => body(req),
        send: (status, payload, headers = {}) => send(
          res, status, payload, { ...commonHeaders(req), ...headers },
        ),
        mutate: (auditInput, work) => auditedMutation(req, current, auditInput, work),
        onUserAccessChanged,
      };
      if (await handleAdminBusinessRoute(context)) return true;
      if (await handleAdminTeamRoute({ ...context, service })) return true;
      send(res, 404, { error: 'not-found' }, commonHeaders(req));
      return true;
    } catch (error) {
      const action = authAction(req.method, pathname);
      if (req.adminIngressAdmitted && action && !req.adminAuthAuditRecorded) {
        const current = req.adminAuditPrincipal ?? null;
        await recordAuditSafely(req, current, {
          action,
          targetType: 'admin-account',
          targetId: current?.account?.id,
          outcome: 'failure',
          details: { error: auditErrorCode(error) },
        });
      }
      const response = publicError(error);
      if (!res.headersSent) {
        const retry = response.retryAfter
          ? { 'Retry-After': String(response.retryAfter) }
          : {};
        send(res, response.status, {
          error: response.code,
          ...(response.retryAfter ? { retryAfter: response.retryAfter } : {}),
        }, { ...commonHeaders(req), ...retry });
      }
      return true;
    } finally {
      ingressPermit?.release();
    }
  }

  return Object.freeze({ handle, prefix: PREFIX });
}
