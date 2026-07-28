import { API_BASE } from './api';

const CAPTCHA_SCRIPT_URL = 'https://turing.captcha.qcloud.com/TJCaptcha.js';
const CAPTCHA_LOAD_TIMEOUT_MS = 15_000;
const CAPTCHA_CHALLENGE_TIMEOUT_MS = 10_000;
const CAPTCHA_INTERACTION_TIMEOUT_MS = 5 * 60_000;
const MAX_OPAQUE_VALUE_LENGTH = 8_192;

export type CaptchaScene = 'email' | 'sms' | 'login';
export type CaptchaErrorReason = 'cancelled' | 'failed' | 'rate-limited' | 'unavailable';

export interface CaptchaProof {
  ticket: string;
  randstr: string;
  aidEncrypted: string;
}

export class CaptchaError extends Error {
  readonly reason: CaptchaErrorReason;
  readonly retryAfter?: number;

  constructor(reason: CaptchaErrorReason, retryAfter?: number) {
    super(reason);
    this.name = 'CaptchaError';
    this.reason = reason;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

interface CaptchaChallenge {
  captchaAppId: string;
  aidEncrypted: string;
  aidEncryptedType: 'cbc' | 'gcm';
}

interface TencentCaptchaInstance {
  show: () => void;
  destroy: () => void;
}

interface TencentCaptchaOptions {
  aidEncrypted: string;
  aidEncryptedType: 'cbc' | 'gcm';
  userLanguage: 'zh-cn';
}

type TencentCaptchaConstructor = new (
  captchaAppId: string,
  callback: (result: unknown) => void,
  options: TencentCaptchaOptions,
) => TencentCaptchaInstance;

declare global {
  interface Window {
    TencentCaptcha?: TencentCaptchaConstructor;
  }
}

let constructorPromise: Promise<TencentCaptchaConstructor> | null = null;

function currentConstructor(): TencentCaptchaConstructor | null {
  if (typeof window === 'undefined') return null;
  return typeof window.TencentCaptcha === 'function' ? window.TencentCaptcha : null;
}

function loadConstructorScript(): Promise<TencentCaptchaConstructor> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || !document.head) {
      reject(new CaptchaError('unavailable'));
      return;
    }

    const script = document.createElement('script');
    let settled = false;
    const timer = window.setTimeout(() => finish(null), CAPTCHA_LOAD_TIMEOUT_MS);

    const finish = (constructor: TencentCaptchaConstructor | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      script.removeEventListener('load', handleLoad);
      script.removeEventListener('error', handleError);
      if (constructor) {
        resolve(constructor);
      } else {
        script.remove();
        reject(new CaptchaError('unavailable'));
      }
    };
    const handleLoad = (): void => finish(currentConstructor());
    const handleError = (): void => finish(null);

    script.src = CAPTCHA_SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    document.head.append(script);
  });
}

async function loadConstructor(): Promise<TencentCaptchaConstructor> {
  const existing = currentConstructor();
  if (existing) return existing;
  constructorPromise ??= loadConstructorScript();
  try {
    return await constructorPromise;
  } catch (error) {
    constructorPromise = null;
    if (error instanceof CaptchaError) throw error;
    throw new CaptchaError('unavailable');
  }
}

function isOpaqueString(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_OPAQUE_VALUE_LENGTH
    && value === value.trim();
}

function parseChallenge(value: unknown): CaptchaChallenge | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const captchaAppId = record.captchaAppId;
  const aidEncrypted = record.aidEncrypted;
  const aidEncryptedType = record.aidEncryptedType;
  if (!isOpaqueString(captchaAppId) || !/^\d+$/.test(captchaAppId)) return null;
  if (!isOpaqueString(aidEncrypted)) return null;
  if (aidEncryptedType !== 'cbc' && aidEncryptedType !== 'gcm') return null;
  return { captchaAppId, aidEncrypted, aidEncryptedType };
}

async function requestChallenge(scene: CaptchaScene): Promise<CaptchaChallenge> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), CAPTCHA_CHALLENGE_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/captcha/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const seconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const retryAfter = Number.isFinite(seconds)
        ? Math.min(3600, Math.max(1, Math.ceil(seconds)))
        : undefined;
      throw new CaptchaError('rate-limited', retryAfter);
    }
    if (!response.ok) throw new CaptchaError('unavailable');
    const payload: unknown = await response.json();
    const challenge = parseChallenge(payload);
    if (!challenge) throw new CaptchaError('unavailable');
    return challenge;
  } catch (error) {
    if (error instanceof CaptchaError) throw error;
    throw new CaptchaError('unavailable');
  } finally {
    window.clearTimeout(timer);
  }
}

function parseProof(result: unknown, aidEncrypted: string): CaptchaProof | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  if (record.ret !== 0 || (record.errorCode !== undefined && record.errorCode !== null)) return null;
  if (!isOpaqueString(record.ticket) || !isOpaqueString(record.randstr)) return null;
  if (record.ticket.toLowerCase().startsWith('trerror')) return null;
  return { ticket: record.ticket, randstr: record.randstr, aidEncrypted };
}

function callbackFailureReason(result: unknown): CaptchaErrorReason {
  if (!result || typeof result !== 'object') return 'failed';
  const record = result as Record<string, unknown>;
  const ticket = record.ticket;
  const hasSdkError = record.errorCode !== undefined && record.errorCode !== null;
  const isDisasterTicket = typeof ticket === 'string'
    && ticket.toLowerCase().startsWith('trerror');
  return hasSdkError || isDisasterTicket ? 'unavailable' : 'failed';
}

function showCaptcha(
  Constructor: TencentCaptchaConstructor,
  challenge: CaptchaChallenge,
): Promise<CaptchaProof> {
  return new Promise((resolve, reject) => {
    let instance: TencentCaptchaInstance | null = null;
    let settled = false;
    const timer = window.setTimeout(() => finish(null, 'unavailable'), CAPTCHA_INTERACTION_TIMEOUT_MS);

    const cleanup = (): void => {
      window.clearTimeout(timer);
      try {
        instance?.destroy();
      } catch {
        // 第三方实例销毁失败不改变本次验证码的关闭态。
      }
      instance = null;
    };
    const finish = (proof: CaptchaProof | null, reason: CaptchaErrorReason): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (proof) resolve(proof);
      else reject(new CaptchaError(reason));
    };
    const callback = (result: unknown): void => {
      const cancelled = !!result && typeof result === 'object'
        && (result as Record<string, unknown>).ret === 2;
      if (cancelled) {
        finish(null, 'cancelled');
        return;
      }
      const proof = parseProof(result, challenge.aidEncrypted);
      finish(proof, callbackFailureReason(result));
    };

    try {
      instance = new Constructor(challenge.captchaAppId, callback, {
        aidEncrypted: challenge.aidEncrypted,
        aidEncryptedType: challenge.aidEncryptedType,
        userLanguage: 'zh-cn',
      });
      if (settled) cleanup();
      else instance.show();
    } catch {
      finish(null, 'unavailable');
    }
  });
}

export async function requestCaptchaProof(scene: CaptchaScene): Promise<CaptchaProof> {
  try {
    const Constructor = await loadConstructor();
    // 第三方 SDK 先加载完成，再申请一次一密 challenge，避免把网络加载时间计入有效期。
    const challenge = await requestChallenge(scene);
    return await showCaptcha(Constructor, challenge);
  } catch (error) {
    if (error instanceof CaptchaError) throw error;
    throw new CaptchaError('unavailable');
  }
}
