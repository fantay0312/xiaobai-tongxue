import { randomUUID } from 'node:crypto';

const JSON_LIMIT = 2 * 1024 * 1024;
const MULTIPART_OVERHEAD = 2 * 1024 * 1024;
const UPLOAD_IDLE_TIMEOUT_MS = 120_000;
const MIN_UPLOAD_BYTES_PER_SECOND = 64 * 1024;
const MIN_UPLOAD_TOTAL_TIMEOUT_MS = 10 * 60_000;
const MULTIPART_MAX_PARTS = 8;
const MULTIPART_MAX_HEADER_BYTES = 16 * 1024;
const MULTIPART_MAX_FIELD_BYTES = 4 * 1024;

function requestId(req) {
  const supplied = req.headers['x-request-id'];
  return typeof supplied === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(supplied)
    ? supplied
    : `xb-${randomUUID()}`;
}

function errorStatus(error) {
  if (error?.message === 'body-too-large') return 413;
  if (error?.message === 'body-timeout') return 408;
  return Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599
    ? error.status
    : 500;
}

function errorCode(error) {
  const message = String(error?.message ?? 'custom-content-failed').split(':', 1)[0];
  return /^[a-z0-9-]{1,80}$/.test(message) ? message : 'custom-content-failed';
}

function multipartBoundary(contentType) {
  if (typeof contentType !== 'string' || !/^multipart\/form-data\s*;/i.test(contentType)) return null;
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2] ?? '';
  return /^[0-9A-Za-z'()+_,./:=?-]{1,70}$/.test(boundary) ? boundary : null;
}

function parseMultipart(body, boundary) {
  const marker = Buffer.from(`--${boundary}`, 'ascii');
  const delimiter = Buffer.concat([Buffer.from('\r\n', 'ascii'), marker]);
  const headerSeparator = Buffer.from('\r\n\r\n', 'ascii');
  const fields = new Map();
  let filePart = null;
  let cursor = 0;
  let parts = 0;
  if (!body.subarray(0, marker.length).equals(marker)) return null;
  cursor = marker.length;
  while (cursor < body.length) {
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--', 'ascii'))) {
      cursor += 2;
      if (body.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n', 'ascii'))) cursor += 2;
      return cursor === body.length && filePart ? {
        bytes: filePart.bytes,
        filename: fields.get('fileName') || filePart.filename,
        assetRole: fields.get('asset_role') || 'lecture',
      } : null;
    }
    if (!body.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n', 'ascii'))) return null;
    cursor += 2;
    parts += 1;
    if (parts > MULTIPART_MAX_PARTS) return null;
    const headerEnd = body.indexOf(headerSeparator, cursor);
    if (headerEnd < 0 || headerEnd - cursor > MULTIPART_MAX_HEADER_BYTES) return null;
    const headerLines = body.subarray(cursor, headerEnd).toString('utf8').split('\r\n');
    const headers = new Map();
    for (const line of headerLines) {
      const split = line.indexOf(':');
      if (split < 1) return null;
      const name = line.slice(0, split).trim().toLowerCase();
      const value = line.slice(split + 1).trim();
      if (!name || headers.has(name)) return null;
      headers.set(name, value);
    }
    const disposition = headers.get('content-disposition') ?? '';
    const name = /(?:^|;)\s*name="([^"\r\n]{1,100})"/i.exec(disposition)?.[1] ?? '';
    const filename = /(?:^|;)\s*filename="([^"\r\n]{0,512})"/i.exec(disposition)?.[1] ?? '';
    if (!/^form-data(?:;|$)/i.test(disposition) || !name) return null;
    const dataStart = headerEnd + headerSeparator.length;
    const nextBoundary = body.indexOf(delimiter, dataStart);
    if (nextBoundary < 0) return null;
    const data = body.subarray(dataStart, nextBoundary);
    if (name === 'file') {
      if (filePart || data.length < 1) return null;
      filePart = { bytes: data, filename };
    } else {
      if (data.length > MULTIPART_MAX_FIELD_BYTES || fields.has(name)) return null;
      fields.set(name, data.toString('utf8'));
    }
    cursor = nextBoundary + delimiter.length;
  }
  return null;
}

