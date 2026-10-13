import { API_BASE, gatewayFetch } from './api';

export interface LibraryEntry {
  id: string; kind: 'file' | 'folder'; name: string; parentId: string | null;
  byteSize?: number; contentType?: string; sha256?: string; phase: 'pending' | 'ready' | 'cleaning' | 'purging';
  createdAt: string; updatedAt: string; deletedAt: string | null; favorite: boolean;
  courseImports?: { courseId: string; assetId: string; at: string }[];
  sourceAssetId?: string;
  sourceCourseId?: string;
  parse?: LibraryParseState;
}
export interface LibraryParseState { assetId: string | null; status: 'unparsed' | 'starting' | 'pending' | 'processing' | 'finalizing' | 'completed' | 'failed' | 'cancelled'; error?: string | null; }
export interface LibrarySnapshot { entries: LibraryEntry[]; storage: 'local' | 'cloud'; maxFileBytes: number; syncWarning?: string | null; }
const messages: Record<string, string> = {
  'library-unavailable': '资料库服务尚未启用，请稍后重试。',
  'library-name-invalid': '名称不能为空，也不能包含斜杠或控制字符。',
  'library-name-exists': '这个位置已有同名项目，请换个名称。',
  'library-folder-not-empty': '文件夹里还有文件，请先移动内容或逐项移入回收站。',
  'library-folder-cycle': '不能把文件夹移到它自己或它的子文件夹中。',
  'library-file-size': '文件为空或超过单文件大小限制。',
  'library-storage-limit': '资料库容量已达到当前限制。',
  'library-file-not-found': '文件尚未准备好，或已移入回收站。',
  'library-entry-not-found': '项目已不存在，请刷新列表。',
  'library-file-integrity': '文件完整性校验未通过，请重新上传。',
  'library-upload-busy': '正在上传其他文件，请稍后再试。',
  'file-type-unsupported': '此文件可保存，暂不能解析。请选择 PDF、PPT、PPTX、DOCX、MD 或 TXT。',
  'custom-content-unavailable': '解析服务暂未启用，文件仍保存在资料库。',
  'asset-duplicate': '项目中已有这份文件，请在项目工作台中继续使用。',
  'library-parse-busy': '文件正在解析，请稍后查看状态。',
  'library-parse-not-ready': '文件尚未解析完成，请等待完成后重试。',
  'asset-in-use': '这份资料仍被课程或课题使用，请先移除相关引用。',
};
async function request(path: string, init?: RequestInit) {
  const response = await gatewayFetch(`${API_BASE}/library${path}`, init);
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(messages[data.error] ?? '操作未完成，请检查连接后重试。'); }
  return response;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export async function listLibrary(signal?: AbortSignal): Promise<LibrarySnapshot> {
  const value = await (await request('', { signal })).json();
  if (!Array.isArray(value.entries) || value.entries.some((item: LibraryEntry) => !item || !['file', 'folder'].includes(item.kind) || typeof item.id !== 'string' || typeof item.name !== 'string')) throw new Error('资料列表格式不完整，请刷新重试。');
  return value;
}
export async function createFolder(name: string, parentId: string | null): Promise<LibraryEntry> { return (await (await request('/folders', json('POST', { name, parentId }))).json()).entry; }
export async function updateLibraryEntry(id: string, patch: Partial<Pick<LibraryEntry, 'name' | 'parentId' | 'favorite'>> & { trashed?: boolean }): Promise<LibraryEntry> { return (await (await request(`/entries/${encodeURIComponent(id)}`, json('PATCH', patch))).json()).entry; }
export async function uploadLibraryFile(file: File, parentId: string | null, signal: AbortSignal): Promise<LibraryEntry> {
  return (await (await request(`/files${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ''}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file, signal })).json()).entry;
}
export async function downloadLibraryFile(id: string, signal?: AbortSignal): Promise<Blob> { return (await request(`/files/${encodeURIComponent(id)}/content`, { signal })).blob(); }
export async function importLibraryFile(id: string, courseId: string, assetRole = 'lecture'): Promise<{ assetId: string }> { return (await request(`/files/${encodeURIComponent(id)}/course`, json('POST', { courseId, assetRole }))).json(); }
export async function purgeLibraryEntry(id: string): Promise<void> { await request(`/entries/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function parseLibraryFile(id: string, signal?: AbortSignal, retry = false): Promise<LibraryParseState> { return (await request(`/files/${encodeURIComponent(id)}/parse`, { ...json('POST', { retry }), signal })).json(); }
export async function libraryParseState(id: string, signal?: AbortSignal): Promise<LibraryParseState> { return (await request(`/files/${encodeURIComponent(id)}/parse`, { signal })).json(); }
export async function readLibrarySources(fileIds: string[], query = '', signal?: AbortSignal): Promise<{ sources: import('../engine/notebookSources').NotebookSource[]; evidence: import('../engine/studyWorkspace').StudySource[] }> { return (await request('/sources', { ...json('POST', { fileIds, query }), signal })).json(); }
export async function detachLibraryCourse(id: string, courseId: string): Promise<void> { await request(`/files/${encodeURIComponent(id)}/course/${encodeURIComponent(courseId)}`, { method: 'DELETE' }); }
export async function prepareLibrarySources(fileIds: string[], signal: AbortSignal, onProgress: (message: string) => void = () => {}, retry = false): ReturnType<typeof readLibrarySources> {
  const deadline = Date.now() + 240000;
  for (const [index, id] of fileIds.entries()) {
    onProgress(`正在准备资料 ${index + 1} / ${fileIds.length}…`);
    let state = await parseLibraryFile(id, signal, retry);
    while (state.status !== 'completed') {
      if (['failed', 'cancelled'].includes(state.status)) throw new Error(state.error || '解析失败，请在资料库中重试。');
      if (Date.now() > deadline) throw new Error('资料仍在解析，稍后可重新连接。');
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1500);
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      });
      state = await libraryParseState(id, signal);
    }
  }
  return readLibrarySources(fileIds, '', signal);
}

export function libraryPath(entries: LibraryEntry[], id: string | null): LibraryEntry[] {
  const result: LibraryEntry[] = []; const seen = new Set<string>(); let cursor = id;
  while (cursor && !seen.has(cursor) && result.length < 64) { seen.add(cursor); const folder = entries.find((entry) => entry.id === cursor && entry.kind === 'folder'); if (!folder) break; result.unshift(folder); cursor = folder.parentId; }
  return result;
}
export function visibleLibraryEntries(entries: LibraryEntry[], folderId: string | null, filter: 'all' | 'recent' | 'favorites' | 'trash', query: string): LibraryEntry[] {
  return entries.filter((entry) => (filter === 'trash' ? !!entry.deletedAt : !entry.deletedAt)
    && (filter !== 'favorites' || entry.favorite)
    && (query ? entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) : filter !== 'all' || entry.parentId === folderId));
}
