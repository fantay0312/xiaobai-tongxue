import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  hasBlockingIssues,
  normalizeTopicDraft,
  studentTopicView,
  validateTopicDraft,
} from './custom-content/topic-contract.mjs';

function completeDraft() {
  const checklist = Array.from({ length: 3 }, (_, index) => ({
    id: `c${index + 1}`,
    point: `要点${index + 1}`,
    groundTruth: `课件明确说明要点${index + 1}的原理`,
    keywords: [[`要点${index + 1}`, '原理']],
    terms: [`要点${index + 1}`],
    level: ['L1', 'L2', 'L5'][index],
    lookupCard: `查书卡${index + 1}`,
    probeLine: `要点${index + 1}是什么意思？`,
    sourceChunkIds: [`chunk-${index + 1}`],
    sourceExcerpt: `要点${index + 1}的原理`,
  }));
  const quiz = (prefix, checklistRef = 'c1') => Array.from({ length: 3 }, (_, index) => ({
    id: `${prefix}-q${index + 1}`,
    question: `问题${index + 1}`,
    options: ['甲', '乙'],
    answerIndex: 0,
    explanation: '依据课件',
    checklistRef,
    mcRef: null,
  }));
  return {
    title: '自定义课题',
    tagline: '从自己的讲义开始',
    transferHint: '换一个生活例子',
    checklist,
    misconceptions: Array.from({ length: 2 }, (_, index) => ({
      mcId: `M${index + 1}`,
      belief: `错误认知${index + 1}`,
      triggerLine: `是不是错误认知${index + 1}就行了？`,
      correctionCriteria: ['明确否定', '说明原因'],
      correctionKeywords: [['不是', '原因']],
      adoptionKeywords: [['是的']],
      injectAfterChecklist: [`c${index + 1}`],
      probe: { statement: `错误判断${index + 1}`, isTrue: false, explanation: '错误原因' },
      remedy: {
        microLesson: { title: '补学', body: '补学正文', askBack: '下次怎么解释？' },
        predictionQuiz: quiz(`m${index + 1}`, `c${index + 1}`),
      },
    })),
    quizBank: quiz('main'),
    prep: {
      microLecture: { title: '微课', body: '微课正文' },
      examples: [],
      selfCheck: ['检查一', '检查二', '检查三'],
      taskCard: '把课件讲给小白听',
    },
  };
}

test('custom topic contract normalizes a complete grounded draft', () => {
  const topic = normalizeTopicDraft(completeDraft(), {
    topicId: 'custom-course-topic',
    courseTitle: '我的课程',
    sourceAssets: [{ id: 'asset-1', wkKnowledgeId: 'wk-1', filename: 'lesson.pdf', assetRole: 'lecture' }],
    promptVersion: 'v1',
    model: 'compiler-model',
  });
  const issues = validateTopicDraft(topic, {
    sourceCorpus: '课件明确说明要点1的原理。课件明确说明要点2的原理。课件明确说明要点3的原理。',
  });
  assert.equal(hasBlockingIssues(issues), false, JSON.stringify(issues));
  assert.equal(topic.course, '我的课程');
  assert.equal(topic.misconceptions.every((item) => item.topicId === topic.topicId), true);
});

test('student custom topic view strips assessment-only and source fields', () => {
  const topic = normalizeTopicDraft(completeDraft(), {
    topicId: 'custom-course-topic', courseTitle: '我的课程', sourceAssets: [],
  });
  const view = studentTopicView(topic);
  const serialized = JSON.stringify(view);
  assert.equal(Object.hasOwn(view.checklist[0], 'groundTruth'), false);
  assert.equal(Object.hasOwn(view.checklist[0], 'sourceExcerpt'), false);
  assert.equal(Object.hasOwn(view.misconceptions[0], 'correctionCriteria'), false);
  assert.equal(Object.hasOwn(view.misconceptions[0].probe, 'explanation'), false);
  assert.equal(Object.hasOwn(view, 'sources'), false);
  assert.doesNotMatch(serialized, /课件明确说明|错误原因/);
});

test('quality gate blocks ungrounded and incomplete drafts', () => {
  const raw = completeDraft();
  raw.checklist[0].sourceChunkIds = [];
  raw.misconceptions = raw.misconceptions.slice(0, 1);
  const topic = normalizeTopicDraft(raw, { topicId: 'custom-x', courseTitle: '我的课程' });
  const issues = validateTopicDraft(topic, { sourceCorpus: '无关正文' });
  assert.equal(hasBlockingIssues(issues), true);
  assert.ok(issues.some((item) => item.code === 'source-missing'));
  assert.ok(issues.some((item) => item.code === 'misconception-count'));
});

test('quality gate preserves and reports invalid quiz references and answers', () => {
  const raw = completeDraft();
  raw.quizBank[0].answerIndex = 99;
  raw.quizBank[1].checklistRef = 'missing-checklist';
  raw.quizBank[2].mcRef = 'missing-misconception';
  raw.misconceptions[0].remedy.predictionQuiz.push({
    ...raw.misconceptions[0].remedy.predictionQuiz[0],
    id: 'extra-remedy-question',
  });
  const topic = normalizeTopicDraft(raw, { topicId: 'custom-invalid-quiz', courseTitle: '我的课程' });
  assert.equal(topic.quizBank[0].answerIndex, 99);
  assert.equal(topic.quizBank[1].checklistRef, 'missing-checklist');
  const issues = validateTopicDraft(topic, { sourceCorpus: '要点1 要点2 要点3' });
  assert.ok(issues.some((item) => item.code === 'quiz-answer'));
  assert.ok(issues.some((item) => item.code === 'quiz-checklist-ref'));
  assert.ok(issues.some((item) => item.code === 'quiz-misconception-ref'));
  assert.ok(issues.some((item) => item.code === 'quiz-count' && item.path.includes('predictionQuiz')));
});

test('custom content migration anchors COS ownership and active compile uniqueness', async () => {
  const sql = await readFile(new URL('./storage/postgres/migrations/004_custom_course_content.sql', import.meta.url), 'utf8');
  const openJobSql = await readFile(new URL('./storage/postgres/migrations/005_custom_compile_open_job.sql', import.meta.url), 'utf8');
  assert.match(sql, /owner_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /cos_key TEXT NOT NULL UNIQUE/);
  assert.match(openJobSql, /custom_compile_jobs_one_active_per_course_idx/);
  assert.match(openJobSql, /WHERE status IN \('queued', 'running', 'needs_review'\)/);
});
