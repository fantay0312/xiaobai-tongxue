import assert from 'node:assert/strict';

type PendingResponse = {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
};

function deferredResponse(): PendingResponse {
  let resolve = (_response: Response): void => undefined;
  const promise = new Promise<Response>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function meResponse(user: string | null, phoneBindingRequired = false): Response {
  return new Response(JSON.stringify({
    user: user ? { name: user } : null,
    authRequired: true,
    captchaAvailable: true,
    emailAuthAvailable: true,
    smsAuthAvailable: true,
    registrationAvailable: true,
    inviteRequired: false,
    emailBindingRequired: false,
    phoneBindingRequired,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition-timeout');
}

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    dispatchEvent: () => true,
    setTimeout: (handler: TimerHandler) => setTimeout(handler, 0),
  },
});
Object.defineProperty(globalThis, 'BroadcastChannel', {
  configurable: true,
  value: undefined,
});

const { useAuthStore } = await import('../src/store/authStore');

function resetStableAnonymous(): void {
  useAuthStore.setState({
    status: 'anon',
    user: null,
    emailMasked: null,
    emailBindingRequired: false,
    phoneMasked: null,
    phoneBindingRequired: false,
    emailAuthAvailable: true,
    smsAuthAvailable: true,
    registrationAvailable: true,
    inviteRequired: false,
  });
}

resetStableAnonymous();
globalThis.fetch = async () => { throw new TypeError('offline'); };
await useAuthStore.getState().refreshSession(false);
assert.equal(useAuthStore.getState().status, 'anon',
  'background revalidation must retain a resolved anonymous snapshot when the network fails');
assert.equal(useAuthStore.getState().emailAuthAvailable, true,
  'background failure must not erase previously confirmed capabilities');

useAuthStore.setState({
  status: 'authed', user: 'stale-user', phoneBindingRequired: true,
  phoneMasked: '138****0000', emailAuthAvailable: true,
});
globalThis.fetch = async () => { throw new TypeError('offline'); };
await useAuthStore.getState().refreshSession(false);
assert.equal(useAuthStore.getState().status, 'unavailable',
  'an authenticated snapshot must fail closed after background network retries are exhausted');
assert.equal(useAuthStore.getState().user, null);
assert.equal(useAuthStore.getState().phoneBindingRequired, false);

for (const rejectedStatus of [401, 403]) {
  useAuthStore.setState({ status: 'authed', user: 'expired-user' });
  globalThis.fetch = async () => new Response('{}', { status: rejectedStatus });
  await useAuthStore.getState().refreshSession(false);
  assert.equal(useAuthStore.getState().status, 'unavailable',
    `an explicit ${rejectedStatus} authentication rejection must fail closed`);
  assert.equal(useAuthStore.getState().user, null);
}

resetStableAnonymous();
let serverFailureCalls = 0;
globalThis.fetch = async () => {
  serverFailureCalls += 1;
  return new Response('{}', { status: 500 });
};
await useAuthStore.getState().refreshSession(false);
assert.equal(serverFailureCalls, 3);
assert.equal(useAuthStore.getState().status, 'unavailable',
  'an HTTP server failure must not retain a stale resolved snapshot');

resetStableAnonymous();
globalThis.fetch = async () => new Response('{}', {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});
await useAuthStore.getState().refreshSession(false);
assert.equal(useAuthStore.getState().status, 'unavailable',
  'a malformed successful response must fail closed');

resetStableAnonymous();
globalThis.fetch = async () => new Response(JSON.stringify({
  authRequired: true,
  user: { name: 'malformed-user' },
  captchaAvailable: true,
}), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});
await useAuthStore.getState().refreshSession(false);
assert.equal(useAuthStore.getState().status, 'unavailable',
  'an authenticated response with missing binding gates must fail closed');
assert.equal(useAuthStore.getState().user, null);

resetStableAnonymous();
const pendingSoftResponse = deferredResponse();
globalThis.fetch = async () => pendingSoftResponse.promise;
const pendingSoftRefresh = useAuthStore.getState().refreshSession(false);
assert.equal(useAuthStore.getState().status, 'anon',
  'background revalidation must not replace the login form with an unknown-state loader');
