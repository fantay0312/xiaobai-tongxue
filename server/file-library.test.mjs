import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createLocalLibraryStore } from './file-library/local-store.mjs';
import { createFileLibraryService } from './file-library/service.mjs';
import { createFileLibraryRouter } from './file-library/router.mjs';

const alice = { id: '11111111-1111-4111-8111-111111111111' };
const bob = { id: '22222222-2222-4222-8222-222222222222' };

test('duplicate library parsing reuses the canonical asset before downloading the original', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xb-reuse-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const local = await createLocalLibraryStore(root);
  const file = await createFileLibraryService(local).upload(alice, {name:'copy.txt',bytes:Buffer.from('same file')});
  let reads = 0, uploads = 0;
  local.blobs.read = async () => { reads++; throw new Error('unnecessary download'); };
  const service = createFileLibraryService({...local,customContent:{
    findLibraryAsset:async()=>null,
    reuseLibraryAsset:async(owner,id,token)=>{assert.equal(owner.id,alice.id);assert.equal(id,file.id);assert.ok(token);return {id:'shared-asset',parseStatus:'completed'};},
    parseLibraryFile:async()=>{uploads++;throw new Error('unnecessary parsing');},
  }});
  assert.equal((await service.parse(alice,file.id)).assetId,'shared-asset');
  assert.equal(reads,0);assert.equal(uploads,0);
  assert.equal((await service.list(alice)).entries[0].parse.status,'completed');
});

test('legacy file list reports the parser state instead of presenting completed files as unparsed', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xb-status-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  let status='pending';
  const service=createFileLibraryService({...await createLocalLibraryStore(root),customContent:{
    listLibraryFiles:async()=>[{assetId:'asset',courseId:'course',courseTitle:'Course',name:'file.txt',parseStatus:status,byteSize:1}],
  }});
  assert.equal((await service.list(alice)).entries.find(e=>e.kind==='file').parse.status,'pending');
  status='completed';
  assert.equal((await service.list(alice)).entries.find(e=>e.kind==='file').parse.status,'completed');
});

test('two parse starts may run together while the global ingestion limit stays at two', async () => {
  let release;const gate=new Promise(resolve=>{release=resolve;});let starts=0;const statuses=[];
  const router=createFileLibraryRouter({service:{parse:async()=>{starts++;await gate;return {status:'pending'};}},
    resolveOwner:async()=>alice,send:(_r,status)=>statuses.push(status),readJson:async()=>({})});
  const req={method:'POST'};
  const a=router.handle(req,{},'/api/library/files/11111111-1111-4111-8111-111111111111/parse');
  const b=router.handle(req,{},'/api/library/files/22222222-2222-4222-8222-222222222222/parse');
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(starts,2);
  await router.handle(req,{},'/api/library/files/33333333-3333-4333-8333-333333333333/parse');
  assert.deepEqual(statuses,[429]);release();await Promise.all([a,b]);
  assert.deepEqual(statuses.sort(),[201,201,429]);
});

test('an old status poll cannot overwrite a newer reparse state', async (t) => {
  const root=await mkdtemp(path.join(os.tmpdir(),'xb-poll-race-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const local=await createLocalLibraryStore(root);
  const file=await createFileLibraryService(local).upload(alice,{name:'poll.txt',bytes:Buffer.from('text')});
  await local.metadata.mutate(alice.id,entries=>{entries[0].parse={assetId:'asset',status:'completed',updatedAt:'old'};});
  let release,started;const gate=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{started=resolve;});
  const service=createFileLibraryService({...local,customContent:{getAsset:async()=>{started();await gate;return{id:'asset',parseStatus:'completed'};}}});
  const read=service.parseState(alice,file.id);
  await entered;
  await local.metadata.mutate(alice.id,entries=>{entries[0].parse={assetId:'asset',status:'pending',updatedAt:'new'};});
  release();
  assert.equal((await read).status,'pending');
  assert.equal((await local.metadata.list(alice.id))[0].parse.status,'pending');
});

test('file library stores original bytes, preserves folders through restart, isolates users and restores trash', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xb-library-')); t.after(() => rm(root, { recursive: true, force: true }));
  const local = await createLocalLibraryStore(root); const imported = [];
  const service = createFileLibraryService({ ...local, customContent: { async validateLibraryCourse() {}, async findLibraryAsset() { return null; }, async parseLibraryFile(owner, input) { imported.push({ owner, input }); return { id: 'course-asset', parseStatus: 'completed' }; }, async attachLibraryAsset() {}, async getAsset() { return { id: 'course-asset', parseStatus: 'completed' }; } } });
  const folder = await service.folder(alice, { name: '课程', parentId: null });
  const child = await service.folder(alice, { name: '数学', parentId: folder.id });
  await assert.rejects(service.update(alice, folder.id, { parentId: child.id }), /library-folder-cycle/);
  await assert.rejects(service.folder(bob, { name: '越权', parentId: folder.id }), /library-folder-not-found/);
  const bytes = Buffer.from('原始内容\nHello, files!\n');
  const file = await service.upload(alice, { name: '笔记.txt', parentId: child.id, bytes, contentType: 'text/plain' });
  assert.equal(file.objectKey, undefined); assert.deepEqual((await service.content(alice, file.id)).bytes, bytes);
  await assert.rejects(service.content(bob, file.id), /library-entry-not-found/);
  await assert.rejects(service.update(alice, child.id, { trashed: true }), /library-folder-not-empty/);
  await service.update(alice, file.id, { parentId: null, name: '复习.txt', favorite: true });
  const restarted = createFileLibraryService(await createLocalLibraryStore(root));
  assert.equal((await restarted.list(alice)).entries.find((entry) => entry.id === file.id).name, '复习.txt');
  await service.importCourse(alice, file.id, { courseId: 'course-one' });
  assert.deepEqual(imported[0].input.bytes, bytes);
  assert.deepEqual((await service.content(alice, file.id)).bytes, bytes, 'course import keeps the original');
  await service.update(alice, file.id, { trashed: true });
  await assert.rejects(service.content(alice, file.id), /library-file-not-found/);
  await service.update(alice, file.id, { trashed: false });
  assert.deepEqual((await service.content(alice, file.id)).bytes, bytes);
  await service.update(alice, child.id, { trashed: true });
  await service.update(alice, child.id, { trashed: false });
  assert.equal((await service.list(bob)).entries.length, 0);
});

