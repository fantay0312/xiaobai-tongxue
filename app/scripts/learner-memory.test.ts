/**
 * 学伴记忆引擎契约:确定性、Mem0 式 ADD/UPDATE/DELETE/NOOP、封顶、检索作用域、提示词零泄漏、
 * 亲笔不可动、回填幂等、净化与合并。只引纯模块(不碰 appStore / sync / engine barrel)。
 */
import assert from 'node:assert/strict';
import { getTopic, TOPICS } from '../src/data';
import { leakageCheck } from '../src/engine/leakage';
import {
  EMPTY_MEMORY, HINT_BY_KEY, MEMORY_CAP, MIN_VISIBLE_CONFIDENCE, composeLearnerProfile, explicitMemory,
  extractSessionMemories, memoryHintsForXiaobai, memoryItemId, mergeMemoryStates, rebuildMemoryFromHistory,
  reconcileMemories, retrieveMemories, sanitizeMemoryState, scoreMemory, scrubQuote,
} from '../src/engine/learnerMemory';
import type { MemoryDraft } from '../src/engine/learnerMemory';
import type {
  ChatMessage, InstructionCard, LearnEvent, LearnEventType, MemoryItem, SessionReport, TurnTrace,
} from '../src/types';

let passed = 0;
function ok(cond: unknown, message: string): void {
  assert.ok(cond, message);
  passed += 1;
}
function eq<T>(actual: T, expected: T, message: string): void {
  assert.deepEqual(actual, expected, message);
  passed += 1;
}

const topic = getTopic('shallow-copy');
assert.ok(topic, '浅拷贝主题必须存在');
const other = TOPICS.find((t) => !t.locked && t.topicId !== topic.topicId);
assert.ok(other, '需要第二门开放课程');

// 2026-08-10 15:00Z = 上海 23:00(夜读)
const T0 = '2026-08-10T15:00:00.000Z';
const NOW = '2026-08-10T16:00:00.000Z';
let seq = 0;
const tick = (n: number) => new Date(Date.parse(T0) + n * 1000).toISOString();
function ev(
  type: LearnEventType, payload: Record<string, unknown> = {}, sessionId: string | null = 'S1',
  topicId = topic.topicId,
): LearnEvent {
  seq += 1;
  return { id: `e${seq}`, t: tick(seq), type, topicId, sessionId, payload, evidence: '' };
}
const msg = (role: ChatMessage['role'], text: string): ChatMessage => ({ id: `m${++seq}`, role, text, t: tick(seq) });
const CARD: InstructionCard = {
  action: 'ask_clarify', mcId: null, mcBelief: null, targetChecklistId: null, knownWhitelist: [],
  recentTeacherTerms: [], style: { persona: '好奇型', learningLevel: 1, maxSentences: 2, mustEndWithQuestion: true },
  paraphraseSource: null,
};
function trace(teacherText: string, over: Partial<TurnTrace['evalResult']> = {}): TurnTrace {
  seq += 1;
  return {
    turn: seq, teacherText, xiaobaiText: '', leakageRetries: 0, t: tick(seq), card: CARD,
    evalResult: {
      checklistHits: [], accuracyFlags: [], mcEvent: null, stuckSignal: false, offTopic: false,
      answeredTangent: false, goldenAnalogy: null, reasoning: '', ...over,
    },
  };
}

const c1 = topic.checklist[0];
const c2 = topic.checklist[1];
const mc = topic.misconceptions[0];
assert.ok(c1 && c2 && mc, '夹具需要两条要点与一条误区');

