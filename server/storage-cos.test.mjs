import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPrivateCosStore,
  createPrivateCosStoreFromEnv,
} from './storage/cos-store.mjs';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';

class FakeCos {
  calls = [];

  async putObject(parameters) {
    this.calls.push({ method: 'putObject', parameters });
    return { ETag: '"etag"', VersionId: 'version-1' };
  }

  async getObject(parameters) {
    this.calls.push({ method: 'getObject', parameters });
    if (parameters.Range) {
      return {
        Body: Buffer.from('s'),
        headers: { 'content-range': 'bytes 0-0/8', 'content-type': 'application/pdf', etag: '"etag"' },
      };
    }
    return {
      Body: Buffer.from('stored'),
      headers: { 'content-type': 'application/pdf', etag: '"etag"' },
    };
  }

  async deleteObject(parameters) {
    this.calls.push({ method: 'deleteObject', parameters });
    return {};
  }

  async headBucket(parameters) {
    this.calls.push({ method: 'headBucket', parameters });
    return {};
  }
}

test('COS store creates random private SSE keys scoped to the user UUID', async () => {
  const cos = new FakeCos();
  const store = createPrivateCosStore({
    cos,
    bucket: 'xiaobai-1250000000',
    region: 'ap-guangzhou',
    randomBytes: () => Buffer.alloc(16, 0xab),
  });
  const uploaded = await store.uploadTranscript({
    userId: USER_ID,
    body: Buffer.from('pdf-data'),
    contentType: 'application/pdf',
    originalName: '成绩单.pdf',
  });
  assert.equal(
    uploaded.key,
    `xiaobai/users/${USER_ID}/transcripts/${'ab'.repeat(16)}`,
  );
  const put = cos.calls.find((call) => call.method === 'putObject').parameters;
  assert.equal(put.ACL, 'private');
  assert.equal(put.ServerSideEncryption, 'AES256');
  assert.equal(put.ContentLength, 8);
  assert.equal('GrantRead' in put, false);
  assert.notEqual(put.ACL, 'public-read');
  assert.equal(uploaded.publicUrl, undefined);

  const custom = await store.uploadCustomCourseAsset({
    userId: USER_ID,
    courseId: '33333333-3333-4333-8333-333333333333',
    body: Buffer.from('pdf-data'),
    contentType: 'application/pdf',
  });
  assert.equal(
    custom.key,
    `xiaobai/users/${USER_ID}/custom-course-assets/33333333-3333-4333-8333-333333333333/${'ab'.repeat(16)}`,
  );
  assert.equal((await store.verifySize({ userId: USER_ID, key: custom.key })).byteSize, 8);

  const read = await store.read({ userId: USER_ID, key: uploaded.key });
  assert.equal(read.body.toString(), 'stored');
  await store.delete({ userId: USER_ID, key: uploaded.key });
  await assert.rejects(
    store.read({ userId: OTHER_USER_ID, key: uploaded.key }),
    /invalid-cos-key/,
  );
  assert.equal((await store.healthCheck()).healthy, true);
});

test('COS configuration and bodies fail closed', async () => {
  assert.throws(() => createPrivateCosStoreFromEnv({}), /COS_SECRET_ID/);
  const store = createPrivateCosStore({
    cos: new FakeCos(),
    bucket: 'xiaobai-1250000000',
    region: 'ap-guangzhou',
    randomBytes: () => Buffer.alloc(16),
    maxObjectBytes: 3,
  });
  await assert.rejects(store.uploadEmailAttachment({
    userId: USER_ID,
    body: Buffer.from('four'),
    contentType: 'text/plain',
  }), /invalid-object-size/);
  await assert.rejects(store.uploadEmailAttachment({
    userId: USER_ID,
    body: Buffer.from('x'),
    contentType: 'text/plain\npublic-read',
  }), /invalid-content-type/);
});
