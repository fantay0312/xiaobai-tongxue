import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomContentService } from './custom-content/service.mjs';
import { createCustomContentRouter } from './custom-content/router.mjs';
import { rankStudySources } from './custom-content/study-sources.mjs';

function fixture() {
  const seen = [];
  const asset = { id: 'asset-a', wkKnowledgeId: 'wk-a', filename: 'lecture.pdf', parseStatus: 'completed' };
  const service = createCustomContentService({
    repository: {
      courses: { findOwned: async (owner, id) => owner === 'alice' && id === 'course-a' ? { id } : null },
      assets: { listOwned: async (owner, course) => { assert.equal(owner, 'alice'); assert.equal(course, 'course-a'); return [asset]; }, findManyByCourse: async (course, ids) => { assert.equal(course, 'course-a'); assert.deepEqual(ids, ['asset-a']); return [asset, { ...asset, id: 'other-asset', wkKnowledgeId: 'forbidden' }]; } },
      topics: { findReadyOwnedByTopicId: async (owner, id) => owner === 'alice' && id === 'custom-a' ? { courseId: 'course-a', payload: { sources: [{ assetId: 'asset-a' }] } } : null },
      jobs: {},
    },
    weknora: { createKnowledgeBase() {}, uploadFile() {}, findKnowledgeByMetadata() {}, isTerminalParseStatus: (status) => status === 'completed', async listChunks(id) { seen.push(id); return [{ id: 'c1', content: '注意力根据查询与键的匹配程度，对值做加权组合。' }]; } },
    cos: { createCustomCourseAssetKey() {}, uploadCustomCourseAsset() {}, verifySize() {}, delete() {} },
    compiler: { compile() {} }, embeddingModelId: 'test-only',
  });
  return { service, seen };
}

test('study sources are scoped to the authenticated owner and published topic assets', async () => {
  const { service, seen } = fixture();
  await assert.rejects(service.findStudySources({ id: 'bob' }, 'custom-a', { query: '注意力' }), /topic-not-found/);
  assert.deepEqual(seen, []);
  const sources = await service.findStudySources({ id: 'alice' }, 'custom-a', { query: '注意力为什么要加权' }, 'trace');
  assert.deepEqual(seen, ['wk-a']);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].filename, 'lecture.pdf');
  assert.equal(sources[0].assetId, 'asset-a');
  await assert.rejects(service.findStudySources({ id: 'alice' }, 'custom-a', { query: '' }), /study-query-invalid/);
});

test('ranking is bounded, deduplicated, and does not manufacture sources for unrelated questions', () => {
  const groups = [{ asset: { id: 'a', filename: 'a.pdf' }, chunks: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, content: '注意力查询和键'.repeat(2000) })) }];
  assert.equal(rankStudySources('注意力查询', groups).length, 5);
  assert.ok(rankStudySources('注意力查询', groups).every((item) => item.excerpt.length <= 1400));
  assert.deepEqual(rankStudySources('火山', groups), []);
  assert.equal(rankStudySources('注意力', [{ ...groups[0], chunks: [groups[0].chunks[0], groups[0].chunks[0]] }]).length, 1);
  const lateMatch = rankStudySources('attention', [{ asset: groups[0].asset, chunks: [{ id: 'late', content: `${'x'.repeat(5000)} attention is all you need` }] }]);
  assert.match(lateMatch[0].excerpt, /attention is all you need/);
});

test('notebook source inventory is owner-scoped and empty selection does not retrieve all assets', async () => {
  const { service, seen } = fixture();
  await assert.rejects(service.listStudyMaterials({ id: 'bob' }, 'custom-a'), /topic-not-found/);
  assert.deepEqual(seen, []);
  const materials = await service.listStudyMaterials({ id: 'alice' }, 'custom-a', 'trace');
  assert.equal(materials.length, 1);
  assert.equal(materials[0].id, 'asset:asset-a');
  assert.match(materials[0].content, /注意力/);
  assert.doesNotMatch(JSON.stringify(materials), /wk-a|forbidden/);
  seen.length = 0;
  assert.deepEqual(await service.findStudySources({ id: 'alice' }, 'custom-a', { query: '注意力', assetIds: [] }), []);
  assert.deepEqual(seen, []);
  await assert.rejects(service.findStudySources({ id: 'alice' }, 'custom-a', { query: '注意力', assetIds: ['foreign'] }), /study-source-invalid/);
});

test('study source route rejects anonymous callers and honors the shared rate limiter', async () => {
  let owner = null;
  let reads = 0;
  let result;
  const router = createCustomContentRouter({
    service: { maxFileBytes: 100, findStudySources() { throw new Error('must not run'); } },
    resolveOwner: async () => {
      if (!owner) result = { status: 401, body: { error: 'login-required' } };
      return owner;
    },
    readJson: async () => { reads += 1; return { query: '注意力' }; }, readRaw: async () => Buffer.alloc(0),
    send: (_response, status, body) => { result = { status, body }; },
    rateLimitMany: async () => ({ allowed: false, retryAfterSeconds: 3 }),
  });
  const call = () => router.handle({ method: 'POST', headers: {}, resume() {} }, {}, '/api/xb/topics/custom-a/study-sources');
  await call();
  assert.equal(result.status, 401); assert.equal(reads, 0);
  owner = { id: 'alice' }; await call();
  assert.equal(result.status, 429);
});

test('bilingual formula queries prefer explanation over repeated attention headings', () => {
  const chunks=[
    ...Array.from({length:18},(_,i)=>({id:`heading-${i}`,content:'Scaled Dot-Product Attention and Multi-Head Attention.'})),
    {id:'reason',content:'Large dk makes dot products larger and softmax gradients small; scale by √\ndk.'},
    {id:'dimensions',content:'Use h=8 heads and dk=dv=64.'},
  ];
  const result=rankStudySources('Scaled Dot-Product Attention 为什么除以 sqrt(d_k)，d_k=64？',[{asset:{id:'a',filename:'paper.pdf'},chunks}]);
  assert.ok(result.slice(0,3).some(x=>x.chunkId==='reason'));
  assert.ok(result.slice(0,3).some(x=>x.chunkId==='dimensions'));
});
