import crypto from 'node:crypto';

const CAPTCHA_ENDPOINT = 'https://captcha.tencentcloudapi.com';
const CAPTCHA_HOST = 'captcha.tencentcloudapi.com';
const CAPTCHA_SERVICE = 'captcha';
const CAPTCHA_ACTION = 'DescribeCaptchaResult';
const CAPTCHA_VERSION = '2019-07-22';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const CHALLENGE_TTL_SECONDS = 360;
const MAX_CHALLENGES = 10_000;
const MAX_RESPONSE_BYTES = 32 * 1024;

const RESULT_REQUIRED = Object.freeze({ ok: false, error: 'captcha-required' });
const RESULT_FAILED = Object.freeze({ ok: false, error: 'captcha-failed' });
const RESULT_UNAVAILABLE = Object.freeze({ ok: false, error: 'captcha-unavailable' });

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sceneConfig(env, name) {
  const upper = name.toUpperCase();
  const captchaAppId = text(env[`TENCENT_CAPTCHA_${upper}_APP_ID`]);
  const appSecretKey = text(env[`TENCENT_CAPTCHA_${upper}_SECRET`]);
  if (!/^[1-9]\d{0,15}$/.test(captchaAppId) || !appSecretKey) return null;
  const numericAppId = Number(captchaAppId);
  if (!Number.isSafeInteger(numericAppId)) return null;
  return Object.freeze({ captchaAppId, numericAppId, appSecretKey });
}

function credentialConfig(env) {
  const secretId = text(env.TENCENTCLOUD_SECRET_ID);
  const secretKey = text(env.TENCENTCLOUD_SECRET_KEY);
  const token = text(env.TENCENTCLOUD_TOKEN);
  const roleName = text(env.TENCENTCLOUD_CVM_ROLE_NAME);
  if (secretId || secretKey || token) {
    return secretId && secretKey
      ? { type: 'static', credentials: Object.freeze({ secretId, secretKey, token }) }
      : null;
  }
  if (!/^[A-Za-z0-9+=,.@_-]{1,128}$/.test(roleName)) return null;
  return { type: 'metadata', roleName };
}

function aesKey(appSecretKey) {
  const source = Buffer.from(appSecretKey, 'utf8');
  if (!source.length) throw new Error('empty-app-secret');
  if (source.length >= 32) return source.subarray(0, 32);
  const key = Buffer.allocUnsafe(32);
  for (let index = 0; index < key.length; index += 1) {
    key[index] = source[index % source.length];
  }
  return key;
}

export function createAidEncrypted(
  captchaAppId,
  appSecretKey,
  {
    nowSeconds = Math.floor(Date.now() / 1000),
    ttlSeconds = CHALLENGE_TTL_SECONDS,
    iv = crypto.randomBytes(12),
  } = {},
) {
  const ivBuffer = Buffer.from(iv);
  if (ivBuffer.length !== 12) throw new Error('bad-gcm-iv');
  if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(ttlSeconds)
    || ttlSeconds < 1 || ttlSeconds > 86_400) {
    throw new Error('bad-aid-time');
  }
  const plaintext = `${captchaAppId}&${nowSeconds}&${ttlSeconds}`;
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey(appSecretKey), ivBuffer);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([ivBuffer, ciphertext, cipher.getAuthTag()]).toString('base64');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

