import assert from 'node:assert/strict';
import { TOPICS } from '../src/data';
import { askDeepStudyTutor, getStudyTutorStatus } from '../src/lib/studyTutor';
const originalFetch = globalThis.fetch;
let captured: Record<string, unknown> = {};
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/status')) return new Response(JSON.stringify({ available: true }));
  assert.ok(String(url).endsWith('/api/study/chat'));
  captured = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ content: 'answer', engine: 'deeptutor', version: '1.6.14', rounds: 3, sources: [] }));
};
const topic = structuredClone(TOPICS[0]);
topic.checklist[0].groundTruth = 'PRIVATE_RUBRIC';
topic.misconceptions[0].correctionCriteria = ['PRIVATE_CRITERIA'];
const controller = new AbortController();
assert.equal(await getStudyTutorStatus(controller.signal), true);
const result = await askDeepStudyTutor({ topic, question: 'why', history: [], note: '', signal: controller.signal });
assert.equal(result.rounds, 3);
assert.doesNotMatch(JSON.stringify(captured), /PRIVATE_RUBRIC|PRIVATE_CRITERIA|system|apiKey/);
globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
  if (init?.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
  else init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
});
const pending = askDeepStudyTutor({ topic, question: 'why', history: [], note: '', signal: controller.signal });
controller.abort();
await assert.rejects(pending, { name: 'AbortError' });
globalThis.fetch = originalFetch;
console.log('study-tutor: source projection, provider metadata and cancellation passed');
