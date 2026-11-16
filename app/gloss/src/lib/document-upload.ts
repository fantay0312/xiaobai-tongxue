import type { Article } from './article';

const PART_BYTES = 512 * 1024;
const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;

/** Each request stays below the sync body cap, including multibyte text and JSON escaping. */
export async function uploadDocument(doc: Article): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  if (bytes.length > MAX_DOCUMENT_BYTES) throw new Error('正文超过 32 MiB，本机内容已保留，暂未同步到云端。');
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const uploadId = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  const parts = Math.ceil(bytes.length / PART_BYTES);
  for (let index = 0; index < parts; index++) {
    const chunk = bytes.subarray(index * PART_BYTES, (index + 1) * PART_BYTES);
    let binary = '';
    for (let offset = 0; offset < chunk.length; offset += 32768) binary += String.fromCharCode(...chunk.subarray(offset, offset + 32768));
    const response = await fetch(`/api/article-uploads/${encodeURIComponent(doc.id)}/${uploadId}/${index}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bytes: bytes.length, parts, chunk: btoa(binary) }),
    });
    if (!response.ok) throw new Error(`document upload ${response.status}`);
  }
  return uploadId;
}
