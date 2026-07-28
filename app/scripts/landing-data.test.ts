import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import leakageReport from '../src/data/leakageReport.json';
import { TOPICS } from '../src/data';
import { examWhisper } from '../src/pages/exam/examStory';
import {
  tokenizationDemo,
  tokenizationSelfTest,
  tokenizationTopic,
} from '../src/data/topics/tokenization';
import {
  COURSE_SUMMARIES,
  DEMO,
  EVIDENCE_STEPS,
  LANDING_METRICS,
  LEARNING_STAGES,
} from '../src/pages/landing/landingData';

const sourcePath = fileURLToPath(new URL('../src/pages/landing/landingData.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
assert.doesNotMatch(
  source,
  /from\s+['"]\.\.\/\.\.\/data(?:\/index(?:\.ts)?)?['"]/,
  '宣传页数据层不得导入 data 聚合入口',
);
assert.doesNotMatch(source, /import[^;]*\bTOPICS\b/, '宣传页数据层不得导入完整 TOPICS');
assert.doesNotMatch(
  source,
  /from\s+['"][^'"]*data\/topics\//,
  '宣传页数据层不得直引 topics；分包配置会因此下载完整课程数据',
);

assert.deepEqual(
  LEARNING_STAGES.map((stage) => stage.title),
  ['备课', '讲解', '赴考', '批注', '补学', '再讲'],
  '六阶段标题或顺序发生漂移',
);
assert.equal(new Set(LEARNING_STAGES.map((stage) => stage.id)).size, 6, '阶段 id 必须唯一');
for (const stage of LEARNING_STAGES) {
  assert.ok(stage.summary && stage.artifact, `${stage.title} 必须描述过程与产物`);
  assert.ok(stage.dwellMs >= 5000, `${stage.title} 自动回放停留时间过短`);
}

const semanticText = (value: string): string =>
  value.toLocaleLowerCase().replace(/[\s，。？！；：、“”‘’—\-!?,.:;（）()]/gu, '');
const teachingDemo = tokenizationDemo.find((line) => line.label.includes('②'));
const misconception = tokenizationTopic.misconceptions.find(
  (item) => item.mcId === DEMO.misconceptionId,
);
const examQuestion = tokenizationTopic.quizBank.find((item) => item.id === 'q3');
const prepQuestion = tokenizationSelfTest.find((item) => item.id === 'st2');
assert.ok(teachingDemo, 'Token 演示必须保留第二段讲解台词');
assert.ok(misconception, '宣传页演示误区必须来自 Token 知识点');
assert.ok(examQuestion, 'Token 演示必须保留 q3 考题');
assert.ok(prepQuestion, 'Token 演示必须保留 st2 摸底题');
assert.equal(DEMO.course, tokenizationTopic.course);
assert.equal(DEMO.title, tokenizationTopic.title);
assert.equal(DEMO.topicId, tokenizationTopic.topicId);
assert.ok(
  semanticText(teachingDemo.text).endsWith(semanticText(DEMO.teachLine)),
  '讲解摘录必须来自 Token 演示第二段',
);
assert.equal(semanticText(DEMO.misconceptionLine), semanticText(misconception.triggerLine));
assert.equal(semanticText(DEMO.examQuestion), semanticText(examQuestion.question));
assert.equal(semanticText(DEMO.prepQuestion), semanticText(prepQuestion.question));
assert.deepEqual(
  DEMO.prepOptions.map(semanticText),
  prepQuestion.options.map(semanticText),
);
assert.equal(DEMO.prepAnswerIndex, prepQuestion.answerIndex);
assert.equal(DEMO.prepStep, 2, '展示题必须是第二波自检第 2 题');
assert.equal(DEMO.prepTotal, tokenizationSelfTest.length, '第二波自检总题数必须来自真实题库');
assert.equal(DEMO.remedyTitle, '一个字 ≠ 一个 Token：切法要看词表');
assert.equal(DEMO.reviewRadar.map(([label]) => label).join(','),
  '覆盖度,准确度,逻辑结构,深度,纠错力');
assert.equal(DEMO.examScore, 20, '带偏分支全链路仿真的随堂测验应为 20 分');
assert.equal(
  DEMO.examWhisper,
  examWhisper('unseen', '哪些词切得整，哪些词切得碎'),
  '赴考心声必须符合当前产品的真实理解派生结果',
);
assert.ok(DEMO.teachLine.length > 20 && DEMO.teachLine.length <= 130, '讲解实录裁剪长度异常');
assert.match(DEMO.adoptedTeacherLine, /一个字对应一块/, '带偏分支必须包含老师认同误区');
assert.match(DEMO.adoptedStudentLine, /按字数判断/, '带偏分支必须包含小白学错的结果');

const metricById = new Map(LANDING_METRICS.map((metric) => [metric.id, metric]));
const courseCount = new Set(TOPICS.map((topic) => topic.course)).size;
const teachableCount = TOPICS.filter((topic) => !topic.locked).length;
assert.equal(metricById.get('courses')?.value, String(courseCount), '课程数快照已漂移');
assert.equal(
  metricById.get('teachable-topics')?.value,
  String(teachableCount),
  '可开讲知识点数快照已漂移',
);
assert.equal(
  metricById.get('adversarial-samples')?.sampleSize,
  leakageReport.totalSamples,
  '对抗样本数必须来自离线报告',
);

const formatRate = (rate: number): string =>
  `${(rate <= 1 ? rate * 100 : rate).toFixed(1)}%`;
const leakageMetric = metricById.get('leakage-rate');
assert.equal(leakageMetric?.from, formatRate(leakageReport.naiveLeakRate));
assert.equal(leakageMetric?.to, formatRate(leakageReport.guardedLeakRate));
assert.equal(leakageMetric?.sampleSize, leakageReport.totalSamples);
assert.match(leakageMetric?.note ?? '', /离线.*(?:台词|测试)/, '泄漏率必须说明离线统计口径');
for (const metric of LANDING_METRICS) {
  assert.ok(metric.value && metric.unit && metric.label && metric.note, `${metric.id} 字段不完整`);
}

const topicGroups = new Map<string, typeof TOPICS>();
for (const topic of TOPICS) {
  const group = topicGroups.get(topic.course);
  if (group) group.push(topic);
  else topicGroups.set(topic.course, [topic]);
}
assert.equal(COURSE_SUMMARIES.length, topicGroups.size, '课程摘要数量必须覆盖全部课程');
for (const summary of COURSE_SUMMARIES) {
  const topics = topicGroups.get(summary.course);
  assert.ok(topics, `课程摘要不存在于数据源：${summary.course}`);
  assert.equal(summary.topicCount, topics.length, `${summary.course} 知识点总数快照已漂移`);
  assert.equal(
    summary.teachableCount,
    topics.filter((topic) => !topic.locked).length,
    `${summary.course} 可开讲数量快照已漂移`,
  );
  for (const title of summary.sampleTopics) {
    assert.ok(topics.some((topic) => topic.title === title), `${summary.course} 示例知识点不存在：${title}`);
  }
}

assert.deepEqual(
  EVIDENCE_STEPS.map((step) => step.title),
  ['关键原话', '误区结果', '逐题判定', '五维批注', '成长册'],
  '一堂课必须留下五份连续证据',
);
assert.equal(new Set(EVIDENCE_STEPS.map((step) => step.id)).size, 5, '证据步骤 id 必须唯一');

console.log('landing data contract: all assertions passed');
