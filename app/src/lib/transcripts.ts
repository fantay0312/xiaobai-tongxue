import { API_BASE, gatewayFetch } from './api';

export const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
export const TRANSCRIPT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

export type TranscriptMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

export interface TranscriptMeta {
  name: string;
  size: number;
  mime: TranscriptMime;
  updatedAt: string;
}

const SUPPORTED_MIMES = new Set<TranscriptMime>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const EXTENSION_MIMES: Record<string, TranscriptMime> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export class TranscriptRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code || `transcript-http-${status}`);
    this.name = 'TranscriptRequestError';
    this.status = status;
    this.code = code;
  }
}

/** 浏览器偶尔不给本地文件 MIME；仅在 MIME 为空时按白名单扩展名补齐。 */
export function transcriptMimeForFile(file: File): TranscriptMime | null {
  const declared = file.type.trim().toLowerCase();
  if (declared === 'image/jpg') return 'image/jpeg';
  if (SUPPORTED_MIMES.has(declared as TranscriptMime)) return declared as TranscriptMime;
  if (declared) return null;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIMES[extension] ?? null;
}

function transcriptMetaFrom(value: unknown): TranscriptMeta | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<Record<keyof TranscriptMeta | 'type', unknown>>;
  const rawMime = item.mime ?? item.type;
  if (
    typeof item.name !== 'string' || item.name.length === 0
    || typeof item.size !== 'number' || !Number.isFinite(item.size) || item.size < 0
    || typeof rawMime !== 'string' || !SUPPORTED_MIMES.has(rawMime as TranscriptMime)
    || typeof item.updatedAt !== 'string' || item.updatedAt.length === 0
  ) return undefined;
  return {
    name: item.name,
    size: item.size,
    mime: rawMime as TranscriptMime,
    updatedAt: item.updatedAt,
  };
}

async function responseError(response: Response): Promise<TranscriptRequestError> {
  const body: unknown = await response.clone().json().catch(() => null);
  const code = body && typeof body === 'object'
    ? String((body as { error?: unknown }).error ?? '')
    : '';
  return new TranscriptRequestError(response.status, code);
}

async function requireOk(response: Response): Promise<void> {
  if (!response.ok) throw await responseError(response);
}

function transcriptFromPayload(payload: unknown): TranscriptMeta | null | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const envelope = payload as { transcript?: unknown; file?: unknown };
  // `transcript/mime` 是当前契约；兼容早期网关的 `file/type` 回包便于平滑升级。
  const value = Object.hasOwn(envelope, 'transcript') ? envelope.transcript : envelope.file;
  if (value === null) return null;
  return transcriptMetaFrom(value);
}

export async function getTranscript(signal?: AbortSignal): Promise<TranscriptMeta | null> {
  const response = await gatewayFetch(`${API_BASE}/transcript`, {
    method: 'GET',
    cache: 'no-store',
    signal,
  });
  await requireOk(response);
  const payload: unknown = await response.json().catch(() => null);
  const transcript = transcriptFromPayload(payload);
  if (transcript === undefined) throw new TranscriptRequestError(response.status, 'bad-response');
  return transcript;
}

export async function uploadTranscript(file: File, signal?: AbortSignal): Promise<TranscriptMeta> {
  const mime = transcriptMimeForFile(file);
  if (!mime) throw new TranscriptRequestError(0, 'unsupported-file');
  if (file.size <= 0) throw new TranscriptRequestError(0, 'empty-file');
  if (file.size > MAX_TRANSCRIPT_BYTES) throw new TranscriptRequestError(0, 'file-too-large');

  const response = await gatewayFetch(`${API_BASE}/transcript`, {
    method: 'PUT',
    headers: {
      'Content-Type': mime,
      'X-File-Name': encodeURIComponent(file.name || '成绩单'),
    },
    body: file,
    signal,
  });
  await requireOk(response);

  // 兼容网关返回元数据或 204；无元数据时回读一次作为最终确认。
  const payload: unknown = response.status === 204
    ? null
    : await response.json().catch(() => null);
  const uploaded = transcriptFromPayload(payload);
  if (uploaded) return uploaded;
  const confirmed = await getTranscript(signal);
  if (!confirmed) throw new TranscriptRequestError(response.status, 'bad-response');
  return confirmed;
}

export async function fetchTranscriptFile(signal?: AbortSignal): Promise<Blob> {
  const response = await gatewayFetch(`${API_BASE}/transcript/file`, {
    method: 'GET',
    cache: 'no-store',
    signal,
  });
  await requireOk(response);
  const blob = await response.blob();
  if (blob.size <= 0) throw new TranscriptRequestError(response.status, 'empty-file');
  return blob;
}

export async function deleteTranscript(signal?: AbortSignal): Promise<void> {
  const response = await gatewayFetch(`${API_BASE}/transcript`, {
    method: 'DELETE',
    signal,
  });
  await requireOk(response);
}
