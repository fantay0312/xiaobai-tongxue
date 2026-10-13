import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOPICS } from '../src/data';

const topics = TOPICS.map((topic) => ({
  topicId: topic.topicId, title: topic.title, course: topic.course,
  lecture: topic.prep.microLecture.body.slice(0, 6000),
  examples: topic.prep.examples.slice(0, 6).map((item) => ({ title: item.title.slice(0, 100), code: item.code.slice(0, 600), walkthrough: item.walkthrough.slice(0, 600) })),
}));
writeFileSync(fileURLToPath(new URL('../../server/study-catalog.json', import.meta.url)), JSON.stringify({ version: 1, topics }, null, 2) + '\n');
console.log(`Exported ${topics.length} public study topics; no assessment fields.`);
