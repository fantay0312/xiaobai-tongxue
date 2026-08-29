import crypto from 'node:crypto';
import COS from 'cos-nodejs-sdk-v5';
import { assertUuid } from './contact-crypto.mjs';
import { positiveInteger, requireConfig } from './config.mjs';

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,48}-\d{5,}$/;
const REGION_PATTERN = /^[a-z]{2}-[a-z0-9-]{2,40}$/;
const PREFIX_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,120}$/;
const CONTENT_TYPE_PATTERN = /^[\x21-\x7e]{1,255}$/;
const PURPOSE_PATHS = Object.freeze({
  transcript: 'transcripts',
  email_attachment: 'inbound-email-attachments',
});

function requireCosConfig(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`invalid-config:${label}`);
  return value;
}

function asBody(value, maximumBytes) {
  let body;
  if (Buffer.isBuffer(value)) body = value;
  else if (value instanceof Uint8Array) body = Buffer.from(value);
  else if (typeof value === 'string') body = Buffer.from(value, 'utf8');
  else throw new Error('invalid-object-body');
  if (body.length === 0 || body.length > maximumBytes) throw new Error('invalid-object-size');
  return body;
}

function safeContentType(value) {
  if (typeof value !== 'string' || !CONTENT_TYPE_PATTERN.test(value)) {
    throw new Error('invalid-content-type');
  }
  return value;
}

function userPrefix(rawUserId) {
  return `users/${assertUuid(rawUserId, 'user-id')}/`;
}

function normalizedPrefix(value) {
  const prefix = String(value ?? 'xiaobai').replace(/^\/+|\/+$/g, '');
  if (!PREFIX_PATTERN.test(prefix) || prefix.includes('..') || prefix.includes('//')) {
    throw new Error('invalid-config:COS_PREFIX');
  }
  return prefix;
}

function assertOwnedKey(rawUserId, rootPrefix, key) {
  const prefix = `${rootPrefix}/${userPrefix(rawUserId)}`;
  const escapedRoot = rootPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `^${escapedRoot}/users/[0-9a-f-]{36}/(?:`
    + '[a-z-]+/[0-9a-f]{32}'
    + '|custom-course-assets/[0-9a-f-]{36}/[0-9a-f]{32}'
    + ')$',
  );
  if (typeof key !== 'string' || !key.startsWith(prefix) || key.includes('..')
    || !pattern.test(key)) {
    throw new Error('invalid-cos-key');
  }
  return key;
}