const sessionEvents: LearnEvent[] = [
  ev('session_started', { mode: 'teach' }),
  ev('checklist_hit', { checklistId: c1.id, point: c1.point }),
  ev('stuck_rescued', { level: 'R1' }),
  ev('stuck_rescued', { level: 'R2', checklistId: c2.id }),
  ev('stuck_rescued', { level: 'R3', checklistId: undefined }),
  ev('golden_analogy_saved', { text: '就像复印一张带便利贴的纸' }),
  ev('misconception_adopted', { mcId: mc.mcId }),
  ev('misconception_adopted', { mcId: 'no_such_mc' }),
  ev('xiaobai_quiz_scored', { score: 40, failed: [c2.id] }),
  ev('session_ended', { turns: 5 }),
];
const report: SessionReport = {
  sessionId: 'S1', topicId: topic.topicId, mode: 'teach', startedAt: T0, endedAt: NOW,
  radar: { 覆盖度: 0.5, 准确度: 0.8, 逻辑结构: 0.9, 深度: 0.5, 纠错力: 0 },
  radarDelta: null, highlights: [], goldenAnalogies: [], blindSpots: [], quiz: null, turnCount: 5, masteredNow: false,
};
const messages: ChatMessage[] = [
  msg('xiaobai', '老师好'),
  msg('teacher', '就像复印一张带便利贴的纸'),
  msg('teacher', '好比搬家只搬了门牌'),
  msg('teacher', '相当于影子跟着本体走，我的电话 13800138000 记一下'),
  msg('teacher', 'zhangsan 说过就好像镜子'),
];
const traces: TurnTrace[] = [
  trace('赋值不是拷贝'), trace('外层新的里层同一个'), trace('改内层两边都变'), trace('这就是浅'),
  trace('嗯……这里我不太确定', { stuckSignal: true }), trace('今天天气不错哈', { offTopic: true }),
];
const extractInput = {
  sessionId: 'S1', events: sessionEvents, report, topic, messages, traces, existing: [] as MemoryItem[],
  piiTerms: ['zhangsan'], now: NOW,
};

// ── 抽取:确定性 + 规则覆盖 ──
const drafts = extractSessionMemories(extractInput);
eq(drafts, extractSessionMemories(extractInput), '同输入两次抽取必须逐字相等');
const byKey = (key: string) => drafts.find((d) => d.dedupeKey === key);
const analogy = byKey('analogy');
ok(analogy && analogy.kind === 'habit' && analogy.confidence === 0.8 && analogy.text === '先生讲课爱打比方',
  '金句事件 → 爱打比方习惯(置信 0.8)');
ok(analogy!.evidence[0] === sessionEvents[5].id, '金句事件 id 排在证据最前');
ok(analogy!.evidence.every((e) => !/\d{7,}/.test(e) && !e.includes('zhangsan')),
  '引文里不得残留电话号码或用户名');
ok(analogy!.evidence.every((e) => e.length <= 21), '引文 ≤20 字');
const stuck = byKey(`stuck:${c2.id}`);
ok(stuck && stuck.kind === 'weakness' && stuck.scope.topicId === topic.topicId
  && stuck.contradictionKey === `checklist:${c2.id}` && stuck.text.includes(c2.point) && stuck.confidence === 0.5,
  'R2 卡壳 → 课级短板,带矛盾键,文本含要点名');
ok(drafts.every((d) => !d.text.includes('undefined')), '缺 checklistId 的 R1/R3 不得生成「undefined」条目');
ok(!drafts.some((d) => d.dedupeKey === 'mc:no_such_mc'), '主题里不存在的误区不出草稿');
const adopted = byKey(`mc:${mc.mcId}`);
ok(adopted && adopted.kind === 'weakness' && !adopted.text.includes(mc.belief) && adopted.text.includes('『'),
  '被带偏 → 短板,用心魔策展名而非 belief 原文');
ok(adopted!.evidence.length === 2 && adopted!.evidence[0] === sessionEvents[6].id, '误区证据 = 事件 id + belief 引文');
const quiz = byKey('quiz');
ok(quiz && quiz.kind === 'weakness' && quiz.text.includes('40 分') && quiz.contradictionKey === `quiz:${topic.topicId}`,
  '送考 40 分 → 短板');
const logic = byKey('radar:logic:hi');
ok(logic && logic.kind === 'strength' && logic.scope.topicId === topic.topicId && logic.confidence === 0.4,
  '逻辑结构 0.9 且 ≥4 轮 → 课级长处(低置信)');
ok(byKey('terse')?.kind === 'habit' && byKey('terse')?.contradictionKey === 'style:length',
  '干净 4 轮均长 <25 → 说话短习惯(卡壳/偏题轮不计)');
ok(byKey('night')?.confidence === 0.3, '上海 23 点开课 → 夜读草稿(置信 0.3,未过可见线)');
ok(drafts.every((d) => d.text.length <= 60 && !/[,:;]/.test(d.text)), '草稿文本 ≤60 字且不含半角标点');
ok(drafts.every((d) => d.text.startsWith('先生') || d.text.includes('先生') || d.text.includes('小白')),
  '草稿一律写先生/小白,不写第一人称');
