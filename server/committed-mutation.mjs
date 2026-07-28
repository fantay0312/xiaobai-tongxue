export async function commitThenRefresh({ commit, refresh, onRefreshFailure }) {
  if (typeof commit !== 'function' || typeof refresh !== 'function'
    || typeof onRefreshFailure !== 'function') {
    throw new Error('commit-refresh-handlers-required');
  }
  const committed = await commit();
  try {
    const refreshed = await refresh();
    return { committed, refreshed };
  } catch (error) {
    onRefreshFailure(error);
    throw error;
  }
}
