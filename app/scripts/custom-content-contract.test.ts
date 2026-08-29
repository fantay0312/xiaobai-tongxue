import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  hydrateRuntimeTopic,
  hydrateTeacherRuntimeTopic,
  registerRuntimeTopics,
  runtimeTopic,
  topicCourseKey,
} from '../src/data/runtimeTopics';
import { getTopic, TOPICS } from '../src/data';
import { mergeEval, type EvaluateInput } from '../src/engine/evaluator';
import { deriveEvolution } from '../src/engine/evolution';
import type { EvalResult, LearnEvent, TopicState } from '../src/types';

const raw = {
  customCourseId: '12345678-1234-4234-8234-123456789012',
  topicId: 'custom-12345678-abcdef12',
  title: '栈与函数调用',
  course: '数据结构',
  tagline: '从一份自己的讲义开始',
  transferHint: '递归调用',
  checklist: Array.from({ length: 3 }, (_, index) => ({
    id: `c${index + 1}`,
    point: `要点${index + 1}`,
    keywords: [[`要点${index + 1}`]],
    terms: [`术语${index + 1}`],
    level: ['L1', 'L2', 'L5'][index],
    lookupCard: `查书卡${index + 1}`,
    probeLine: `这一点是什么意思？`,
  })),
  misconceptions: Array.from({ length: 2 }, (_, index) => ({
    mcId: `m${index + 1}`,
    belief: `误区${index + 1}`,
    triggerLine: `是不是误区${index + 1}就对了？`,
    correctionKeywords: [['不是']],
    adoptionKeywords: [['是的']],
    injectAfterChecklist: [`c${index + 1}`],
    probe: { statement: `判断${index + 1}`, isTrue: false },
    remedy: {
      microLesson: { title: '补学', body: '补学正文', askBack: '怎么解释？' },
      predictionQuiz: [],
    },
  })),
  quizBank: [],
  prep: {
    microLecture: { title: '微课', body: '微课正文' },
    examples: [],
    selfCheck: ['一', '二', '三'],
    taskCard: '讲给小白听',
  },
};

const hydrated = hydrateRuntimeTopic(raw);
assert.ok(hydrated, '合法的学生课题视图应能注册');
assert.equal(hydrated.checklist[0].groundTruth, hydrated.checklist[0].point, '客户端只补要点名占位，不还原评估依据');
assert.deepEqual(hydrated.misconceptions[0].correctionCriteria, [], '客户端不还原纠正标准');
assert.equal(hydrated.misconceptions[0].probe.explanation, '', '客户端不还原摸底解释');

registerRuntimeTopics([hydrated]);
assert.equal(runtimeTopic(hydrated.topicId)?.title, hydrated.title);
assert.equal(getTopic(hydrated.topicId)?.course, '数据结构');
assert.equal(TOPICS.some((topic) => topic.topicId === hydrated.topicId), false, '运行时课题不得改写预埋课程数组');
assert.equal(topicCourseKey(hydrated), 'custom:12345678-1234-4234-8234-123456789012');
const sameTitleOtherCourse = hydrateRuntimeTopic({
  ...raw,
  topicId: 'custom-87654321-fedcba98',
  customCourseId: '87654321-4321-4321-8321-210987654321',
});
assert.ok(sameTitleOtherCourse);
registerRuntimeTopics([hydrated, sameTitleOtherCourse]);
assert.notEqual(topicCourseKey(hydrated), topicCourseKey(sameTitleOtherCourse));
const masteryEvents: LearnEvent[] = [hydrated, sameTitleOtherCourse].map((topic, index) => ({
  id: `mastery-${index}`,
  t: `2026-08-29T00:00:0${index}Z`,
  type: 'topic_mastered',
  topicId: topic.topicId,
  sessionId: null,
  payload: {},
  evidence: 'test',
}));
const duplicateTitleEvolution = deriveEvolution(masteryEvents, [hydrated, sameTitleOtherCourse]);
assert.equal(duplicateTitleEvolution.coursesTouched.length, 2);
assert.notEqual(duplicateTitleEvolution.coursesTouched[0], duplicateTitleEvolution.coursesTouched[1]);
registerRuntimeTopics([]);

