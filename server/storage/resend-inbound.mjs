import crypto from 'node:crypto';
import { assertUuid, stableUuid } from './contact-crypto.mjs';
import { positiveInteger } from './config.mjs';

function headerValue(headers, name) {
  if (headers?.get) return headers.get(name);
  if (!headers || typeof headers !== 'object') return null;
  const entry = Object.entries(headers)
    .find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] ?? null;
}

function signatureHeaders(headers) {
  const values = {
    id: headerValue(headers, 'svix-id'),
    timestamp: headerValue(headers, 'svix-timestamp'),
    signature: headerValue(headers, 'svix-signature'),
  };
  if (Object.values(values).some((value) => typeof value !== 'string' || value === '')) {
    throw new Error('missing-webhook-signature');
  }
  return values;
}

function providerResult(response, label) {
  if (!response || response.error || !response.data) throw new Error(`${label}-failed`);
  return response.data;
}

function attachmentItems(data) {
  if (!data || !Array.isArray(data.data)) throw new Error('resend-attachments-invalid');
  if (data.has_more) throw new Error('resend-attachments-pagination-required');
  return data.data;
}

function rawPayload(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  throw new Error('invalid-webhook-payload');
}

function attachmentPlans(attachments, maximumBytes, maximumTotalBytes) {
  const plans = [];
  let totalBytes = 0;
  for (const attachment of attachments) {
    const size = attachment?.size;
    if (!Number.isSafeInteger(size) || size <= 0) throw new Error('invalid-attachment-size');
    if (size > maximumBytes) throw new Error('attachment-too-large');
    totalBytes += size;
    if (totalBytes > maximumTotalBytes) throw new Error('attachments-total-too-large');
    plans.push({ attachment, size });
  }
  return { plans, totalBytes };
}

async function readAttachmentBody(response, maximumBytes) {
  if (!response.body?.getReader) {
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maximumBytes) throw new Error('attachment-too-large');
    return body;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks, total);
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('attachment-too-large');
    }
    chunks.push(chunk);
  }
}

async function downloadAttachment({
  attachment,
  expectedBytes,
  fetchImpl,
  maximumBytes,
  timeoutMs,
}) {
  let url;
  try {
    url = new URL(attachment.download_url);
  } catch {
    throw new Error('invalid-attachment-url');
  }
  if (url.protocol !== 'https:') throw new Error('invalid-attachment-url');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { 'User-Agent': 'xiaobai-gateway/1.0' },
    });
    if (!response.ok) throw new Error('attachment-download-failed');
    const lengthHeader = response.headers?.get?.('content-length');
    if (lengthHeader !== null && lengthHeader !== undefined && lengthHeader !== '') {
      const declaredLength = Number(lengthHeader);
      if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
        throw new Error('attachment-size-mismatch');
      }
      if (declaredLength > maximumBytes) throw new Error('attachment-too-large');
      if (declaredLength !== expectedBytes) throw new Error('attachment-size-mismatch');
    }
    const body = await readAttachmentBody(response, maximumBytes);
    if (body.length !== expectedBytes) throw new Error('attachment-size-mismatch');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function attachmentName(attachment) {
  const fallback = `attachment-${String(attachment.id ?? 'unknown').slice(0, 80)}`;
  const filename = typeof attachment.filename === 'string' ? attachment.filename : fallback;
  return filename.trim().normalize('NFC').slice(0, 512) || fallback;
}

function emailBodyBytes(email, maximumBytes) {
  let bytes = 0;
  for (const [label, value] of [['text', email?.text], ['html', email?.html]]) {
    if (value == null) continue;
    if (typeof value !== 'string') throw new Error(`invalid-email-${label}`);
    bytes += Buffer.byteLength(value, 'utf8');
  }
  if (bytes > maximumBytes) throw new Error('email-body-too-large');
  return bytes;
}

async function cleanupUploads(cos, userId, uploads) {
  await Promise.allSettled(uploads.map((item) => cos.delete({ userId, key: item.key })));
}