export function createTc3Headers(payload, credentials, timestamp) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:${CONTENT_TYPE}\nhost:${CAPTCHA_HOST}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`;
  const scope = `${date}/${CAPTCHA_SERVICE}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`;
  const secretDate = hmac(`TC3${credentials.secretKey}`, date);
  const secretService = hmac(secretDate, CAPTCHA_SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${scope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    Authorization: authorization,
    'Content-Type': CONTENT_TYPE,
    Host: CAPTCHA_HOST,
    'X-TC-Action': CAPTCHA_ACTION,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': CAPTCHA_VERSION,
    ...(credentials.token ? { 'X-TC-Token': credentials.token } : {}),
  };
}

async function responseJson(response, signal, maximum = MAX_RESPONSE_BYTES) {
  if (!response?.ok) {
    void response?.body?.cancel('upstream-http-error').catch(() => {});
    throw new Error('upstream-http-error');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('upstream-empty-body');
  const chunks = [];
  let size = 0;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    rejectAbort(signal.reason ?? new Error('upstream-aborted'));
  };
  if (signal.aborted) {
    void reader.cancel(signal.reason).catch(() => {});
    throw signal.reason ?? new Error('upstream-aborted');
  }
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        void reader.cancel('upstream-response-too-large').catch(() => {});
        throw new Error('upstream-response-too-large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (signal.aborted) void reader.cancel(signal.reason).catch(() => {});
    try { reader.releaseLock(); } catch {}
  }
  try {
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch {
    throw new Error('upstream-bad-json');
  }
}

async function fetchJsonWithTimeout(fetchImpl, url, init, timeoutMs, maximum = MAX_RESPONSE_BYTES) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      redirect: 'error',
    });
    return await responseJson(response, controller.signal, maximum);
  } finally {
    clearTimeout(timer);
  }
}

function validProofField(value, maximum) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function validCaptchaResponse(payload) {
  const response = payload?.Response;
  if (!response || typeof response !== 'object' || response.Error) {
    throw new Error('captcha-api-error');
  }
  if (!Number.isInteger(response.CaptchaCode) || !Number.isInteger(response.EvilLevel)) {
    throw new Error('captcha-api-bad-response');
  }
  return response.CaptchaCode === 1 && response.EvilLevel === 0;
}

export function createTencentCaptcha({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  randomBytes = crypto.randomBytes,
  challengeTtlSeconds = CHALLENGE_TTL_SECONDS,
  requestTimeoutMs = 5_000,
  metadataTimeoutMs = 1_500,
} = {}) {
  const emailScene = sceneConfig(env, 'email');
  const loginScene = sceneConfig(env, 'login');
  const scenes = new Map([
    ['email', emailScene],
    ['sms', emailScene],
    ['login', loginScene],
  ]);
  const credentialSource = credentialConfig(env);
  const distinctSceneApps = emailScene?.captchaAppId !== loginScene?.captchaAppId;
  const available = Boolean(emailScene && loginScene) && distinctSceneApps && Boolean(credentialSource)
    && typeof fetchImpl === 'function';
  const challenges = new Map();
  let cachedCredentials = null;
  let credentialRequest = null;

  function pruneChallenges(at) {
    for (const [aidEncrypted, challenge] of challenges) {
      if (challenge.expiresAt <= at) challenges.delete(aidEncrypted);
    }
  }

  function issueChallenge(scene) {
    if (!available) return RESULT_UNAVAILABLE;
    const config = scenes.get(scene);
    if (!config) return RESULT_REQUIRED;
    const at = now();
    pruneChallenges(at);
    if (challenges.size >= MAX_CHALLENGES) return RESULT_UNAVAILABLE;
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const aidEncrypted = createAidEncrypted(config.captchaAppId, config.appSecretKey, {
          nowSeconds: Math.floor(at / 1000),
          ttlSeconds: challengeTtlSeconds,
          iv: randomBytes(12),
        });
        if (challenges.has(aidEncrypted)) continue;
        challenges.set(aidEncrypted, { scene, expiresAt: at + challengeTtlSeconds * 1000 });
        return {
          ok: true,
          scene,
          captchaAppId: config.captchaAppId,
          aidEncrypted,
          aidEncryptedType: 'gcm',
          expiresIn: challengeTtlSeconds,
        };
      }
    } catch {
      return RESULT_UNAVAILABLE;
    }
    return RESULT_UNAVAILABLE;
  }

  function consumeChallenge(scene, proof) {
    if (!available) return RESULT_UNAVAILABLE;
    const aidEncrypted = validProofField(proof?.aidEncrypted, 4096) ? proof.aidEncrypted : '';
    const complete = validProofField(proof?.ticket, 4096)
      && validProofField(proof?.randstr, 1024) && aidEncrypted;
    if (!complete) {
      if (aidEncrypted) challenges.delete(aidEncrypted);
      return RESULT_REQUIRED;
    }
    const challenge = challenges.get(aidEncrypted);
    challenges.delete(aidEncrypted);
    if (!challenge || challenge.scene !== scene || challenge.expiresAt <= now()) return RESULT_FAILED;
    if (/^trerror_/i.test(proof.ticket)) return RESULT_FAILED;
    return { ok: true, ticket: proof.ticket, randstr: proof.randstr };
  }

  async function loadMetadataCredentials() {
    const role = credentialSource.roleName;
    const url = `http://metadata.tencentyun.com/latest/meta-data/cam/security-credentials/${encodeURIComponent(role)}`;
    const payload = await fetchJsonWithTimeout(
      fetchImpl,
      url,
      { method: 'GET' },
      metadataTimeoutMs,
      8 * 1024,
    );
    const secretId = text(payload?.TmpSecretId);
    const secretKey = text(payload?.TmpSecretKey);
    const token = text(payload?.Token);
    const expiresAt = Number(payload?.ExpiredTime);
    if (payload?.Code !== 'Success' || !secretId || !secretKey || !token
      || !Number.isFinite(expiresAt) || expiresAt <= Math.floor(now() / 1000) + 5) {
      throw new Error('metadata-bad-credentials');
    }
    cachedCredentials = Object.freeze({ secretId, secretKey, token, expiresAt });
    return cachedCredentials;
  }

  async function credentials() {
    if (credentialSource.type === 'static') return credentialSource.credentials;
    const nowSeconds = Math.floor(now() / 1000);
    if (cachedCredentials?.expiresAt > nowSeconds + 60) return cachedCredentials;
    if (!credentialRequest) credentialRequest = loadMetadataCredentials();
    const pending = credentialRequest;
    try {
      return await pending;
    } finally {
      if (credentialRequest === pending) credentialRequest = null;
    }
  }

  async function verify(scene, proof, userIp) {
    const claimed = consumeChallenge(scene, proof);
    if (!claimed.ok) return claimed;
    const config = scenes.get(scene);
    if (!config || !validProofField(userIp, 128)) return RESULT_FAILED;
    const body = JSON.stringify({
      CaptchaType: 9,
      Ticket: claimed.ticket,
      UserIp: userIp,
      Randstr: claimed.randstr,
      CaptchaAppId: config.numericAppId,
      AppSecretKey: config.appSecretKey,
      NeedGetCaptchaTime: 1,
    });
    try {
      const auth = await credentials();
      const timestamp = Math.floor(now() / 1000);
      const headers = createTc3Headers(body, auth, timestamp);
      const payload = await fetchJsonWithTimeout(fetchImpl, CAPTCHA_ENDPOINT, {
        method: 'POST',
        headers,
        body,
      }, requestTimeoutMs);
      return validCaptchaResponse(payload) ? { ok: true } : RESULT_FAILED;
    } catch {
      return RESULT_UNAVAILABLE;
    }
  }

  return Object.freeze({ available, issueChallenge, verify });
}
