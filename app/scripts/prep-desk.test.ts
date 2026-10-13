import assert from 'node:assert/strict';
import { buildCoachSystem, EMPTY_PREP_CONTEXT } from '../src/engine/coach';
import { openingCard } from '../src/engine/director';
import { initialTopicState } from '../src/engine/memory';
import {
  clearAllDesks, focusChecklistId, gapsView, normalizeDesk, openingFocusId, orderExamples,
  revealedLecture, safeHttpUrl, saveDesk, splitLecture, visibleSegmentCount, walkthroughLocked,
} from '../src/engine/prepDesk';
import { getTopic } from '../src/data';
import type { Topic, XiaobaiGlobal } from '../src/types';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  },
});

const GLOBAL: XiaobaiGlobal = {
  persona: '好奇型', learningLevel: 1, relationshipMemory: [], goldenAnalogies: [], topicsMastered: 0, bestRecord: null,
};

{
  const segments = splitLecture('开头说明。\n\n**讲课节奏建议**\n\n先讲清楚，再举例。\n\n收束。');
  assert.equal(segments.length, 3);
  assert.match(segments[1].text, /讲课节奏建议/);
  assert.match(segments[1].text, /先讲清楚/);
  assert.equal(visibleSegmentCount('read', segments.length, []), 3);
  assert.equal(visibleSegmentCount('retell', segments.length, []), 1);
  assert.equal(visibleSegmentCount('retell', segments.length, ['短', '这是我的话']), 1);
  assert.equal(visibleSegmentCount('retell', segments.length, ['这是我的话', '再写一句']), 3);
  assert.equal(revealedLecture(segments, 1), segments[0].text);
  assert.doesNotMatch(revealedLecture(segments, 1), /收束/);
}

{
  const examples = [{ title: '甲' }, { title: '乙' }, { title: '丙' }];
  const related = [false, true, false];
  assert.deepEqual(orderExamples(examples, related, 'read').map((row) => row.item.title), ['甲', '乙', '丙']);
  assert.deepEqual(orderExamples(examples, related, 'examples').map((row) => row.item.title), ['乙', '甲', '丙']);
  assert.equal(orderExamples(examples, related, 'gaps')[0].related, true);
}

{
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(gapsView({ method: 'read', checklistIds: ids, marks: {}, wrongCount: 0, peek: false }), {
    waiting: false, held: false, showCore: true,
  });
  assert.equal(gapsView({ method: 'gaps', checklistIds: ids, marks: {}, wrongCount: 0, peek: false }).waiting, true);
  assert.equal(gapsView({ method: 'gaps', checklistIds: ids, marks: { a: 'gap' }, wrongCount: 0, peek: false }).showCore, true);
  const held = gapsView({
    method: 'gaps', checklistIds: ids, marks: { a: 'know', b: 'know', c: 'know' }, wrongCount: 0, peek: false,
  });
  assert.equal(held.held, true);
  assert.equal(held.showCore, false);
  assert.equal(gapsView({
    method: 'gaps', checklistIds: ids, marks: { a: 'know', b: 'know', c: 'know' }, wrongCount: 0, peek: true,
  }).showCore, true);
  assert.equal(gapsView({
    method: 'gaps', checklistIds: ids, marks: { a: 'know', b: 'know', c: 'know' }, wrongCount: 1, peek: false,
  }).showCore, true);
  const partial = gapsView({ method: 'gaps', checklistIds: ids, marks: { a: 'know' }, wrongCount: 0, peek: false });
  assert.equal(partial.showCore, false);
  assert.equal(partial.waiting, false);
  assert.equal(partial.held, false);
}

{
  const checklist = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(focusChecklistId(checklist, { method: 'read', marks: { a: 'gap' } }), null);
  assert.equal(focusChecklistId(checklist, { method: 'gaps', marks: { a: 'fuzzy', b: 'gap' } }), 'b');
  assert.equal(focusChecklistId(checklist, { method: 'gaps', marks: { c: 'fuzzy' } }), 'c');
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(walkthroughLocked('read', '', false), false);
  assert.equal(walkthroughLocked('examples', '短', false), true);
  assert.equal(walkthroughLocked('examples', '先写判断', false), false);
  assert.equal(walkthroughLocked('examples', '', true), false);
  assert.equal(normalizeDesk({ method: 'nope', peek: 1 }).method, 'read');
  assert.equal(normalizeDesk({ peek: true }).peek, true);
}

{
  const topic = getTopic('tokenization');
  assert.ok(topic, '分词主题必须存在');
  const second = topic.checklist[1];
  assert.ok(second);
  const state = initialTopicState(topic);
  assert.equal(openingCard('teach', topic, state, GLOBAL, second.id).card.targetChecklistId, second.id);
  assert.equal(openingCard('teach', topic, state, GLOBAL, 'missing').card.targetChecklistId, topic.checklist[0].id);
  assert.equal(openingCard('reteach', topic, state, GLOBAL, second.id).card.targetChecklistId, topic.checklist[0].id);
  assert.equal(openingCard('teach', topic, state, GLOBAL).card.action, 'ask_clarify');
  saveDesk(topic.topicId, {
    ...normalizeDesk({}),
    method: 'gaps',
    marks: { [topic.checklist[0].id]: 'fuzzy', [second.id]: 'gap' },
  });
  assert.equal(openingFocusId(topic, topic.topicId), second.id);
  clearAllDesks();
  assert.equal(openingFocusId(topic, topic.topicId), null);
}

{
  const secret = {
    course: '测',
    title: '测课',
    tagline: '测',
    transferHint: '迁移',
    checklist: [{
      id: 'c1', level: 'L1', point: '要点甲', probeLine: '这是什么',
      groundTruth: 'GROUND_TRUTH_SECRET', lookupCard: 'LOOKUP_CARD_SECRET',
    }],
    misconceptions: [],
    prep: {
      taskCard: '任务',
      microLecture: { title: '讲', body: 'UNREVEALED_LECTURE_SECRET' },
      examples: [],
      selfCheck: [],
    },
  } as unknown as Topic;
  const prompt = buildCoachSystem(secret, {
    ...EMPTY_PREP_CONTEXT,
    quiz: { answered: 1, total: 1, correct: 1, done: true },
    methodLabel: '跟读复述',
    seenLecture: '已经打开的这一段',
    retells: ['我用自己的话说'],
    ownNote: '我的备课笔记',
    weakPoints: ['要点甲'],
  });
  assert.match(prompt, /已经打开的这一段/);
  assert.match(prompt, /我的备课笔记/);
  assert.match(prompt, /我用自己的话说/);
  assert.match(prompt, /要点甲/);
  assert.doesNotMatch(prompt, /GROUND_TRUTH_SECRET/);
  assert.doesNotMatch(prompt, /LOOKUP_CARD_SECRET/);
  assert.doesNotMatch(prompt, /UNREVEALED_LECTURE_SECRET/);
  const closed = buildCoachSystem(secret, EMPTY_PREP_CONTEXT);
  assert.doesNotMatch(closed, /UNREVEALED_LECTURE_SECRET/);
  assert.doesNotMatch(closed, /GROUND_TRUTH_SECRET/);
}

console.log('prep desk: all assertions passed');
