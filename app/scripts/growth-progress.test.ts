import assert from 'node:assert/strict';
import { deriveTeacherRank, TEACHER_RANKS } from '../src/engine/achievements';
import { deriveWisdom, wisdomThreshold } from '../src/engine/evolution';
import { TOPICS } from '../src/data';
import { layoutSea, activeStarLinks, SEA_HEIGHT, SEA_WIDTH } from '../src/pages/growth/knowledgeSeaGeometry';
import type { LearnEvent, XiaobaiGlobal } from '../src/types';
import type { MapNode } from '../src/pages/growth/KnowledgeMap';

const event = (type: LearnEvent['type'], index: number): LearnEvent => ({
  id: `event-${index}`, t: '2026-10-12T00:00:00Z', type, topicId: 'attention',
  sessionId: 'test-session', payload: {}, evidence: '真实课堂事件测试',
});
const global: XiaobaiGlobal = { persona: '好奇型', learningLevel: 1, relationshipMemory: [], goldenAnalogies: [], topicsMastered: 0, bestRecord: null };
const input = (events: LearnEvent[]) => ({ events, reports: [], global, topicStates: {}, topics: TOPICS });
assert.deepEqual(TEACHER_RANKS.map((rank) => rank.title), ['塾师', '外傅', '夫子']);
const mastered = Array.from({ length: 8 }, (_, index) => event('topic_mastered', index));
assert.equal(deriveTeacherRank(input([])).title, '塾师');
assert.equal(deriveTeacherRank(input(mastered.slice(0, 3))).title, '塾师');
assert.equal(deriveTeacherRank(input(mastered.slice(0, 4))).title, '外傅');
assert.equal(deriveTeacherRank(input(mastered.slice(0, 7))).title, '外傅');
assert.equal(deriveTeacherRank(input(mastered)).title, '夫子');
assert.equal(deriveTeacherRank(input(mastered)).nextTitle, null);
assert.deepEqual([1, 2, 3, 4, 5, 6].map(wisdomThreshold), [0, 15, 40, 75, 120, 175]);
assert.equal(deriveWisdom(mastered).xp, 200, '学识与先生履历保持不同的既有计分口径');
const nodes: MapNode[] = TOPICS.map((topic) => ({ topic, state: null, status: topic.locked ? 'locked' : 'unlearned' }));
for (const compact of [false, true]) {
  for (const selected of [null, 'attention']) {
    const points = layoutSea(nodes, false, compact, selected);
    assert.equal(points.size, nodes.length, '每讲都保留可定位的知识星');
    for (const point of points.values()) {
      assert.ok(Number.isFinite(point.x) && point.x > 0 && point.x < SEA_WIDTH);
      assert.ok(Number.isFinite(point.y) && point.y > 0 && point.y < SEA_HEIGHT);
    }
    assert.ok(activeStarLinks(selected, points).length <= 3);
    if (selected) assert.deepEqual(points.get(selected), { x: compact ? 650 : 720, y: 190 });
  }
}
console.log('Growth progress: teacher promotion, independent wisdom and orbital-node coverage passed');