export function createPrivateCosStore({
  cos,
  bucket,
  region,
  prefix = 'xiaobai',
  randomBytes = crypto.randomBytes,
  maxObjectBytes = 80 * 1024 * 1024,
} = {}) {
  if (!cos?.putObject || !cos?.getObject || !cos?.deleteObject) {
    throw new Error('cos-client-required');
  }
  const safeBucket = requireCosConfig(bucket, BUCKET_PATTERN, 'COS_BUCKET');
  const safeRegion = requireCosConfig(region, REGION_PATTERN, 'COS_REGION');
  const safePrefix = normalizedPrefix(prefix);
  const maximumBytes = positiveInteger(maxObjectBytes, undefined, 'COS_MAX_OBJECT_BYTES', 100 * 1024 * 1024);

  async function put(key, rawBody, contentType) {
    const body = asBody(rawBody, maximumBytes);
    const result = await cos.putObject({
      Bucket: safeBucket,
      Region: safeRegion,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: safeContentType(contentType),
      ACL: 'private',
      ServerSideEncryption: 'AES256',
    });
    return {
      key,
      etag: result?.ETag ?? null,
      versionId: result?.VersionId ?? null,
      byteSize: body.length,
    };
  }

  async function upload(purpose, { userId: rawUserId, body, contentType }) {
    const userId = assertUuid(rawUserId, 'user-id');
    const purposePath = PURPOSE_PATHS[purpose];
    if (!purposePath) throw new Error('invalid-file-purpose');
    const random = randomBytes(16);
    if (!Buffer.isBuffer(random) || random.length !== 16) throw new Error('cos-random-source-failed');
    const key = `${safePrefix}/users/${userId}/${purposePath}/${random.toString('hex')}`;
    return put(key, body, contentType);
  }

  function customCourseAssetKey(rawUserId, rawCourseId) {
    const userId = assertUuid(rawUserId, 'user-id');
    const courseId = assertUuid(rawCourseId, 'course-id');
    const random = randomBytes(16);
    if (!Buffer.isBuffer(random) || random.length !== 16) throw new Error('cos-random-source-failed');
    return `${safePrefix}/users/${userId}/custom-course-assets/${courseId}/${random.toString('hex')}`;
  }

  return Object.freeze({
    maxObjectBytes: maximumBytes,
    uploadTranscript(input) {
      return upload('transcript', input);
    },
    uploadEmailAttachment(input) {
      return upload('email_attachment', input);
    },
    createCustomCourseAssetKey({ userId, courseId }) {
      return customCourseAssetKey(userId, courseId);
    },
    uploadCustomCourseAsset({ userId: rawUserId, courseId: rawCourseId, key, body, contentType }) {
      const userId = assertUuid(rawUserId, 'user-id');
      const courseId = assertUuid(rawCourseId, 'course-id');
      const safeKey = key === undefined
        ? customCourseAssetKey(userId, courseId)
        : assertOwnedKey(userId, safePrefix, key);
      const expectedPrefix = `${safePrefix}/users/${userId}/custom-course-assets/${courseId}/`;
      if (!safeKey.startsWith(expectedPrefix)) throw new Error('invalid-cos-key');
      return put(safeKey, body, contentType);
    },
    async read({ userId, key }) {
      const safeKey = assertOwnedKey(userId, safePrefix, key);
      const result = await cos.getObject({
        Bucket: safeBucket,
        Region: safeRegion,
        Key: safeKey,
      });
      return {
        body: result.Body,
        contentType: result.headers?.['content-type'] ?? null,
        etag: result.ETag ?? result.headers?.etag ?? null,
      };
    },
    async delete({ userId, key }) {
      const safeKey = assertOwnedKey(userId, safePrefix, key);
      await cos.deleteObject({ Bucket: safeBucket, Region: safeRegion, Key: safeKey });
      return true;
    },
    async verifySize({ userId, key }) {
      const safeKey = assertOwnedKey(userId, safePrefix, key);
      // 当前生产 CAM 允许 GetObject 但不开放 HeadObject。只取第 1 字节，
      // 从 Content-Range 的总长度核验完整上传，避免为 80 MiB 原件做二次下载。
      const result = await cos.getObject({
        Bucket: safeBucket,
        Region: safeRegion,
        Key: safeKey,
        Range: 'bytes=0-0',
      });
      const contentRange = String(result.headers?.['content-range'] ?? '');
      const length = Number(contentRange.split('/').at(-1));
      return {
        byteSize: Number.isSafeInteger(length) && length >= 0 ? length : null,
        contentType: result.headers?.['content-type'] ?? null,
        etag: result.ETag ?? result.headers?.etag ?? null,
      };
    },
    async healthCheck() {
      const startedAt = Date.now();
      const suffix = randomBytes(16);
      if (!Buffer.isBuffer(suffix) || suffix.length !== 16) {
        throw new Error('cos-random-source-failed');
      }
      const key = `${safePrefix}/health/${suffix.toString('hex')}`;
      await cos.putObject({
        Bucket: safeBucket,
        Region: safeRegion,
        Key: key,
        Body: Buffer.from('ok', 'utf8'),
        ContentLength: 2,
        ContentType: 'text/plain',
        ACL: 'private',
        ServerSideEncryption: 'AES256',
      });
      await cos.deleteObject({ Bucket: safeBucket, Region: safeRegion, Key: key });
      return { healthy: true, latencyMs: Date.now() - startedAt, bucket: safeBucket };
    },
  });
}

export function createPrivateCosStoreFromEnv(env = process.env, options = {}) {
  const secretId = requireConfig(env, 'COS_SECRET_ID');
  const secretKey = requireConfig(env, 'COS_SECRET_KEY');
  const bucket = requireConfig(env, 'COS_BUCKET');
  const region = requireConfig(env, 'COS_REGION');
  const prefix = env.COS_PREFIX || 'xiaobai';
  const cos = options.cos ?? new COS({
    SecretId: secretId,
    SecretKey: secretKey,
    Protocol: 'https:',
    Timeout: positiveInteger(env.COS_TIMEOUT_MS, 15_000, 'COS_TIMEOUT_MS', 120_000),
  });
  return createPrivateCosStore({
    cos,
    bucket,
    region,
    prefix,
    randomBytes: options.randomBytes,
    maxObjectBytes: positiveInteger(
      env.COS_MAX_OBJECT_BYTES,
      80 * 1024 * 1024,
      'COS_MAX_OBJECT_BYTES',
      100 * 1024 * 1024,
    ),
  });
}
