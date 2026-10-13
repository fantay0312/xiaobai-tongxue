/**
 * 课题文件：一棵虚拟文件树（notes/ papers/ data/ code/ figures/ report.md references.bib …）。
 * 内容存在 IndexedDB，元数据（大小、时间、来历）在 researchStore；IndexedDB 不可用时退回内存，刷新后丢失。
 */
import { researchStore } from '../../store/researchStore';
import { ownerKey } from '../../store/studyData';
import type { FileMeta, Provenance, ResearchProject } from './types';

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/** 单个文本文件 40 万字；单个二进制 4 MB；一个课题 300 个文件、合计 48 MB */
export const LIMITS = { textChars: 400_000, binaryBytes: 4 * 1024 * 1024, files: 300, projectBytes: 48 * 1024 * 1024 } as const;

const DB_NAME = 'xiaobai-research-files-v1';
const STORE = 'files';
const MAX_PROVENANCE = 12;

/* ───────── 存储后端 ───────── */

const memory = new Map<string, string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;
let mode: 'indexeddb' | 'memory' | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    const fallback = () => {
      mode = 'memory';
      resolve(null);
    };
    try {
      if (typeof indexedDB === 'undefined') {
        fallback();
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        mode = 'indexeddb';
        resolve(request.result);
      };
      request.onerror = fallback;
      request.onblocked = fallback;
    } catch {
      fallback();
    }
  });
  return dbPromise;
}

/** 文件内容实际存在哪里；memory 表示刷新页面后会丢 */
export async function storageMode(): Promise<'indexeddb' | 'memory'> {
  await openDb();
  return mode ?? 'memory';
}

function run<T>(db: IDBDatabase, access: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(STORE, access);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? request.error);
    } catch (error) {
      reject(error);
    }
  });
}

const contentKey = (owner: string | null, projectId: string, path: string) => `${ownerKey(owner)}|${projectId}|${path}`;

async function putContent(key: string, content: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.set(key, content);
    return;
  }
  try {
    await run(db, 'readwrite', (store) => store.put(content, key));
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';
    if (name === 'QuotaExceededError') throw new WorkspaceError('浏览器的存储空间不足，文件没有保存。请删除不用的文件或课题后重试。');
    throw new WorkspaceError('文件没有保存：浏览器存储写入失败。');
  }
}

async function getContent(key: string): Promise<string | undefined> {
  const db = await openDb();
  if (!db) return memory.get(key);
  try {
    const value = await run<unknown>(db, 'readonly', (store) => store.get(key));
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

async function removeContent(key: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.delete(key);
    return;
  }
  await run(db, 'readwrite', (store) => store.delete(key)).catch(() => undefined);
}

/* ───────── 路径与类型 ───────── */

const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'csv', 'tsv', 'json', 'jsonl', 'py', 'r', 'bib', 'tex', 'yaml', 'yml', 'toml', 'ini', 'log', 'html', 'xml', 'svg', 'js', 'ts', 'sql', 'sh', 'ipynb',
]);
const MIME: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', jsonl: 'application/json',
  py: 'text/x-python', bib: 'application/x-bibtex', tex: 'application/x-tex', html: 'text/html', xml: 'application/xml', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', npy: 'application/octet-stream', pkl: 'application/octet-stream',
};

export const extensionOf = (path: string) => (/\.([a-z0-9]+)$/i.exec(path)?.[1] ?? '').toLowerCase();
export const baseName = (path: string) => path.split('/').pop() ?? path;
export const isTextPath = (path: string) => TEXT_EXTENSIONS.has(extensionOf(path)) || !extensionOf(path);
export const mimeOf = (path: string) => MIME[extensionOf(path)] ?? (isTextPath(path) ? 'text/plain' : 'application/octet-stream');
export const isImagePath = (path: string) => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extensionOf(path));

