import assert from 'node:assert/strict';
import test from 'node:test';
import { createResendInboundProcessor } from './storage/resend-inbound.mjs';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EMAIL_ID = '22222222-2222-4222-8222-222222222222';
const INBOUND_ID = '33333333-3333-4333-8333-333333333333';

function fixture({
  transactionError = null,
  eventType = 'email.received',
  quotaAllowed = true,
} = {}) {
  const calls = [];
  const resend = {
    webhooks: {
      verify(input) {
        calls.push({ method: 'verify', input });
        return {
          type: eventType,
          data: {
            email_id: EMAIL_ID,
            created_at: '2026-07-28T00:00:00.000Z',
          },
        };
      },
    },
    emails: {
      receiving: {
        async get(id, options) {
          calls.push({ method: 'get-email', id, options });
          return {
            data: {
              id,
              from: 'teacher@example.com',
              to: ['student@mail.tokentosea.com'],
              subject: 'Transcript',
              text: 'Attached.',
              html: '<p>Attached.</p>',
              headers: { 'message-id': 'provider-message' },
              created_at: '2026-07-28T00:00:00.000Z',
            },
            error: null,
          };
        },
        attachments: {
          async list(input) {
            calls.push({ method: 'list-attachments', input });
            return {
              data: {
                object: 'list',
                has_more: false,
                data: [{
                  id: 'attachment-1',
                  filename: '成绩单.pdf',
                  content_type: 'application/pdf',
                  download_url: 'https://attachments.example.test/signed',
                  size: 8,
                }],
              },
              error: null,
            };
          },
        },
      },
    },
  };
  const createdFiles = [];
  const postgres = {
    inboundEmails: {
      async findByProviderId() {
        return null;
      },
    },
    async withTransaction(work) {
      if (transactionError) throw transactionError;
      return work({
        inboundEmails: {
          async create(input) {
            calls.push({ method: 'create-email', input });
            return { id: input.id };
          },
        },
        userFiles: {
          async create(input) {
            createdFiles.push(input);
            return input;
          },
        },
      });
    },
  };
  const deleted = [];
  const quotaReservations = [];
  const quotaStore = {
    async reserveInboundQuota(input) {
      quotaReservations.push(input);
      return { allowed: quotaAllowed, duplicateReservation: false };
    },
  };
  const cos = {
    async uploadEmailAttachment(input) {
      calls.push({ method: 'upload', input });
      return {
        key: `users/${USER_ID}/inbound-email-attachments/${'ab'.repeat(16)}`,
        byteSize: input.body.length,
      };
    },
    async delete(input) {
      deleted.push(input);
    },
  };
  const fetchImpl = async () => {
    calls.push({ method: 'download-attachment' });
    return {
      ok: true,
      headers: { get: () => '8' },
      async arrayBuffer() {
        return Buffer.from('pdf-data');
      },
    };
  };
  return {
    calls,
    cos,
    createdFiles,
    deleted,
    fetchImpl,
    postgres,
    quotaReservations,
    quotaStore,
    resend,
  };
}

test('Resend inbound verifies raw signature then stores body and attachments in PG/COS', async () => {
  const setup = fixture();
  const processor = createResendInboundProcessor({
    ...setup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
    uuid: () => INBOUND_ID,
  });
  const result = await processor.process({
    payload: '{"type":"email.received"}',
    headers: {
      'svix-id': 'msg_1',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signed',
    },
  });
  assert.deepEqual(result, {
    status: 'processed',
    inboundEmailId: INBOUND_ID,
    attachmentCount: 1,
  });
  const verification = setup.calls.find((call) => call.method === 'verify').input;
  assert.equal(verification.payload, '{"type":"email.received"}');
  assert.equal(verification.webhookSecret, 'whsec_test');
  assert.deepEqual(verification.headers, {
    id: 'msg_1',
    timestamp: '123',
    signature: 'v1,signed',
  });
  const email = setup.calls.find((call) => call.method === 'create-email').input;
  assert.equal(email.providerMessageId, EMAIL_ID);
  assert.equal(email.userId, USER_ID);
  assert.equal(setup.createdFiles.length, 1);
  assert.equal(setup.createdFiles[0].purpose, 'email_attachment');
  assert.equal(setup.createdFiles[0].sha256.length, 64);
  assert.equal(setup.deleted.length, 0);
  assert.equal(setup.quotaReservations.length, 1);
  assert.equal(setup.quotaReservations[0].bytes, 33);
  assert.equal(setup.quotaReservations[0].userCountLimit, 50);
  assert.equal(setup.quotaReservations[0].globalByteLimit, 500 * 1024 * 1024);
});

