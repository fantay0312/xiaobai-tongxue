import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import leakageReport from '../src/data/leakageReport.json';
import { TOPICS } from '../src/data';
import { examWhisper } from '../src/pages/exam/examStory';
import { getStageMeta } from '../src/engine/evolution';
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
import {
  classifyTeachDemoLine,
  createTeachDemoReply,
  getTeachJourneySnapshot,
} from '../src/pages/landing/landingTeachDemo';

const sourcePath = fileURLToPath(new URL('../src/pages/landing/landingData.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const teachDemoPath = fileURLToPath(new URL('../src/pages/landing/landingTeachDemo.ts', import.meta.url));
const teachDemoSource = readFileSync(teachDemoPath, 'utf8');
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
assert.doesNotMatch(
  teachDemoSource,
  /(?:store\/appStore|engine\/|data\/topics\/|\bTOPICS\b|\/api\/)/,
  '宣传页互动会话必须保持内存隔离，不得载入真实档案、完整引擎或受保护 API',
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
assert.deepEqual(DEMO.pupilStage, {
  name: getStageMeta(2).name,
  description: getStageMeta(2).description,
}, '宣传页小白科名快照已漂移');
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
assert.equal(DEMO.correctedReviewRadar.map(([label]) => label).join(','),
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
assert.match(
  DEMO.branchNotice,
  /错误分支.*接管.*本地.*完整讲解舱/,
  '讲解回放必须同屏说明失败分支与本地演示边界',
);
assert.match(DEMO.missedCorrection, /不是一一对应.*词表/, '课堂失误必须附正确纠正提示');
assert.equal(
  classifyTeachDemoLine(DEMO.correctedTeacherLine),
  'corrected',
  '动态试讲必须识别明确纠正“一字一块”的讲法',
);
assert.equal(
  classifyTeachDemoLine(DEMO.adoptedTeacherLine),
  'adopted',
  '动态试讲必须识别顺着误区讲错的分支',
);
assert.equal(
  classifyTeachDemoLine('一个字不一定对应一个 Token，最后还是要看词表怎么切。'),
  'corrected',
  '否定一一对应关系时不能误判为认同误区',
);
for (const trailingRejection of [
  '一个字一个 Token 是错的。',
  '字数等于 Token 数是不对的。',
  '一个字一个 Token 不一定对。',
]) {
  assert.equal(
    classifyTeachDemoLine(trailingRejection),
    'corrected',
    `后置否定不能被误判为认同误区：${trailingRejection}`,
  );
}
for (const doubleNegative of [
  '一个字一个 Token 不是错的。',
  '一个字一个 Token 并不是不对。',
]) {
  assert.equal(
    classifyTeachDemoLine(doubleNegative),
    'adopted',
    `辩护“一字一块”的双重否定不能被误判为纠正：${doubleNegative}`,
  );
}
assert.equal(
  classifyTeachDemoLine('难道不是一个字对应一个 Token 吗？'),
  'needs-example',
  '反问误区不能被误判为已经纠正',
);
assert.equal(
  classifyTeachDemoLine('词表不能决定怎么切。'),
  'needs-example',
  '否定词表作用的错误说法不能被误判为已经纠正',
);
assert.equal(
  classifyTeachDemoLine('词表决定一个字对应一个 Token。'),
  'adopted',
  '把“一字一块”嫁接给词表仍然是错误结论',
);
assert.equal(
  classifyTeachDemoLine('高频词不会合并成整块。'),
  'needs-example',
  '否定高频合并规律不能被误判为已纠正',
);
assert.equal(
  classifyTeachDemoLine('Token 是模型读取文本时使用的单位。'),
  'needs-example',
  '没有回答切分依据时，小白应继续追问',
);
assert.equal(
  createTeachDemoReply(DEMO.correctedTeacherLine).text,
  DEMO.correctedStudentLine,
  '纠正分支必须使用受保护的小白回应快照',
);
assert.equal(
  createTeachDemoReply(DEMO.adoptedTeacherLine).text,
  DEMO.adoptedStudentLine,
  '带偏分支必须继续使用真实误区结果快照',
);
assert.equal(
  getTeachJourneySnapshot('corrected').branch,
  'passed',
  '纠正结果必须沿用到赴考与批注',
);
assert.equal(
  getTeachJourneySnapshot('adopted').review.resultValue,
  String(DEMO.examScore),
  '带偏分支必须保留受保护的测验快照',
);
const remedyBody = misconception.remedy.microLesson.body;
for (const example of DEMO.tokenExamples) {
  const exampleSnapshot = `"${example.source}" → ${example.pieces.map((piece) => `[${piece}]`).join('')}`;
  assert.ok(
    semanticText(remedyBody).includes(semanticText(exampleSnapshot)),
    `讲解示意切法必须来自课程补学材料：${example.source}`,
  );
}

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
