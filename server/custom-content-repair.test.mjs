import test from 'node:test';
import assert from 'node:assert/strict';
import { hasBlockingIssues, normalizeTopicDraft, validateTopicDraft } from './custom-content/topic-contract.mjs';
import { createTopicCompiler, TOPIC_PROMPT_VERSION } from './custom-content/topic-compiler.mjs';

const quiz = (id, checklistRef = 'C1', mcRef = null) => ({
  id, question: `问题${id}`, options: ['甲', '乙'], answerIndex: 0, explanation: '依据课件', checklistRef, mcRef,
});
const quizzes = (prefix, checklistRef, mcRef) => [1, 2, 3].map((n) => quiz(`${prefix}-Q${n}`, checklistRef, mcRef));

/** 2026-08-30 线上首份草稿的真实形状:字段写成字符串、关键词一维、"C1-C2"、"小白：" 前缀 */
function sloppyDraft() {
  return {
    title: '审计风险与审计证据',
    tagline: '掌握风险模型',
    transferHint: '换一个行业',
    checklist: [1, 2, 3].map((n) => ({
      id: `C${n}`, point: `要点${n}`, groundTruth: `课件明确说明要点${n}的原理`, keywords: [`要点${n}`, '原理'],
      terms: [`要点${n}`], level: 'L1', lookupCard: '查书卡', probeLine: `小白：要点${n}是什么意思？`,
      sourceChunkIds: ['chunk-1'], sourceExcerpt: '要点原理',
    })),
    misconceptions: [
      {
        mcId: 'm1', belief: '审计提供绝对保证', triggerLine: '「小白：审计是不是保证报表一点错都没有？」',
        correctionCriteria: '审计提供合理保证而非绝对保证；存在固有限制',
        correctionKeywords: ['合理保证', '固有限制'], adoptionKeywords: '合理保证',
        injectAfterChecklist: 'c1',
        probe: '审计能保证报表完全正确。',
        remedy: { microLesson: '审计通过降低检查风险提供合理保证。', predictionQuiz: quizzes('M1', 'c1', 'm1') },
      },
      {
        mcId: 'M2', belief: '证据越多越可靠', triggerLine: '资料多就没问题吧？', correctionCriteria: ['适当性同样重要'],
        correctionKeywords: [['适当性']], adoptionKeywords: [['质量']], injectAfterChecklist: ['C2'],
        probe: { statement: '证据数量决定一切。', explanation: '充分性只是数量维度' },
        remedy: { microLesson: { title: '补学', body: '正文', askBack: '再说一遍？' }, predictionQuiz: quizzes('M2', 'C2', 'M2') },
      },
    ],
    quizBank: [quiz('Q1', 'C1-C2'), quiz('Q2', 'c3'), quiz('Q3', 'C3', 'm2')],
    prep: {
      microLecture: { title: '速讲', body: '正文' },
      examples: [],
      selfCheck: '自检一\n自检二；自检三',
      taskCard: '任务卡',
    },
  };
}

test('归一化容错:字符串/一维/大小写/"C1-C2"/说话人前缀都能对回契约', () => {
  const topic = normalizeTopicDraft(sloppyDraft(), { topicId: 'custom-t', courseTitle: '审计学', sourceAssets: [] });
  const [m1] = topic.misconceptions;
  assert.equal(topic.checklist[0].probeLine, '要点1是什么意思？');
  assert.deepEqual(topic.checklist[0].keywords, [['要点1'], ['原理']]);
  assert.equal(m1.triggerLine, '审计是不是保证报表一点错都没有？');
  assert.deepEqual(m1.correctionCriteria, ['审计提供合理保证而非绝对保证', '存在固有限制']);
  assert.deepEqual(m1.correctionKeywords, [['合理保证'], ['固有限制']]);
  assert.deepEqual(m1.adoptionKeywords, [['合理保证']]);
  assert.deepEqual(m1.injectAfterChecklist, ['C1']);
  assert.equal(m1.probe.statement, '审计能保证报表完全正确。');
  assert.equal(m1.probe.explanation, '审计提供合理保证而非绝对保证');
  assert.equal(m1.remedy.microLesson.body, '审计通过降低检查风险提供合理保证。');
  assert.deepEqual(m1.remedy.predictionQuiz.map((q) => [q.checklistRef, q.mcRef]), [['C1', 'm1'], ['C1', 'm1'], ['C1', 'm1']]);
  assert.deepEqual(topic.quizBank.map((q) => q.checklistRef), ['C1', 'C3', 'C3']);
  assert.equal(topic.quizBank[2].mcRef, 'M2');
  assert.deepEqual(topic.prep.selfCheck, ['自检一', '自检二', '自检三']);
  const issues = validateTopicDraft(topic);
  // 只剩模型确实没写的:M1 补学小笺缺标题与回问
  assert.deepEqual(issues.map((i) => i.code), ['remedy-incomplete']);
});

