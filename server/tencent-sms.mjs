import crypto from 'node:crypto';

const SMS_HOST = 'sms.tencentcloudapi.com';
const SMS_ENDPOINT = `https://${SMS_HOST}`;
const SMS_SERVICE = 'sms';
const SMS_ACTION = 'SendSms';
const SMS_VERSION = '2021-01-11';
const SMS_CONTENT_TYPE = 'application/json; charset=utf-8';

export function normalizeMainlandPhone(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  let national;
  if (/^1[3-9]\d{9}$/.test(input)) national = input;
  else if (/^\+861[3-9]\d{9}$/.test(input)) national = input.slice(3);
  else if (/^00861[3-9]\d{9}$/.test(input)) national = input.slice(4);
  else if (/^861[3-9]\d{9}$/.test(input)) national = input.slice(2);
  return national ? `+86${national}` : null;
}

export function maskPhone(value) {
  const phone = normalizeMainlandPhone(value);
  return phone ? `${phone.slice(0, 6)}****${phone.slice(-4)}` : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

function utcDate(timestamp) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function createTencentTc3Headers(options) {
  const {
    secretId, secretKey, sessionToken, payload, timestamp,
    host = SMS_HOST, region = 'ap-guangzhou',
  } = options ?? {};
  if (!secretId || !secretKey || typeof payload !== 'string'
    || !Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new Error('tencent-tc3-bad-input');
  }
  const date = utcDate(timestamp);
  const canonicalHeaders = `content-type:${SMS_CONTENT_TYPE}\n`
    + `host:${host}\nx-tc-action:${SMS_ACTION.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = [
    'POST', '/', '', canonicalHeaders, signedHeaders, sha256(payload),
  ].join('\n');
  const scope = `${date}/${SMS_SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256', String(timestamp), scope, sha256(canonicalRequest),
  ].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, SMS_SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign, 'hex');
  const authorization = 'TC3-HMAC-SHA256 '
    + `Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    Authorization: authorization,
    'Content-Type': SMS_CONTENT_TYPE,
    Host: host,
    'X-TC-Action': SMS_ACTION,
    'X-TC-Region': region,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': SMS_VERSION,
    ...(sessionToken ? { 'X-TC-Token': sessionToken } : {}),
  };
}

function templateForPurpose(options, purpose) {
  if (purpose === 'login') return options.loginTemplateId || options.templateId;
  if (purpose === 'reset-password') return options.resetTemplateId || options.templateId;
  return options.bindTemplateId || options.templateId;
}

function responseError(data) {
  const apiError = data?.Response?.Error?.Code;
  if (typeof apiError === 'string' && apiError) return apiError;
  const statuses = data?.Response?.SendStatusSet;
  if (!Array.isArray(statuses) || statuses.length !== 1) return 'InvalidResponse';
  return statuses[0]?.Code === 'Ok' ? null : String(statuses[0]?.Code || 'SendFailed');
}

function validateSenderOptions(options) {
  const required = ['secretId', 'secretKey', 'sdkAppId', 'signName', 'templateId'];
  if (required.some((key) => typeof options?.[key] !== 'string' || !options[key].trim())) {
    throw new Error('tencent-sms-not-configured');
  }
  if (typeof options.fetchImpl !== 'function') throw new Error('tencent-sms-fetch-required');
}

export function createTencentSmsSender(input = {}) {
  const options = {
    endpoint: SMS_ENDPOINT,
    region: 'ap-guangzhou',
    timeoutMs: 10_000,
    fetchImpl: globalThis.fetch,
    now: Date.now,
    ...input,
  };
  validateSenderOptions(options);
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
    || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('tencent-sms-bad-endpoint');
  }

  return async ({ phone: value, code, purpose, expiresInMinutes, idempotencyKey }) => {
    const phone = normalizeMainlandPhone(value);
    const templateId = templateForPurpose(options, purpose);
    if (!phone || !/^\d{6}$/.test(code) || !templateId
      || !Number.isSafeInteger(expiresInMinutes)
      || expiresInMinutes < 1 || expiresInMinutes > 60) {
      throw new Error('tencent-sms-bad-message');
    }
    const payload = JSON.stringify({
      PhoneNumberSet: [phone],
      SmsSdkAppId: options.sdkAppId,
      SignName: options.signName,
      TemplateId: templateId,
      TemplateParamSet: [code, String(expiresInMinutes)],
      SessionContext: String(idempotencyKey ?? '').slice(0, 511),
    });
    const timestamp = Math.floor(options.now() / 1000);
    const headers = createTencentTc3Headers({
      ...options,
      payload,
      timestamp,
      host: endpoint.host,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await options.fetchImpl(endpoint, {
        method: 'POST', headers, body: payload, signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      const error = response.ok ? responseError(data) : `Http${response.status}`;
      if (error) throw new Error(`tencent-sms-request-failed:${error}`);
      return { requestId: data.Response.RequestId };
    } finally {
      clearTimeout(timer);
    }
  };
}