test('Resend inbound compensates COS writes when PostgreSQL fails', async () => {
  const setup = fixture({ transactionError: new Error('database-down') });
  const processor = createResendInboundProcessor({
    ...setup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
    uuid: () => INBOUND_ID,
  });
  await assert.rejects(processor.process({
    payload: '{}',
    headers: {
      'svix-id': 'msg_1',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signed',
    },
  }), /database-down/);
  assert.equal(setup.deleted.length, 1);
  assert.equal(setup.deleted[0].userId, USER_ID);
});

test('Resend inbound ignores unrelated verified events and fails closed on signature config', async () => {
  const setup = fixture({ eventType: 'email.delivered' });
  assert.throws(() => createResendInboundProcessor({
    ...setup,
    webhookSecret: '',
    resolveUserId: async () => USER_ID,
  }), /webhook-secret/);
  const processor = createResendInboundProcessor({
    ...setup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
  });
  assert.deepEqual(await processor.process({
    payload: '{}',
    headers: {
      'svix-id': 'msg_1',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signed',
    },
  }), { status: 'ignored' });
  assert.equal(setup.calls.some((call) => call.method === 'get-email'), false);
  await assert.rejects(processor.process({ payload: '{}', headers: {} }), /missing-webhook-signature/);
});

test('Resend inbound acknowledges quota rejection without writing PG or COS', async () => {
  const setup = fixture({ quotaAllowed: false });
  const processor = createResendInboundProcessor({
    ...setup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
    uuid: () => INBOUND_ID,
  });
  assert.deepEqual(await processor.process({
    payload: '{}',
    headers: {
      'svix-id': 'msg_1',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signed',
    },
  }), { status: 'quota-rejected', attachmentCount: 0 });
  assert.equal(setup.calls.some((call) => call.method === 'download-attachment'), false);
  assert.equal(setup.calls.some((call) => call.method === 'upload'), false);
  assert.equal(setup.calls.some((call) => call.method === 'create-email'), false);
});

test('Resend inbound enforces body and total attachment limits before storage', async () => {
  const bodySetup = fixture();
  const originalGet = bodySetup.resend.emails.receiving.get;
  bodySetup.resend.emails.receiving.get = async (...args) => {
    const response = await originalGet(...args);
    response.data.text = '123456';
    response.data.html = null;
    return response;
  };
  const bodyProcessor = createResendInboundProcessor({
    ...bodySetup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
    maxBodyBytes: 5,
  });
  await assert.rejects(bodyProcessor.process({
    payload: '{}',
    headers: {
      'svix-id': 'msg_1',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signed',
    },
  }), /email-body-too-large/);
  assert.equal(bodySetup.quotaReservations.length, 0);

  const attachmentSetup = fixture();
  const attachmentProcessor = createResendInboundProcessor({
    ...attachmentSetup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
    maxTotalAttachmentBytes: 7,
  });
  await assert.rejects(attachmentProcessor.process({
    payload: '{}',
    headers: {
      'svix-id': 'msg_2',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signed',
    },
  }), /attachments-total-too-large/);
  assert.equal(attachmentSetup.quotaReservations.length, 0);
  assert.equal(
    attachmentSetup.calls.some((call) => call.method === 'download-attachment'),
    false,
  );
});