ok(!drafts.some((d) => d.kind === 'strength' && d.dedupeKey.startsWith('hit:')),
  '没有往史短板时,要点命中不生成「后来讲明白了」');
ok(extractSessionMemories({ ...extractInput, messages: [], traces: [] }).every((d) => !['terse', 'verbose', 'code'].includes(d.dedupeKey)),
  '回填路径(无对话)不产出说话风格类草稿');
eq(scrubQuote('  请加我微信 abc123  '), null, '联系方式引文整条丢弃');
eq(scrubQuote('一二三四五六七八九十一二三四五六七八九十廿一'), '一二三四五六七八九十一二三四五六七八九十…', '引文截 20 字加省略号');

// ── 归并:ADD / UPDATE / DELETE / NOOP ──
const first = reconcileMemories([], drafts, NOW);
ok(first.ops.every((op) => op.op === 'ADD') && first.items.length === drafts.length, '首次归并全部 ADD');
ok(first.items.every((it) => it.id === memoryItemId(it.kind, it.scope, it.dedupeKey)), 'id 由 kind|scope|dedupeKey 稳定派生');
const LATER = '2026-08-12T15:00:00.000Z';
const second = reconcileMemories(first.items, drafts, LATER);
ok(second.ops.every((op) => op.op === 'UPDATE') && second.items.length === first.items.length, '同草稿再来 → 全部 UPDATE');
const analogyItem = second.items.find((it) => it.dedupeKey === 'analogy')!;
ok(analogyItem.seenCount === 2 && Math.abs(analogyItem.confidence - 0.95) < 1e-9 && analogyItem.lastSeenAt === LATER,
  'UPDATE:seenCount++、置信 +0.15、刷新 lastSeenAt');
const corrected: MemoryDraft = {
  kind: 'strength', scope: { topicId: topic.topicId }, dedupeKey: `mc:${mc.mcId}`,
  contradictionKey: `mc:${mc.mcId}`, text: '先生把『心魔』这处误区纠了回来', confidence: 0.7, evidence: ['x'],
};
const third = reconcileMemories(second.items, [corrected], LATER);
const adoptedId = memoryItemId('weakness', { topicId: topic.topicId }, `mc:${mc.mcId}`);
ok(third.ops.some((op) => op.op === 'DELETE' && op.id === adoptedId && op.reason === `contradiction:mc:${mc.mcId}`)
  && third.ops.some((op) => op.op === 'ADD') && !third.items.some((it) => it.id === adoptedId),
  '同矛盾键的长处到来 → 旧短板 DELETE、新长处 ADD');
const explicitWeak = { ...second.items.find((it) => it.id === adoptedId)!, source: 'explicit' as const };
const kept = reconcileMemories(second.items.map((it) => (it.id === adoptedId ? explicitWeak : it)), [corrected], LATER);
ok(kept.ops.length === 1 && kept.ops[0].op === 'NOOP' && kept.ops[0].reason === `kept-explicit:mc:${mc.mcId}`
  && kept.items.length === second.items.length && kept.items.find((it) => it.id === adoptedId)?.text === explicitWeak.text,
  '亲笔短板在位 → 相反草稿 NOOP,条目不动');
const hitAfter = extractSessionMemories({
  ...extractInput, sessionId: 'S2', existing: second.items,
  events: [ev('session_started', { mode: 'teach' }, 'S2'), ev('checklist_hit', { checklistId: c2.id }, 'S2')],
  report: null, messages: [], traces: [],
});
ok(hitAfter.some((d) => d.dedupeKey === `hit:${c2.id}` && d.kind === 'strength' && d.contradictionKey === `checklist:${c2.id}`),
  '往史有卡壳短板时,再命中该要点 → 「后来讲明白了」长处');
const afterHit = reconcileMemories(second.items, hitAfter, LATER);
ok(!afterHit.items.some((it) => it.dedupeKey === `stuck:${c2.id}`), '「后来讲明白了」删掉同要点的卡壳短板');
const mastery = reconcileMemories(second.items, [{
  kind: 'milestone', scope: { topicId: topic.topicId }, dedupeKey: 'mastered', text: '《x》讲了 3 轮，小白出师', confidence: 1, evidence: [],
}], LATER);
ok(mastery.ops.filter((op) => op.reason === 'superseded-by-mastery').length === 2
  && !mastery.items.some((it) => it.kind === 'weakness' && (it.dedupeKey === 'quiz' || it.dedupeKey.startsWith('stuck:'))),
  '出师 → 该课卡壳/送考短板退场');