const teacherRaw = structuredClone(raw) as typeof raw & {
  checklist: Array<(typeof raw.checklist)[number] & { groundTruth: string }>;
  misconceptions: Array<(typeof raw.misconceptions)[number] & { correctionCriteria: string[]; probe: { statement: string; isTrue: false; explanation: string } }>;
};
teacherRaw.checklist.forEach((item, index) => { item.groundTruth = `完整评估依据${index + 1}`; });
teacherRaw.misconceptions.forEach((item, index) => {
  item.correctionCriteria = [`完整纠正标准${index + 1}`];
  item.probe.explanation = `完整错误解释${index + 1}`;
});
const teacherTopic = hydrateTeacherRuntimeTopic(teacherRaw);
assert.ok(teacherTopic, '完整教师稿应能通过严格 hydration');
assert.equal(teacherTopic.checklist[0].groundTruth, '完整评估依据1');
assert.deepEqual(teacherTopic.misconceptions[0].correctionCriteria, ['完整纠正标准1']);
assert.equal(runtimeTopic(teacherTopic.topicId), undefined, '教师稿不得自动进入全局学生运行时表');
assert.equal(hydrateTeacherRuntimeTopic(raw), null, '脱敏学生稿不能冒充教师备课稿');

const customState: TopicState = {
  topicId: hydrated.topicId,
  knowledgeState: '没懂',
  level: 'L1',
  hitChecklist: [],
  mcStates: {},
  accuracyFlags: [],
  stuckStreak: 0,
  rescueLevel: 0,
  prepDone: false,
  lastVerified: null,
  reviewDue: null,
  forgotten: false,
  mastery: 0,
};
const customInput: EvaluateInput = {
  utterance: '我提到了要点1，但结论其实讲反了',
  lastXiaobaiText: null,
  topic: hydrated,
  state: customState,
  pendingMcId: null,
  settings: { mode: 'proxy', baseUrl: '', apiKey: '', model: '', temperature: 0 },
};
const ruleFalsePositive: EvalResult = {
  checklistHits: ['c1'], accuracyFlags: [], mcEvent: null,
  stuckSignal: false, offTopic: false, answeredTangent: false,
  goldenAnalogy: null, reasoning: '关键词命中',
};
const semanticVeto = mergeEval(ruleFalsePositive, {
  checklistHits: [],
  accuracyFlags: [{ checklistId: 'c1', note: '结论与完整 rubric 相悖' }],
}, customInput);
assert.deepEqual(semanticVeto.checklistHits, [], '自定义课服务端 rubric 应否决关键词假阳性');
assert.equal(semanticVeto.accuracyFlags[0]?.checklistId, 'c1');

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../src/pages/custom-content/index.tsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/lib/customContent.ts', import.meta.url), 'utf8');
const evaluatorSource = await readFile(new URL('../src/engine/evaluator.ts', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../src/store/appStore.ts', import.meta.url), 'utf8');
const prepSource = await readFile(new URL('../src/pages/prep/index.tsx', import.meta.url), 'utf8');
const shellCss = await readFile(new URL('../src/components/shell/AppShell.module.css', import.meta.url), 'utf8');
assert.match(appSource, /path="\/custom-content"/);
assert.match(pageSource, /自选讲义/);
assert.match(pageSource, /getCourseCompileJob/);
assert.match(pageSource, /考小白的随堂题/);
assert.match(pageSource, /重编题号/);
assert.match(pageSource, /重编要点编号/);
assert.match(pageSource, /重编误区编号/);
assert.match(pageSource, /查找课件出处/);
assert.match(pageSource, /放弃这份草稿/);
assert.match(pageSource, /重新连接资料服务/);
assert.match(pageSource, /listCourseAssets[\s\S]{0,700}retryDelay\(failures\)/);
assert.match(pageSource, /getCourseCompileJob[\s\S]{0,900}retryDelay\(failures\)/);
assert.match(evaluatorSource, /evaluateCustomTopicSemantic/);
assert.match(evaluatorSource, /const semantic = customTopic\s*\? await evaluateCustomTopicSemantic/);
assert.match(evaluatorSource, /mode === 'mock' && !customTopic/);
assert.match(storeSource, /learningLevel:\s*deriveEvolution\(state\.events, getAllTopics\(\)\)\.stage/);
assert.match(storeSource, /CUSTOM_TOPICS_RETRY_MS\[attempt\]/);
assert.match(prepSource, /TEACHER_TOPIC_RETRY_MS\[attempt\]/);
assert.match(shellCss, /@media \(max-width: 520px\)[\s\S]*navGroup:has\(\.linkActive\) \.menuButton/);
assert.doesNotMatch(apiSource, /X-API-Key|WK_API_KEY|WeKnora.*key/i, '浏览器 API 层不得持有 WeKnora 凭据');

console.log('custom content contract: 45 assertions passed');
