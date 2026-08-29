import crypto from 'node:crypto';
import path from 'node:path';
import {
  hasBlockingIssues,
  normalizeTopicDraft,
  studentTopicView,
  teacherEditableDraft,
  validateTopicDraft,
} from './topic-contract.mjs';
import { TOPIC_PROMPT_VERSION } from './topic-compiler.mjs';

const COURSE_TITLE_MAX = 120;
const TOPIC_TITLE_MAX = 160;
const DEFAULT_MAX_FILE_BYTES = 80 * 1024 * 1024;
const ASSET_ROLES = new Set(['lecture', 'lab', 'syllabus', 'reading']);
const PARSE_STATUSES = new Set([
  'pending', 'processing', 'finalizing', 'completed', 'failed', 'deleting', 'cancelled',
]);

const FILE_TYPES = Object.freeze({
  '.pdf': 'application/pdf',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
});

function publicError(code, status = 400) {
  const error = new Error(code);
  error.status = status;
  return error;
}

function cleanText(value, maximum) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';
}

function cleanFilename(value) {
  const normalized = String(value ?? '').normalize('NFKC').replaceAll('\\', '/').replace(/[\u0000-\u001f\u007f]/g, '');
  if (!normalized || normalized.startsWith('/') || normalized.length > 260) throw publicError('filename-invalid');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) throw publicError('filename-invalid');
  return parts.join('/');
}

function isZip(bytes) {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));
}

function isOle(bytes) {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function validUtf8Text(bytes) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 2 * 1024 * 1024)));
    return true;
  } catch {
    return false;
  }
}

function validateFile(bytes, filename, maximum) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw publicError('file-empty');
  if (bytes.length > maximum) throw publicError('file-too-large', 413);
  const extension = path.extname(filename.split('/').at(-1)).toLowerCase();
  const contentType = FILE_TYPES[extension];
  if (!contentType) throw publicError('file-type-unsupported', 415);
  const valid = extension === '.pdf'
    ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
    : extension === '.ppt'
      ? isOle(bytes)
      : extension === '.pptx' || extension === '.docx'
        ? isZip(bytes)
        : validUtf8Text(bytes);
  if (!valid) throw publicError('file-content-mismatch', 415);
  return { extension, contentType };
}

function normalizedParseStatus(value) {
  const status = String(value ?? '').toLowerCase();
  return PARSE_STATUSES.has(status) ? status : 'processing';
}

function normalizedEnableStatus(value, parseStatus) {
  const status = String(value ?? '').toLowerCase();
  if (status === 'enabled' || status === 'disabled') return status;
  return parseStatus === 'completed' ? 'enabled' : 'disabled';
}

function upstreamKnowledge(value) {
  const id = String(value?.id ?? value?.knowledge_id ?? '').trim();
  if (!id) throw new Error('weknora-invalid-knowledge');
  const parseStatus = normalizedParseStatus(value?.parse_status ?? value?.parseStatus);
  return {
    id,
    parseStatus,
    enableStatus: normalizedEnableStatus(value?.enable_status ?? value?.enableStatus, parseStatus),
    errorMessage: parseStatus === 'failed' ? '资料解析失败，可尝试重新解析' : null,
  };
}

function chunkContent(value) {
  return String(value?.content ?? value?.text ?? value?.chunk_content ?? '').trim();
}

function chunkId(value) {
  return String(value?.id ?? value?.chunk_id ?? '').trim();
}

function sourceOverlap(query, content) {
  const wanted = new Set();
  const normalized = String(query).toLowerCase();
  for (const word of normalized.match(/[a-z0-9_+-]{2,}/g) ?? []) wanted.add(word);
  for (const sequence of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    for (let size = 2; size <= Math.min(4, sequence.length); size += 1) {
      for (let index = 0; index + size <= sequence.length; index += 1) {
        wanted.add(sequence.slice(index, index + size));
      }
    }
  }
  if (wanted.size === 0) return 0;
  const haystack = String(content).toLowerCase();
  let matched = 0;
  for (const token of wanted) if (haystack.includes(token)) matched += 1;
  return matched / wanted.size;
}

