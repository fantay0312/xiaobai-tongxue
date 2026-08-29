import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  hasBlockingIssues,
  normalizeTopicDraft,
  studentTopicView,
  validateTopicDraft,
} from './custom-content/topic-contract.mjs';
import { createTopicCompiler } from './custom-content/topic-compiler.mjs';

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

test('blank quiz options remain positional and cannot silently retarget the answer', () => {
  const raw = completeDraft();
  raw.quizBank[0].options = ['甲', '', '丙'];
  raw.quizBank[0].answerIndex = 2;
  const topic = normalizeTopicDraft(raw, { topicId: 'custom-blank-option', courseTitle: '我的课程' });
  assert.deepEqual(topic.quizBank[0].options, ['甲', '', '丙']);
  assert.equal(topic.quizBank[0].answerIndex, 2);
  const issues = validateTopicDraft(topic, { sourceCorpus: '要点1 要点2 要点3' });
  assert.ok(issues.some((item) => item.code === 'quiz-shape' && item.path === 'quizBank.0'));
});

test('long topic-prefixed quiz ids preserve their distinguishing suffixes', () => {
  const raw = completeDraft();
  const prefix = `custom-${'a'.repeat(80)}`;
  raw.quizBank.forEach((item, index) => { item.id = `${prefix}-main-q${index + 1}`; });
  const topic = normalizeTopicDraft(raw, { topicId: prefix, courseTitle: '我的课程' });
  assert.equal(new Set(topic.quizBank.map((item) => item.id)).size, 3);
  assert.deepEqual(topic.quizBank.map((item) => item.id.slice(-2)), ['q1', 'q2', 'q3']);
});

test('custom semantic evaluation keeps the full rubric inside the server compiler', async () => {
  const topic = normalizeTopicDraft(completeDraft(), {
    topicId: 'custom-server-eval', courseTitle: '我的课程', sourceAssets: [],
  });
  let captured = null;
  const compiler = createTopicCompiler({
    weknora: { async listChunks() { return []; }, async search() { return []; } },
    llm: {
      model: 'test-model',
      async generate(prompt) {
        captured = prompt;
        return JSON.stringify({ checklistHits: [], accuracyFlags: [], reasoning: '严格判定' });
      },
    },
  });
  const result = await compiler.evaluateSemantic({
    topic,
    utterance: '老师本轮讲解',
    lastXiaobaiText: '小白上一句',
    hitChecklist: [],
    pendingMcId: topic.misconceptions[0].mcId,
    requestId: 'eval-test',
  });
  assert.equal(result.reasoning, '严格判定');
  assert.match(captured.user, /课件明确说明要点1的原理/);
  assert.match(captured.user, /明确否定/);
  assert.match(captured.system, /不可信原文/);
});

test('topic compiler retrieves a requested title before applying the source budget', async () => {
  const chunks = Array.from({ length: 240 }, (_, index) => ({
    id: `long-${index}`,
    content: index === 239
      ? '深处主题：课件明确说明要点1的原理、要点2的原理、要点3的原理。'
      : `背景段落${index}：${'普通材料'.repeat(100)}`,
  }));
  let captured = null;
  const compiler = createTopicCompiler({
    weknora: {
      async listChunks() { return chunks; },
      async search() { return [chunks.at(-1)]; },
    },
    llm: {
      model: 'test-model',
      async generate(prompt) {
        captured = prompt;
        return JSON.stringify(completeDraft());
      },
    },
  });
  await compiler.compile({
    course: { id: 'course', title: '长讲义', wkDocKbId: 'kb-long' },
    assets: [{ id: 'asset', wkKnowledgeId: 'knowledge-long', filename: 'long.pdf', assetRole: 'lecture' }],
    topicId: 'custom-long-topic',
    requestedTitle: '深处主题',
    requestId: 'compile-long',
  });
  const request = JSON.parse(captured.user);
  assert.match(request.source, /深处主题/);
  assert.ok(request.source.length <= 72_000);
});

test('custom content migration anchors COS ownership and active compile uniqueness', async () => {
  const sql = await readFile(new URL('./storage/postgres/migrations/004_custom_course_content.sql', import.meta.url), 'utf8');
  const openJobSql = await readFile(new URL('./storage/postgres/migrations/005_custom_compile_open_job.sql', import.meta.url), 'utf8');
  const leaseSql = await readFile(new URL('./storage/postgres/migrations/006_custom_compile_leases.sql', import.meta.url), 'utf8');
  const uploadIntentSql = await readFile(new URL('./storage/postgres/migrations/007_custom_upload_cleanup_intents.sql', import.meta.url), 'utf8');
  const courseIntentSql = await readFile(new URL('./storage/postgres/migrations/008_custom_course_create_intents.sql', import.meta.url), 'utf8');
  const reparseClaimSql = await readFile(new URL('./storage/postgres/migrations/009_custom_asset_reparse_claims.sql', import.meta.url), 'utf8');
  assert.match(sql, /owner_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /cos_key TEXT NOT NULL UNIQUE/);
  assert.match(openJobSql, /custom_compile_jobs_one_active_per_course_idx/);
  assert.match(openJobSql, /WHERE status IN \('queued', 'running', 'needs_review'\)/);
  assert.match(leaseSql, /lease_token UUID/);
  assert.match(leaseSql, /lease_expires_at TIMESTAMPTZ/);
  assert.match(uploadIntentSql, /custom_asset_upload_intents/);
  assert.match(uploadIntentSql, /cos_key TEXT NOT NULL UNIQUE/);
  assert.match(courseIntentSql, /custom_course_create_intents/);
  assert.match(courseIntentSql, /wk_doc_kb_id UUID NOT NULL UNIQUE/);
  assert.match(reparseClaimSql, /reparse_token UUID/);
  assert.match(reparseClaimSql, /status_revision BIGINT NOT NULL DEFAULT 0/);
  assert.match(reparseClaimSql, /custom_assets_reparse_claim_pair/);
});

