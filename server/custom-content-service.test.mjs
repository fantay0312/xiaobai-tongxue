import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as waitTurn } from 'node:timers/promises';
import { createCustomContentService } from './custom-content/service.mjs';
import { normalizeTopicDraft } from './custom-content/topic-contract.mjs';

const IDS = Array.from({ length: 30 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);

function repositoryFixture() {
  let sequence = 0;
  const courses = new Map();
  const courseIntents = new Map();
  const assets = new Map();
  const uploadIntents = new Map();
  const topics = new Map();
  const jobs = new Map();
  const nextId = () => IDS[sequence++];
  return {
    courses: {
      async createCreationIntent(input) {
        const row = { id: nextId(), ...input, cleanupStartedAt: null, createdAt: new Date().toISOString() };
        courseIntents.set(row.id, row);
        return row;
      },
      async finalizeCreationIntent(ownerId, intentId) {
        const intent = courseIntents.get(intentId);
        if (!intent || intent.ownerId !== ownerId || intent.cleanupStartedAt) return null;
        const row = {
          id: nextId(), ownerId, title: intent.title,
          wkDocKbId: intent.wkDocKbId, wkFaqKbId: intent.wkFaqKbId,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        courses.set(row.id, row);
        courseIntents.delete(intentId);
        return row;
      },
      async removeCreationIntent(ownerId, intentId) {
        const intent = courseIntents.get(intentId);
        if (!intent || intent.ownerId !== ownerId) return false;
        return courseIntents.delete(intentId);
      },
      async claimStaleCreationIntents() { return []; },
      async listByOwner(ownerId) {
        return [...courses.values()].filter((course) => course.ownerId === ownerId).map((course) => ({
          ...course,
          assetCount: [...assets.values()].filter((asset) => asset.courseId === course.id).length,
          topicCount: [...topics.values()].filter((topic) => topic.courseId === course.id && topic.status === 'ready').length,
        }));
      },
      async findOwned(ownerId, id) { return [...courses.values()].find((course) => course.id === id && course.ownerId === ownerId) ?? null; },
      async findById(id) { return courses.get(id) ?? null; },
      async findOwnedByKnowledgeBaseIds(ownerId, wkDocKbId, wkFaqKbId) {
        return [...courses.values()].find((course) => (
          course.ownerId === ownerId && course.wkDocKbId === wkDocKbId && course.wkFaqKbId === wkFaqKbId
        )) ?? null;
      },
    },
    assets: {
      async createUploadIntent(input) {
        const course = courses.get(input.courseId);
        if (!course || course.ownerId !== input.ownerId) return null;
        const row = { id: nextId(), ...input, wkKnowledgeId: null, wkDocKbId: course.wkDocKbId, cleanupStartedAt: null };
        uploadIntents.set(row.id, row);
        return row;
      },
      async setUploadIntentKnowledge(ownerId, id, wkKnowledgeId) {
        const intent = uploadIntents.get(id);
        if (!intent || intent.ownerId !== ownerId || intent.cleanupStartedAt) return null;
        const row = { ...intent, wkKnowledgeId };
        uploadIntents.set(id, row);
        return row;
      },
      async removeUploadIntent(ownerId, id) {
        const intent = uploadIntents.get(id);
        if (!intent || intent.ownerId !== ownerId) return false;
        return uploadIntents.delete(id);
      },
      async claimStaleUploadIntents() { return []; },
      async finalizeUploadIntent(ownerId, intentId, input) {
        const intent = uploadIntents.get(intentId);
        if (!intent || intent.ownerId !== ownerId || intent.cleanupStartedAt
          || intent.courseId !== input.courseId || intent.wkKnowledgeId !== input.wkKnowledgeId) return null;
        const row = { id: nextId(), ...input, cosKey: intent.cosKey, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        assets.set(row.id, row);
        uploadIntents.delete(intentId);
        return row;
      },
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
      async findOwnedByStorageRefs(ownerId, cosKey, wkKnowledgeId) {
        return [...assets.values()].find((asset) => (
          asset.cosKey === cosKey && asset.wkKnowledgeId === wkKnowledgeId
          && courses.get(asset.courseId)?.ownerId === ownerId
        )) ?? null;
      },
      async findManyOwned(ownerId, courseId, ids) {
        return this.listOwned(ownerId, courseId).then((rows) => rows.filter((asset) => ids.includes(asset.id)));
      },
      async findManyByCourse(courseId, ids) { return [...assets.values()].filter((asset) => asset.courseId === courseId && ids.includes(asset.id)); },
      async updateStatus(id, patch) {
        if (assets.get(id)?.parseStatus === 'deleting') return null;
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
      async publishValidated(id, expectedPayload, verifiedPayload) {
        const current = topics.get(id);
        if (!current || current.status !== 'draft' || JSON.stringify(current.payload) !== JSON.stringify(expectedPayload)) return null;
        const row = {
          ...current,
          payload: verifiedPayload,
          qualityIssues: [],
          status: 'ready',
          publishedAt: new Date().toISOString(),
        };
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
        if (!job || job.status !== 'running' || job.leaseToken !== input.leaseToken) return null;
        const attached = {
          ...job, status: 'needs_review', topicId: topic.id, errorCode: null,
          leaseToken: null, leaseExpiresAt: null,
        };
        jobs.set(job.id, attached);
        return { topic, job: attached };
      },
      async findOwned(ownerId, id) {
        const job = jobs.get(id);
        return job && courses.get(job.courseId)?.ownerId === ownerId ? job : null;
      },
      async findById(id) { return jobs.get(id) ?? null; },
      async listClaimable() {
        return [...jobs.values()].filter((job) => job.status === 'queued' || (job.status === 'running' && !job.leaseToken));
      },
      async claimForRun(id, leaseToken) {
        const job = jobs.get(id);
        if (!job || (job.status !== 'queued' && !(job.status === 'running' && !job.leaseToken))) return null;
        const claimed = { ...job, status: 'running', leaseToken, leaseExpiresAt: new Date(Date.now() + 600_000).toISOString() };
        jobs.set(id, claimed);
        return claimed;
      },
      async findOpenByCourse(courseId) {
        return [...jobs.values()].find((job) => (
          job.courseId === courseId
          && (job.status === 'queued' || job.status === 'running' || job.status === 'needs_review')
        )) ?? null;
      },
      async transitionClaimed(id, leaseToken, patch) {
        const current = jobs.get(id);
        if (!current || current.status !== 'running' || current.leaseToken !== leaseToken) return null;
        const row = { ...current, ...patch, leaseToken: null, leaseExpiresAt: null };
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
    createCustomCourseAssetKey({ userId, courseId }) {
      return `xiaobai/users/${userId}/custom-course-assets/${courseId}/fixture`;
    },
    async uploadCustomCourseAsset({ userId, courseId, key = this.createCustomCourseAssetKey({ userId, courseId }), body }) {
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

function storedZip(files) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.body ?? 'x');
    const expandedSize = file.expandedSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(expandedSize, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(expandedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, directory, eocd]);
}

function minimalPowerPointCfb() {
  const sectorSize = 512;
  const header = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x003e, 24);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(0, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(11, 60);
  header.writeUInt32LE(1, 64);
  header.writeUInt32LE(0xfffffffe, 68);
  header.writeUInt32LE(0, 72);
  header.fill(0xff, 76);
  header.writeUInt32LE(1, 76);

  const directory = Buffer.alloc(sectorSize);
  const writeEntry = (index, name, type, start, size) => {
    const offset = index * 128;
    const encoded = Buffer.from(`${name}\0`, 'utf16le');
    encoded.copy(directory, offset);
    directory.writeUInt16LE(encoded.length, offset + 64);
    directory[offset + 66] = type;
    directory.writeUInt32LE(0xffffffff, offset + 68);
    directory.writeUInt32LE(0xffffffff, offset + 72);
    directory.writeUInt32LE(0xffffffff, offset + 76);
    directory.writeUInt32LE(start, offset + 116);
    directory.writeBigUInt64LE(BigInt(size), offset + 120);
  };
  writeEntry(0, 'Root Entry', 5, 10, 64);
  writeEntry(1, 'PowerPoint Document', 2, 2, 4096);
  writeEntry(2, 'Current User', 2, 0, 32);
  directory.writeUInt32LE(1, 76);
  directory.writeUInt32LE(2, 128 + 72);

  const fat = Buffer.alloc(sectorSize, 0xff);
  fat.writeUInt32LE(0xfffffffe, 0 * 4);
  fat.writeUInt32LE(0xfffffffd, 1 * 4);
  for (let sector = 2; sector < 9; sector += 1) fat.writeUInt32LE(sector + 1, sector * 4);
  fat.writeUInt32LE(0xfffffffe, 9 * 4);
  fat.writeUInt32LE(0xfffffffe, 10 * 4);
  fat.writeUInt32LE(0xfffffffe, 11 * 4);
  const documentSectors = Array.from({ length: 8 }, () => Buffer.alloc(sectorSize));
  documentSectors[0].writeUInt16LE(0, 0);
  documentSectors[0].writeUInt16LE(0x0ff5, 2);
  documentSectors[0].writeUInt32LE(28, 4);
  documentSectors[0].writeUInt32LE(64, 20);
  documentSectors[0].writeUInt16LE(0, 64);
  documentSectors[0].writeUInt16LE(0x1772, 66);
  documentSectors[0].writeUInt32LE(4, 68);
  const rootMiniStream = Buffer.alloc(sectorSize);
  rootMiniStream.writeUInt16LE(0, 0);
  rootMiniStream.writeUInt16LE(0x0ff6, 2);
  rootMiniStream.writeUInt32LE(24, 4);
  rootMiniStream.writeUInt32LE(20, 8);
  rootMiniStream.writeUInt32LE(0xe391c05f, 12);
  rootMiniStream.writeUInt32LE(0, 16);
  rootMiniStream.writeUInt16LE(0x03f4, 22);
  rootMiniStream[24] = 3;
  rootMiniStream[25] = 0;
  const miniFat = Buffer.alloc(sectorSize, 0xff);
  miniFat.writeUInt32LE(0xfffffffe, 0);
  return Buffer.concat([
    header,
    directory,
    fat,
    ...documentSectors,
    rootMiniStream,
    miniFat,
  ]);
}

test('custom content service runs create, upload, compile, review, publish and student-view flow', async () => {
  const repository = repositoryFixture();
  const calls = { faq: null, deleted: [], evaluation: null };
  let mutateDuringFaq = null;
  let kb = 0;
  let knowledge = 0;
  const weknora = {
    async healthCheck() { return true; },
    async createKnowledgeBase(input) { kb += 1; return { id: input.id }; },
    async deleteKnowledgeBase(id) { calls.deleted.push(id); },
    async uploadFile() { return { id: `wk-knowledge-${++knowledge}`, parse_status: 'completed', enable_status: 'enabled' }; },
    async findKnowledgeByMetadata() { return null; },
    async getKnowledge(id) { return { id, parse_status: 'completed', enable_status: 'enabled' }; },
    async reparseKnowledge() {},
    async deleteKnowledge(id) { calls.deleted.push(id); },
    async listChunks() {
      return [{ id: 'chunk-1', content: '课件中的要点1原理、要点2原理、要点3原理，以及递归调用。' }];
    },
    async search() { return [{ id: 'chunk-1', content: '课件中的要点原理' }]; },
    async upsertFaqEntries(_id, entries) { calls.faq = entries; return { task_id: 'faq-test' }; },
    async waitForFaqImport(taskId) {
      assert.equal(taskId, 'faq-test');
      if (mutateDuringFaq) {
        const mutate = mutateDuringFaq;
        mutateDuringFaq = null;
        await mutate();
      }
      return { status: 'completed' };
    },
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
  mutateDuringFaq = async () => {
    await repository.topics.updateDraft(saved.id, { ...saved.payload, title: '并发未验证稿' }, [{ code: 'race' }]);
  };
  await assert.rejects(
    service.publishTopic(alice, saved.id, 'trace-publish-raced'),
    /topic-not-editable/,
    'FAQ 同步期间并发修改的 payload 不得跨过已验证快照发布',
  );
  const restoredDraft = await service.updateDraft(alice, saved.id, saved.payload, 'trace-restore');
  const published = await service.publishTopic(alice, restoredDraft.id, 'trace-publish');
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
  assert.equal(student[0].customCourseId, course.id);
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
    async createKnowledgeBase(input) { kb += 1; return { id: input.id }; },
    async deleteKnowledgeBase() {},
    async uploadFile() { return { id: `wk-knowledge-${++knowledge}`, parse_status: 'completed', enable_status: 'enabled' }; },
    async findKnowledgeByMetadata() { return null; },
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
    async createKnowledgeBase(input) { return { id: input.id }; },
    async deleteKnowledgeBase() {},
    async uploadFile() { uploadCalls += 1; },
    async findKnowledgeByMetadata() { return null; },
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

test('OOXML uploads require bounded DOCX/PPTX archive structure', async () => {
  const repository = repositoryFixture();
  let uploads = 0;
  const weknora = {
    async healthCheck() { return true; },
    async createKnowledgeBase(input) { return { id: input.id }; },
    async deleteKnowledgeBase() {},
    async uploadFile() { uploads += 1; return { id: `wk-ooxml-${uploads}`, parse_status: 'completed', enable_status: 'enabled' }; },
    async findKnowledgeByMetadata() { return null; },
    isTerminalParseStatus(status) { return status === 'completed'; },
  };
  const service = createCustomContentService({
    repository, weknora, cos: cosFixture(), compiler: { async compile() {} },
    embeddingModelId: 'embed-1', maxFileBytes: 1024 * 1024, uuid: () => IDS[23],
  });
  const owner = { id: IDS[22], name: 'Owner' };
  const course = await service.createCourse(owner, 'OOXML 测试');
  const validDocx = storedZip([
    { name: '[Content_Types].xml', body: '<Types />' },
    { name: '_rels/.rels', body: '<Relationships />' },
    { name: 'word/document.xml', body: '<document />' },
  ]);
  const uploaded = await service.uploadAsset(owner, course.id, {
    bytes: validDocx, filename: 'lesson.docx', assetRole: 'lecture', requestId: 'docx-valid',
  });
  assert.equal(uploaded.parseStatus, 'completed');
  const legacy = await service.uploadAsset(owner, course.id, {
    bytes: minimalPowerPointCfb(), filename: 'legacy.ppt', assetRole: 'lecture', requestId: 'ppt-valid',
  });
  assert.equal(legacy.parseStatus, 'completed');
  const compatibleDifat = minimalPowerPointCfb();
  compatibleDifat.writeUInt32LE(0xffffffff, 68);
  compatibleDifat.writeUInt32LE(0xfffffffe, 80);
  const compatibleLegacy = await service.uploadAsset(owner, course.id, {
    bytes: compatibleDifat, filename: 'compatible-legacy.ppt', assetRole: 'lecture', requestId: 'ppt-compatible',
  });
  assert.equal(compatibleLegacy.parseStatus, 'completed');
  await assert.rejects(
    service.uploadAsset(owner, course.id, {
      bytes: Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(1024)]),
      filename: 'renamed.ppt', assetRole: 'lecture', requestId: 'ppt-invalid',
    }),
    /file-content-mismatch/,
  );
  const orphanStreams = minimalPowerPointCfb();
  orphanStreams.writeUInt32LE(0xffffffff, 512 + 76);
  await assert.rejects(
    service.uploadAsset(owner, course.id, {
      bytes: orphanStreams, filename: 'orphan-streams.ppt', assetRole: 'lecture', requestId: 'ppt-orphan',
    }),
    /file-content-mismatch/,
  );
  const forgedRecords = minimalPowerPointCfb();
  forgedRecords.fill(0, 3 * 512, 3 * 512 + 72);
  await assert.rejects(
    service.uploadAsset(owner, course.id, {
      bytes: forgedRecords, filename: 'forged-records.ppt', assetRole: 'lecture', requestId: 'ppt-forged',
    }),
    /file-content-mismatch/,
  );
  await assert.rejects(
    service.uploadAsset(owner, course.id, {
      bytes: storedZip([{ name: 'random.txt', body: 'not OOXML' }]),
      filename: 'renamed.docx', assetRole: 'lecture', requestId: 'docx-invalid',
    }),
    /file-content-mismatch/,
  );
  await assert.rejects(
    service.uploadAsset(owner, course.id, {
      bytes: storedZip([
        { name: '[Content_Types].xml', body: 'x' },
        { name: '_rels/.rels', body: 'x' },
        { name: 'ppt/presentation.xml', body: 'x', expandedSize: 300 * 1024 * 1024 },
      ]),
      filename: 'bomb.pptx', assetRole: 'lecture', requestId: 'pptx-bomb',
    }),
    /file-archive-too-large/,
  );
  assert.equal(uploads, 3);
});

test('failed WeKnora ingestion compensates the already written COS original', async () => {
  const repository = repositoryFixture();
  const cos = cosFixture();
  const weknora = {
    async healthCheck() { return true; },
    async createKnowledgeBase(input) { return { id: input.id }; },
    async deleteKnowledgeBase() {},
    async uploadFile() { throw new Error('weknora-upstream-failed'); },
    async findKnowledgeByMetadata() { return null; },
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

test('stale upload reconciliation is bounded to four concurrent upstream deletions', async () => {
  const repository = repositoryFixture();
  const intents = Array.from({ length: 12 }, (_, index) => ({
    id: `intent-${index}`,
    ownerId: IDS[index % IDS.length],
    cosKey: `cos-key-${index}`,
    wkKnowledgeId: `knowledge-${index}`,
    wkDocKbId: 'document-kb',
  }));
  repository.assets.claimStaleUploadIntents = async () => intents;
  repository.assets.removeUploadIntent = async () => true;
  let active = 0;
  let maximum = 0;
  const service = createCustomContentService({
    repository,
    cos: cosFixture(),
    weknora: {
      async createKnowledgeBase() {},
      async uploadFile() {},
      async findKnowledgeByMetadata() { return null; },
      async deleteKnowledge() {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      },
    },
    compiler: { async compile() {} },
    embeddingModelId: 'embedding-model',
  });
  assert.deepEqual(await service.reconcileUploadIntents(), { scanned: 12, cleaned: 12 });
  assert.equal(maximum, 4);
});

test('asset deletion resumes idempotently from a persisted deleting state', async () => {
  const repository = repositoryFixture();
  const cos = cosFixture();
  let removeCalls = 0;
  const remove = repository.assets.remove;
  repository.assets.remove = async (id) => {
    removeCalls += 1;
    if (removeCalls === 1) throw new Error('simulated-db-delete-failure');
    return remove.call(repository.assets, id);
  };
  const weknora = {
    async healthCheck() { return true; },
    async createKnowledgeBase(input) { return { id: input.id }; },
    async deleteKnowledgeBase() {},
    async uploadFile() { return { id: 'wk-delete-resume', parse_status: 'completed', enable_status: 'enabled' }; },
    async findKnowledgeByMetadata() { return null; },
    async deleteKnowledge() {},
    isTerminalParseStatus(status) { return status === 'completed'; },
  };
  const service = createCustomContentService({
    repository, weknora, cos,
    compiler: { async compile() {} }, embeddingModelId: 'embed-1', uuid: () => IDS[29],
  });
  const owner = { id: IDS[28], name: 'Owner' };
  const course = await service.createCourse(owner, '删除续作');
  const asset = await service.uploadAsset(owner, course.id, {
    bytes: Buffer.from('%PDF-1.7\nresume\n%%EOF'), filename: 'resume.pdf', assetRole: 'lecture', requestId: 'upload',
  });
  await assert.rejects(service.deleteAsset(owner, asset.id, 'delete-first'), /simulated-db-delete-failure/);
  const stranded = await repository.assets.findOwned(owner.id, asset.id);
  assert.equal(stranded.parseStatus, 'deleting');
  await service.deleteAsset(owner, asset.id, 'delete-retry');
  assert.equal(await repository.assets.findOwned(owner.id, asset.id), null);
  assert.equal(cos.objects.size, 0);
});

test('lost commit acknowledgements recover committed course and asset rows without compensation', async () => {
  const repository = repositoryFixture();
  const cos = cosFixture();
  const deleted = [];
  const weknora = {
    async healthCheck() { return true; },
    async createKnowledgeBase(input) { return { id: input.id }; },
    async deleteKnowledgeBase(id) { deleted.push(`kb:${id}`); },
    async uploadFile() { return { id: 'wk-commit-asset', parse_status: 'completed', enable_status: 'enabled' }; },
    async findKnowledgeByMetadata() { return null; },
    async deleteKnowledge(id) { deleted.push(`knowledge:${id}`); },
    isTerminalParseStatus(status) { return status === 'completed'; },
  };
  const finalizeCourse = repository.courses.finalizeCreationIntent;
  repository.courses.finalizeCreationIntent = async (...args) => {
    await finalizeCourse.apply(repository.courses, args);
    throw new Error('lost-course-commit-ack');
  };
  const service = createCustomContentService({
    repository, weknora, cos, compiler: { async compile() {} }, embeddingModelId: 'embed-1',
  });
  const owner = { id: IDS[17], name: 'Owner' };
  const course = await service.createCourse(owner, '提交回执恢复');
  assert.equal(course.title, '提交回执恢复');
  assert.deepEqual(deleted, [], '课程已提交时不得补偿删除其 KB');

  const finalizeAsset = repository.assets.finalizeUploadIntent;
  repository.assets.finalizeUploadIntent = async (...args) => {
    await finalizeAsset.apply(repository.assets, args);
    throw new Error('lost-asset-commit-ack');
  };
  const asset = await service.uploadAsset(owner, course.id, {
    bytes: Buffer.from('%PDF-1.7\ncommit\n%%EOF'), filename: 'commit.pdf', assetRole: 'lecture', requestId: 'commit-asset',
  });
  assert.equal(asset.wkKnowledgeId, 'wk-commit-asset');
  assert.deepEqual(deleted, [], '资产已提交时不得补偿删除 WeKnora 副本');
  assert.equal(cos.objects.size, 1, '资产已提交时不得补偿删除 COS 原件');
});
