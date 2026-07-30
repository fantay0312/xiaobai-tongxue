const SCOPES = new Set([
  'all', 'login', 'chat', 'asr', 'vision', 'state', 'transcript', 'commerce',
]);
const FEATURE_SCOPES = new Set([
  'login', 'chat', 'asr', 'vision', 'state', 'transcript', 'commerce',
]);

function asString(value) {
  return value == null ? '0' : String(value);
}

function publicCatalog(plans) {
  return {
    plans: plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      tagline: plan.tagline,
      description: plan.description,
      status: plan.status,
      prices: plan.prices.map((price) => ({
        id: price.id,
        billingPeriod: price.billingPeriod,
        currency: price.currency,
        amountMinor: asString(price.amountMinor),
        durationDays: price.durationDays,
        bonusPoints: asString(price.bonusPoints),
      })),
      entitlements: plan.entitlements.map((item) => ({
        key: item.entitlementKey,
        name: item.name,
        value: item.value,
      })),
    })),
  };
}

export function createCommerceReadModel({
  postgres,
  catalogCacheTtlMs = 3_000,
  now = Date.now,
} = {}) {
  if (!Number.isSafeInteger(catalogCacheTtlMs) || catalogCacheTtlMs < 1_000
      || catalogCacheTtlMs > 30_000 || typeof now !== 'function') {
    throw new Error('invalid-commerce-cache-config');
  }
  const requestSnapshots = new WeakMap();
  // Admin reads bypass this public cache. Default staleness is capped at three seconds;
  // invalidateCatalogCache is also exposed for an explicit admin mutation hook.
  let catalogGeneration = 0;
  let catalogCache = null;
  let catalogFlight = null;

  async function loadCatalog() {
    return publicCatalog(await postgres.catalog.listPlans({ activeOnly: true }));
  }

  async function catalog() {
    if (catalogCache && catalogCache.expiresAt > now()) return catalogCache.value;
    if (catalogFlight) return catalogFlight.promise;
    const generation = catalogGeneration;
    const flight = {};
    flight.promise = loadCatalog().then((value) => {
      if (generation === catalogGeneration) {
        catalogCache = { value, expiresAt: now() + catalogCacheTtlMs };
      }
      return value;
    }).finally(() => {
      if (catalogFlight === flight) catalogFlight = null;
    });
    catalogFlight = flight;
    return flight.promise;
  }

  function invalidateCatalogCache() {
    catalogGeneration += 1;
    catalogCache = null;
    catalogFlight = null;
  }

  function snapshotFor(user, request) {
    if (!request || typeof request !== 'object') return { userId: user.id };
    const current = requestSnapshots.get(request);
    if (current?.userId === user.id) return current;
    const created = { userId: user.id };
    requestSnapshots.set(request, created);
    return created;
  }

  function snapshotEntitlements(snapshot) {
    snapshot.entitlements ??= postgres.subscriptions.effectiveEntitlements(snapshot.userId);
    return snapshot.entitlements;
  }

  function snapshotFeatures(snapshot) {
    snapshot.features ??= snapshotEntitlements(snapshot).then(
      (entitlements) => postgres.subscriptions.effectiveFeatures(
        snapshot.userId,
        entitlements,
      ),
    );
    return snapshot.features;
  }

  async function summary(user, request = null) {
    const snapshot = snapshotFor(user, request);
    const [wallet, subscription, entitlements, features] = await Promise.all([
      postgres.points.getWallet(user.id),
      postgres.subscriptions.activeForUser(user.id),
      snapshotEntitlements(snapshot),
      snapshotFeatures(snapshot),
    ]);
    return {
      wallet: { available: asString(wallet?.available) },
      subscription: subscription ? {
        id: subscription.id,
        planName: subscription.planName,
        status: subscription.status,
        startsAt: subscription.startsAt,
        endsAt: subscription.endsAt,
      } : null,
      entitlements: entitlements.map((item) => ({
        key: item.entitlementKey,
        name: item.name,
        value: item.value,
        expiresAt: item.expiresAt,
      })),
      features: features.map((item) => ({
        key: item.key,
        name: item.name,
        enabled: item.enabled,
        reason: item.reason,
      })),
    };
  }

  async function accessDecision(user, scope, request = null) {
    if (!SCOPES.has(scope)) throw new Error('invalid-access-scope');
    const restriction = await postgres.userAccess.activeRestriction(user.id, scope);
    if (restriction) {
      return {
        allowed: false,
        error: 'account-restricted',
        reason: restriction.publicReason || '',
        expiresAt: restriction.expiresAt,
      };
    }
    const features = await snapshotFeatures(snapshotFor(user, request));
    if (FEATURE_SCOPES.has(scope)) {
      const feature = features.find((item) => item.key === scope);
      if (!feature || !feature.enabled) {
        return {
          allowed: false,
          error: 'feature-disabled',
          reason: feature?.reason || 'feature-not-configured',
        };
      }
    }
    return { allowed: true };
  }

  return Object.freeze({ catalog, invalidateCatalogCache, summary, accessDecision });
}
