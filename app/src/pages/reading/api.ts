import { API_BASE, gatewayFetch } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
const serviceKeyName = () => `xiaobai-reader-services:${useAuthStore.getState().user || ''}`;
export function readServiceKey() { return localStorage.getItem(serviceKeyName()) || ''; }
export function writeServiceKey(key: string) { if (key.trim()) localStorage.setItem(serviceKeyName(), key.trim()); else localStorage.removeItem(serviceKeyName()); }
export function readerServiceHeaders(): Record<string, string> { const key = readServiceKey(); return key ? { 'X-Reader-Service-Key': key } : {}; }
export async function readerApi<T>(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST', signal?: AbortSignal): Promise<T> {
  const response = await gatewayFetch(`${API_BASE}/reader${path}`, { method, signal, headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(['/cover', '/speech'].includes(path) ? readerServiceHeaders() : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `reader-http-${response.status}`);
  }
  return response.json();
}
export const READER_ERRORS: Record<string, string> = {
  'reader-conflict': '另一台设备已更新这篇文章。本机改动已保留，请先导出笔记再重新载入云端版本。',
  'reader-url-private': '只能导入公开网页，无法访问内网地址。', 'reader-url-invalid': '请输入完整的 http 或 https 网页地址。',
  'reader-no-article': '没有找到可阅读的正文，可以复制正文后使用“粘贴文字”。',
  'reader-source-unavailable': '网页暂时无法读取，可以粘贴正文后阅读。', 'reader-source-timeout': '网页响应超时，请稍后重试。',
  'reader-source-too-large': '网页文件过大，请下载后从文件导入。', 'reader-source-type': '这个地址不是文章或 PDF，请使用文件导入。',
  'reader-social-use-paste': '社交帖子和视频无法直接提取，请复制正文或字幕后使用“粘贴文字”。',
  'reader-cover-unconfigured': '服务器尚未配置绘图服务。', 'reader-search-unavailable': '联网检索暂时不可用，请稍后重试。',
};
export const readerError = (error: unknown) => error instanceof Error ? READER_ERRORS[error.message] || `操作未完成：${error.message}` : '操作未完成，请重试。';
