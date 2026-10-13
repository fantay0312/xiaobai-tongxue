import { readFileSync } from 'node:fs';

let catalog;
try { catalog = JSON.parse(readFileSync(new URL('./study-catalog.json', import.meta.url), 'utf8')); }
catch { catalog = { topics: [] }; }
const topics = new Map((catalog.topics ?? []).map((topic) => [topic.topicId, topic]));

export function resolveBuiltinStudyTopic(topicId) { return topics.get(topicId) ?? null; }
