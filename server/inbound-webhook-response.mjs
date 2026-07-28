const POLICY_REJECTIONS = new Set([
  'attachment-too-large',
  'attachments-total-too-large',
  'email-body-too-large',
  'inbound-recipient-unmapped',
  'invalid-attachment-size',
  'invalid-attachment-url',
  'invalid-email-html',
  'invalid-email-text',
  'invalid-resend-event',
  'resend-attachments-pagination-required',
  'too-many-attachments',
]);

export function classifyInboundWebhookError(error) {
  const message = error instanceof Error ? error.message : 'inbound-email-failed';
  const invalidSignature = message === 'missing-webhook-signature'
    || /signature|webhook-payload/i.test(message);
  if (invalidSignature) {
    return {
      logLevel: 'error',
      message,
      statusCode: 400,
      body: { error: 'invalid-webhook' },
    };
  }
  if (POLICY_REJECTIONS.has(message)) {
    return {
      logLevel: 'warn',
      message,
      statusCode: 200,
      body: { ok: true, status: 'policy-rejected' },
    };
  }
  return {
    logLevel: 'error',
    message,
    statusCode: 503,
    body: { error: 'inbound-email-failed' },
  };
}