test('缺 probe 时以错误认知作判断题、缺解释取首条纠正标准;缺 remedy 不再抛弃整条误区', () => {
  const draft = sloppyDraft();
  delete draft.misconceptions[0].probe;
  draft.misconceptions[0].remedy = '一段补学说明';
  const topic = normalizeTopicDraft(draft, { topicId: 'custom-t', courseTitle: '审计学', sourceAssets: [] });
  const [m1] = topic.misconceptions;
  assert.equal(m1.probe.statement, '审计提供绝对保证');
  assert.equal(m1.probe.isTrue, false);
  assert.equal(m1.remedy.microLesson.body, '一段补学说明');
  assert.equal(m1.remedy.predictionQuiz.length, 0);
});

function fakeWeknora() {
  const chunks = [{ id: 'chunk-1', content: '课件明确说明要点1的原理、要点2的原理、要点3的原理。合理保证 固有限制 适当性 质量' }];
  return { async listChunks() { return chunks; }, async search() { return chunks; } };
}
const compileInput = {
  course: { id: 'course', title: '审计学', wkDocKbId: 'kb' },
  assets: [{ id: 'asset', wkKnowledgeId: 'k1', filename: 'a.md', assetRole: 'lecture' }],
  topicId: 'custom-course-job',
  requestedTitle: '审计学',
  requestId: 'compile-1',
};

test('首稿没过闸 → 带问题清单修补一轮,修补稿过闸即采用', async () => {
  const prompts = [];
  const llm = {
    model: 'm',
    async generate(prompt) {
      prompts.push(prompt);
      if (prompts.length === 1) return JSON.stringify(sloppyDraft());
      const request = JSON.parse(prompt.user);
      assert.ok(Array.isArray(request.issues) && request.issues.length > 0);
      assert.equal(request.draft.sources, undefined);
      assert.equal(request.draft.compileMeta, undefined);
      const fixed = structuredClone(request.draft);
      fixed.misconceptions[0].remedy.microLesson.title = '补学';
      fixed.misconceptions[0].remedy.microLesson.askBack = '回问？';
      return JSON.stringify(fixed);
    },
  };
  const compiler = createTopicCompiler({ weknora: fakeWeknora(), llm });
  const result = await compiler.compile(compileInput);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0].system, /字段名、嵌套与类型必须与下面的骨架完全一致/);
  assert.match(prompts[1].system, /只修改问题清单涉及的字段/);
  assert.equal(hasBlockingIssues(result.qualityIssues), false);
  assert.equal(result.topic.misconceptions[0].remedy.microLesson.askBack, '回问？');
  assert.equal(result.topic.compileMeta.promptVersion, TOPIC_PROMPT_VERSION);
});

test('修补稿更差或解析失败 → 保留首稿交老师校订', async () => {
  let calls = 0;
  const worse = createTopicCompiler({
    weknora: fakeWeknora(),
    llm: { model: 'm', async generate() { calls += 1; return calls === 1 ? JSON.stringify(sloppyDraft()) : '{"title":"x"}'; } },
  });
  const kept = await worse.compile(compileInput);
  assert.equal(calls, 2);
  assert.deepEqual(kept.qualityIssues.map((i) => i.code), ['remedy-incomplete']);
  assert.equal(kept.topic.title, '审计风险与审计证据');

  let broken = 0;
  const failing = createTopicCompiler({
    weknora: fakeWeknora(),
    llm: { model: 'm', async generate() { broken += 1; return broken === 1 ? JSON.stringify(sloppyDraft()) : 'not json'; } },
  });
  const survived = await failing.compile(compileInput);
  assert.equal(broken, 2);
  assert.equal(survived.topic.title, '审计风险与审计证据');
});

test('首稿即过闸 → 不发修补请求', async () => {
  const draft = sloppyDraft();
  draft.misconceptions[0].remedy.microLesson = { title: '补学', body: '正文', askBack: '回问？' };
  let calls = 0;
  const compiler = createTopicCompiler({
    weknora: fakeWeknora(),
    llm: { model: 'm', async generate() { calls += 1; return JSON.stringify(draft); } },
  });
  const result = await compiler.compile(compileInput);
  assert.equal(calls, 1);
  assert.equal(hasBlockingIssues(result.qualityIssues), false);
});

test('repair():对存量草稿修补,保留 teacherEdited 与 topicId', async () => {
  const stored = normalizeTopicDraft({ ...sloppyDraft(), compileMeta: { teacherEdited: true } }, {
    topicId: 'custom-course-job', courseTitle: '审计学', sourceAssets: compileInput.assets, promptVersion: 'custom-topic-v1', model: 'old',
  });
  const issues = validateTopicDraft(stored);
  const compiler = createTopicCompiler({
    weknora: fakeWeknora(),
    llm: {
      model: 'm',
      async generate(prompt) {
        const fixed = structuredClone(JSON.parse(prompt.user).draft);
        fixed.misconceptions[0].remedy.microLesson.title = '补学';
        fixed.misconceptions[0].remedy.microLesson.askBack = '回问？';
        return JSON.stringify(fixed);
      },
    },
  });
  const result = await compiler.repair({ course: compileInput.course, assets: compileInput.assets, topic: stored, issues, requestId: 'r1' });
  assert.equal(hasBlockingIssues(result.qualityIssues), false);
  assert.equal(result.topic.topicId, 'custom-course-job');
  assert.equal(result.topic.compileMeta.teacherEdited, true);
  assert.equal(result.topic.sources[0].assetId, 'asset');
});
