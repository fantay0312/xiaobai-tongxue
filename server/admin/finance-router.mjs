import crypto from 'node:crypto';
import {
  pageInput,
  pathParts,
  permission,
  requireIdempotencyKey,
  requireReason,
} from './http.mjs';

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

function safePointResult(result) {
  return {
    operation: {
      id: result.operation.id,
      operationKind: result.operation.operationKind,
      status: result.operation.status,
      targetUserId: result.operation.targetUserId,
      reason: result.operation.reason,
      metadata: result.operation.metadata,
      createdAt: result.operation.createdAt,
    },
    wallet: result.wallet,
    replayed: result.replayed,
  };
}

function assignmentHash(input, reason, actorId) {
  const canonical = JSON.stringify({
    actorId,
    userId: input.userId,
    planId: input.planId,
    priceId: input.priceId ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    status: input.status ?? 'active',
    reason,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function assignmentIdentity(input, reason, actorId) {
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  return {
    idempotencyKey,
    requestHash: assignmentHash(input, reason, actorId),
    userId: input.userId,
    actorId,
  };
}

async function assignSubscription(context, input, identity) {
  const { postgres, principal } = context;
  return postgres.withTransaction(async (tx) => {
    const operation = await tx.subscriptions.lockAssignment(identity);
    if (operation.replayed) {
      return {
        subscription: operation.responseSnapshot.subscription,
        replayed: true,
      };
    }
    const bonusPoints = await tx.subscriptions.assignmentBonusPoints(input);
    if (BigInt(bonusPoints) > 0n) {
      permission(principal, 'points.adjust');
    }
    await tx.subscriptions.reserveAssignment(identity);
    const assigned = await tx.subscriptions.create({
      ...input,
      source: 'admin',
      assignedBy: principal.account.id,
    });
    if (String(assigned.bonusPoints) !== bonusPoints) {
      throw new Error('subscription-bonus-changed');
    }
    let bonusOperationId = null;
    if (BigInt(bonusPoints) > 0n) {
      const bonus = await tx.points.post({
        userId: input.userId,
        amount: bonusPoints,
        kind: 'subscription_bonus',
        idempotencyKey: `subscription:${assigned.subscription.id}:bonus`,
        actorAdminId: principal.account.id,
        reason: '订阅套餐积分赠送',
        metadata: { subscriptionId: assigned.subscription.id },
      });
      bonusOperationId = bonus.operation.id;
    }
    await tx.subscriptions.completeAssignment({
      idempotencyKey: identity.idempotencyKey,
      subscriptionId: assigned.subscription.id,
      bonusOperationId,
      responseSnapshot: {
        subscription: assigned.subscription,
        bonusPoints,
      },
    });
    return { subscription: assigned.subscription, replayed: false };
  });
}

export async function handleAdminFinanceRoute(context) {
  const {
    req, pathname, url, principal, postgres, commerce, send, body, mutate,
  } = context;
  const parts = pathParts(pathname, PREFIX);

  if (parts[0] === 'subscriptions' && parts.length === 1 && req.method === 'GET') {
    permission(principal, 'subscriptions.read');
    send(200, stringBigInts(await postgres.subscriptions.list({
      ...pageInput(url),
      userId: url.searchParams.get('userId'),
    })));
    return true;
  }

  if (parts[0] === 'subscriptions' && parts.length === 1 && req.method === 'POST') {
    permission(principal, 'subscriptions.write');
    const input = await body();
    const reason = requireReason(input.reason);
    const identity = assignmentIdentity(input, reason, principal.account.id);
    const existing = await postgres.subscriptions.findAssignment(identity);
    const bonusPoints = existing.replayed
      ? existing.responseSnapshot.bonusPoints
      : await postgres.subscriptions.assignmentBonusPoints(input);
    if (!existing.replayed && BigInt(bonusPoints) > 0n) {
      permission(principal, 'points.adjust');
    }
    const result = await mutate({
      action: 'subscription.assign',
      targetType: 'user',
      targetId: input.userId,
      details: { reason, bonusPoints },
    }, () => assignSubscription(context, input, identity));
    send(201, stringBigInts(result));
    return true;
  }

  if (parts[0] === 'subscriptions' && parts.length === 2 && req.method === 'PATCH') {
    permission(principal, 'subscriptions.write');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'subscription.update',
      targetType: 'subscription',
      targetId: parts[1],
      details: { reason },
    }, () => postgres.withTransaction(
      (tx) => tx.subscriptions.update(parts[1], input),
    ));
    send(200, result);
    return true;
  }

  if (parts[0] === 'points' && parts.length === 1 && req.method === 'GET') {
    permission(principal, 'points.read');
    const userId = url.searchParams.get('userId');
    if (!userId) throw new Error('invalid-user-id');
    const [wallet, ledger] = await Promise.all([
      postgres.points.getWallet(userId),
      postgres.points.listForUser(userId, pageInput(url)),
    ]);
    send(200, stringBigInts({ wallet, ...ledger }));
    return true;
  }

  if (parts.join('/') === 'points/adjustments' && req.method === 'POST') {
    permission(principal, 'points.adjust');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'points.adjust',
      targetType: 'user',
      targetId: input.userId,
      details: { amount: input.amount, reason },
    }, () => postgres.withTransaction((tx) => tx.points.post({
      ...input,
      reason,
      kind: 'admin_adjustment',
      actorAdminId: principal.account.id,
    })));
    send(201, stringBigInts(safePointResult(result)));
    return true;
  }

  if (parts.join('/') === 'cdk/campaigns' && req.method === 'GET') {
    permission(principal, 'cdk.read');
    send(200, await postgres.cdk.listCampaigns(pageInput(url)));
    return true;
  }

  if (parts.join('/') === 'cdk/campaigns' && req.method === 'POST') {
    permission(principal, 'cdk.write');
    const input = await body();
    const reason = requireReason(input.reason);
    const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
    const result = await mutate({
      action: 'cdk.campaign.create',
      targetType: 'cdk-campaign',
      details: { quantity: input.quantity, reason },
    }, () => commerce.createCampaign({
      ...input,
      reason,
      idempotencyKey,
    }, principal.account.id));
    send(201, result);
    return true;
  }

  if (parts[0] === 'cdk' && parts[1] === 'campaigns' && parts[3] === 'revoke'
      && parts.length === 4 && req.method === 'POST') {
    permission(principal, 'cdk.write');
    const input = await body();
    const reason = requireReason(input.reason);
    const result = await mutate({
      action: 'cdk.campaign.revoke',
      targetType: 'cdk-campaign',
      targetId: parts[2],
      details: { reason },
    }, () => postgres.withTransaction(
      (tx) => tx.cdk.revokeCampaign(parts[2], principal.account.id),
    ));
    send(200, result);
    return true;
  }

  return false;
}
