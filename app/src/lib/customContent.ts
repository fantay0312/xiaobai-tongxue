import type { ChecklistItem, Misconception, Topic } from '../types';
import { API_BASE, gatewayFetch } from './api';

const ROOT = `${API_BASE}/xb`;
const ABSOLUTE_MAX_FILE_BYTES = 80 * 1024 * 1024;

export type AssetRole = 'lecture' | 'lab' | 'syllabus' | 'reading';
export type AssetParseStatus = 'pending' | 'processing' | 'finalizing' | 'completed' | 'failed' | 'cancelled';

export interface CustomCourse {
  id: string;
  title: string;
  assetCount: number;
  topicCount: number;
  createdAt: string;
}

export interface CustomAsset {
  id: string;
  courseId: string;
  assetRole: AssetRole;
  filename: string;
  contentType: string;
  byteSize: number;
  wkKnowledgeId: string;
  parseStatus: AssetParseStatus;
  enableStatus: 'enabled' | 'disabled';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualityIssue {
  code: string;
  path: string;
  message: string;
  level: 'error' | 'warning';
}

export interface SourceCandidate {
  chunkId: string;
  assetId: string;
  filename: string;
  excerpt: string;
}

export type CustomChecklistItem = ChecklistItem & {
  sourceChunkIds: string[];
  sourceExcerpt: string;
};

export type CustomTopicPayload = Omit<Topic, 'checklist' | 'misconceptions'> & {
  checklist: CustomChecklistItem[];
  misconceptions: Misconception[];
  sources?: { assetId: string; wkKnowledgeId: string; filename: string; role: AssetRole }[];
  compileMeta?: { model: string; promptVersion: string; teacherEdited: boolean };
};

export interface CustomTopicRecord {
  id: string;
  topicId: string;
  courseId: string;
  status: 'draft' | 'ready' | 'archived';
  payload: CustomTopicPayload;
  qualityIssues: QualityIssue[];
  promptVersion: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompileJob {
  id: string;
  courseId: string;
  topicId: string | null;
  assetIds: string[];
  requestedTitle: string | null;
  status: 'queued' | 'running' | 'needs_review' | 'done' | 'failed';
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  topic?: CustomTopicRecord | null;
}

export class CustomContentError extends Error {
  status: number;
  retryAfter: number;

  constructor(code: string, status: number, retryAfter = 0) {
    super(code);
    this.name = 'CustomContentError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await gatewayFetch(`${ROOT}${pathname}`, init);
  const data = await payload(response);
  if (!response.ok) {
    const code = typeof data.error === 'string' ? data.error : 'custom-content-failed';
    const retryAfter = Number(data.retryAfter ?? response.headers.get('Retry-After') ?? 0);
    throw new CustomContentError(code, response.status, Number.isFinite(retryAfter) ? retryAfter : 0);
  }
  return data as T;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export async function customContentStatus(): Promise<{ configured: boolean; healthy: boolean; maxFileBytes: number }> {
  const status = await request<{ configured: boolean; healthy: boolean; maxFileBytes: number }>('/status');
  if (!Number.isSafeInteger(status.maxFileBytes)
    || status.maxFileBytes < 1
    || status.maxFileBytes > ABSOLUTE_MAX_FILE_BYTES) {
    throw new CustomContentError('custom-content-contract-invalid', 502);
  }
  return status;
}

export async function listCustomCourses(): Promise<CustomCourse[]> {
  return (await request<{ courses: CustomCourse[] }>('/courses')).courses;
}

export async function createCustomCourse(title: string): Promise<CustomCourse> {
  return (await request<{ course: CustomCourse }>('/courses', json('POST', { title }))).course;
}

export async function listCourseAssets(courseId: string): Promise<CustomAsset[]> {
  return (await request<{ assets: CustomAsset[] }>(`/courses/${encodeURIComponent(courseId)}/assets`)).assets;
}

export async function uploadCourseAsset(
  courseId: string,
  file: File,
  assetRole: AssetRole,
): Promise<CustomAsset> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('fileName', file.webkitRelativePath || file.name);
  form.append('asset_role', assetRole);
  return (await request<{ asset: CustomAsset }>(
    `/courses/${encodeURIComponent(courseId)}/assets`,
    { method: 'POST', body: form },
  )).asset;
}

export async function reparseCustomAsset(assetId: string): Promise<CustomAsset> {
  return (await request<{ asset: CustomAsset }>(
    `/assets/${encodeURIComponent(assetId)}/reparse`,
    { method: 'POST' },
  )).asset;
}

export async function deleteCustomAsset(assetId: string): Promise<void> {
  await request(`/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
}

export async function startTopicCompile(input: {
  courseId: string;
  assetIds: string[];
  title?: string;
}): Promise<CompileJob> {
  return (await request<{ job: CompileJob }>('/topics/compile', json('POST', input))).job;
}

export async function getCompileJob(jobId: string): Promise<CompileJob> {
  return (await request<{ job: CompileJob }>(`/compile-jobs/${encodeURIComponent(jobId)}`)).job;
}

export async function getCourseCompileJob(courseId: string): Promise<CompileJob | null> {
  return (await request<{ job: CompileJob | null }>(
    `/courses/${encodeURIComponent(courseId)}/compile-job`,
  )).job;
}

export async function saveTopicDraft(id: string, draft: CustomTopicPayload): Promise<CustomTopicRecord> {
  return (await request<{ topic: CustomTopicRecord }>(
    `/topics/${encodeURIComponent(id)}/draft`,
    json('PUT', { draft }),
  )).topic;
}

export async function discardTopicDraft(id: string): Promise<void> {
  await request(`/topics/${encodeURIComponent(id)}/draft`, { method: 'DELETE' });
}

export async function findTopicSourceCandidates(
  id: string,
  point: string,
  groundTruth: string,
): Promise<SourceCandidate[]> {
  return (await request<{ candidates: SourceCandidate[] }>(
    `/topics/${encodeURIComponent(id)}/source-candidates`,
    json('POST', { point, groundTruth }),
  )).candidates;
}

export async function publishCustomTopic(id: string): Promise<CustomTopicRecord> {
  return (await request<{ topic: CustomTopicRecord }>(
    `/topics/${encodeURIComponent(id)}/publish`,
    { method: 'POST' },
  )).topic;
}

export async function listPublishedCustomTopics(): Promise<unknown[]> {
  const value = await request<{ topics?: unknown[] }>('/topics');
  return Array.isArray(value.topics) ? value.topics : [];
}

export async function getTeacherCustomTopic(topicId: string, signal?: AbortSignal): Promise<CustomTopicRecord> {
  return (await request<{ topic: CustomTopicRecord }>(
    `/topics/${encodeURIComponent(topicId)}/teacher`,
    { signal },
  )).topic;
}

/** 自定义课的完整 rubric 只在 BFF 内参与评估；浏览器只收回脱敏后的判定结果。 */
export async function evaluateCustomTopicSemantic(input: {
  topicId: string;
  utterance: string;
  lastXiaobaiText: string | null;
  hitChecklist: string[];
  pendingMcId: string | null;
}): Promise<Record<string, unknown>> {
  return (await request<{ evaluation: Record<string, unknown> }>(
    `/topics/${encodeURIComponent(input.topicId)}/evaluate`,
    json('POST', {
      utterance: input.utterance,
      lastXiaobaiText: input.lastXiaobaiText,
      hitChecklist: input.hitChecklist,
      pendingMcId: input.pendingMcId,
    }),
  )).evaluation;
}