async function multipartUpload(req, readRaw, limit) {
  const contentType = req.headers['content-type'];
  const boundary = multipartBoundary(contentType);
  if (!boundary) {
    const error = new Error('multipart-required');
    error.status = 415;
    throw error;
  }
  const bodyLimit = limit + MULTIPART_OVERHEAD;
  const body = await readRaw(req, bodyLimit, {
    idleTimeoutMs: UPLOAD_IDLE_TIMEOUT_MS,
    totalTimeoutMs: Math.max(
      MIN_UPLOAD_TOTAL_TIMEOUT_MS,
      Math.ceil(bodyLimit / MIN_UPLOAD_BYTES_PER_SECOND) * 1_000,
    ),
  });
  const parsed = parseMultipart(body, boundary);
  if (!parsed) {
    const error = new Error('multipart-invalid');
    error.status = 400;
    throw error;
  }
  return parsed;
}

export function createCustomContentRouter({
  service,
  resolveOwner,
  send,
  readJson,
  readRaw,
  hasJsonContentType,
  rateLimit = null,
  logger = console,
} = {}) {
  if (!service || !resolveOwner || !send || !readJson || !readRaw) {
    throw new Error('custom-content-router-dependencies-required');
  }
  let uploadInflight = 0;
  const uploadOwners = new Set();

  async function admit(owner, res, scope, limit, windowSeconds, globalLimit = null) {
    if (!rateLimit) return true;
    try {
      const checks = [
        [owner.id, limit],
        ...(globalLimit ? [['global', globalLimit]] : []),
      ];
      for (const [subject, maximum] of checks) {
        const decision = await rateLimit({
          scope: `custom-content-${scope}${subject === 'global' ? '-global' : ''}`,
          subject,
          limit: maximum,
          windowSeconds,
        });
        if (!decision.allowed) {
          const retryAfter = Math.max(1, decision.retryAfterSeconds || 1);
          send(res, 429, { error: 'rate-limited', retryAfter }, { 'Retry-After': String(retryAfter) });
          return false;
        }
      }
      return true;
    } catch {
      send(res, 503, { error: 'rate-limit-unavailable' });
      return false;
    }
  }

  async function withOwner(req, res, operation, task) {
    let owner;
    try {
      owner = await resolveOwner(req, res, operation);
    } catch (error) {
      req.resume();
      logger.error?.(`[custom-content] ${operation} owner resolution failed:`, errorCode(error));
      if (!res.headersSent) return send(res, 503, { error: 'custom-content-auth-unavailable' });
      return;
    }
    if (!owner) {
      req.resume();
      return;
    }
    try {
      return await task(owner, requestId(req));
    } catch (error) {
      const status = errorStatus(error);
      const code = errorCode(error);
      if (status >= 500) logger.error?.(`[custom-content] ${operation}:`, code);
      return send(res, status, { error: status >= 500 && code === 'custom-content-failed' ? 'custom-content-failed' : code });
    }
  }

  async function jsonBody(req, res, limit = JSON_LIMIT) {
    if (hasJsonContentType && !hasJsonContentType(req)) {
      send(res, 415, { error: 'json-required' });
      return null;
    }
    try {
      const body = await readJson(req, limit);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        send(res, 400, { error: 'json-object-required' });
        return null;
      }
      return body;
    } catch (error) {
      send(res, error?.message === 'body-too-large' ? 413 : 400, { error: errorCode(error) });
      return null;
    }
  }

  async function withOwnerJson(req, res, operation, task) {
    return withOwner(req, res, operation, async (owner, traceId) => {
      const body = await jsonBody(req, res);
      if (body === null) return;
      return task(owner, traceId, body);
    });
  }

  return Object.freeze({
    async handle(req, res, pathname) {
      if (pathname === '/api/xb/status' && req.method === 'GET') {
        return withOwner(req, res, 'custom-status', async () => send(res, 200, await service.status()));
      }

      if (pathname === '/api/xb/courses' && req.method === 'GET') {
        return withOwner(req, res, 'custom-courses-list', async (owner) => (
          send(res, 200, { courses: await service.listCourses(owner) })
        ));
      }
      if (pathname === '/api/xb/courses' && req.method === 'POST') {
        return withOwnerJson(req, res, 'custom-course-create', async (owner, traceId, body) => {
          if (!await admit(owner, res, 'course-create', 10, 86_400, 100)) return;
          return send(res, 201, { course: await service.createCourse(owner, body.title, traceId) });
        });
      }

      const courseMatch = /^\/api\/xb\/courses\/([^/]+)$/.exec(pathname);
      if (courseMatch && req.method === 'GET') {
        return withOwner(req, res, 'custom-course-get', async (owner) => (
          send(res, 200, { course: await service.getCourse(owner, decodeURIComponent(courseMatch[1])) })
        ));
      }

      const courseJobMatch = /^\/api\/xb\/courses\/([^/]+)\/compile-job$/.exec(pathname);
      if (courseJobMatch && req.method === 'GET') {
        return withOwner(req, res, 'custom-course-compile-job', async (owner) => (
          send(res, 200, {
            job: await service.getCourseCompileJob(owner, decodeURIComponent(courseJobMatch[1])),
          })
        ));
      }

      const assetsMatch = /^\/api\/xb\/courses\/([^/]+)\/assets$/.exec(pathname);
      if (assetsMatch && req.method === 'GET') {
        return withOwner(req, res, 'custom-assets-list', async (owner) => (
          send(res, 200, {
            assets: await service.listAssets(owner, decodeURIComponent(assetsMatch[1])),
          })
        ));
      }
      if (assetsMatch && req.method === 'POST') {
        return withOwner(req, res, 'custom-asset-upload', async (owner, traceId) => {
          if (uploadInflight >= 2 || uploadOwners.has(owner.id)) {
            req.resume();
            return send(res, 429, { error: 'upload-busy', retryAfter: 5 }, { 'Retry-After': '5' });
          }
          if (!await admit(owner, res, 'asset-upload', 30, 86_400, 300)) {
            req.resume();
            return;
          }
          uploadInflight += 1;
          uploadOwners.add(owner.id);
          try {
            const upload = await multipartUpload(req, readRaw, service.maxFileBytes);
            const asset = await service.uploadAsset(
              owner,
              decodeURIComponent(assetsMatch[1]),
              { ...upload, requestId: traceId },
            );
            return send(res, 202, { asset });
          } finally {
            uploadInflight -= 1;
            uploadOwners.delete(owner.id);
          }
        });
      }

      const assetMatch = /^\/api\/xb\/assets\/([^/]+)$/.exec(pathname);
      if (assetMatch && req.method === 'GET') {
        return withOwner(req, res, 'custom-asset-get', async (owner, traceId) => (
          send(res, 200, {
            asset: await service.getAsset(owner, decodeURIComponent(assetMatch[1]), traceId),
          })
        ));
      }
      if (assetMatch && req.method === 'DELETE') {
        return withOwner(req, res, 'custom-asset-delete', async (owner, traceId) => (
          send(res, 200, await service.deleteAsset(owner, decodeURIComponent(assetMatch[1]), traceId))
        ));
      }

      const reparseMatch = /^\/api\/xb\/assets\/([^/]+)\/reparse$/.exec(pathname);
      if (reparseMatch && req.method === 'POST') {
        return withOwner(req, res, 'custom-asset-reparse', async (owner, traceId) => {
          if (!await admit(owner, res, 'asset-reparse', 20, 86_400, 200)) return;
          return send(res, 202, {
            asset: await service.reparseAsset(owner, decodeURIComponent(reparseMatch[1]), traceId),
          });
        });
      }

      if (pathname === '/api/xb/topics/compile' && req.method === 'POST') {
        return withOwnerJson(req, res, 'custom-topic-compile', async (owner, _traceId, body) => {
          if (!await admit(owner, res, 'topic-compile', 12, 86_400, 120)) return;
          return send(res, 202, { job: await service.startCompile(owner, body) });
        });
      }

      const jobMatch = /^\/api\/xb\/compile-jobs\/([^/]+)$/.exec(pathname);
      if (jobMatch && req.method === 'GET') {
        return withOwner(req, res, 'custom-compile-job', async (owner) => (
          send(res, 200, { job: await service.getCompileJob(owner, decodeURIComponent(jobMatch[1])) })
        ));
      }

      if (pathname === '/api/xb/topics' && req.method === 'GET') {
        return withOwner(req, res, 'custom-topics-list', async (owner) => (
          send(res, 200, { topics: await service.listPublishedTopics(owner) })
        ));
      }

      const sourceCandidatesMatch = /^\/api\/xb\/topics\/([^/]+)\/source-candidates$/.exec(pathname);
      if (sourceCandidatesMatch && req.method === 'POST') {
        return withOwnerJson(req, res, 'custom-topic-source-candidates', async (owner, traceId, body) => {
          if (!await admit(owner, res, 'source-search', 120, 86_400, 1_200)) return;
          return send(res, 200, {
            candidates: await service.findSourceCandidates(
              owner,
              decodeURIComponent(sourceCandidatesMatch[1]),
              body,
              traceId,
            ),
          });
        });
      }

      const evaluateTopicMatch = /^\/api\/xb\/topics\/([^/]+)\/evaluate$/.exec(pathname);
      if (evaluateTopicMatch && req.method === 'POST') {
        return withOwnerJson(req, res, 'custom-topic-evaluate', async (owner, traceId, body) => {
          if (!await admit(owner, res, 'semantic-evaluate', 2_000, 86_400, 20_000)) return;
          return send(res, 200, {
            evaluation: await service.evaluateTopic(
              owner,
              decodeURIComponent(evaluateTopicMatch[1]),
              body,
              traceId,
            ),
          });
        });
      }

      const draftMatch = /^\/api\/xb\/topics\/([^/]+)\/draft$/.exec(pathname);
      if (draftMatch && req.method === 'PUT') {
        return withOwnerJson(req, res, 'custom-topic-draft', async (owner, traceId, body) => (
          send(res, 200, {
            topic: await service.updateDraft(owner, decodeURIComponent(draftMatch[1]), body.draft, traceId),
          })
        ));
      }
      if (draftMatch && req.method === 'DELETE') {
        return withOwner(req, res, 'custom-topic-discard', async (owner) => (
          send(res, 200, await service.discardDraft(owner, decodeURIComponent(draftMatch[1])))
        ));
      }

      const publishMatch = /^\/api\/xb\/topics\/([^/]+)\/publish$/.exec(pathname);
      if (publishMatch && req.method === 'POST') {
        return withOwner(req, res, 'custom-topic-publish', async (owner, traceId) => (
          send(res, 200, {
            topic: await service.publishTopic(owner, decodeURIComponent(publishMatch[1]), traceId),
          })
        ));
      }

      const teacherTopicMatch = /^\/api\/xb\/topics\/([^/]+)\/teacher$/.exec(pathname);
      if (teacherTopicMatch && req.method === 'GET') {
        return withOwner(req, res, 'custom-topic-teacher', async (owner) => (
          send(res, 200, {
            topic: await service.getTeacherTopic(owner, decodeURIComponent(teacherTopicMatch[1])),
          })
        ));
      }

      const topicMatch = /^\/api\/xb\/topics\/([^/]+)$/.exec(pathname);
      if (topicMatch && req.method === 'GET') {
        return withOwner(req, res, 'custom-topic-get', async (owner) => (
          send(res, 200, {
            topic: await service.getPublishedTopic(owner, decodeURIComponent(topicMatch[1])),
          })
        ));
      }

      return send(res, 404, { error: 'not-found' });
    },
  });
}
