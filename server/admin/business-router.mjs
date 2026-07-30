import {
  pageInput,
  pathParts,
  permission,
  requireReason,
} from './http.mjs';
import { handleAdminFinanceRoute } from './finance-router.mjs';

const PREFIX = '/api/admin/v1';

function stringBigInts(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stringBigInts);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, stringBigInts(item)]),
    );
  }
  return value;
}

function listEnvelope(items) {
  return { items, total: items.length, page: 1, pageSize: items.length };
}

function safeUser(user) {
  return {
    id: user.id,
    source: user.source,
    username: user.username,
    displayName: user.displayName,
    disabledAt: user.disabledAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    restrictions: user.restrictions,
  };
}

export async function handleAdminBusinessRoute(context) {
  const {
    req, pathname, url, principal, postgres, commerce, send, body, mutate,
    onUserAccessChanged,
  } = context;
  const parts = pathParts(pathname, PREFIX);

  if (parts[0] === 'overview' && parts.length === 1 && req.method === 'GET') {
    permission(principal, 'overview.read');
    send(200, { counts: stringBigInts(await postgres.adminRbac.overview()) });
    return true;
  }

  if (parts[0] === 'users' && parts.length === 1 && req.method === 'GET') {
    permission(principal, 'users.read');
    const result = await postgres.userAccess.listUsers({
      ...pageInput(url),
      query: url.searchParams.get('q') ?? '',
      status: url.searchParams.get('status') ?? '',
    });
    send(200, stringBigInts({
      ...result,
      items: result.items.map(safeUser),
    }));
    return true;
  }

  if (parts[0] === 'users' && parts[2] === 'status'
      && parts.length === 3 && req.method === 'POST') {
    permission(principal, 'users.restrict');
    const input = await body();
    if (typeof input.disabled !== 'boolean') throw new Error('invalid-disabled');
    const disabled = input.disabled;
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: disabled ? 'user.suspend' : 'user.unsuspend',
      targetType: 'user',
      targetId: parts[1],
      details: { reason },
    }, () => postgres.withTransaction(
      (tx) => tx.userAccess.setDisabled(parts[1], disabled),
    ));
    await onUserAccessChanged(parts[1]);
    send(200, stringBigInts(safeUser(result)));
    return true;
  }

  if (parts[0] === 'users' && parts[2] === 'restrictions'
      && parts.length === 3 && req.method === 'POST') {
    permission(principal, 'users.restrict');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'user.restriction.create',
      targetType: 'user',
      targetId: parts[1],
      details: { scope: input.scope, reason },
    }, () => postgres.withTransaction((tx) => tx.userAccess.addRestriction({
      ...input,
      reason,
      userId: parts[1],
      createdBy: principal.account.id,
    })));
    await onUserAccessChanged(parts[1]);
    send(201, result);
    return true;
  }

  if (parts[0] === 'users' && parts[2] === 'restrictions'
      && parts.length === 4 && req.method === 'DELETE') {
    permission(principal, 'users.restrict');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'user.restriction.revoke',
      targetType: 'user-restriction',
      targetId: parts[3],
      details: { reason },
    }, () => postgres.withTransaction(
      (tx) => tx.userAccess.revokeRestriction(
        parts[1], parts[3], principal.account.id,
      ),
    ));
    await onUserAccessChanged(parts[1]);
    send(200, { ok: true, restriction: result });
    return true;
  }

  if (parts[0] === 'plans' && parts.length === 1 && req.method === 'GET') {
    permission(principal, 'plans.read');
    send(200, listEnvelope(stringBigInts(await postgres.catalog.listPlans())));
    return true;
  }

  if (parts[0] === 'plans' && parts.length === 1 && req.method === 'POST') {
    permission(principal, 'plans.write');
    const input = await body();
    const reason = requireReason(input.reason);
    const created = await mutate({
      action: 'plan.create', targetType: 'subscription-plan',
      details: { reason },
    }, () => postgres.withTransaction(
      (tx) => tx.catalog.createPlan(input, principal.account.id),
    ));
    commerce.invalidateCatalogCache?.();
    const item = (await postgres.catalog.listPlans()).find((plan) => plan.id === created.id);
    send(201, stringBigInts(item));
    return true;
  }

  if (parts[0] === 'plans' && parts.length === 2 && req.method === 'PATCH') {
    permission(principal, 'plans.write');
    const input = await body();
    const reason = requireReason(input.reason);
    await mutate({
      action: 'plan.update', targetType: 'subscription-plan', targetId: parts[1],
      details: { reason },
    }, () => postgres.withTransaction(
      (tx) => tx.catalog.updatePlan(parts[1], input, principal.account.id),
    ));
    commerce.invalidateCatalogCache?.();
    const item = (await postgres.catalog.listPlans()).find((plan) => plan.id === parts[1]);
    send(200, stringBigInts(item));
    return true;
  }

  if (parts[0] === 'entitlements' && parts.length === 1 && req.method === 'GET') {
    permission(principal, 'entitlements.read');
    send(200, listEnvelope(await postgres.catalog.listEntitlements()));
    return true;
  }

  if (parts[0] === 'entitlements' && parts.length === 1 && req.method === 'POST') {
    permission(principal, 'entitlements.write');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'entitlement.create', targetType: 'entitlement',
      details: { reason },
    }, () => postgres.catalog.createEntitlement(input, principal.account.id));
    commerce.invalidateCatalogCache?.();
    send(201, result);
    return true;
  }

  if (parts[0] === 'entitlements' && parts.length === 2 && req.method === 'PATCH') {
    permission(principal, 'entitlements.write');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'entitlement.update', targetType: 'entitlement', targetId: parts[1],
      details: { reason },
    }, () => postgres.withTransaction(
      (tx) => tx.catalog.updateEntitlement(parts[1], input),
    ));
    commerce.invalidateCatalogCache?.();
    send(200, result);
    return true;
  }

  if (parts[0] === 'features' && parts.length === 1 && req.method === 'GET') {
    permission(principal, 'features.read');
    send(200, listEnvelope(await postgres.features.list()));
    return true;
  }

  if (parts[0] === 'features' && parts.length === 2 && req.method === 'PUT') {
    permission(principal, 'features.write');
    const input = await body();
    const reason = requireReason(input.changeReason);
    const result = await mutate({
      action: 'feature.upsert', targetType: 'feature', targetId: parts[1],
      details: { reason },
    }, () => postgres.features.upsert(parts[1], {
      ...input,
      changeReason: undefined,
    }, principal.account.id));
    send(200, result);
    return true;
  }

  return handleAdminFinanceRoute(context);
}