pendingSoftResponse.resolve(meResponse(null));
await pendingSoftRefresh;

useAuthStore.setState({ status: 'unknown' });
globalThis.fetch = async () => { throw new TypeError('offline'); };
await useAuthStore.getState().refreshSession(false);
assert.equal(useAuthStore.getState().status, 'unavailable',
  'an unresolved first load must fail closed instead of preserving unknown forever');

resetStableAnonymous();
await useAuthStore.getState().refreshSession(true);
assert.equal(useAuthStore.getState().status, 'unavailable',
  'an explicit auth-invalidating refresh must fail closed');
assert.equal(useAuthStore.getState().emailAuthAvailable, false);

resetStableAnonymous();
const older = deferredResponse();
const newer = deferredResponse();
let concurrentCalls = 0;
globalThis.fetch = async () => {
  concurrentCalls += 1;
  return concurrentCalls === 1 ? older.promise : newer.promise;
};
const olderRefresh = useAuthStore.getState().refreshSession(false);
const newerRefresh = useAuthStore.getState().refreshSession(false);
newer.resolve(meResponse('newer-user'));
await newerRefresh;
older.resolve(meResponse('stale-user'));
await olderRefresh;
assert.equal(concurrentCalls, 2);
assert.equal(useAuthStore.getState().user, 'newer-user',
  'a late response from a superseded focus refresh must not overwrite the newer identity');

useAuthStore.setState({ status: 'authed', user: 'stable-user' });
const background = deferredResponse();
const invalidating = deferredResponse();
let interleavedCalls = 0;
globalThis.fetch = async () => {
  interleavedCalls += 1;
  return interleavedCalls === 1 ? background.promise : invalidating.promise;
};
const backgroundRefresh = useAuthStore.getState().refreshSession(false);
const invalidatingRefresh = useAuthStore.getState().refreshSession(true);
invalidating.resolve(meResponse(null));
await invalidatingRefresh;
background.resolve(meResponse('stale-user'));
await backgroundRefresh;
assert.equal(interleavedCalls, 2);
assert.equal(useAuthStore.getState().status, 'anon');
assert.equal(useAuthStore.getState().user, null,
  'fail-closed revalidation must win over an older background response');

resetStableAnonymous();
const olderDirect = deferredResponse();
const newerDirect = deferredResponse();
let directCalls = 0;
globalThis.fetch = async () => {
  directCalls += 1;
  return directCalls === 1 ? olderDirect.promise : newerDirect.promise;
};
const olderInit = useAuthStore.getState().init(true);
const newerInit = useAuthStore.getState().init(true);
newerDirect.resolve(meResponse('newest-direct-user', true));
await newerInit;
olderDirect.resolve(meResponse('stale-direct-user'));
await olderInit;
assert.equal(useAuthStore.getState().user, 'newest-direct-user');
assert.equal(useAuthStore.getState().phoneBindingRequired, true,
  'a stale direct init response must not overwrite a newer phone-binding gate');

resetStableAnonymous();
const logoutResponse = deferredResponse();
const queuedRefreshResponse = deferredResponse();
let mutationCalls = 0;
globalThis.fetch = async () => {
  mutationCalls += 1;
  return mutationCalls === 1 ? logoutResponse.promise : queuedRefreshResponse.promise;
};
const logout = useAuthStore.getState().logout();
await useAuthStore.getState().refreshSession(false);
await useAuthStore.getState().refreshSession(true);
logoutResponse.resolve(new Response('{}', { status: 200 }));
await logout;
await waitFor(() => mutationCalls === 2);
assert.equal(useAuthStore.getState().status, 'unknown',
  'a queued fail-closed refresh must take precedence over a queued background refresh');
queuedRefreshResponse.resolve(meResponse(null));
await waitFor(() => useAuthStore.getState().status === 'anon');

console.log('auth state revalidation: ok');