test('Resend inbound rejects invalid metadata and verifies downloaded attachment size', async () => {
  const metadataSetup = fixture();
  const originalList = metadataSetup.resend.emails.receiving.attachments.list;
  metadataSetup.resend.emails.receiving.attachments.list = async (...args) => {
    const response = await originalList(...args);
    response.data.data[0].size = '8';
    return response;
  };
  const metadataProcessor = createResendInboundProcessor({
    ...metadataSetup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
  });
  await assert.rejects(metadataProcessor.process({
    payload: '{}',
    headers: {
      'svix-id': 'msg_1',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signed',
    },
  }), /invalid-attachment-size/);
  assert.equal(metadataSetup.quotaReservations.length, 0);
  assert.equal(
    metadataSetup.calls.some((call) => call.method === 'download-attachment'),
    false,
  );

  const emptySetup = fixture();
  const originalEmptyList = emptySetup.resend.emails.receiving.attachments.list;
  emptySetup.resend.emails.receiving.attachments.list = async (...args) => {
    const response = await originalEmptyList(...args);
    response.data.data[0].size = 0;
    return response;
  };
  const emptyProcessor = createResendInboundProcessor({
    ...emptySetup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
  });
  await assert.rejects(emptyProcessor.process({
    payload: '{}',
    headers: {
      'svix-id': 'msg_empty',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signed',
    },
  }), /invalid-attachment-size/);
  assert.equal(emptySetup.quotaReservations.length, 0);
  assert.equal(emptySetup.calls.some((call) => call.method === 'download-attachment'), false);

  const mismatchSetup = fixture();
  mismatchSetup.fetchImpl = async () => ({
    ok: true,
    headers: { get: () => null },
    async arrayBuffer() {
      return Buffer.from('short');
    },
  });
  const mismatchProcessor = createResendInboundProcessor({
    ...mismatchSetup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
  });
  await assert.rejects(mismatchProcessor.process({
    payload: '{}',
    headers: {
      'svix-id': 'msg_2',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signed',
    },
  }), /attachment-size-mismatch/);
  assert.equal(mismatchSetup.quotaReservations.length, 1);
});

test('Resend inbound streams attachment bodies instead of buffering unbounded responses', async () => {
  const setup = fixture();
  let readCount = 0;
  setup.fetchImpl = async () => ({
    ok: true,
    headers: { get: () => '8' },
    body: {
      getReader() {
        const chunks = [Buffer.from('pdf-'), Buffer.from('data')];
        return {
          async read() {
            const value = chunks[readCount];
            readCount += 1;
            return value ? { done: false, value } : { done: true, value: undefined };
          },
          async cancel() {},
        };
      },
    },
    async arrayBuffer() {
      throw new Error('arrayBuffer-must-not-run');
    },
  });
  const processor = createResendInboundProcessor({
    ...setup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
    uuid: () => INBOUND_ID,
  });
  const result = await processor.process({
    payload: '{}',
    headers: {
      'svix-id': 'msg_stream',
      'svix-timestamp': '123',
      'svix-signature': 'v1,signed',
    },
  });
  assert.equal(result.status, 'processed');
  assert.equal(readCount, 3);
  assert.equal(setup.calls.some((call) => call.method === 'upload'), true);
});

test('Resend inbound caps concurrent webhook processing', async () => {
  const setup = fixture({ eventType: 'email.delivered' });
  const originalVerify = setup.resend.webhooks.verify;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  setup.resend.webhooks.verify = async (...args) => {
    await gate;
    return originalVerify(...args);
  };
  const processor = createResendInboundProcessor({
    ...setup,
    webhookSecret: 'whsec_test',
    resolveUserId: async () => USER_ID,
    maxConcurrent: 1,
  });
  const headers = {
    'svix-id': 'msg_1',
    'svix-timestamp': '123',
    'svix-signature': 'v1,signed',
  };
  const first = processor.process({ payload: '{}', headers });
  await assert.rejects(
    processor.process({ payload: '{}', headers }),
    /inbound-email-busy/,
  );
  release();
  assert.deepEqual(await first, { status: 'ignored' });
});
