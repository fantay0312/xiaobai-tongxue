export function createResponseConcurrencyGate({
  limit,
  error = 'commerce-busy',
} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error('invalid-concurrency-limit');
  }
  const admittedRequests = new WeakSet();
  let active = 0;

  function acquire(request, response) {
    if (!request || typeof request !== 'object'
        || !response || typeof response !== 'object') {
      throw new Error('invalid-concurrency-request');
    }
    if (admittedRequests.has(request)) return { allowed: true, reused: true };
    if (active >= limit) return { allowed: false, error };

    admittedRequests.add(request);
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
      if (typeof response.off === 'function') {
        response.off('finish', release);
        response.off('close', release);
      }
    };
    if (typeof response.once === 'function') {
      response.once('finish', release);
      response.once('close', release);
    } else {
      // Lightweight unit-test response doubles do not expose lifecycle events.
      queueMicrotask(release);
    }
    return { allowed: true, reused: false };
  }

  return Object.freeze({ acquire });
}