test('file library HTTP requires auth and downloads exact bytes with safe headers', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xb-library-http-')); t.after(() => rm(root, { recursive: true, force: true }));
  const service = createFileLibraryService(await createLocalLibraryStore(root));
  const router = createFileLibraryRouter({ service,
    resolveOwner: async (req, res) => { if (req.headers['x-test-user']) return alice; res.writeHead(401); res.end('{}'); return null; },
    send: (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); },
    readJson: async (req) => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body); },
    readRaw: async (req, max) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); const bytes = Buffer.concat(chunks); if (bytes.length > max) throw new Error('body-too-large'); return bytes; },
  });
  const server = http.createServer((req, res) => void router.handle(req, res, new URL(req.url, 'http://localhost').pathname));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const rootUrl = `http://127.0.0.1:${server.address().port}/api/library`;
  assert.equal((await fetch(rootUrl)).status, 401);
  const bytes = Buffer.from('<script>not executed</script>\n');
  const upload = await fetch(`${rootUrl}/files`, { method: 'POST', headers: { 'X-Test-User': 'alice', 'X-File-Name': encodeURIComponent('资料.txt'), 'Content-Type': 'text/plain' }, body: bytes });
  assert.equal(upload.status, 201); const file = (await upload.json()).entry;
  const download = await fetch(`${rootUrl}/files/${file.id}/content`, { headers: { 'X-Test-User': 'alice' } });
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff'); assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.match(download.headers.get('content-disposition'), /^attachment/); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
});

