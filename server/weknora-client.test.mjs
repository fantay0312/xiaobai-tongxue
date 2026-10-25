import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createWeKnoraClient } from './custom-content/weknora-client.mjs';
import { sourceCacheOptions } from './custom-content/source-cache.mjs';

async function withServer(handler, task) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    return await task(`http://127.0.0.1:${port}/api/v1`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('500 chunks use stable page offsets without duplicates or omitted last-page chunks', async () => {
  const sizes = [];
  await withServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const size = Number(url.searchParams.get('page_size'));
    const page = Number(url.searchParams.get('page'));
    sizes.push(size);
    const start = (page - 1) * size;
    const items = Array.from({ length: Math.min(size, 500 - start) }, (_, index) => ({ id: String(start + index), content: 'source' }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { items, total: 500 } }));
  }, async (baseUrl) => {
    const client = createWeKnoraClient({ baseUrl, apiKey: 'test' });
    const chunks = await client.listChunks('document', '', 500);
    assert.deepEqual(chunks.map((chunk) => chunk.id), Array.from({ length: 500 }, (_, index) => String(index)));
  });
  assert.deepEqual(sizes, [200, 200, 200]);
});

test('WeKnora client sends API key, request id and exact hybrid query_text contract', async () => {
  const requests = [];
  await withServer(async (req, res) => {
    const raw = await body(req);
    requests.push({ url: req.url, method: req.method, headers: req.headers, raw });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: [{ id: 'chunk-1', content: '命中正文' }] }));
  }, async (baseUrl) => {
    const client = createWeKnoraClient({ baseUrl, apiKey: 'wk-test-key' });
    const hits = await client.hybridSearch({
      kbId: 'kb-1', queryText: '浅拷贝', knowledgeIds: ['knowledge-1'], requestId: 'trace-1',
    });
    assert.equal(hits[0].id, 'chunk-1');
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/v1/knowledge-bases/kb-1/hybrid-search');
  assert.equal(requests[0].headers['x-api-key'], 'wk-test-key');
  assert.equal(requests[0].headers['x-request-id'], 'trace-1');
  const payload = JSON.parse(requests[0].raw.toString('utf8'));
  assert.equal(payload.query_text, '浅拷贝');
  assert.equal(Object.hasOwn(payload, 'query'), false);
  assert.deepEqual(payload.knowledge_ids, ['knowledge-1']);
});

test('WeKnora knowledge-base creation preserves the caller-supplied id', async () => {
  const id = '88888888-8888-4888-8888-888888888888';
  let payload = null;
  await withServer(async (req, res) => {
    payload = JSON.parse((await body(req)).toString('utf8'));
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: payload }));
  }, async (baseUrl) => {
    const client = createWeKnoraClient({ baseUrl, apiKey: 'wk-test-key' });
    const created = await client.createKnowledgeBase({ id, name: 'idempotent-kb', type: 'document' }, 'kb-create');
    assert.equal(created.id, id);
  });
  assert.equal(payload.id, id);
});

test('WeKnora upload uses multipart file and process_config without exposing key in body', async () => {
  let captured;
  await withServer(async (req, res) => {
    captured = { headers: req.headers, raw: await body(req) };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: { id: 'knowledge-1', parse_status: 'pending', enable_status: 'disabled' },
    }));
  }, async (baseUrl) => {
    const client = createWeKnoraClient({ baseUrl, apiKey: 'wk-private-key' });
    const result = await client.uploadFile('kb-1', {
      bytes: Buffer.from('%PDF-1.7\ntest'),
      filename: '讲义.pdf',
      contentType: 'application/pdf',
      processConfig: { graph_enabled: false },
      requestId: 'trace-upload',
    });
    assert.equal(result.id, 'knowledge-1');
  });
  assert.match(captured.headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.equal(Number(captured.headers['content-length']), captured.raw.length);
  const wire = captured.raw.toString('utf8');
  assert.match(wire, /name="file"; filename="[^"]+"/);
  assert.match(wire, /name="process_config"/);
  assert.match(wire, /graph_enabled/);
  assert.doesNotMatch(wire, /wk-private-key/);
});

test('WeKnora client reconciles an ambiguous upload by private metadata marker', async () => {
  let requestedUrl = '';
  await withServer(async (req, res) => {
    requestedUrl = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: [{ id: 'knowledge-ambiguous', metadata: { xiaobai_upload_marker: 'marker-1' } }],
      total: 1,
    }));
  }, async (baseUrl) => {
    const client = createWeKnoraClient({ baseUrl, apiKey: 'wk-private-key' });
    const found = await client.findKnowledgeByMetadata({
      kbId: 'kb-1', key: 'xiaobai_upload_marker', value: 'marker-1', maximumWaitMs: 0,
    });
    assert.equal(found.id, 'knowledge-ambiguous');
  });
  assert.equal(requestedUrl, '/api/v1/knowledge-bases/kb-1/knowledge?page=1&page_size=200');
});

test('WeKnora client turns upstream pages into stable errors', async () => {
  await withServer(async (_req, res) => {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end('<h1>private upstream detail</h1>');
  }, async (baseUrl) => {
    const client = createWeKnoraClient({ baseUrl, apiKey: 'wk-test-key' });
    await assert.rejects(
      client.getKnowledge('knowledge-1'),
      (error) => error.message === 'weknora-upstream-failed' && !error.message.includes('private'),
    );
  });
});

