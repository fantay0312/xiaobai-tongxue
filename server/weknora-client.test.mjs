import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createWeKnoraClient } from './custom-content/weknora-client.mjs';

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