test('legacy originals join folders once; removing an imported file does not resurrect it; sync failures keep saved files usable', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xb-legacy-')); t.after(() => rm(root, { recursive: true, force: true }));
  const local = await createLocalLibraryStore(root); const bytes = Buffer.from('existing course original');
  let syncFails = false; let reads = 0;
  const source = { assetId: 'legacy-1', courseId: 'course-1', courseTitle: '数学', name: '讲义.md', byteSize: bytes.length, sha256: (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex') };
  const service = createFileLibraryService({ ...local, customContent: {
    async listLibraryFiles() { if (syncFails) throw new Error('offline'); return [source]; },
    async readLibraryFile(owner, id) { assert.equal(owner.id, alice.id); assert.equal(id, 'legacy-1'); reads++; return bytes; },
    async getAsset() { return { id: 'legacy-1', parseStatus: 'completed' }; }, async validateLibraryCourse() {}, async findLibraryAsset() { return null; }, async parseLibraryFile() { throw new Error('should reuse'); }, async adoptLibraryAsset() { return { id: 'legacy-1', parseStatus: 'completed' }; }, async attachLibraryAsset() {}, async deleteLibraryAsset() {},
  } });
  const first = await service.list(alice); const file = first.entries.find((entry) => entry.sourceAssetId);
  assert.equal(first.entries.find((entry) => entry.kind === 'folder').name, '数学');
  assert.equal((await service.list(alice)).entries.length, 2);
  assert.deepEqual((await service.content(alice, file.id)).bytes, bytes);
  assert.equal((await service.importCourse(alice, file.id, { courseId: 'course-1' })).assetId, 'legacy-1');
  await service.update(alice, file.id, { trashed: true }); await service.purge(alice, file.id);
  assert.equal((await service.list(alice)).entries.some((entry) => entry.sourceAssetId === source.assetId), false);
  // Also retain every course binding when a vault-native original is purged.
  const own = await service.upload(alice, { name: '本地.txt', bytes: Buffer.from('mine') });
  await local.metadata.mutate(alice.id, (entries) => { entries.find((e) => e.id === own.id).courseImports = [{ courseId: source.courseId, assetId: source.assetId }]; });
  await service.update(alice, own.id, { trashed: true }); await service.purge(alice, own.id);
  syncFails = true; const degraded = await service.list(alice);
  assert.ok(degraded.syncWarning); assert.equal(degraded.entries.filter((entry) => entry.kind === 'folder').length, 1); assert.ok(reads > 0);
});

test('purge records a durable intent before deleting bytes; cleanup cannot delete a newly ready upload', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'xb-reconcile-')); t.after(() => rm(root, { recursive: true, force: true }));
  const local = await createLocalLibraryStore(root); const service = createFileLibraryService(local);
  const file = await service.upload(alice, { name: '保留.txt', bytes: Buffer.from('keep') });
  let deletes = 0; const oldDelete = local.blobs.delete; local.blobs.delete = async (args) => { deletes++; return oldDelete(args); };
  const oldPending = local.metadata.pendingBefore;
  local.metadata.pendingBefore = async () => [{ userId: alice.id, entries: [{ ...(await local.metadata.list(alice.id))[0], phase: 'pending' }] }];
  await service.reconcile(); assert.equal(deletes, 0, 'stale snapshot cannot remove ready bytes');
  local.metadata.pendingBefore = oldPending;
  await service.update(alice, file.id, { trashed: true });
  const oldMutate = local.metadata.mutate; let calls = 0;
  local.metadata.mutate = async (...args) => { calls++; if (calls === 2) throw new Error('commit-failed'); return oldMutate(...args); };
  await assert.rejects(service.purge(alice, file.id), /commit-failed/);
  assert.equal((await local.metadata.list(alice.id))[0].phase, 'purging');
  await assert.rejects(service.update(alice, file.id, { trashed: false }), /library-upload-pending/);
  local.metadata.mutate = oldMutate;
  await service.purge(alice, file.id); assert.equal((await service.list(alice)).entries.length, 0);
});

test('asynchronous rate limits cannot admit concurrent uploads or imports from the same owner', async () => {
  let release; const gate = new Promise((resolve) => { release = resolve; }); let admitted = 0;
  const statuses = []; const service = { maxFileBytes: 100, async upload() { admitted++; return {}; }, async importCourse() { admitted++; return {}; } };
  const router = createFileLibraryRouter({ service, resolveOwner: async () => alice,
    rateLimit: async () => { await gate; return { allowed: true }; },
    send: (_res, status) => { statuses.push(status); }, readRaw: async () => Buffer.from('x'), readJson: async () => ({ courseId: 'x' }),
  });
  const req = { method: 'POST', url: '/api/library/files', headers: { 'x-file-name': 'x.txt' } };
  const first = router.handle(req, {}, '/api/library/files');
  await Promise.resolve(); await Promise.resolve();
  await router.handle(req, {}, '/api/library/files');
  await router.handle(req, {}, '/api/library/files/11111111-1111-4111-8111-111111111111/course');
  release(); await first;
  assert.equal(admitted, 1); assert.deepEqual(statuses.sort(), [201, 429, 429]);
});

test('purge recovers canonical parse identity after catalog registration failed', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(),'xb-parse-commit-')); t.after(() => rm(root,{recursive:true,force:true}));
  const local = await createLocalLibraryStore(root); let canonical = null; let deleted = 0;
  const service = createFileLibraryService({...local,customContent:{
    findLibraryAsset: async () => canonical,
    parseLibraryFile: async () => { canonical={id:'canonical',parseStatus:'completed'}; return canonical; },
    deleteLibraryAsset: async (_owner,id) => { assert.equal(id,'canonical'); canonical=null; deleted++; },
  }});
  const file=await service.upload(alice,{name:'lesson.txt',bytes:Buffer.from('original')});
  const original=local.metadata.mutate; let calls=0;
  local.metadata.mutate=async (...args) => { if (++calls===2) throw new Error('catalog-commit-failed'); return original(...args); };
  await assert.rejects(service.parse(alice,file.id),/catalog-commit-failed/);
  local.metadata.mutate=original;
  assert.ok(canonical); assert.equal((await local.metadata.list(alice.id))[0].parse.assetId,undefined);
  await service.update(alice,file.id,{trashed:true}); await service.purge(alice,file.id);
  assert.equal(deleted,1); assert.equal(canonical,null); assert.equal((await service.list(alice)).entries.length,0);
});