const mass: MemoryDraft[] = Array.from({ length: MEMORY_CAP + 5 }, (_, i) => ({
  kind: 'note', scope: {}, dedupeKey: `bulk-${i}`, text: `第 ${i} 条`, confidence: 0.5, evidence: [],
}));
const note = explicitMemory('先生开讲前爱先问一句', {}, NOW)!;
const capped = reconcileMemories([note], mass, NOW);
ok(capped.items.length === MEMORY_CAP && capped.items.some((it) => it.id === note.id)
  && capped.ops.filter((op) => op.reason === 'cap-80').length === 6, '封顶 80:亲笔不淘汰,多出的观察项按分数淘汰');
const pinnedTerse = { ...first.items.find((it) => it.dedupeKey === 'terse')!, pinned: true };
const verbose: MemoryDraft = { kind: 'habit', scope: {}, dedupeKey: 'verbose', contradictionKey: 'style:length', text: '先生一开口就是一大段', confidence: 0.5, evidence: [] };
ok(reconcileMemories([pinnedTerse], [verbose], LATER).items.length === 1, '固定的条目不被矛盾草稿顶掉');

// ── 评分 ──
const base = first.items.find((it) => it.dedupeKey === 'analogy')!;
const stale = { ...base, lastSeenAt: '2026-07-01T00:00:00.000Z' };
ok(scoreMemory(stale, LATER) < scoreMemory(base, LATER), '观察项按 21 天半衰期褪色');
ok(scoreMemory({ ...stale, kind: 'milestone' }, LATER) === scoreMemory({ ...base, kind: 'milestone' }, LATER), '里程碑不褪色');
ok(scoreMemory({ ...stale, source: 'explicit' }, LATER) === scoreMemory({ ...base, source: 'explicit' }, LATER), '亲笔不褪色');
ok(scoreMemory({ ...base, muted: true }, LATER) === 0, '隐藏项得分归零');
ok(scoreMemory({ ...base, pinned: true }, LATER) > scoreMemory(base, LATER) * 1.5, '固定项加倍');

// ── 检索作用域 ──
const otherWeak: MemoryItem = {
  ...first.items.find((it) => it.dedupeKey === 'quiz')!, id: 'mem-other', scope: { topicId: other.topicId },
};
const courseItem: MemoryItem = { ...base, id: 'mem-course', dedupeKey: 'course-x', scope: { course: topic.course }, confidence: 0.5 };
const mutedItem: MemoryItem = { ...base, id: 'mem-muted', dedupeKey: 'muted-x', muted: true };
const pool = [...first.items, otherWeak, courseItem, mutedItem];
const got = retrieveMemories({ items: pool, topicId: topic.topicId, course: topic.course, limit: 50, now: LATER });
ok(!got.some((it) => it.id === 'mem-other'), '别的课的条目不取');
ok(!got.some((it) => it.id === 'mem-muted'), '隐藏项不取');
ok(!got.some((it) => it.dedupeKey === 'night'), `低于 ${MIN_VISIBLE_CONFIDENCE} 的条目不取`);
const ranks = got.map((it) => (it.scope.topicId ? 3 : it.scope.course ? 2 : 1));
ok(ranks.every((r, i) => i === 0 || ranks[i - 1] >= r) && ranks.includes(3) && ranks.includes(2) && ranks.includes(1),
  '作用域次序 课 > 课程 > 全局');
eq(retrieveMemories({ items: pool, topicId: topic.topicId, kinds: ['weakness'], limit: 1, now: LATER }).map((it) => it.kind), ['weakness'], 'kinds 过滤 + limit');

