import { Resend } from 'resend';
import { positiveInteger, requireConfig } from './config.mjs';
import { createResendInboundProcessor } from './resend-inbound.mjs';

export function createResendInboundProcessorFromEnv(dependencies = {}, env = process.env) {
  const apiKey = requireConfig(env, 'RESEND_API_KEY');
  const webhookSecret = requireConfig(env, 'RESEND_WEBHOOK_SECRET');
  return createResendInboundProcessor({
    ...dependencies,
    resend: dependencies.resend ?? new Resend(apiKey),
    webhookSecret,
    maxAttachmentBytes: positiveInteger(
      env.RESEND_MAX_ATTACHMENT_BYTES,
      10 * 1024 * 1024,
      'RESEND_MAX_ATTACHMENT_BYTES',
      40 * 1024 * 1024,
    ),
    maxAttachments: positiveInteger(
      env.RESEND_MAX_ATTACHMENTS, 10, 'RESEND_MAX_ATTACHMENTS', 100,
    ),
    maxTotalAttachmentBytes: positiveInteger(
      env.RESEND_MAX_TOTAL_ATTACHMENT_BYTES,
      25 * 1024 * 1024,
      'RESEND_MAX_TOTAL_ATTACHMENT_BYTES',
      100 * 1024 * 1024,
    ),
    maxBodyBytes: positiveInteger(
      env.RESEND_MAX_BODY_BYTES,
      2 * 1024 * 1024,
      'RESEND_MAX_BODY_BYTES',
      10 * 1024 * 1024,
    ),
    maxConcurrent: positiveInteger(
      env.RESEND_MAX_CONCURRENT, 4, 'RESEND_MAX_CONCURRENT', 20,
    ),
    userDailyMessageLimit: positiveInteger(
      env.RESEND_USER_DAILY_MESSAGE_LIMIT,
      50,
      'RESEND_USER_DAILY_MESSAGE_LIMIT',
      10_000,
    ),
    userDailyByteLimit: positiveInteger(
      env.RESEND_USER_DAILY_BYTE_LIMIT,
      100 * 1024 * 1024,
      'RESEND_USER_DAILY_BYTE_LIMIT',
      10 * 1024 ** 3,
    ),
    globalDailyMessageLimit: positiveInteger(
      env.RESEND_GLOBAL_DAILY_MESSAGE_LIMIT,
      200,
      'RESEND_GLOBAL_DAILY_MESSAGE_LIMIT',
      100_000,
    ),
    globalDailyByteLimit: positiveInteger(
      env.RESEND_GLOBAL_DAILY_BYTE_LIMIT,
      500 * 1024 * 1024,
      'RESEND_GLOBAL_DAILY_BYTE_LIMIT',
      10 * 1024 ** 3,
    ),
    downloadTimeoutMs: positiveInteger(
      env.RESEND_DOWNLOAD_TIMEOUT_MS,
      15_000,
      'RESEND_DOWNLOAD_TIMEOUT_MS',
      120_000,
    ),
  });
}
