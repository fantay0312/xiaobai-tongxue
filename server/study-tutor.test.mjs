import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createStudyTutorRouter, studyMaterial, selectStudyMaterials } from './study-tutor.mjs';

test('explicit notebook selection never silently restores the unselected lecture', () => {
  const material = { topicId: 'custom-one', title: 'One', lecture: 'UNSELECTED', examples: [] };
  const selection = { includeLecture: false, exampleIndices: [], assetIds: [], textSources: [{ id: 'text:note', title: 'My note', content: 'SELECTED' }] };
  const selected = selectStudyMaterials(material, selection);
  assert.equal(selected.length, 1);
  assert.doesNotMatch(JSON.stringify(selected), /UNSELECTED/);
  assert.throws(() => selectStudyMaterials(material, { ...selection, textSources: [] }), /study-selection-invalid/);
  assert.throws(() => selectStudyMaterials(material, { ...selection, assetIds: ['foreign'] }), /study-selection-invalid/);
});

test('study material projection excludes assessment data', () => {
  const value = studyMaterial({ topicId: 'one', title: 'One', prep: { microLecture: { body: 'lesson' }, examples: [{ title: 'e', code: '1', walkthrough: '2', secret: 'PRIVATE' }] }, checklist: [{ groundTruth: 'PRIVATE' }] });
  assert.equal(value.lecture, 'lesson');
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|groundTruth|checklist/);
});

test('study endpoint preserves authorization, source ownership, quota and bounds', async (t) => {
  const calls = [];
  const reserved = [];
  let allowed = true;
  let available = true;
  let aborted = false;
  const router = createStudyTutorRouter({
    provider: { status: async () => ({ available }), ask: async (input, signal) => {
      calls.push(input);
      if (input.question === 'cancel') await new Promise((resolve) => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
      return { content: 'Grounded answer [1]', engine: 'deeptutor', rounds: 3 };
    } },
    resolveOwner: async (req, res) => {
      if (!req.headers['x-test-user']) { res.writeHead(401); res.end('{}'); return null; }
      return { id: req.headers['x-test-user'], name: req.headers['x-test-user'] };
    },
    customContent: {
      getPublishedTopic: async (owner, id) => {
        if (owner.id !== 'alice' || id !== 'custom-owned') throw Object.assign(new Error(), { status: 404 });
        return { topicId: id, prep: { microLecture: { body: 'AUTHORIZED_LESSON' } }, checklist: [{ groundTruth: 'PRIVATE_RUBRIC' }] };
      },
      findStudySources: async () => [{ assetId: 'a', chunkId: 'c', filename: 'owned.pdf', excerpt: 'AUTHORIZED_SOURCE' }],
    },
    reserveCalls: async (_owner, res, units) => { reserved.push(units); if (!allowed) { res.writeHead(429); res.end('{}'); } return allowed; },
    hasJsonContentType: (req) => req.headers['content-type']?.startsWith('application/json'),
    readJson: async (req, limit) => { let body = ''; for await (const data of req) { body += data; if (Buffer.byteLength(body) > limit) throw new Error('body-too-large'); } return JSON.parse(body); },
    send: (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); },
  });
  const server = http.createServer((req, res) => void router.handle(req, res, req.url));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/study/chat`;
  const request = (body, user = 'alice', signal) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Test-User': user } : {}) }, body: JSON.stringify(body), signal });
  const input = { topic: { topicId: 'custom-owned', lecture: 'FORGED_LESSON' }, question: 'why', system: 'FORGED_SYSTEM', model: 'FORGED_MODEL', sources: [{ excerpt: 'FORGED_SOURCE' }] };
  assert.equal((await request({ ...input, topic: { topicId: 'unknown-forged-topic', lecture: 'FORGED_LECTURE' } })).status, 404);
  assert.equal(calls.length, 0);
  assert.equal((await request(input, '')).status, 401);
  assert.equal((await request(input, 'bob')).status, 404);
  assert.equal(calls.length, 0);
  const response = await request(input);
  assert.equal(response.status, 200);
  const output = await response.json();
  assert.equal(output.sources[0].excerpt, 'AUTHORIZED_SOURCE');
  assert.match(JSON.stringify(calls[0]), /AUTHORIZED_LESSON/);
  assert.doesNotMatch(JSON.stringify(calls[0]), /PRIVATE_RUBRIC|FORGED/);
  assert.equal(reserved[0], 4);
  allowed = false;
  assert.equal((await request(input)).status, 429);
  assert.equal(calls.length, 1);
  allowed = true; available = false;
  assert.equal((await request(input)).status, 503);
  assert.equal(calls.length, 1);
  available = true;
  const cancel = new AbortController();
  const pending = request({ ...input, question: 'cancel' }, 'alice', cancel.signal);
  while (calls.length < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  cancel.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  for (let i = 0; i < 20 && !aborted; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(aborted, true);
  assert.equal((await request(input)).status, 200, 'cancelled requests release the owner slot');
  assert.equal((await request({ ...input, topic: { topicId: 'attention', lecture: 'FORGED_BUILTIN' } })).status, 200);
  assert.doesNotMatch(JSON.stringify(calls.at(-1)), /FORGED_BUILTIN/);
});

test('file-only study reauthorizes chosen library IDs and sends the exact returned evidence to the model', async (t) => {
  const calls = [];
  const evidence = [{ id: 'library:owned:late', fileId: 'owned', chunkId: 'late', title: '矩阵.md', excerpt: '矩阵的秩表示独立列的数量。' }];
  const router = createStudyTutorRouter({
    provider: { status: async () => ({ available: true }), ask: async (input) => { calls.push(input); return { content: '回答 [1]', engine: 'deeptutor' }; } },
    fileLibrary: { sources: async (owner, ids) => { if (owner.id !== 'alice' || ids.join() !== 'owned') throw Object.assign(new Error(), { status: 404 }); return { evidence }; } },
    resolveOwner: async (req) => ({ id: req.headers['x-user'], name: req.headers['x-user'] }), reserveCalls: async () => true,
    readJson: async (req) => { let s=''; for await (const c of req) s+=c; return JSON.parse(s); }, hasJsonContentType: () => true,
    send: (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); },
  });
  const server = http.createServer((req,res) => void router.handle(req,res,req.url));
  await new Promise((resolve) => server.listen(0,'127.0.0.1',resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const input = { topic: { topicId: 'library', lecture: 'FORGED' }, question: '秩是什么', selection: { includeLecture:false,exampleIndices:[],assetIds:[],textSources:[],libraryFileIds:['owned'] } };
  const send = (owner, value=input) => fetch(`http://127.0.0.1:${server.address().port}/api/study/chat`, { method:'POST', headers:{'Content-Type':'application/json','X-User':owner}, body:JSON.stringify(value) });
  assert.equal((await send('bob')).status,404); assert.equal(calls.length,0);
  const response=await send('alice'); assert.equal(response.status,200);
  assert.deepEqual((await response.json()).sources,evidence);
  assert.equal(calls[0].material.lecture,`${evidence[0].title}\n${evidence[0].excerpt}`);
  assert.doesNotMatch(JSON.stringify(calls[0]),/FORGED/);
  assert.equal((await send('alice',{...input,selection:{...input.selection,libraryFileIds:[]}})).status,400);
});