/** 规整成相对路径；不合法返回 null */
export function normalizePath(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!cleaned || cleaned.length > 160) return null;
  const parts = cleaned.split('/');
  if (parts.length > 6) return null;
  // 不允许上跳、隐藏段、控制字符和各系统里不能做文件名的符号
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.') || /[\u0000-\u001f<>:"|?*]/.test(part) || part.length > 80)) return null;
  return parts.join('/');
}

const byteLength = (text: string) => new Blob([text]).size;

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const body = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((body.length * 3) / 4);
}

export function toDataUrl(base64: string, mime: string): string {
  return `data:${mime};base64,${base64.replace(/\s+/g, '')}`;
}

export function dataUrlBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/* ───────── 读写 ───────── */

export interface WriteInput {
  path: string;
  content: string;
  encoding?: 'utf8' | 'dataurl';
  provenance: Omit<Provenance, 'at' | 'action'>;
}

export interface WriteResult {
  meta: FileMeta;
  created: boolean;
}

export const listFiles = (owner: string | null, projectId: string): FileMeta[] => researchStore.files(owner, projectId);

export const fileExists = (owner: string | null, projectId: string, path: string) => listFiles(owner, projectId).some((file) => file.path === path);

export async function readFile(owner: string | null, projectId: string, path: string): Promise<{ meta: FileMeta; content: string } | null> {
  const meta = listFiles(owner, projectId).find((file) => file.path === path);
  if (!meta) return null;
  const content = await getContent(contentKey(owner, projectId, path));
  // 元数据还在但内容没了（内存模式刷新过，或浏览器清了站点数据）
  if (content === undefined) return null;
  return { meta, content };
}

export async function writeFile(owner: string | null, projectId: string, input: WriteInput): Promise<WriteResult> {
  const path = normalizePath(input.path);
  if (!path) throw new WorkspaceError('文件路径不合法：用相对路径，如 notes/summary.md，不能包含 .. 或特殊符号。');
  const encoding = input.encoding ?? 'utf8';
  const size = encoding === 'utf8' ? byteLength(input.content) : dataUrlBytes(input.content);
  if (encoding === 'utf8' && input.content.length > LIMITS.textChars) {
    throw new WorkspaceError(`文件太大：文本文件最多 ${LIMITS.textChars / 10000} 万字，这份有 ${Math.round(input.content.length / 10000)} 万字。请拆成几个文件。`);
  }
  if (encoding === 'dataurl' && size > LIMITS.binaryBytes) {
    throw new WorkspaceError(`文件太大：图片等二进制文件最多 ${LIMITS.binaryBytes / 1024 / 1024} MB。`);
  }
  const files = listFiles(owner, projectId);
  const existing = files.find((file) => file.path === path);
  if (!existing && files.length >= LIMITS.files) throw new WorkspaceError(`这个课题的文件已达 ${LIMITS.files} 个上限，请先删除不用的文件。`);
  const total = files.reduce((sum, file) => sum + file.size, 0) - (existing?.size ?? 0) + size;
  if (total > LIMITS.projectBytes) throw new WorkspaceError(`这个课题的文件合计超过 ${LIMITS.projectBytes / 1024 / 1024} MB，请先删除不用的文件。`);

  await putContent(contentKey(owner, projectId, path), input.content);
  const stamp = new Date().toISOString();
  const entry: Provenance = { ...input.provenance, at: stamp, action: existing ? 'update' : 'create' };
  const meta: FileMeta = {
    path,
    encoding,
    mime: encoding === 'dataurl' ? (/^data:([^;,]+)/.exec(input.content)?.[1] ?? mimeOf(path)) : mimeOf(path),
    size,
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
    provenance: [...(existing?.provenance ?? []), entry].slice(-MAX_PROVENANCE),
  };
  researchStore.setFiles(owner, projectId, (current) => [...current.filter((file) => file.path !== path), meta]);
  return { meta, created: !existing };
}

export async function deleteFile(owner: string | null, projectId: string, path: string): Promise<boolean> {
  if (!fileExists(owner, projectId, path)) return false;
  await removeContent(contentKey(owner, projectId, path));
  researchStore.setFiles(owner, projectId, (current) => current.filter((file) => file.path !== path));
  return true;
}

