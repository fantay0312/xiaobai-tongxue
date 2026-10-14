import assert from 'node:assert/strict';

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  setTimeout: (handler: TimerHandler, ms?: number) => setTimeout(handler, ms === 10_000 ? 20 : ms),
  clearTimeout,
  dispatchEvent: () => true,
} });
Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
const { completeResponse } = await import('../src/lib/completeResponse');
const { requestCaptchaProof, CaptchaError } = await import('../src/lib/tencentCaptcha');
const { useAuthStore } = await import('../src/store/authStore');

const stalledBody = () => new Response(new ReadableStream({ start() {} }));
await assert.rejects(completeResponse(async () => stalledBody(), 10), { name: 'AbortError' });
await assert.rejects(completeResponse(() => new Promise(() => {}), 10), { name: 'AbortError' });
const cancelled = new AbortController();
cancelled.abort();
let requests = 0;
await assert.rejects(completeResponse(async () => { requests++; return new Response(); }, 100, cancelled.signal),
  { name: 'AbortError' });
assert.equal(requests, 0, 'a cancelled request must not be sent');
const response = await completeResponse(async () => new Response('{"error":"invalid-code"}', {
  status: 400, headers: { 'Retry-After': '60' },
}), 100);
assert.equal(response.status, 400);
assert.equal(response.headers.get('Retry-After'), '60');
assert.deepEqual(await response.json(), { error: 'invalid-code' });
assert.equal((await completeResponse(async () => new Response(null, { status: 204 }), 100)).status, 204);

type Callback = (value: unknown) => void;
const callbacks: Callback[] = [];
let destroyed = 0;
window.TencentCaptcha = class {
  constructor(_id: string, callback: Callback) { callbacks.push(callback); }
  show() {}
  destroy() { destroyed++; }
};
const challenge = () => new Response(JSON.stringify({
  captchaAppId: '123456', aidEncrypted: 'test-challenge', aidEncryptedType: 'gcm',
}));
const proof = { ret: 0, ticket: 'test-ticket', randstr: 'test-randstr' };
const me = () => new Response(JSON.stringify({
  user: { name: 'latest-user' }, authRequired: true, captchaAvailable: true,
  emailAuthAvailable: true, smsAuthAvailable: true, registrationAvailable: true,
  emailBindingRequired: false, phoneBindingRequired: false,
}));
let loginPosts = 0;
globalThis.fetch = async (input) => {
  if (String(input).endsWith('/captcha/challenge')) return challenge();
  if (String(input).endsWith('/me')) return me();
  loginPosts++;
  return me();
};
async function waitForCallback(count: number) {
  for (let attempt = 0; attempt < 30 && callbacks.length < count; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(callbacks.length, count);
}
const stop = new AbortController();
const cancelledCaptcha = requestCaptchaProof('login', stop.signal);
await waitForCallback(1);
stop.abort();
await assert.rejects(cancelledCaptcha, (error) => error instanceof CaptchaError && error.reason === 'cancelled');
callbacks[0](proof);
assert.equal(destroyed, 1, 'cancelled SDK instances must be destroyed exactly once');

const loginOperations = [
  (signal: AbortSignal) => useAuthStore.getState().login('account', 'password', signal),
  (signal: AbortSignal) => useAuthStore.getState().loginWithPhoneCode('+8613800000000', '123456', signal),
  (signal: AbortSignal) => useAuthStore.getState().loginWithEmailCode('qa@example.com', '123456', signal),
];
for (const login of loginOperations) {
  const controller = new AbortController();
  const count = callbacks.length + 1;
  const pending = login(controller.signal);
  await waitForCallback(count);
  controller.abort();
  assert.equal((await pending).ok, false);
  callbacks[count - 1](proof);
}
assert.equal(loginPosts, 0, 'late CAPTCHA callbacks after leaving the page must not post credentials');

const oldCount = callbacks.length + 1;
const oldLogin = useAuthStore.getState().login('old-account', 'password');
await waitForCallback(oldCount);
const newLogin = useAuthStore.getState().login('latest-user', 'password');
await waitForCallback(oldCount + 1);
callbacks[oldCount](proof);
assert.equal((await newLogin).ok, true);
callbacks[oldCount - 1](proof);
assert.equal((await oldLogin).ok, false);
assert.equal(loginPosts, 1, 'an older CAPTCHA must not replace a newer login');
assert.equal(useAuthStore.getState().user, 'latest-user');

globalThis.fetch = async (input) => {
  if (String(input).endsWith('/captcha/challenge')) return challenge();
  if (String(input).endsWith('/me')) return me();
  return stalledBody();
};
const bodyCount = callbacks.length + 1;
const stalledLogin = useAuthStore.getState().login('latest-user', 'password');
await waitForCallback(bodyCount);
callbacks[bodyCount - 1](proof);
const failed = await stalledLogin;
assert.equal(failed.ok, false);
assert.match(failed.message ?? '', /超时/);
await useAuthStore.getState().refreshSession(false);
assert.equal(useAuthStore.getState().user, 'latest-user', 'body timeout must release the authentication lock');
for (const requestCode of [
  () => useAuthStore.getState().requestSmsCode('+8613800000000', 'register', undefined, 'test-invite'),
  () => useAuthStore.getState().requestEmailCode('qa@example.com', 'register', 'test-invite'),
]) {
  globalThis.fetch = async (input) => String(input).endsWith('/captcha/challenge')
    ? challenge() : new Response(JSON.stringify({ error: 'already-registered' }), { status: 409 });
  const count = callbacks.length + 1;
  const pending = requestCode();
  await waitForCallback(count);
  callbacks[count - 1](proof);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.alreadyRegistered, true);
}
console.log('auth request deadlines and CAPTCHA lifecycle: ok');
