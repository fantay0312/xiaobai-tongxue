import { createResponseConcurrencyGate } from './response-concurrency-gate.mjs';

const PREFIX = '/api/commerce';

function responseFor(error) {
  const code = error instanceof Error ? error.message : 'internal-error';
  if (code === 'body-too-large') return { status: 413, code };
  if (code === 'bad-json') return { status: 400, code };
  if (code === 'too-many-attempts') return { status: 429, code };
  if (code === 'commerce-busy') return { status: 503, code };
  if (code === 'commerce-ingress-unavailable') return { status: 503, code };
  if (code === 'invalid-cdk' || code === 'cdk-expired') return { status: 400, code };
  if (code === 'cdk-already-used') return { status: 409, code };
  if (code === 'cdk-unavailable' || code === 'cdk-key-unavailable') {
    return { status: 503, code: 'cdk-unavailable' };
  }
  if (code.startsWith('invalid-') || code.startsWith('unknown-')) {
    return { status: 400, code };
  }
  return { status: 500, code: 'internal-error' };
}

export function createCommerceRouter({
  commerce,
  readJson,
  send,
  hasJsonContentType,
  preflightUser,
  resolveUser,
  allowedOrigin = null,
  rateLimit = null,
  clientIp = null,
  catalogMaxConcurrent = 8,
} = {}) {
  if (!commerce || !readJson || !send || !hasJsonContentType
      || !preflightUser || !resolveUser || !rateLimit || !clientIp) {
    throw new Error('commerce-router-dependencies-required');
  }
  const catalogGate = createResponseConcurrencyGate({
    limit: catalogMaxConcurrent,
  });

  async function admission(checks) {
    for (const input of checks) {
      let result;
      try {
        result = await rateLimit(input);
        if (typeof result?.allowed !== 'boolean') {
          throw new Error('invalid-commerce-ingress-result');
        }
      } catch {
        throw new Error('commerce-ingress-unavailable');
      }
      if (!result.allowed) throw new Error('too-many-attempts');
    }
  }

  function requestIp(req) {
    try {
      return clientIp(req);
    } catch {
      throw new Error('commerce-ingress-unavailable');
    }
  }

  async function catalogAllowed(req) {
    await admission([
      {
        scope: 'commerce-catalog-ip',
        subject: requestIp(req),
        limit: 120,
        windowSeconds: 60,
      },
      {
        scope: 'commerce-catalog-global',
        subject: 'anonymous-catalog',
        limit: 2_000,
        windowSeconds: 60,
      },
    ]);
  }

  async function redeemAllowed(req, user) {
    await admission([
      {
        scope: 'commerce-cdk-redeem-user',
        subject: user.id,
        limit: 20,
        windowSeconds: 900,
      },
      {
        scope: 'commerce-cdk-redeem-ip',
        subject: requestIp(req),
        limit: 60,
        windowSeconds: 900,
      },
    ]);
  }

  async function handle(req, res, pathname) {
    if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;
    try {
      if (pathname === `${PREFIX}/catalog` && req.method === 'GET') {
        const permit = catalogGate.acquire(req, res);
        if (!permit.allowed) throw new Error(permit.error);
        await catalogAllowed(req);
        send(res, 200, await commerce.catalog());
        return true;
      }
      if (pathname === `${PREFIX}/me` && req.method === 'GET') {
        const preflight = await preflightUser(req, res);
        if (!preflight) return true;
        const user = await resolveUser(req, res, 'commerce', { preflight });
        if (!user) return true;
        send(res, 200, await commerce.summary(user, req));
        return true;
      }
      if (pathname === `${PREFIX}/cdk/redeem` && req.method === 'POST') {
        if (!allowedOrigin || req.headers.origin !== allowedOrigin) {
          send(res, 403, { error: 'origin-required' });
          req.resume();
          return true;
        }
        if (!hasJsonContentType(req)) {
          send(res, 415, { error: 'json-required' });
          req.resume();
          return true;
        }
        const preflight = await preflightUser(req, res);
        if (!preflight) {
          req.resume();
          return true;
        }
        await redeemAllowed(req, preflight.user);
        const user = await resolveUser(req, res, 'commerce', { preflight });
        if (!user) {
          req.resume();
          return true;
        }
        const input = await readJson(req);
        send(res, 200, await commerce.redeem(user, input?.code));
        return true;
      }
      send(res, 404, { error: 'not-found' });
      return true;
    } catch (error) {
      const response = responseFor(error);
      if (req.method !== 'GET') req.resume();
      if (!res.headersSent) send(res, response.status, { error: response.code });
      return true;
    }
  }

  return Object.freeze({ handle, prefix: PREFIX });
}
