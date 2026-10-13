/** Only immutable, fully indexed source versions may share a short-lived chunk read. */
export function sourceCacheOptions(asset) {
  if (asset.parseStatus !== 'completed' || asset.enableStatus !== 'enabled') return {};
  return { cacheKey: `${asset.id}:${asset.statusRevision ?? asset.updatedAt}` };
}