function stableCompilerError(error) {
  const code = String(error?.message ?? 'compile-failed').split(':', 1)[0];
  const allowed = new Set([
    'compiler-no-chunks', 'compiler-invalid-json', 'compiler-timeout', 'compiler-rate-limited',
    'compiler-upstream-failed', 'compiler-empty', 'weknora-timeout', 'weknora-unreachable',
    'weknora-upstream-failed',
  ]);
  return allowed.has(code) ? code : 'compile-failed';
}

function publicCourse(course) {
  return {
    id: course.id,
    title: course.title,
    assetCount: course.assetCount ?? 0,
    topicCount: course.topicCount ?? 0,
    createdAt: course.createdAt,
  };
}

function publicAsset(asset) {
  return {
    id: asset.id,
    courseId: asset.courseId,
    assetRole: asset.assetRole,
    filename: asset.filename,
    contentType: asset.contentType,
    byteSize: asset.byteSize,
    wkKnowledgeId: asset.wkKnowledgeId,
    parseStatus: asset.parseStatus,
    enableStatus: asset.enableStatus,
    errorMessage: asset.errorMessage,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function faqEntry(mc) {
  return {
    standard_question: mc.belief,
    similar_questions: [mc.triggerLine],
    negative_questions: mc.correctionCriteria.slice(0, 3),
    answers: [mc.correctionCriteria.join('；')],
    is_enabled: true,
    is_recommended: false,
  };
}

export function createCustomContentService({
  repository,
  weknora,
  cos,
  compiler,
  embeddingModelId,
  summaryModelId,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  uuid = crypto.randomUUID,
  logger = console,
} = {}) {
  if (!repository?.courses || !repository?.assets || !repository?.topics || !repository?.jobs) {
    throw new Error('custom-content-repository-required');
  }
  if (!weknora?.createKnowledgeBase || !weknora?.uploadFile) throw new Error('weknora-client-required');
  if (!cos?.uploadCustomCourseAsset || !cos?.verifySize || !cos?.delete) throw new Error('custom-content-cos-required');
  if (!compiler?.compile) throw new Error('topic-compiler-required');
  if (!embeddingModelId) throw new Error('weknora-embedding-model-required');
  const runningJobs = new Map();
  const queuedJobIds = new Set();
  const compileQueue = [];
  const maxConcurrentCompiles = 2;
  let activeCompiles = 0;

  const kbBase = (name, type) => ({
    name,
    description: '小白同学自定义课程 sidecar 知识库',
    type,
    embedding_model_id: embeddingModelId,
    ...(summaryModelId ? { summary_model_id: summaryModelId } : {}),
    chunking_config: {
      strategy: 'heading',
      chunk_size: 512,
      chunk_overlap: 80,
      enable_parent_child: true,
      parent_chunk_size: 4096,
      child_chunk_size: 384,
      separators: ['\n\n', '\n', '。', '！', '？'],
    },
    indexing_strategy: {
      vector_enabled: true,
      keyword_enabled: true,
      wiki_enabled: false,
      graph_enabled: false,
    },
    question_generation_config: { enabled: false },
  });

  async function requireCourse(ownerId, courseId) {
    const course = await repository.courses.findOwned(ownerId, courseId).catch(() => null);
    if (!course) throw publicError('course-not-found', 404);
    return course;
  }

  async function compensateCos(userId, key, reason) {
    if (!key) return;
    try {
      await cos.delete({ userId, key });
    } catch {
      logger.error?.(`[custom-content] COS compensation failed: ${reason}`);
    }
  }

  async function refreshAsset(asset, requestId) {
    if (weknora.isTerminalParseStatus(asset.parseStatus)) return asset;
    try {
      const status = upstreamKnowledge(await weknora.getKnowledge(asset.wkKnowledgeId, requestId));
      if (
        status.parseStatus === asset.parseStatus
        && status.enableStatus === asset.enableStatus
        && status.errorMessage === asset.errorMessage
      ) return asset;
      return await repository.assets.updateStatus(asset.id, status);
    } catch (error) {
      if (String(error?.message).startsWith('weknora-not-found')) {
        return repository.assets.updateStatus(asset.id, {
          parseStatus: 'failed', enableStatus: 'disabled', errorMessage: '资料在解析服务中不存在',
        });
      }
      return asset;
    }
  }

  async function loadOwnedTopic(ownerId, id) {
    const topic = await repository.topics.findOwned(ownerId, id).catch(() => null);
    if (!topic) throw publicError('topic-not-found', 404);
    return topic;
  }

  async function hydrateDraftSources(course, current, candidate, requestId) {
    const sourceIds = (current.payload?.sources ?? []).map((source) => source.assetId).filter(Boolean);
    const assets = sourceIds.length
      ? await repository.assets.findManyByCourse(course.id, sourceIds)
      : [];
    const sourceAssets = assets.map((asset) => ({
      id: asset.id,
      wkKnowledgeId: asset.wkKnowledgeId,
      filename: asset.filename,
      assetRole: asset.assetRole,
    }));
    const chunkLists = await Promise.all(
      assets.map((asset) => weknora.listChunks(asset.wkKnowledgeId, requestId, 500)),
    );
    const chunks = chunkLists.flat().map((value) => ({ id: chunkId(value), content: chunkContent(value) }))
      .filter((chunk) => chunk.id && chunk.content);
    const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk.content]));
    const normalized = normalizeTopicDraft(candidate, {
      topicId: current.topicId,
      courseTitle: course.title,
      sourceAssets,
      promptVersion: current.promptVersion,
      model: current.payload?.compileMeta?.model ?? '',
    });
    normalized.compileMeta.teacherEdited = true;
    for (const item of normalized.checklist) {
      item.sourceChunkIds = item.sourceChunkIds.filter((id) => chunkMap.has(id));
      item.sourceExcerpt = item.sourceChunkIds[0]
        ? chunkMap.get(item.sourceChunkIds[0]).replace(/\s+/g, ' ').slice(0, 800)
        : '';
    }
    const sourceCorpus = chunks.map((chunk) => chunk.content).join('\n');
    const issues = validateTopicDraft(normalized, { sourceCorpus });
    for (const [index, item] of normalized.checklist.entries()) {
      const supported = item.sourceChunkIds.some((id) => (
        sourceOverlap(`${item.point} ${item.groundTruth}`, chunkMap.get(id) ?? '') >= 0.15
      ));
      if (!supported) {
        issues.push({
          code: 'ground-truth-not-grounded',
          path: `checklist.${index}.groundTruth`,
          message: '修改后的评估依据与所选课件片段关联过弱',
          level: 'error',
        });
      }
    }
    return { normalized, issues };
  }

  async function runJob(jobId) {
    if (runningJobs.has(jobId)) return runningJobs.get(jobId);
    const task = (async () => {
      const job = await repository.jobs.findById(jobId);
      if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
      await repository.jobs.update(job.id, { status: 'running' });
      try {
        const course = await repository.courses.findById(job.courseId);
        if (!course) throw new Error('course-not-found');
        const assets = await repository.assets.findManyByCourse(job.courseId, job.assetIds);
        if (assets.length !== job.assetIds.length || assets.some((asset) => asset.parseStatus !== 'completed')) {
          throw new Error('assets-not-ready');
        }
        const topicId = `custom-${course.id.slice(0, 8)}-${job.id.slice(0, 8)}`;
        const result = await compiler.compile({
          course,
          assets,
          topicId,
          requestedTitle: job.requestedTitle,
          requestId: `xb-compile-${job.id}`,
        });
        const topic = await repository.topics.createDraft({
          topicId,
          courseId: course.id,
          payload: result.topic,
          qualityIssues: result.qualityIssues,
          promptVersion: TOPIC_PROMPT_VERSION,
        });
        await repository.jobs.update(job.id, { status: 'needs_review', topicId: topic.id });
      } catch (error) {
        logger.error?.('[custom-content] compile failed:', stableCompilerError(error));
        await repository.jobs.update(job.id, {
          status: 'failed',
          errorCode: stableCompilerError(error),
        }).catch(() => {});
      }
    })().finally(() => runningJobs.delete(jobId));
    runningJobs.set(jobId, task);
    return task;
  }

  function pumpCompileQueue() {
    while (activeCompiles < maxConcurrentCompiles && compileQueue.length > 0) {
      const jobId = compileQueue.shift();
      queuedJobIds.delete(jobId);
      activeCompiles += 1;
      void runJob(jobId).finally(() => {
        activeCompiles -= 1;
        pumpCompileQueue();
      });
    }
  }

  function scheduleJob(jobId) {
    if (runningJobs.has(jobId) || queuedJobIds.has(jobId)) return;
    queuedJobIds.add(jobId);
    compileQueue.push(jobId);
    queueMicrotask(pumpCompileQueue);
  }

  return Object.freeze({
    maxFileBytes,

    async status() {
      return { configured: true, healthy: await weknora.healthCheck() };
    },

    async createCourse(owner, titleValue, requestId) {
      const title = cleanText(titleValue, COURSE_TITLE_MAX);
      if (title.length < 2) throw publicError('course-title-invalid');
      const suffix = uuid().slice(0, 8);
      const [docResult, faqResult] = await Promise.allSettled([
        weknora.createKnowledgeBase(kbBase(`小白·${title}·资料·${suffix}`, 'document'), requestId),
        weknora.createKnowledgeBase(kbBase(`小白·${title}·误区·${suffix}`, 'faq'), requestId),
      ]);
      if (docResult.status !== 'fulfilled' || faqResult.status !== 'fulfilled') {
        await Promise.allSettled([
          docResult.status === 'fulfilled' && docResult.value?.id
            ? weknora.deleteKnowledgeBase(docResult.value.id, requestId)
            : Promise.resolve(),
          faqResult.status === 'fulfilled' && faqResult.value?.id
            ? weknora.deleteKnowledgeBase(faqResult.value.id, requestId)
            : Promise.resolve(),
        ]);
        throw publicError('course-create-upstream-failed', 502);
      }
      const docId = String(docResult.value?.id ?? '').trim();
      const faqId = String(faqResult.value?.id ?? '').trim();
      if (!docId || !faqId) {
        await Promise.allSettled([
          docId ? weknora.deleteKnowledgeBase(docId, requestId) : Promise.resolve(),
          faqId ? weknora.deleteKnowledgeBase(faqId, requestId) : Promise.resolve(),
        ]);
        throw publicError('course-create-upstream-failed', 502);
      }
      try {
        return publicCourse(await repository.courses.create({
          ownerId: owner.id, title, wkDocKbId: docId, wkFaqKbId: faqId,
        }));
      } catch (error) {
        await Promise.allSettled([
          weknora.deleteKnowledgeBase(docId, requestId),
          weknora.deleteKnowledgeBase(faqId, requestId),
        ]);
        throw error;
      }
    },

    async listCourses(owner) {
      return (await repository.courses.listByOwner(owner.id)).map(publicCourse);
    },

    async getCourse(owner, courseId) {
      const course = await requireCourse(owner.id, courseId);
      const assets = await repository.assets.listOwned(owner.id, course.id);
      const refreshed = await Promise.all(assets.map((asset) => refreshAsset(asset, `xb-assets-${course.id}`)));
      return { ...publicCourse(course), assets: refreshed.map(publicAsset) };
    },

    async uploadAsset(owner, courseId, {
      bytes,
      filename: filenameValue,
      assetRole: roleValue,
      requestId,
    }) {
      const course = await requireCourse(owner.id, courseId);
      const filename = cleanFilename(filenameValue);
      const assetRole = ASSET_ROLES.has(roleValue) ? roleValue : 'lecture';
      const { contentType } = validateFile(bytes, filename, maxFileBytes);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      let stored;
      try {
        stored = await cos.uploadCustomCourseAsset({
          userId: owner.id,
          courseId: course.id,
          body: bytes,
          contentType,
        });
        const verified = await cos.verifySize({ userId: owner.id, key: stored.key });
        if (verified.byteSize !== bytes.length) throw new Error('cos-object-size-mismatch');
      } catch {
        await compensateCos(owner.id, stored?.key, 'verify-upload');
        throw publicError('asset-storage-failed', 502);
      }
      let uploaded;
      try {
        uploaded = upstreamKnowledge(await weknora.uploadFile(course.wkDocKbId, {
          bytes,
          filename,
          contentType,
          metadata: { xiaobai_course_id: course.id, asset_role: assetRole, sha256 },
          processConfig: {
            parser_engine_rules: [
              { file_types: ['.ppt', '.pptx', '.pdf', '.docx', '.md', '.txt'], engine: 'builtin' },
            ],
            chunking_config: {
              strategy: 'heading', chunk_size: 512, chunk_overlap: 80,
              enable_parent_child: true, parent_chunk_size: 4096, child_chunk_size: 384,
              separators: ['\n\n', '\n', '。', '！', '？'],
            },
            enable_multimodel: false,
            question_generation_config: { enabled: false },
            graph_enabled: false,
          },
          requestId,
        }));
      } catch (error) {
        await compensateCos(owner.id, stored.key, 'weknora-upload');
        if (String(error?.message).startsWith('weknora-conflict')) throw publicError('asset-duplicate', 409);
        if (String(error?.message).startsWith('weknora-file-too-large')) throw publicError('file-too-large', 413);
        throw publicError('asset-upload-upstream-failed', 502);
      }
      try {
        return publicAsset(await repository.assets.create({
          courseId: course.id,
          assetRole,
          filename,
          contentType,
          byteSize: bytes.length,
          sha256,
          cosKey: stored.key,
          wkKnowledgeId: uploaded.id,
          parseStatus: uploaded.parseStatus,
          enableStatus: uploaded.enableStatus,
          errorMessage: uploaded.errorMessage,
        }));
      } catch (error) {
        const cleanup = await Promise.allSettled([
          weknora.deleteKnowledge(uploaded.id, requestId),
          cos.delete({ userId: owner.id, key: stored.key }),
        ]);
        if (cleanup.some((result) => result.status === 'rejected')) {
          logger.error?.('[custom-content] upload compensation incomplete');
        }
        if (error?.code === '23505') throw publicError('asset-duplicate', 409);
        throw error;
      }
    },

    async listAssets(owner, courseId) {
      const course = await requireCourse(owner.id, courseId);
      const assets = await repository.assets.listOwned(owner.id, course.id);
      return (await Promise.all(assets.map((asset) => refreshAsset(asset, `xb-assets-${course.id}`))))
        .map(publicAsset);
    },

    async getAsset(owner, assetId, requestId) {
      const asset = await repository.assets.findOwned(owner.id, assetId).catch(() => null);
      if (!asset) throw publicError('asset-not-found', 404);
      return publicAsset(await refreshAsset(asset, requestId));
    },

    async reparseAsset(owner, assetId, requestId) {
      const asset = await repository.assets.findOwned(owner.id, assetId).catch(() => null);
      if (!asset) throw publicError('asset-not-found', 404);
      const stored = await cos.verifySize({ userId: owner.id, key: asset.cosKey }).catch(() => null);
      if (!stored || stored.byteSize !== asset.byteSize) throw publicError('asset-storage-missing', 409);
      await weknora.reparseKnowledge(asset.wkKnowledgeId, {}, requestId).catch(() => {
        throw publicError('asset-reparse-upstream-failed', 502);
      });
      return publicAsset(await repository.assets.updateStatus(asset.id, {
        parseStatus: 'pending', enableStatus: 'disabled', errorMessage: null,
      }));
    },

    async deleteAsset(owner, assetId, requestId) {
      const asset = await repository.assets.findOwned(owner.id, assetId).catch(() => null);
      if (!asset) throw publicError('asset-not-found', 404);
      if (await repository.assets.isReferenced(asset.id)) throw publicError('asset-in-use', 409);
      await weknora.deleteKnowledge(asset.wkKnowledgeId, requestId).catch((error) => {
        if (!String(error?.message).startsWith('weknora-not-found')) {
          throw publicError('asset-delete-upstream-failed', 502);
        }
      });
      await cos.delete({ userId: owner.id, key: asset.cosKey }).catch(() => {
        throw publicError('asset-storage-delete-failed', 502);
      });
      await repository.assets.remove(asset.id);
      return { ok: true };
    },

    async startCompile(owner, input) {
      const course = await requireCourse(owner.id, input?.courseId);
      const assetIds = Array.isArray(input?.assetIds) ? [...new Set(input.assetIds)] : [];
      if (assetIds.length === 0 || assetIds.length > 12) throw publicError('assets-required');
      const assets = await repository.assets.findManyOwned(owner.id, course.id, assetIds).catch(() => []);
      if (assets.length !== assetIds.length) throw publicError('asset-not-found', 404);
      if (assets.some((asset) => asset.parseStatus !== 'completed')) throw publicError('assets-not-ready', 409);
      if (await repository.jobs.findActiveByCourse(course.id)) throw publicError('compile-job-active', 409);
      const requestedTitle = cleanText(input?.title, TOPIC_TITLE_MAX) || null;
      let job;
      try {
        job = await repository.jobs.create({ courseId: course.id, assetIds, requestedTitle });
      } catch (error) {
        if (error?.code === '23505') throw publicError('compile-job-active', 409);
        throw error;
      }
      scheduleJob(job.id);
      return job;
    },

    async getCompileJob(owner, jobId) {
      const job = await repository.jobs.findOwned(owner.id, jobId).catch(() => null);
      if (!job) throw publicError('compile-job-not-found', 404);
      if ((job.status === 'queued' || job.status === 'running') && !runningJobs.has(job.id)) scheduleJob(job.id);
      const topic = job.topicId ? await repository.topics.findOwned(owner.id, job.topicId) : null;
      return { ...job, topic };
    },

    async updateDraft(owner, id, candidate, requestId) {
      const current = await loadOwnedTopic(owner.id, id);
      if (current.status !== 'draft') throw publicError('topic-not-editable', 409);
      const course = await requireCourse(owner.id, current.courseId);
      const { normalized, issues } = await hydrateDraftSources(course, current, candidate, requestId);
      const updated = await repository.topics.updateDraft(current.id, teacherEditableDraft(normalized), issues);
      if (!updated) throw publicError('topic-not-editable', 409);
      return updated;
    },

    async publishTopic(owner, id, requestId) {
      const current = await loadOwnedTopic(owner.id, id);
      if (current.status !== 'draft') throw publicError('topic-not-editable', 409);
      const course = await requireCourse(owner.id, current.courseId);
      const { normalized, issues } = await hydrateDraftSources(course, current, current.payload, requestId);
      if (hasBlockingIssues(issues)) {
        await repository.topics.updateDraft(current.id, normalized, issues);
        throw publicError('topic-quality-gate-failed', 409);
      }
      const existing = await repository.topics.listReadyByCourse(course.id);
      const faqEntries = [...existing.map((topic) => topic.payload), normalized]
        .flatMap((topic) => topic.misconceptions ?? [])
        .map(faqEntry);
      if (course.wkFaqKbId && faqEntries.length > 0) {
        await (async () => {
          const task = await weknora.upsertFaqEntries(course.wkFaqKbId, faqEntries, requestId);
          if (!task?.task_id) throw new Error('faq-task-missing');
          await weknora.waitForFaqImport(task.task_id, requestId);
        })().catch(() => {
          throw publicError('faq-sync-failed', 502);
        });
      }
      const updated = await repository.topics.updateDraft(current.id, normalized, []);
      if (!updated) throw publicError('topic-not-editable', 409);
      const published = await repository.topics.publish(current.id);
      if (!published) throw publicError('topic-not-editable', 409);
      await repository.jobs.markDoneForTopic(current.id).catch(() => {});
      return published;
    },

    async listPublishedTopics(owner) {
      return (await repository.topics.listReadyByOwner(owner.id)).map((topic) => studentTopicView(topic.payload));
    },

    async getPublishedTopic(owner, topicId) {
      const topic = await repository.topics.findReadyOwnedByTopicId(owner.id, topicId);
      if (!topic) throw publicError('topic-not-found', 404);
      return studentTopicView(topic.payload);
    },

    async getTeacherTopic(owner, topicId) {
      const topic = await repository.topics.findReadyOwnedByTopicId(owner.id, topicId);
      if (!topic) throw publicError('topic-not-found', 404);
      return topic;
    },

    async resumePendingJobs() {
      const jobs = await repository.jobs.listResumable();
      for (const job of jobs) scheduleJob(job.id);
      return jobs.length;
    },
  });
}
