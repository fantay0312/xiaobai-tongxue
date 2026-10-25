import type { Topic } from '../types';
import type { StudySource } from './studyWorkspace';

export interface NotebookSource {
  id: string;
  title: string;
  content: string;
  kind: 'lecture' | 'example' | 'asset' | 'text' | 'library';
  assetId?: string;
  libraryFileId?: string;
  version?: string;
  limited?: boolean;
}

export function courseSources(topic: Topic): NotebookSource[] {
  return [
    { id: `lecture:${topic.topicId}`, title: topic.prep.microLecture.title, content: topic.prep.microLecture.body, kind: 'lecture' as const },
    ...topic.prep.examples.map((example, i): NotebookSource => ({ id: `example:${topic.topicId}:${i}`, title: example.title, content: `${example.code}\n\n${example.walkthrough}`, kind: 'example' })),
  ].filter((source) => source.content.trim());
}

export function restoreTextSources(raw: unknown): NotebookSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 16).flatMap((source) => source && typeof source.id === 'string' && /^text:[\w-]{1,80}$/.test(source.id) && typeof source.content === 'string' && source.content.trim()
    ? [{ id: source.id, title: String(source.title || '补充资料').slice(0, 120), content: source.content.slice(0, 16000), kind: 'text' as const }] : []);
}

export function selectNotebookSources(sources: NotebookSource[], ids?: string[]): NotebookSource[] {
  return ids === undefined ? sources : sources.filter((source) => ids.includes(source.id));
}

/** The same bounded, query-focused snippets are used for prompts and saved citations. */
export function sourceEvidence(sources: NotebookSource[], query = ''): StudySource[] {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2}/g) ?? [])].slice(0, 30);
  return sources.map((source, index) => {
    const lower = source.content.toLowerCase();
    const matches = terms.map((term) => lower.indexOf(term)).filter((n) => n >= 0);
    const start = matches.length ? Math.max(0, Math.min(...matches) - 90) : 0;
    return { id: source.id, title: source.title, excerpt: source.content.slice(start, start + 550), score: matches.length, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 5).map(({ id, title, excerpt }) => ({ id, title, excerpt }));
}

export function notebookScopeKey(sources: NotebookSource[]): string {
  let hash = 2166136261;
  for (const c of sources.map((source) => `${source.id}:${source.content}`).join('|')) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function sourceScopedTopic(topic: Topic, sources: NotebookSource[]): Topic {
  const includeLecture = sources.some((source) => source.id === `lecture:${topic.topicId}`);
  // Published teaching material already has a lesson structure. Original files
  // remain evidence for Q&A; appending their covers destroys that structure.
  if (includeLecture) return { ...topic, prep: { ...topic.prep, examples: topic.prep.examples.filter((_, index) => sources.some((source) => source.id === `example:${topic.topicId}:${index}`)) } };
  return { ...topic, prep: { ...topic.prep, microLecture: { ...topic.prep.microLecture, title: '所选资料', body: sources.map((source) => `## ${source.title}\n\n${source.content}`).join('\n\n') }, examples: [], selfCheck: includeLecture ? topic.prep.selfCheck : [] }, checklist: includeLecture ? topic.checklist : [], misconceptions: includeLecture ? topic.misconceptions : [] };
}
