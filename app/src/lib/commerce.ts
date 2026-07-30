import { API_BASE, gatewayFetch } from './api';
import {
  decodeCommerceCatalog,
  decodeCommerceRedemption,
  decodeCommerceSummary,
  type CommerceCatalog,
  type CommerceRedemption,
  type CommerceSummary,
} from './commerce-types';

interface CommerceRequestOptions {
  signal?: AbortSignal;
}

export class CommerceApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'CommerceApiError';
    this.code = code;
    this.status = status;
  }
}

async function payload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function expectOk(response: Response): Promise<unknown> {
  const body = await payload(response);
  if (response.ok) return body;
  const code = body && typeof body === 'object' && !Array.isArray(body)
    && typeof (body as Record<string, unknown>).error === 'string'
    ? String((body as Record<string, unknown>).error)
    : 'commerce-request-failed';
  throw new CommerceApiError(code, response.status);
}

export async function fetchCommerceCatalog(
  options: CommerceRequestOptions = {},
): Promise<CommerceCatalog> {
  const response = await gatewayFetch(`${API_BASE}/commerce/catalog`, {
    signal: options.signal,
    headers: { Accept: 'application/json' },
  });
  return decodeCommerceCatalog(await expectOk(response));
}

export async function fetchCommerceSummary(
  options: CommerceRequestOptions = {},
): Promise<CommerceSummary> {
  const response = await gatewayFetch(`${API_BASE}/commerce/me`, {
    signal: options.signal,
    headers: { Accept: 'application/json' },
  });
  return decodeCommerceSummary(await expectOk(response));
}

export async function redeemCommerceCode(code: string): Promise<CommerceRedemption> {
  const response = await gatewayFetch(`${API_BASE}/commerce/cdk/redeem`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
  return decodeCommerceRedemption(await expectOk(response));
}

export function commerceErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '';
  if (!(error instanceof CommerceApiError)) return '暂时无法读取订阅资料，请稍后重试。';
  const messages: Record<string, string> = {
    'invalid-cdk': '兑换码无效、已使用或已过期，请核对后再试。',
    'cdk-expired': '兑换码已过期，请联系发放方。',
    'cdk-already-used': '兑换码已使用或已被撤销。',
    'cdk-unavailable': '兑换服务正在维护，请稍后再试。',
    'invalid-code': '兑换码无效、已使用或已过期，请核对后再试。',
    'code-unavailable': '兑换码无效、已使用或已过期，请核对后再试。',
    'too-many-attempts': '尝试次数过多，请稍后再试。',
    'phone-verification-required': '请先完成手机号验证，再兑换权益。',
    'commerce-unavailable': '订阅服务正在维护，请稍后再试。',
  };
  return messages[error.code] ?? '这次操作没有完成，请稍后再试。';
}

export type {
  CommerceCatalog,
  CommerceEntitlement,
  CommerceFeature,
  CommercePlan,
  CommercePrice,
  CommerceRedemption,
  CommerceSubscription,
  CommerceSummary,
} from './commerce-types';
