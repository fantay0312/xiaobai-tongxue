import assert from 'node:assert/strict';
import { TOPICS } from '../src/data';
import { learningPreferenceReply } from '../src/engine/conversationRepair';
import { sourceScopedTopic, courseSources } from '../src/engine/notebookSources';
import { studyScenes } from '../src/engine/guidedStudy';
import { orderedCourseAssets, readCompilePlan, saveCompilePlan } from '../src/lib/courseCompilePlan';
import type { CustomAsset } from '../src/lib/customContent';

const topic = TOPICS.find((item) => !item.locked)!;
const scoped = sourceScopedTopic(topic, [...courseSources(topic), { id: 'asset:cover', title: '06-Optimizing.pdf', content: '某大学商学院\n教师\nkunchen@example.com\nFall 2026', kind: 'asset' }]);
assert.equal(scoped.prep.microLecture.body, topic.prep.microLecture.body);
assert.deepEqual(scoped.prep.examples, topic.prep.examples);
assert.doesNotMatch(studyScenes(scoped).map((scene) => scene.body).join('\n'), /kunchen@example/);
const original = sourceScopedTopic(topic, [{ id: 'asset:only', title: 'Original', content: 'Original evidence', kind: 'asset' }]);
assert.equal(studyScenes(original, false, true)[0].kind, 'read');
const long = { ...topic, prep: { ...topic.prep, microLecture: { title: 'Long', body: `## Concept\n\n${'内容。'.repeat(300)}` } } };
assert.equal(studyScenes(long)[0].body.startsWith('内容'), true, 'a heading must stay attached to substantive content');

const question = '你想了解哪部分知识，是插入、索引、删除还是冒泡排序、二分算法、选择排序、插入排序呢？';
for (const persona of ['好奇型', '严谨型', '杠精型'] as const) {
  const reply = learningPreferenceReply(question, '算法', persona)!;
  assert.match(reply, /「插入」/);
  assert.doesNotMatch(reply, /几百万|数组|变慢/);
}
assert.ok(learningPreferenceReply('小白你想先学什么？', '算法', '好奇型'));
assert.equal(learningPreferenceReply('数组按索引取元素是不是常数时间？', '算法', '好奇型'), null);
assert.equal(learningPreferenceReply('你想了解哪部分知识？我先讲数组，索引访问与数组大小无关。', '算法', '好奇型'), null);

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) } });
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
const files = ['第10讲.pdf', '第2讲.pdf', '第1讲.pdf'].map((filename, index) => ({ id: String(index), filename } as CustomAsset));
assert.deepEqual(orderedCourseAssets(files).map((file) => file.filename), ['第1讲.pdf', '第2讲.pdf', '第10讲.pdf']);
saveCompilePlan('alice', 'course', ids);
assert.deepEqual(readCompilePlan('alice', 'course'), ids);
assert.deepEqual(readCompilePlan('bob', 'course'), []);
assert.deepEqual(readCompilePlan('alice', 'other'), []);
saveCompilePlan('alice', 'course', ids.slice(1));
assert.deepEqual(readCompilePlan('alice', 'course'), ids.slice(1), 'published lessons leave the resumable queue');
saveCompilePlan('alice', 'course', []);
assert.deepEqual(readCompilePlan('alice', 'course'), []);
console.log('operation fixes: source structure, classroom negotiation, numeric ordering and account-scoped resume passed');
