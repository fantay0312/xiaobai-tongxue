import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyInboundWebhookError } from './inbound-webhook-response.mjs';

test('permanent inbound policy rejections are acknowledged without provider retries', () => {
  for (const message of [
    'too-many-attachments',
    'email-body-too-large',
    'attachment-too-large',
    'attachments-total-too-large',
    'inbound-recipient-unmapped',
    'resend-attachments-pagination-required',
  ]) {
    assert.deepEqual(classifyInboundWebhookError(new Error(message)), {
      logLevel: 'warn',
      message,
      statusCode: 200,
      body: { ok: true, status: 'policy-rejected' },
    });
  }
});

test('signature failures return 400 and infrastructure failures remain retryable', () => {
  assert.equal(
    classifyInboundWebhookError(new Error('missing-webhook-signature')).statusCode,
    400,
  );
  assert.deepEqual(classifyInboundWebhookError(new Error('database-down')), {
    logLevel: 'error',
    message: 'database-down',
    statusCode: 503,
    body: { error: 'inbound-email-failed' },
  });
  assert.equal(
    classifyInboundWebhookError(new Error('inbound-email-busy')).statusCode,
    503,
  );
  assert.equal(
    classifyInboundWebhookError(new Error('attachment-size-mismatch')).statusCode,
    503,
  );
});