export function createResendInboundProcessor({
  resend,
  webhookSecret,
  postgres,
  cos,
  resolveUserId,
  fetchImpl = globalThis.fetch,
  uuid = stableUuid,
  maxAttachmentBytes = 10 * 1024 * 1024,
  maxAttachments = 10,
  maxTotalAttachmentBytes = 25 * 1024 * 1024,
  maxBodyBytes = 2 * 1024 * 1024,
  maxConcurrent = 4,
  quotaStore,
  userDailyMessageLimit = 50,
  userDailyByteLimit = 100 * 1024 * 1024,
  globalDailyMessageLimit = 200,
  globalDailyByteLimit = 500 * 1024 * 1024,
  downloadTimeoutMs = 15_000,
} = {}) {
  if (!resend?.webhooks?.verify || !resend?.emails?.receiving?.get
    || !resend?.emails?.receiving?.attachments?.list) {
    throw new Error('resend-client-required');
  }
  if (typeof webhookSecret !== 'string' || webhookSecret.trim() === '') {
    throw new Error('resend-webhook-secret-required');
  }
  if (!postgres?.inboundEmails || !postgres?.withTransaction) {
    throw new Error('postgres-store-required');
  }
  if (!cos?.uploadEmailAttachment || !cos?.delete) throw new Error('cos-store-required');
  if (typeof resolveUserId !== 'function') throw new Error('recipient-resolver-required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch-required');
  if (!quotaStore?.reserveInboundQuota) throw new Error('inbound-quota-store-required');
  const maximumBytes = positiveInteger(
    maxAttachmentBytes,
    undefined,
    'RESEND_MAX_ATTACHMENT_BYTES',
    40 * 1024 * 1024,
  );
  const attachmentLimit = positiveInteger(maxAttachments, undefined, 'RESEND_MAX_ATTACHMENTS', 100);
  const totalAttachmentBytes = positiveInteger(
    maxTotalAttachmentBytes,
    undefined,
    'RESEND_MAX_TOTAL_ATTACHMENT_BYTES',
    100 * 1024 * 1024,
  );
  const bodyBytesLimit = positiveInteger(
    maxBodyBytes,
    undefined,
    'RESEND_MAX_BODY_BYTES',
    10 * 1024 * 1024,
  );
  const concurrencyLimit = positiveInteger(
    maxConcurrent,
    undefined,
    'RESEND_MAX_CONCURRENT',
    20,
  );
  const timeoutMs = positiveInteger(
    downloadTimeoutMs,
    undefined,
    'RESEND_DOWNLOAD_TIMEOUT_MS',
    120_000,
  );
  const quotaLimits = {
    userCountLimit: positiveInteger(
      userDailyMessageLimit, undefined, 'RESEND_USER_DAILY_MESSAGE_LIMIT', 10_000,
    ),
    userByteLimit: positiveInteger(
      userDailyByteLimit, undefined, 'RESEND_USER_DAILY_BYTE_LIMIT', 10 * 1024 ** 3,
    ),
    globalCountLimit: positiveInteger(
      globalDailyMessageLimit, undefined, 'RESEND_GLOBAL_DAILY_MESSAGE_LIMIT', 100_000,
    ),
    globalByteLimit: positiveInteger(
      globalDailyByteLimit, undefined, 'RESEND_GLOBAL_DAILY_BYTE_LIMIT', 10 * 1024 ** 3,
    ),
  };
  let active = 0;

  return Object.freeze({
    async process({ payload, headers }) {
      if (active >= concurrencyLimit) throw new Error('inbound-email-busy');
      active += 1;
      try {
        const raw = rawPayload(payload);
        const event = await resend.webhooks.verify({
          payload: raw,
          headers: signatureHeaders(headers),
          webhookSecret,
        });
        if (event?.type !== 'email.received') return { status: 'ignored' };
        const providerMessageId = event.data?.email_id;
        if (typeof providerMessageId !== 'string' || providerMessageId === '') {
          throw new Error('invalid-resend-event');
        }
        const duplicate = await postgres.inboundEmails.findByProviderId(providerMessageId);
        if (duplicate) {
          return { status: 'duplicate', inboundEmailId: duplicate.id, attachmentCount: 0 };
        }

        const email = providerResult(
          await resend.emails.receiving.get(providerMessageId, { html_format: 'cid' }),
          'resend-email-fetch',
        );
        const attachmentPage = providerResult(
          await resend.emails.receiving.attachments.list({ emailId: providerMessageId }),
          'resend-attachment-list',
        );
        const attachments = attachmentItems(attachmentPage);
        if (attachments.length > attachmentLimit) throw new Error('too-many-attachments');
        const userId = assertUuid(await resolveUserId({ event, email }), 'user-id');
        const inboundEmailId = assertUuid(uuid(), 'inbound-email-id');
        const uploads = [];

        try {
          const bodyBytes = emailBodyBytes(email, bodyBytesLimit);
          const { plans, totalBytes: plannedAttachmentBytes } = attachmentPlans(
            attachments,
            maximumBytes,
            totalAttachmentBytes,
          );
          const quota = await quotaStore.reserveInboundQuota({
            userId,
            providerMessageId,
            bytes: bodyBytes + plannedAttachmentBytes,
            ...quotaLimits,
          });
          if (!quota.allowed) return { status: 'quota-rejected', attachmentCount: 0 };
          const downloads = [];
          for (const { attachment, size } of plans) {
            const body = await downloadAttachment({
              attachment,
              expectedBytes: size,
              fetchImpl,
              maximumBytes,
              timeoutMs,
            });
            downloads.push({ attachment, body });
          }
          for (const { attachment, body } of downloads) {
            const upload = await cos.uploadEmailAttachment({
              userId,
              body,
              contentType: attachment.content_type || 'application/octet-stream',
            });
            uploads.push({
              ...upload,
              originalName: attachmentName(attachment),
              contentType: attachment.content_type || 'application/octet-stream',
              sha256: crypto.createHash('sha256').update(body).digest('hex'),
            });
          }

          const stored = await postgres.withTransaction(async (transaction) => {
            const inbound = await transaction.inboundEmails.create({
              id: inboundEmailId,
              userId,
              providerMessageId,
              fromAddress: email.from,
              toAddresses: email.to,
              subject: email.subject || '',
              textBody: email.text || null,
              htmlBody: email.html || null,
              headers: email.headers || {},
              receivedAt: email.created_at || event.data.created_at,
            });
            if (!inbound) return null;
            for (const upload of uploads) {
              await transaction.userFiles.create({
                userId,
                inboundEmailId,
                purpose: 'email_attachment',
                cosKey: upload.key,
                originalName: upload.originalName,
                contentType: upload.contentType,
                byteSize: upload.byteSize,
                sha256: upload.sha256,
              });
            }
            return inbound;
          });
          if (!stored) {
            await cleanupUploads(cos, userId, uploads);
            const existing = await postgres.inboundEmails.findByProviderId(providerMessageId);
            return {
              status: 'duplicate',
              inboundEmailId: existing?.id ?? null,
              attachmentCount: 0,
            };
          }
          return {
            status: 'processed',
            inboundEmailId: stored.id,
            attachmentCount: uploads.length,
          };
        } catch (error) {
          await cleanupUploads(cos, userId, uploads);
          throw error;
        }
      } finally {
        active -= 1;
      }
    },
  });
}
