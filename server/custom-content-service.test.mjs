import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as waitTurn } from 'node:timers/promises';
import { createCustomContentService } from './custom-content/service.mjs';
import { normalizeTopicDraft } from './custom-content/topic-contract.mjs';

const IDS = Array.from({ length: 30 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);

function repositoryFixture() {
  let sequence = 0;
  const courses = new Map();
  const assets = new Map();
  const topics = new Map();
  const jobs = new Map();
  const nextId = () => IDS[sequence++];
  return {
    courses: {
      async create(input) {
        const row = { id: nextId(), ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        courses.set(row.id, row);
        return row;
      },
      async listByOwner(ownerId) {
        return [...courses.values()].filter((course) => course.ownerId === ownerId).map((course) => ({
          ...course,
          assetCount: [...assets.values()].filter((asset) => asset.courseId === course.id).length,
          topicCount: [...topics.values()].filter((topic) => topic.courseId === course.id && topic.status === 'ready').length,
        }));
      },
      async findOwned(ownerId, id) { return [...courses.values()].find((course) => course.id === id && course.ownerId === ownerId) ?? null; },
      async findById(id) { return courses.get(id) ?? null; },
    },
    assets: {
      async create(input) {
        const row = { id: nextId(), ...input, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        assets.set(row.id, row);
        return row;
      },
      async listOwned(ownerId, courseId) {
        const course = courses.get(courseId);
        return course?.ownerId === ownerId ? [...assets.values()].filter((asset) => asset.courseId === courseId) : [];
      },
      async findOwned(ownerId, id) {
        const asset = assets.get(id);
        return asset && courses.get(asset.courseId)?.ownerId === ownerId ? asset : null;
      },
      async findManyOwned(ownerId, courseId, ids) {
        return this.listOwned(ownerId, courseId).then((rows) => rows.filter((asset) => ids.includes(asset.id)));
      },
      async findManyByCourse(courseId, ids) { return [...assets.values()].filter((asset) => asset.courseId === courseId && ids.includes(asset.id)); },
      async updateStatus(id, patch) {
        const row = { ...assets.get(id), ...patch, updatedAt: new Date().toISOString() };
        assets.set(id, row);
        return row;
      },
      async remove(id) { return assets.delete(id); },
      async claimDelete(ownerId, id) {
        const asset = await this.findOwned(ownerId, id);
        if (!asset || await this.isReferenced(id)) return null;
        const row = { ...asset, parseStatus: 'deleting', enableStatus: 'disabled', errorMessage: null };
        assets.set(id, row);
        return row;
      },
      async isReferenced(id) {
        return [...jobs.values()].some((job) => (
          (job.status === 'queued' || job.status === 'running' || job.status === 'needs_review')
          && job.assetIds.includes(id)
        )) || [...topics.values()].some((topic) => (
          (topic.status === 'draft' || topic.status === 'ready')
          && (topic.payload?.sources ?? []).some((source) => source.assetId === id)
        ));
      },
    },
    topics: {
      async findOwned(ownerId, id) {
        const topic = topics.get(id);
        return topic && courses.get(topic.courseId)?.ownerId === ownerId ? topic : null;
      },
      async findReadyOwnedByTopicId(ownerId, topicId) {
        return [...topics.values()].find((topic) => (
          topic.topicId === topicId && topic.status === 'ready' && courses.get(topic.courseId)?.ownerId === ownerId
        )) ?? null;
      },
      async listReadyByOwner(ownerId) {
        return [...topics.values()].filter((topic) => topic.status === 'ready' && courses.get(topic.courseId)?.ownerId === ownerId);
      },
      async listReadyByCourse(courseId) { return [...topics.values()].filter((topic) => topic.courseId === courseId && topic.status === 'ready'); },
      async updateDraft(id, payload, qualityIssues) {
        const row = { ...topics.get(id), payload, qualityIssues, updatedAt: new Date().toISOString() };
        topics.set(id, row);
        return row;
      },
      async discardDraft(ownerId, id) {
        const topic = topics.get(id);
        if (!topic || topic.status !== 'draft' || courses.get(topic.courseId)?.ownerId !== ownerId) return null;
        const archived = { ...topic, status: 'archived', updatedAt: new Date().toISOString() };
        topics.set(id, archived);
        const job = [...jobs.values()].find((candidate) => candidate.topicId === id && candidate.status === 'needs_review');
        if (job) jobs.set(job.id, { ...job, status: 'failed', errorCode: 'teacher-discarded' });
        return archived;
      },
      async publish(id) {
        const row = { ...topics.get(id), status: 'ready', publishedAt: new Date().toISOString() };
        topics.set(id, row);
        const job = [...jobs.values()].find((candidate) => candidate.topicId === id && candidate.status === 'needs_review');
        if (job) jobs.set(job.id, { ...job, status: 'done', errorCode: null });
        return row;
      },
    },
    jobs: {
      async create(input) {
        const ready = input.assetIds.every((id) => assets.get(id)?.courseId === input.courseId && assets.get(id)?.parseStatus === 'completed');
        if (!ready) return null;
        const row = { id: nextId(), ...input, topicId: null, status: 'queued', errorCode: null, createdAt: new Date().toISOString() };
        jobs.set(row.id, row);
        return row;
      },
      async createDraftAndAttach(input) {
        let topic = [...topics.values()].find((candidate) => candidate.topicId === input.topicId);
        if (!topic) {
          topic = {
            id: nextId(),
            topicId: input.topicId,
            courseId: input.courseId,
            payload: input.payload,
            qualityIssues: input.qualityIssues,
            promptVersion: input.promptVersion,
            status: 'draft',
            publishedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          topics.set(topic.id, topic);
        }
        const job = jobs.get(input.jobId);
        if (!job || (job.status !== 'queued' && job.status !== 'running')) return null;
        const attached = { ...job, status: 'needs_review', topicId: topic.id, errorCode: null };
        jobs.set(job.id, attached);
        return { topic, job: attached };
      },
      async findOwned(ownerId, id) {
        const job = jobs.get(id);
        return job && courses.get(job.courseId)?.ownerId === ownerId ? job : null;
      },
      async findById(id) { return jobs.get(id) ?? null; },
      async listResumable() { return [...jobs.values()].filter((job) => job.status === 'queued' || job.status === 'running'); },
      async findOpenByCourse(courseId) {
        return [...jobs.values()].find((job) => (
          job.courseId === courseId
          && (job.status === 'queued' || job.status === 'running' || job.status === 'needs_review')
        )) ?? null;
      },
      async transitionActive(id, patch) {
        const current = jobs.get(id);
        if (!current || (current.status !== 'queued' && current.status !== 'running')) return null;
        const row = { ...jobs.get(id), ...patch };
        jobs.set(id, row);
        return row;
      },
      async markDoneForTopic(topicId) {
        const job = [...jobs.values()].find((candidate) => candidate.topicId === topicId);
        if (!job) return null;
        const row = { ...job, status: 'done', errorCode: null };
        jobs.set(job.id, row);
        return row;
      },
    },
  };
}

function rawDraft() {
  const quizzes = (prefix, checklistRef) => Array.from({ length: 3 }, (_, index) => ({
    id: `${prefix}-${index}`,
    question: `要点${index + 1}如何判断？`,
    options: ['正确', '错误'],
    answerIndex: 0,
    explanation: '来自课件',
    checklistRef,
    mcRef: null,
  }));
  return {
    title: '栈与函数调用',
    tagline: '调用一次，压入一帧',
    transferHint: '递归调用',
    checklist: Array.from({ length: 3 }, (_, index) => ({
      id: `c${index + 1}`,
      point: `要点${index + 1}`,
      groundTruth: `课件中的要点${index + 1}原理`,
      keywords: [[`要点${index + 1}`, '原理']],
      terms: [`要点${index + 1}`],
      level: ['L1', 'L2', 'L5'][index],
      lookupCard: `查书卡${index + 1}`,
      probeLine: `要点${index + 1}是什么意思？`,
      sourceChunkIds: ['chunk-1'],
      sourceExcerpt: '课件中的要点原理',
    })),
    misconceptions: Array.from({ length: 2 }, (_, index) => ({
      mcId: `M${index + 1}`,
      belief: `误区${index + 1}`,
      triggerLine: `是不是误区${index + 1}才对？`,
      correctionCriteria: ['明确否定', '说明原因'],
      correctionKeywords: [['不是', '原因']],
      adoptionKeywords: [['是的']],
      injectAfterChecklist: [`c${index + 1}`],
      probe: { statement: `判断${index + 1}`, isTrue: false, explanation: '错误原因' },
      remedy: {
        microLesson: { title: '补学', body: '补学正文', askBack: '怎么解释？' },
        predictionQuiz: quizzes(`m${index + 1}`, `c${index + 1}`),
      },
    })),
    quizBank: quizzes('main', 'c1'),
    prep: {
      microLecture: { title: '微课', body: '课件中的微课正文' },
      examples: [],
      selfCheck: ['一', '二', '三'],
      taskCard: '讲给小白听',
    },
  };
}

function cosFixture() {
  const objects = new Map();
  return {
    objects,
    async uploadCustomCourseAsset({ userId, courseId, body }) {
      const key = `xiaobai/users/${userId}/custom-course-assets/${courseId}/fixture`;
      objects.set(key, Buffer.from(body));
      return { key, byteSize: body.length, etag: 'etag' };
    },
    async verifySize({ key }) {
      const body = objects.get(key);
      if (!body) throw new Error('not-found');
      return { byteSize: body.length, etag: 'etag' };
    },
    async delete({ key }) { objects.delete(key); return true; },
  };
}

test('custom content service runs create, upload, compile, review, publish and student-view flow', async () => {
  const repository = repositoryFixture();
  const calls = { faq: null, deleted: [], evaluation: null };
  let kb = 0;
  let knowledge = 0;
  const weknora = {
    async healthCheck() { return true; },
    async createKnowledgeBase() { return { id: `wk-kb-${++kb}` }; },
    async deleteKnowledgeBase(id) { calls.deleted.push(id); },
    async uploadFile() { return { id: `wk-knowledge-${++knowledge}`, parse_status: 'completed', enable_status: 'enabled' }; },
    async getKnowledge(id) { return { id, parse_status: 'completed', enable_status: 'enabled' }; },
    async reparseKnowledge() {},
    async deleteKnowledge(id) { calls.deleted.push(id); },
    async listChunks() {
      return [{ id: 'chunk-1', content: '课件中的要点1原理、要点2原理、要点3原理，以及递归调用。' }];
    },
    async search() { return [{ id: 'chunk-1', content: '课件中的要点原理' }]; },
    async upsertFaqEntries(_id, entries) { calls.faq = entries; return { task_id: 'faq-test' }; },
    async waitForFaqImport(taskId) { assert.equal(taskId, 'faq-test'); return { status: 'completed' }; },
    isTerminalParseStatus(status) { return status === 'completed' || status === 'failed' || status === 'cancelled'; },
  };
  const compiler = {
    async compile({ course, assets, topicId }) {
      const topic = normalizeTopicDraft(rawDraft(), {
        topicId,
        courseTitle: course.title,
        sourceAssets: assets,
        promptVersion: 'custom-topic-v1',
        model: 'test-model',
      });
      return { topic, qualityIssues: [], chunkCount: 1 };
    },
    async evaluateSemantic(input) {
      calls.evaluation = input;
      return {
        checklistHits: [{ id: 'c1', quote: '要点1原理' }],
        mcJudgement: null,
        accuracyFlags: [],
        stuckSignal: false,
        offTopic: false,
        answeredTangent: false,
        goldenAnalogy: null,
        reasoning: '符合完整评估依据',
        forbiddenExtra: input.topic.checklist[0].groundTruth,
      };
    },
  };
  const cos = cosFixture();
  const ids = IDS.slice(20);
  const service = createCustomContentService({
    repository, weknora, cos, compiler, embeddingModelId: 'embed-1', summaryModelId: 'chat-1',
    uuid: () => ids.shift(), logger: { error() {} },
  });
  const alice = { id: IDS[19], name: 'Alice' };
  const bob = { id: IDS[18], name: 'Bob' };

  const course = await service.createCourse(alice, '数据结构', 'trace-course');
  assert.equal(course.title, '数据结构');
  await assert.rejects(service.getCourse(bob, course.id), /course-not-found/);

  const asset = await service.uploadAsset(alice, course.id, {
    bytes: Buffer.from('%PDF-1.7\nlesson\n%%EOF'), filename: 'lesson.pdf', assetRole: 'lecture', requestId: 'trace-upload',
  });
  assert.equal(asset.parseStatus, 'completed');
  assert.equal(Object.hasOwn(asset, 'cosKey'), false, '浏览器资产响应不得暴露 COS key');
  assert.equal(cos.objects.size, 1, '用户原文件应先落 COS');

  const queued = await service.startCompile(alice, { courseId: course.id, assetIds: [asset.id], title: '栈与函数调用' });
  await assert.rejects(
    service.deleteAsset(alice, asset.id, 'trace-delete-running'),
    /asset-in-use/,
    '开放编译任务引用的资料不得从 WeKnora、COS 或数据库删除',
  );
  assert.equal(cos.objects.size, 1);
  let job = queued;
  for (let attempt = 0; attempt < 20 && job.status !== 'needs_review'; attempt += 1) {
    await waitTurn();
    job = await service.getCompileJob(alice, queued.id);
  }
  assert.equal(job.status, 'needs_review');
  assert.ok(job.topic);

  const restored = await service.getCourseCompileJob(alice, course.id);
  assert.equal(restored.id, queued.id, '刷新页面后应能按课程找回待校订任务');
  assert.equal(restored.topic.id, job.topic.id);
  await assert.rejects(
    service.startCompile(alice, { courseId: course.id, assetIds: [asset.id] }),
    /compile-job-active/,
    '待校订草稿未发布前不得创建第二个孤儿草稿',
  );

  const saved = await service.updateDraft(alice, job.topic.id, job.topic.payload, 'trace-save');
  assert.deepEqual(saved.qualityIssues, []);
  const published = await service.publishTopic(alice, saved.id, 'trace-publish');
  assert.equal(published.status, 'ready');
  assert.equal(calls.faq.length, 2);

  const evaluation = await service.evaluateTopic(alice, published.topicId, {
    utterance: '我来讲要点1原理',
    lastXiaobaiText: null,
    hitChecklist: [],
    pendingMcId: null,
  }, 'trace-evaluate');
  assert.equal(calls.evaluation.topic.checklist[0].groundTruth, '课件中的要点1原理');
  assert.deepEqual(evaluation.checklistHits, [{ id: 'c1', quote: '要点1原理' }]);
  assert.equal(Object.hasOwn(evaluation, 'forbiddenExtra'), false, '评估响应不得回传完整 rubric 或上游额外字段');
  await assert.rejects(
    service.evaluateTopic(bob, published.topicId, { utterance: '越权评估' }),
    /topic-not-found/,
  );

  const student = await service.listPublishedTopics(alice);
  assert.equal(student.length, 1);
  assert.equal(Object.hasOwn(student[0].checklist[0], 'groundTruth'), false);
  assert.equal(Object.hasOwn(student[0].misconceptions[0], 'correctionCriteria'), false);
  assert.equal(Object.hasOwn(student[0], 'sources'), false);
  await assert.rejects(service.deleteAsset(alice, asset.id, 'trace-delete'), /asset-in-use/);
  assert.equal(cos.objects.size, 1, '被课题引用的 COS 原件不能删除');
  assert.equal(await service.getCourseCompileJob(alice, course.id), null, '发布后课程不再保留开放编译任务');

  const disposableCourse = await service.createCourse(alice, '可放弃草稿');
  const disposableAsset = await service.uploadAsset(alice, disposableCourse.id, {
    bytes: Buffer.from('%PDF-1.7\ndisposable\n%%EOF'), filename: 'disposable.pdf', assetRole: 'lecture', requestId: 'discard-upload',
  });
  const disposableQueued = await service.startCompile(alice, {
    courseId: disposableCourse.id, assetIds: [disposableAsset.id], title: '不要的草稿',
  });
  let disposableJob = disposableQueued;
  for (let attempt = 0; attempt < 20 && disposableJob.status !== 'needs_review'; attempt += 1) {
    await waitTurn();
    disposableJob = await service.getCompileJob(alice, disposableQueued.id);
  }
  assert.equal(disposableJob.status, 'needs_review');
  await service.discardDraft(alice, disposableJob.topic.id);
  assert.equal(await service.getCourseCompileJob(alice, disposableCourse.id), null);
  await service.deleteAsset(alice, disposableAsset.id, 'discard-delete');
  assert.equal(cos.objects.size, 1, '放弃草稿后应解除资料引用并允许删除其 COS 原件');
});

test('teacher-added checklist item is grounded against owned course chunks on save', async () => {
  const repository = repositoryFixture();
  let kb = 0;
  let knowledge = 0;
  const weknora = {
    async healthCheck() { return true; },
    async createKnowledgeBase() { return { id: `wk-kb-${++kb}` }; },
    async deleteKnowledgeBase() {},
    async uploadFile() { return { id: `wk-knowledge-${++knowledge}`, parse_status: 'completed', enable_status: 'enabled' }; },
    async getKnowledge(id) { return { id, parse_status: 'completed', enable_status: 'enabled' }; },
    async listChunks() {
      return [
        { id: 'chunk-1', content: '课件中的要点1原理、要点2原理、要点3原理。' },
        { id: 'chunk-2', content: '课件说明递归终止条件决定调用何时返回。' },
      ];
    },
    async search() { return []; },
    async upsertFaqEntries() { return { task_id: 'faq-test' }; },
    async waitForFaqImport() {},
    isTerminalParseStatus(status) { return status === 'completed'; },
  };
  const compiler = {
    async compile({ course, assets, topicId }) {
      return {
        topic: normalizeTopicDraft(rawDraft(), {
          topicId, courseTitle: course.title, sourceAssets: assets, promptVersion: 'custom-topic-v1', model: 'test-model',
        }),
        qualityIssues: [],
      };
    },
  };
  const ids = IDS.slice(20);
  const service = createCustomContentService({
    repository, weknora, cos: cosFixture(), compiler, embeddingModelId: 'embed-1',
    uuid: () => ids.shift(), logger: { error() {} },
  });
  const owner = { id: IDS[19], name: 'Alice' };
  const course = await service.createCourse(owner, '递归课程');
  const asset = await service.uploadAsset(owner, course.id, {
    bytes: Buffer.from('%PDF-1.7\nlesson\n%%EOF'), filename: 'lesson.pdf', assetRole: 'lecture', requestId: 'upload',
  });
  const queued = await service.startCompile(owner, { courseId: course.id, assetIds: [asset.id] });
  let job = queued;
  for (let attempt = 0; attempt < 20 && job.status !== 'needs_review'; attempt += 1) {
    await waitTurn();
    job = await service.getCompileJob(owner, queued.id);
  }
  const candidates = await service.findSourceCandidates(owner, job.topic.id, {
    point: '递归终止条件', groundTruth: '递归终止条件决定调用何时返回',
  }, 'source-candidates');
  assert.deepEqual(candidates.map((candidate) => candidate.chunkId), ['chunk-2']);
  assert.equal(Object.hasOwn(candidates[0], 'wkKnowledgeId'), false);
  await assert.rejects(
    service.findSourceCandidates({ id: IDS[18] }, job.topic.id, {
      point: '递归终止条件', groundTruth: '递归终止条件决定调用何时返回',
    }),
    /topic-not-found/,
  );
  const candidate = structuredClone(job.topic.payload);
  candidate.checklist.push({
    id: 'c4', point: '递归终止条件', groundTruth: '递归终止条件决定调用何时返回',
    keywords: [['递归', '终止']], terms: ['递归'], level: 'L3',
    lookupCard: '检查递归出口', probeLine: '没有终止条件会怎样？', sourceChunkIds: [], sourceExcerpt: '',
  });
  const saved = await service.updateDraft(owner, job.topic.id, candidate, 'save-added');
  assert.deepEqual(saved.payload.checklist[3].sourceChunkIds, ['chunk-2']);
  assert.match(saved.payload.checklist[3].sourceExcerpt, /递归终止条件/);
  assert.equal(saved.qualityIssues.some((issue) => issue.path.startsWith('checklist.3') && issue.code === 'source-missing'), false);
});

test('custom content service rejects disguised and oversized files before WeKnora', async () => {
  const repository = repositoryFixture();
  let uploadCalls = 0;
  const weknora = {
    async healthCheck() { return true; },
    async createKnowledgeBase() { return { id: `wk-${Math.random()}` }; },
    async deleteKnowledgeBase() {},
    async uploadFile() { uploadCalls += 1; },
    isTerminalParseStatus() { return true; },
  };
  const service = createCustomContentService({
    repository,
    weknora,
    cos: cosFixture(),
    compiler: { async compile() {} },
    embeddingModelId: 'embed-1',
    maxFileBytes: 16,
    uuid: () => IDS[25],
  });
  const owner = { id: IDS[24], name: 'Owner' };
  const course = await service.createCourse(owner, '测试课程');
  await assert.rejects(
    service.uploadAsset(owner, course.id, { bytes: Buffer.from('not a pdf'), filename: 'bad.pdf', assetRole: 'lecture' }),
    /file-content-mismatch/,
  );
  await assert.rejects(
    service.uploadAsset(owner, course.id, { bytes: Buffer.alloc(17), filename: 'too-big.txt', assetRole: 'lecture' }),
    /file-too-large/,
  );
  assert.equal(uploadCalls, 0);
});

test('failed WeKnora ingestion compensates the already written COS original', async () => {
  const repository = repositoryFixture();
  const cos = cosFixture();
  const weknora = {
    async healthCheck() { return true; },
    async createKnowledgeBase() { return { id: `wk-${Math.random()}` }; },
    async deleteKnowledgeBase() {},
    async uploadFile() { throw new Error('weknora-upstream-failed'); },
    isTerminalParseStatus() { return true; },
  };
  const service = createCustomContentService({
    repository,
    weknora,
    cos,
    compiler: { async compile() {} },
    embeddingModelId: 'embed-1',
    uuid: () => IDS[27],
    logger: { error() {} },
  });
  const owner = { id: IDS[26], name: 'Owner' };
  const course = await service.createCourse(owner, '补偿测试');
  await assert.rejects(
    service.uploadAsset(owner, course.id, {
      bytes: Buffer.from('%PDF-1.7\nlesson\n%%EOF'),
      filename: 'lesson.pdf',
      assetRole: 'lecture',
    }),
    /asset-upload-upstream-failed/,
  );
  assert.equal(cos.objects.size, 0, 'WeKnora 失败后不得遗留 COS 原件');
  assert.equal((await repository.assets.listOwned(owner.id, course.id)).length, 0);
});