export async function renameFile(owner: string | null, projectId: string, from: string, to: string): Promise<string> {
  const target = normalizePath(to);
  if (!target) throw new WorkspaceError('新的文件路径不合法。');
  if (target === from) return target;
  if (fileExists(owner, projectId, target)) throw new WorkspaceError('这个位置已经有同名文件。');
  const file = await readFile(owner, projectId, from);
  if (!file) throw new WorkspaceError('文件已不存在。');
  await putContent(contentKey(owner, projectId, target), file.content);
  await removeContent(contentKey(owner, projectId, from));
  researchStore.setFiles(owner, projectId, (current) => [
    ...current.filter((item) => item.path !== from),
    { ...file.meta, path: target, mime: file.meta.encoding === 'utf8' ? mimeOf(target) : file.meta.mime, updatedAt: new Date().toISOString() },
  ]);
  return target;
}

/** 删除课题时清掉它的全部文件内容 */
export async function clearProjectFiles(owner: string | null, projectId: string): Promise<void> {
  const files = listFiles(owner, projectId);
  await Promise.all(files.map((file) => removeContent(contentKey(owner, projectId, file.path))));
}

/* ───────── 导出 ───────── */

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function dataUrlBlob(dataUrl: string): Blob {
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'application/octet-stream';
  const binary = atob(dataUrlBase64(dataUrl));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export async function downloadFile(owner: string | null, projectId: string, path: string): Promise<boolean> {
  const file = await readFile(owner, projectId, path);
  if (!file) return false;
  const blob = file.meta.encoding === 'dataurl' ? dataUrlBlob(file.content) : new Blob([file.content], { type: `${file.meta.mime};charset=utf-8` });
  downloadBlob(baseName(path), blob);
  return true;
}

const safeName = (title: string) => title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || '课题';

/** 把整个课题的文件打成 zip，附一份来历清单；返回打进去的文件数 */
export async function exportProjectZip(owner: string | null, project: ResearchProject): Promise<number> {
  const files = listFiles(owner, project.id);
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  let count = 0;
  const manifest: string[] = [`# ${project.title}`, '', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
  if (project.goal) {
    manifest.push('## 课题目标', '', project.goal.objective, '');
    if (project.goal.criteria.length) manifest.push('验收标准：', ...project.goal.criteria.map((item) => `- ${item}`), '');
  }
  manifest.push('## 文件来历', '');
  for (const meta of files) {
    const file = await readFile(owner, project.id, meta.path);
    if (!file) {
      manifest.push(`- ${meta.path}：内容已丢失，未导出`);
      continue;
    }
    if (meta.encoding === 'dataurl') zip.file(meta.path, dataUrlBase64(file.content), { base64: true });
    else zip.file(meta.path, file.content);
    count += 1;
    const last = meta.provenance[meta.provenance.length - 1];
    const who = last ? `${ACTOR_LABELS[last.actor]}${last.tool ? `（${last.tool}）` : ''}${last.sessionTitle ? ` · 会话「${last.sessionTitle}」` : ''}${last.turn ? ` 第 ${last.turn} 轮` : ''}` : '未知';
    manifest.push(`- ${meta.path}：${who}，${new Date(meta.updatedAt).toLocaleString('zh-CN')}`);
  }
  zip.file('PROVENANCE.md', manifest.join('\n'));
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(`${safeName(project.title)}.zip`, blob);
  return count;
}

export const ACTOR_LABELS: Record<Provenance['actor'], string> = { agent: '科研助手', worker: '并行助手', python: 'Python 运行', user: '你' };

/** 给模型和界面看的目录摘要 */
export function fileDigest(files: FileMeta[], max = 60): string {
  if (!files.length) return '（空）';
  const lines = files.slice(0, max).map((file) => `${file.path} (${formatBytes(file.size)})`);
  if (files.length > max) lines.push(`… 另有 ${files.length - max} 个文件`);
  return lines.join('\n');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
