import assert from 'node:assert/strict';
import { emptyLearningIdentity, loadLearningIdentity, saveLearningIdentity } from '../src/engine/learningIdentity';
import { homeContinuation } from '../src/pages/learn/shell/homeContinuation';
import type { Topic } from '../src/types';
import type { ConversationBrief } from '../src/lib/artifactProviders/chat';

const cache = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value) }, configurable: true });
const identity = emptyLearningIdentity();
const topics = [{ topicId: 'open', title: '开放课程' }, { topicId: 'locked', title: '未开放课程', locked: true }] as Topic[];
const chats: ConversationBrief[] = [
  { workspace: 'open', topicId: 'open', id: 'old', title: '原来对话', messages: 2, at: 10 },
  { workspace: 'open', topicId: 'open', id: 'latest', title: '最近对话', messages: 4, at: 30 },
  { workspace: 'removed', topicId: 'removed', id: 'stale', title: '已删除课程', messages: 4, at: 100 },
  { workspace: 'locked', topicId: 'locked', id: 'closed', title: '未开放课程', messages: 4, at: 200 },
  { workspace: 'library-chat', id: 'blank', title: '空对话', messages: 0, at: 300 },
];
assert.equal(homeContinuation(topics, identity, []), null);
assert.equal(homeContinuation(topics, { ...identity, lastTopicId: 'open' }, chats)?.conversation?.id, 'latest');
assert.equal(homeContinuation(topics, { ...identity, lastTopicId: 'open' }, [])?.topic?.topicId, 'open');
assert.equal(homeContinuation(topics, { ...identity, lastTopicId: 'locked' }, [])?.topic, undefined);
assert.equal(homeContinuation(topics, identity, chats)?.conversation?.id, 'latest');
assert.equal(chats[0].id, 'old', 'sorting recents must not mutate the caller data');

const stamp = '2026-10-22T10:00:00.000Z';
saveLearningIdentity('alice', { ...identity, letterReadAt: stamp, lastTopicId: 'open' });
assert.equal(loadLearningIdentity('alice').letterReadAt, stamp);
assert.equal(loadLearningIdentity('alice').lastTopicId, 'open');
assert.equal(loadLearningIdentity('bob').letterReadAt, null, 'letter read state belongs to its account');
cache.set('xiaobai-learning-identity-v1:legacy', JSON.stringify({ acceptedAt: stamp, actor: 'xiaobai', lastTopicId: 'open' }));
assert.equal(loadLearningIdentity('legacy').acceptedAt, stamp);
assert.equal(loadLearningIdentity('legacy').letterReadAt, null, 'old records without the new field stay compatible');
cache.set('xiaobai-learning-identity-v1:invalid', JSON.stringify({ letterReadAt: 'not-a-date' }));
assert.equal(loadLearningIdentity('invalid').letterReadAt, null);
console.log('Home continuation, stale/locked courses, read-state persistence and account isolation: passed.');