test('custom maintenance starts after listen and shares the COS upload ceiling', async () => {
  const indexSource = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  const serviceSource = await readFile(new URL('./custom-content/service.mjs', import.meta.url), 'utf8');
  const routerSource = await readFile(new URL('./custom-content/router.mjs', import.meta.url), 'utf8');
  const weknoraSource = await readFile(new URL('./custom-content/weknora-client.mjs', import.meta.url), 'utf8');
  const fileValidatorSource = await readFile(new URL('./custom-content/file-validator.mjs', import.meta.url), 'utf8');
  const repositorySource = await readFile(new URL('./storage/postgres/custom-content.mjs', import.meta.url), 'utf8');
  const redisSource = await readFile(new URL('./storage/redis-otp-store.mjs', import.meta.url), 'utf8');
  const cosSource = await readFile(new URL('./storage/cos-store.mjs', import.meta.url), 'utf8');
  const configuredBlock = indexSource.slice(
    indexSource.indexOf('if (WK_CONFIGURED)'),
    indexSource.indexOf('async function runCustomContentMaintenance'),
  );
  const listenBlock = indexSource.slice(indexSource.indexOf("server.listen(PORT"));
  assert.doesNotMatch(configuredBlock, /await customContentService\.(?:reconcile|resumePendingJobs)/);
  assert.match(indexSource, /Promise\.allSettled\(\[\s*customContentService\.reconcileUploadIntents\(\)/);
  assert.match(indexSource, /customContentService\.reconcileDeletingAssets\(\)/);
  assert.match(indexSource, /customMaintenanceRunning/);
  assert.match(listenBlock, /void runCustomContentMaintenance\(\)/);
  assert.match(serviceSource, /reconcileClaimedIntents\(intents, reconcileUploadIntent\)/);
  assert.match(serviceSource, /concurrency = 4/);
  assert.match(cosSource, /maxObjectBytes = 80 \* 1024 \* 1024/);
  assert.match(indexSource, /productionStorage\?\.cos\?\.maxObjectBytes < maxFileBytes/);
  assert.match(indexSource, /protectedUser\(req, res, 'all'\)/);
  assert.doesNotMatch(indexSource, /protectedUser\(req, res, operation\)/);
  assert.match(routerSource, /custom-content-auth-unavailable/);
  assert.match(routerSource, /idleTimeoutMs: UPLOAD_IDLE_TIMEOUT_MS/);
  assert.match(routerSource, /MIN_UPLOAD_BYTES_PER_SECOND/);
  assert.match(routerSource, /bytes: filePart\.bytes/);
  assert.doesNotMatch(routerSource, /\.formData\(\)|\.arrayBuffer\(\)/);
  assert.match(weknoraSource, /Readable\.from\(parts\)/);
  assert.doesNotMatch(weknoraSource, /new Blob\(|new FormData\(/);
  assert.match(routerSource, /json-object-required/);
  assert.match(indexSource, /const refreshIdleTimer = \(\) =>/);
  assert.match(serviceSource, /healthy: await weknora\.healthCheck\(\), maxFileBytes/);
  assert.match(serviceSource, /inflateRawSync\(compressed/);
  assert.match(serviceSource, /zipCrc32\(expanded\)/);
  assert.match(serviceSource, /ooxmlXmlInfo\(expanded\)/);
  assert.match(serviceSource, /officeRelationships\.length !== 1/);
  assert.match(serviceSource, /if \(overrideMatches\.length > 0\)/);
  assert.match(serviceSource, /names\.has\(canonicalName\)/);
  assert.match(serviceSource, /asciiFold\(packagePartName\(mapping\.partName\)\)/);
  assert.match(fileValidatorSource, /new Worker\(WORKER_URL/);
  assert.match(serviceSource, /await validateUploadedFile\(\{/);
  assert.match(repositorySource, /WHERE id = \$1 AND parse_status = 'deleting'/);
  assert.match(repositorySource, /claimStaleDeletingAssets/);
  assert.match(repositorySource, /async claimReparse\(ownerId, id\)/);
  assert.match(repositorySource, /!\['completed', 'failed', 'cancelled'\]\.includes/);
  assert.match(serviceSource, /asset-delete-finalize-failed/);
  assert.match(serviceSource, /repository\.assets\.claimReparse\(owner\.id, asset\.id\)/);
  assert.match(repositorySource, /status_revision = \$5/);
  assert.match(redisSource, /RATE_LIMIT_MANY_SCRIPT/);
  assert.match(redisSource, /redis\.call\('MSET', unpack\(updates\)\)/);
  assert.match(redisSource, /redis\.call\('PTTL', KEYS\[i\]\)/);
  assert.match(redisSource, /redis\.call\('PEXPIRE', KEYS\[i\], expiry\)/);
  assert.match(redisSource, /duplicate-rate-limit-reservation/);
  assert.match(routerSource, /rateLimitMany\?\.\(checks\)/);
  assert.match(indexSource, /redisOtp\.rateLimitMany\(inputs\)/);
});
