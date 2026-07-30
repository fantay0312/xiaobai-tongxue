import { cdkHash, normalizeCdk } from '../admin/config.mjs';
import { createCdkCampaignCreator } from './cdk-creation.mjs';
import { readFrozenRewards } from './cdk-rewards.mjs';
import { createCommerceReadModel } from './read-model.mjs';

function rewardLabels(rewards) {
  return rewards.map((reward) => ({ type: reward.type, label: reward.label }));
}

async function replayRedemption(tx, user, code) {
  if (typeof tx.cdk.findRedemptionByCode !== 'function') {
    throw new Error('cdk-already-used');
  }
  const redemption = await tx.cdk.findRedemptionByCode(code.id);
  if (!redemption || redemption.userId !== user.id) throw new Error('cdk-already-used');
  const snapshot = readFrozenRewards(
    redemption.rewardsSnapshot,
    { allowExpired: true },
  );
  return rewardLabels(snapshot.items);
}

async function issueFrozenRewards(tx, user, code, rewardsSnapshot) {
  const rewards = rewardsSnapshot.items;
  const pointTotal = rewards
    .filter((item) => item.type === 'points')
    .reduce((sum, item) => sum + BigInt(item.amount), 0n);
  let pointOperationId = null;
  let subscriptionId = null;
  const subscription = rewards.find((item) => item.type === 'subscription');
  if (subscription) {
    const startsAt = new Date();
    const assigned = await tx.cdk.createFrozenSubscription({
      userId: user.id,
      reward: subscription,
      startsAt,
      endsAt: new Date(startsAt.getTime() + subscription.durationDays * 86_400_000),
    });
    subscriptionId = assigned.id;
  }
  for (const reward of rewards.filter((item) => item.type === 'entitlement')) {
    await tx.cdk.grantFrozenEntitlement({
      userId: user.id, reward, sourceReference: code.id,
    });
  }
  if (pointTotal > 0n) {
    const posted = await tx.points.post({
      userId: user.id,
      amount: pointTotal.toString(),
      kind: 'cdk_redeem',
      idempotencyKey: `cdk:${code.id}:points`,
      reason: 'CDK 兑换',
      metadata: { codeId: code.id, campaignId: code.campaignId },
    });
    pointOperationId = posted.operation.id;
  }
  await tx.cdk.completeRedemption({
    codeId: code.id,
    campaignId: code.campaignId,
    userId: user.id,
    rewards: rewardsSnapshot,
    pointOperationId,
    subscriptionId,
  });
  await tx.cdk.completeCampaignIfExhausted(code.campaignId);
  return rewardLabels(rewards);
}

async function redeemLockedCode(tx, user, candidates) {
  const code = await tx.cdk.lockCode([...candidates.values()]);
  if (!code || candidates.get(Number(code.keyVersion)) !== code.codeHash) {
    throw new Error('invalid-cdk');
  }
  if (code.status === 'redeemed') return replayRedemption(tx, user, code);
  if (code.status !== 'active' || code.campaignStatus !== 'active') {
    throw new Error('cdk-already-used');
  }
  if (code.campaignExpiresAt
      && new Date(code.campaignExpiresAt).getTime() <= Date.now()) {
    throw new Error('cdk-expired');
  }
  return issueFrozenRewards(tx, user, code, readFrozenRewards(code.rewards));
}

export function createCommerceService({
  postgres,
  cdkKeys,
  currentCdkVersion,
  cdkExportRootKey,
  catalogCacheTtlMs = 3_000,
  now = Date.now,
} = {}) {
  if (!postgres?.withTransaction) throw new Error('commerce-postgres-required');
  const keys = cdkKeys ?? new Map();
  const readModel = createCommerceReadModel({ postgres, catalogCacheTtlMs, now });
  const { summary } = readModel;
  const createCampaign = createCdkCampaignCreator({
    postgres,
    cdkKeys: keys,
    currentCdkVersion,
    exportRootKey: cdkExportRootKey,
    now,
  });

  async function redeem(user, rawCode) {
    const normalized = normalizeCdk(rawCode);
    if (!normalized) throw new Error('invalid-cdk');
    if (keys.size === 0) throw new Error('cdk-unavailable');
    const candidates = new Map();
    for (const [version, key] of keys) {
      candidates.set(version, cdkHash(key, version, normalized));
    }
    const result = await postgres.withTransaction(
      (tx) => redeemLockedCode(tx, user, candidates),
    );
    let commerce = null;
    try {
      commerce = await summary(user);
    } catch {
      // Redemption is already committed; a read-model outage must not turn success into a 500.
    }
    return { ok: true, rewards: result, commerce };
  }

  return Object.freeze({
    ...readModel,
    createCampaign,
    redeem,
  });
}