test('WeKnora client accepts only an explicit api/v1 base and private HTTP transport', () => {
  assert.throws(
    () => createWeKnoraClient({ baseUrl: 'http://127.0.0.1:8180', apiKey: 'test-key' }),
    /weknora-base-url-invalid/,
  );
  assert.throws(
    () => createWeKnoraClient({ baseUrl: 'http://example.com/api/v1', apiKey: 'test-key' }),
    /weknora-base-url-insecure/,
  );
});

test('WeKnora FAQ import wait accepts underscored task ids and resolves on completed', async () => {
  // 线上 task_id 形如 faq_import_10000_1788102686874_bc594e7e_1f07dec6e6e;旧正则不含 "_" 会把成功导入判成 invalid
  const polls = [];
  await withServer(async (req, res) => {
    polls.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { status: polls.length === 1 ? 'processing' : 'completed', added_count: 3 } }));
  }, async (baseUrl) => {
    const client = createWeKnoraClient({ baseUrl, apiKey: 'wk-test-key' });
    const done = await client.waitForFaqImport('faq_import_10000_1788102686874_bc594e7e_1f07dec6e6e', 'trace-faq');
    assert.equal(done.added_count, 3);
    await assert.rejects(client.waitForFaqImport('bad task/id', 'trace-faq'), /weknora-faq-task-invalid/);
  });
  assert.equal(polls.length, 2);
  assert.equal(polls[0], '/api/v1/faq/import/progress/faq_import_10000_1788102686874_bc594e7e_1f07dec6e6e');
});

test('versioned source reads share work and are invalidated by reparse', async () => {
  let reads = 0;
  await withServer(async (req, res) => {
    const chunks = req.url.startsWith('/api/v1/chunks/');
    if (chunks) reads++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: chunks ? [{ id: 'c1', content: 'source' }] : {} }));
  }, async (baseUrl) => {
    const client = createWeKnoraClient({ baseUrl, apiKey: 'test' });
    const options = { cacheKey: 'course-a:asset-a:revision-1' };
    const [first] = await Promise.all([client.listChunks('k1', 'a', 500, options), client.listChunks('k1', 'b', 500, options)]);
    assert.equal(reads, 1);
    first[0].content = 'browser-forgery';
    assert.equal((await client.listChunks('k1', 'c', 500, options))[0].content, 'source');
    await client.listChunks('k1', 'd', 500, { cacheKey: 'course-b:asset-b:revision-1' });
    assert.equal(reads, 2, 'different source scopes must not share cached evidence');
    await client.reparseKnowledge('k1', {});
    await client.listChunks('k1', 'e', 500, options);
    assert.equal(reads, 3);
  });
});

test('a failed source read is not cached and pagination shares one deadline', async () => {
  let reads = 0;
  await withServer(async (_req, res) => {
    reads++;
    res.writeHead(reads === 1 ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: reads !== 1, data: [{ id: 'c1', content: 'source' }] }));
  }, async (baseUrl) => {
    const client = createWeKnoraClient({ baseUrl, apiKey: 'test' });
    await assert.rejects(client.listChunks('k1', '', 500, { cacheKey: 'v1' }));
    assert.equal((await client.listChunks('k1', '', 500, { cacheKey: 'v1' })).length, 1);
    assert.equal(reads, 2);
  });
  await withServer(async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 70));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { items: Array.from({length:200},(_,i)=>({id:String(i),content:'s'})), total:400 } }));
  }, async (baseUrl) => {
    const client = createWeKnoraClient({ baseUrl, apiKey: 'test', chunkReadTimeoutMs: 100 });
    const start = Date.now();
    await assert.rejects(client.listChunks('slow', '', 500), /weknora-timeout/);
    assert.ok(Date.now() - start < 190, 'the second page cannot acquire another full request budget');
  });
});

test('only completed source versions are cacheable and status reads share in-flight work', async () => {
  assert.deepEqual(sourceCacheOptions({ parseStatus: 'processing', enableStatus: 'enabled' }), {});
  const asset = { id:'a',courseId:'course-a',parseStatus:'completed',enableStatus:'enabled',statusRevision:'3' };
  assert.notDeepEqual(sourceCacheOptions(asset),sourceCacheOptions({...asset,statusRevision:'4'}));
  assert.deepEqual(sourceCacheOptions(asset),sourceCacheOptions({...asset,courseId:'course-b'}), 'the same canonical source version is reused across courses');
  let calls=0;
  await withServer(async (_req,res)=>{
    calls++; await new Promise(resolve=>setTimeout(resolve,20));
    res.end(JSON.stringify({success:true,data:{id:'k1',parse_status:'completed'}}));
  },async baseUrl=>{
    const client=createWeKnoraClient({baseUrl,apiKey:'test'});
    await Promise.all([client.getKnowledge('k1'),client.getKnowledge('k1')]);
    assert.equal(calls,1);
    await client.getKnowledge('k1'); assert.equal(calls,2);
  });
});

test('FAQ progress response body stays within the whole wait budget', async () => {
  await withServer(async (_req,res)=>{
    res.writeHead(200,{'Content-Type':'application/json'}); res.flushHeaders();
    await new Promise(resolve=>setTimeout(resolve,100));
    res.end(JSON.stringify({success:true,data:{status:'processing'}}));
  },async baseUrl=>{
    const client=createWeKnoraClient({baseUrl,apiKey:'test'});
    const start=Date.now();
    await assert.rejects(client.waitForFaqImport('faq_task','trace',30),/weknora-timeout/);
    assert.ok(Date.now()-start<120);
  });
});

