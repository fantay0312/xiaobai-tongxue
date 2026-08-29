import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  hydrateRuntimeTopic,
  hydrateTeacherRuntimeTopic,
  registerRuntimeTopics,
  runtimeTopic,
} from '../src/data/runtimeTopics';
import { getTopic, TOPICS } from '../src/data';

const raw = {
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

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const pageSource = await readFile(new URL('../src/pages/custom-content/index.tsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../src/lib/customContent.ts', import.meta.url), 'utf8');
assert.match(appSource, /path="\/custom-content"/);
assert.match(pageSource, /自选讲义/);
assert.match(pageSource, /getCourseCompileJob/);
assert.match(pageSource, /考小白的随堂题/);
assert.match(pageSource, /查找课件出处/);
assert.doesNotMatch(apiSource, /X-API-Key|WK_API_KEY|WeKnora.*key/i, '浏览器 API 层不得持有 WeKnora 凭据');

console.log('custom content contract: 24 assertions passed');