// ── 提示词零泄漏 ──
const hintInput = { items: pool, topicId: topic.topicId, course: topic.course, topic, hitChecklist: [], now: LATER };
const hints = memoryHintsForXiaobai(hintInput);
ok(hints.length > 0 && hints.length <= 2, '提示词 ≤2 句');
ok(hints.every((h) => Object.values(HINT_BY_KEY).includes(h)), '提示词只来自固定话术表');
const secrets = [
  ...topic.checklist.flatMap((c) => [c.groundTruth, c.lookupCard]),
  ...topic.misconceptions.flatMap((m) => m.correctionCriteria),
].filter((s) => s.length >= 4);
ok(hints.every((h) => secrets.every((s) => !h.includes(s) && !s.includes(h))), '提示词不含 groundTruth/lookupCard/correctionCriteria');
ok(hints.every((h) => topic.checklist.every((c) => c.terms.every((t) => !h.includes(t)))), '提示词不含夹具主题任何 checklist 术语');
ok(pool.filter((it) => ['weakness', 'strength', 'milestone', 'note'].includes(it.kind))
  .every((it) => !hints.some((h) => h.includes(it.text))), '短板/长处/里程碑/笔记永不进提示');
const editedHabit: MemoryItem = { ...base, id: 'mem-edited', dedupeKey: 'analogy', source: 'explicit', text: `老师讲${c2.point}时爱打比方`, pinned: true };
const editedHints = memoryHintsForXiaobai({ ...hintInput, items: [editedHabit] });
ok(editedHints.every((h) => !h.includes(c2.point)) && editedHints.every((h) => h === HINT_BY_KEY.analogy),
  '亲笔改过的习惯只按 dedupeKey 取表,不注入改写后的文本');
ok(memoryHintsForXiaobai({ ...hintInput, items: [{ ...note }] }).length === 0, '亲笔笔记没有表项 → 不进提示');
for (const t of TOPICS) {
  for (const line of Object.values(HINT_BY_KEY)) {
    assert.deepEqual(leakageCheck({ reply: line, topic: t, whitelistChecklist: [], teacherTerms: [] }), [],
      `话术「${line}」在《${t.title}》零白名单下泄漏`);
  }
}
passed += 1;

// ── 画像 ──
const profile = composeLearnerProfile({ items: second.items, events: sessionEvents, now: LATER });
ok(profile.basis.sessionCount === 1 && profile.summary.includes('1 堂课') && profile.summary.length <= 120,
  '画像 summary 引用真实堂数');
ok(profile.sections.style.includes('爱打比方') && profile.sections.weaknesses !== '' && profile.sections.bond === ''
  && Object.values(profile.sections).every((s) => s.length <= 80), '画像五段各 ≤80,无据段为空');
ok(!profile.sections.pace.includes('夜读'), '未过可见线的夜读不进画像');
const staleProfile = composeLearnerProfile({ items: second.items, events: sessionEvents, now: '2026-09-05T00:00:00.000Z' });
ok(staleProfile.summary.startsWith('先生上回来是 25 天前。') && staleProfile.summary.includes('先生从前'),
  '14 天未来 → 标注上回时间并改「从前」口吻');
const emptyProfile = composeLearnerProfile({ items: [], events: [], now: LATER });
ok(emptyProfile.summary === '' && Object.values(emptyProfile.sections).every((s) => s === ''), '空档画像全部为空串');

// ── 亲笔 ──
eq(explicitMemory('   ', {}, NOW), null, '空文本不建条目');
ok(note.source === 'explicit' && note.pinned && note.confidence === 1 && note.kind === 'note', '亲笔条目 explicit/固定/置信 1');
ok(explicitMemory('字'.repeat(80), {}, NOW)!.text.length === 60, '亲笔超 60 字截断');
const survived = reconcileMemories([note], drafts, LATER).items.find((it) => it.id === note.id);
ok(survived && survived.text === note.text && survived.source === 'explicit', '亲笔条目经归并原样保留');

// ── 回填幂等 ──
const history = [
  ...sessionEvents,
  ev('session_started', { mode: 'reteach' }, 'S2'),
  ev('misconception_corrected', { mcId: mc.mcId }, 'S2'),
  ev('session_ended', { turns: 3 }, 'S2'),
  ev('prep_completed', {}, null),
];
const rebuiltA = rebuildMemoryFromHistory({ events: history, reports: [report], topics: TOPICS, now: LATER });
const rebuiltB = rebuildMemoryFromHistory({ events: [...history].reverse(), reports: [report], topics: TOPICS, now: LATER });
eq(rebuiltA, rebuiltB, '回填幂等,且不依赖事件输入顺序');
eq(JSON.parse(JSON.stringify(rebuiltA)), rebuiltA, '回填结果可 JSON 往返(无 undefined 键)');
ok(rebuiltA.items.some((it) => it.dedupeKey === 'reteach' && it.kind === 'bond'), '重讲会话 → 情分条目');
ok(rebuiltA.items.some((it) => it.kind === 'strength' && it.dedupeKey === `mc:${mc.mcId}`)
  && !rebuiltA.items.some((it) => it.kind === 'weakness' && it.dedupeKey === `mc:${mc.mcId}`),
  '回填按时间重放:后来纠正的误区只留长处');
