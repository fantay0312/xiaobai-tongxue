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

export async function askDeepStudyTutor({ topic, question, note, history, signal, selectedSources }: {
  topic: Topic; question: string; note: string; history: StudyMessage[]; signal: AbortSignal; selectedSources?: NotebookSource[];
}): Promise<DeepStudyReply> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 120000);
  try {
    const response = await gatewayFetch(`${API_BASE}/study/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ topic: { topicId: topic.topicId, title: topic.title, course: topic.course, lecture: topic.prep.microLecture.body.slice(0, 6000), examples: topic.prep.examples.slice(0, 6).map((item) => ({ title: item.title, code: item.code.slice(0, 600), walkthrough: item.walkthrough.slice(0, 600) })) }, question: question.slice(0, 3000), note: note.slice(0, 1500), history: history.slice(-6).map((message) => ({ role: message.role, text: message.text.slice(0, 600) })), ...(selectedSources === undefined ? {} : { selection: {
        includeLecture: selectedSources.some((source) => source.id === `lecture:${topic.topicId}`), exampleIndices: selectedSources.filter((source) => source.kind === 'example').map((source) => Number(source.id.split(':').at(-1))), assetIds: selectedSources.filter((source) => source.kind === 'asset').map((source) => source.assetId), libraryFileIds: selectedSources.filter((source) => source.kind === 'library').map((source) => source.libraryFileId), textSources: selectedSources.filter((source) => source.kind === 'text').slice(0, 16).map((source) => ({ id: source.id, title: source.title, content: source.content.slice(0, 4000) })),
      } }) }),
    });
    if (!response.ok) throw new Error(response.status === 503 ? 'deeptutor-unavailable' : `study-http-${response.status}`);
    const result = await response.json();
    if (result.engine !== 'deeptutor' || typeof result.content !== 'string' || !result.content.trim()) throw new Error('study-empty');
    return result;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}
