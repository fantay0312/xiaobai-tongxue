import { API_BASE, gatewayFetch } from './api';
import type { Topic } from '../types';
import type { StudyMessage, StudySource } from '../engine/studyWorkspace';
import type { NotebookSource } from '../engine/notebookSources';

export async function getStudyTutorStatus(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await gatewayFetch(`${API_BASE}/study/status`, { signal });
    return response.ok && (await response.json()).available === true;
  } catch { return false; }
}

export interface DeepStudyReply { content: string; engine: 'deeptutor'; version: string; rounds: number; sources: StudySource[]; sourceNote?: string; }
/** 深入答疑的阶段进度：读取所选资料 → 拟定讲解提纲 → 核对资料依据 → 组织解释与自检题。 */
export interface DeepStudyStage { id: string; label: string; status: 'running' | 'done'; }

function checkedReply(result: unknown): DeepStudyReply {
  const reply = result as Partial<DeepStudyReply> | null;
  if (!reply || reply.engine !== 'deeptutor' || typeof reply.content !== 'string' || !reply.content.trim()) throw new Error('study-empty');
  return reply as DeepStudyReply;
}

/** 读取网关的阶段事件流，直到 done 或 error；连接中途断开视为未完成。 */
async function readStageStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, onStage: (stage: DeepStudyStage) => void): Promise<DeepStudyReply> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let buffer = '';
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      if (buffer.length > 256000) throw new Error('study-stream-too-large');
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const lines = buffer.slice(0, end).split('\n');
        buffer = buffer.slice(end + 2);
        const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
        const payload = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!event || !payload) continue; // 心跳注释行
        const data = JSON.parse(payload);
        if (event === 'stage' && typeof data.id === 'string' && typeof data.label === 'string' && (data.status === 'running' || data.status === 'done')) onStage({ id: data.id, label: data.label, status: data.status });
        else if (event === 'error') throw new Error(data.error === 'deeptutor-unavailable' ? 'deeptutor-unavailable' : `study-http-${Number(data.status) || 502}`);
        else if (event === 'done') return checkedReply(data);
      }
    }
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    throw new Error('study-stream-incomplete');
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
  }
}

export async function askDeepStudyTutor({ topic, question, note, history, signal, selectedSources, onStage }: {
  topic: Topic; question: string; note: string; history: StudyMessage[]; signal: AbortSignal; selectedSources?: NotebookSource[];
  /** 提供后改走事件流，每个阶段开始、完成时各回调一次；不提供时仍是一次性响应。 */
  onStage?: (stage: DeepStudyStage) => void;
}): Promise<DeepStudyReply> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 120000);
  try {
    const response = await gatewayFetch(`${API_BASE}/study/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(onStage ? { Accept: 'text/event-stream' } : {}) }, signal: controller.signal,
      body: JSON.stringify({ topic: { topicId: topic.topicId, title: topic.title, course: topic.course, lecture: topic.prep.microLecture.body.slice(0, 6000), examples: topic.prep.examples.slice(0, 6).map((item) => ({ title: item.title, code: item.code.slice(0, 600), walkthrough: item.walkthrough.slice(0, 600) })) }, question: question.slice(0, 3000), note: note.slice(0, 1500), history: history.slice(-6).map((message) => ({ role: message.role, text: message.text.slice(0, 600) })), ...(selectedSources === undefined ? {} : { selection: {
        includeLecture: selectedSources.some((source) => source.id === `lecture:${topic.topicId}`), exampleIndices: selectedSources.filter((source) => source.kind === 'example').map((source) => Number(source.id.split(':').at(-1))), assetIds: selectedSources.filter((source) => source.kind === 'asset').map((source) => source.assetId), libraryFileIds: selectedSources.filter((source) => source.kind === 'library').map((source) => source.libraryFileId), textSources: selectedSources.filter((source) => source.kind === 'text').slice(0, 16).map((source) => ({ id: source.id, title: source.title, content: source.content.slice(0, 4000) })),
      } }) }),
    });
    if (!response.ok) throw new Error(response.status === 503 ? 'deeptutor-unavailable' : `study-http-${response.status}`);
    // 旧网关不识别 Accept 时会直接回 JSON，照常解析。
    if (onStage && response.body && response.headers.get('content-type')?.includes('text/event-stream')) return await readStageStream(response.body, controller.signal, onStage);
    return checkedReply(await response.json());
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