ok(rebuiltA.profile !== null && rebuiltA.profile.basis.sessionCount === 2, '回填后画像就位');
eq(rebuildMemoryFromHistory({ events: [], reports: [], topics: TOPICS, now: LATER }), EMPTY_MEMORY, '空事件流回填 = 空记忆');

// ── 净化 ──
eq(sanitizeMemoryState('nope'), null, '非对象切片 → null');
const dirty = sanitizeMemoryState({
  items: [{}, { ...base, confidence: 1.5, evidence: ['a', 'b', 'c', 'd', 'e', 'f', 3] }, { ...base, kind: 'alien' }, { ...base, id: base.id }],
  profile: { version: 2 }, paused: 'x',
});
ok(dirty && dirty.items.length === 1 && dirty.items[0].confidence === 1 && dirty.items[0].evidence.length === 5
  && dirty.profile === null && dirty.paused === false, '畸形条目丢弃、数值夹取、重复 id 去重、画像/paused 归安全值');
const overflow = sanitizeMemoryState({ items: capped.items.concat(mass.slice(0, 3).map((d, i) => ({ ...base, id: `extra-${i}`, dedupeKey: d.dedupeKey }))), profile: profile, paused: true });
ok(overflow && overflow.items.length === MEMORY_CAP && overflow.paused && overflow.profile?.summary === profile.summary,
  '超 80 条封顶,合法画像与 paused 保留');

// ── 合并 ──
const older = { ...base, text: '旧文', updatedAt: T0, muted: true };
const newer = { ...base, text: '新文', updatedAt: LATER, muted: false };
const merged = mergeMemoryStates([{ ...EMPTY_MEMORY, items: [newer], paused: false }, { ...EMPTY_MEMORY, items: [older], paused: true }])!;
ok(merged.items.length === 1 && merged.items[0].text === '新文' && merged.items[0].muted === false && merged.paused === true,
  '按 updatedAt 新者胜(本地取消隐藏可胜远端隐藏),paused 取后者');
const tie = mergeMemoryStates([{ ...EMPTY_MEMORY, items: [{ ...base, pinned: false }] }, { ...EMPTY_MEMORY, items: [{ ...base, pinned: true }] }])!;
ok(tie.items[0].pinned === true, '同 updatedAt 平手取固定者');
// 先生在 A 机固定+隐藏(T1),B 机的后台「又见到一次」(T2)只推观察字段——合并后固定/隐藏不得丢
const EVEN_LATER = '2026-08-14T15:00:00.000Z';
const pinnedOnA = { ...base, pinned: true, muted: true, updatedAt: LATER };
const seenOnB = reconcileMemories([base], drafts.filter((d) => d.dedupeKey === 'analogy'), EVEN_LATER).items
  .find((it) => it.id === base.id)!;
ok(seenOnB.updatedAt === base.updatedAt && seenOnB.lastSeenAt === EVEN_LATER && seenOnB.seenCount === base.seenCount + 1,
  'seen-again UPDATE 只推 lastSeenAt/seenCount,不动 updatedAt');
const keepIntent = mergeMemoryStates([{ ...EMPTY_MEMORY, items: [seenOnB] }, { ...EMPTY_MEMORY, items: [pinnedOnA] }])!.items[0];
ok(keepIntent.pinned && keepIntent.muted && keepIntent.lastSeenAt === EVEN_LATER && keepIntent.seenCount === seenOnB.seenCount
  && keepIntent.confidence === Math.max(seenOnB.confidence, pinnedOnA.confidence),
  '合并:固定/隐藏取 updatedAt 新者,观察字段两边取大');
const keepIntentRev = mergeMemoryStates([{ ...EMPTY_MEMORY, items: [pinnedOnA] }, { ...EMPTY_MEMORY, items: [seenOnB] }])!.items[0];
ok(keepIntentRev.pinned && keepIntentRev.muted && keepIntentRev.lastSeenAt === EVEN_LATER, '合并顺序无关');

console.log(`learner memory: ${passed} assertions passed`);
