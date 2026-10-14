import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { articleFromHtml, externalUrl, fetchPublic, publicAddress } from './reader/importer.mjs';
import { createReaderRepository } from './reader/repository.mjs';
import { createReaderRouter, validateReaderDocument } from './reader/router.mjs';

test('reader refuses private, encoded, mapped, reserved addresses and unsafe URLs before connecting', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '198.18.0.1', '::1', '::ffff:8.8.8.8', 'fc00::1', '2001:db8::1', '224.0.0.1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  for (const url of ['http://2130706433/', 'file:///etc/passwd', 'http://localhost/', 'https://user:pass@example.com/', 'https://example.com:8000/']) assert.throws(() => externalUrl(url));
  await assert.rejects(fetchPublic('https://example.com', { lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] }), /private/);
});

test('article extraction keeps paragraphs, figures and tables without executable markup', () => {
  const html = '<html><head><title>Scientific reading</title></head><body><article><h1>Scientific reading</h1><p>' + 'This is a sufficiently long explanatory paragraph about the scientific method and evidence. '.repeat(8) + '</p><img src="https://example.com/figure.png" alt="Experiment"/><table><tr><th>Trial</th><th>Result</th></tr><tr><td>1</td><td>42</td></tr></table><script>secret()</script></article></body></html>';
  const result = articleFromHtml(html, 'https://example.com/article');
  assert.ok(result.blocks.some((b) => b.kind === 'image'));
  assert.ok(result.blocks.some((b) => b.kind === 'table' && b.text.includes('42')));
  assert.ok(result.blocks.every((b) => !b.text.includes('secret()')));
});

test('reader documents validate shape and reject executable covers or oversized content', () => {
  const doc = { id: randomUUID(), title: 'Test', blocks: [{ id: 'p1', kind: 'paragraph', text: 'Evidence' }], marks: [], threads: [] };
  assert.equal(validateReaderDocument(doc).wordCount, 8);
  assert.throws(() => validateReaderDocument({ ...doc, cover: 'javascript:alert(1)' }));
  assert.throws(() => validateReaderDocument({ ...doc, blocks: [{ id: 'p1', kind: 'iframe', text: '' }] }));
  assert.throws(() => validateReaderDocument({ ...doc, title: 'x'.repeat(501) }));
});

test('reader storage passes owner on every query and rejects stale revisions', async () => {
  const calls = [];
  const repo = createReaderRepository({ query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } });
  const owner = randomUUID(), id = randomUUID();
  await repo.list(owner); await repo.get(owner, id); await repo.tokens(owner); await repo.tokenRevoke(owner, id);
  assert.ok(calls.every((call) => call.values[0] === owner));
  await assert.rejects(repo.put(owner, { id }, 3), /reader-conflict/);
  assert.equal(calls.at(-1).values[3], 3);
  const token = await repo.tokenCreate(owner, 'Test client');
  assert.match(token.token, /^xbr_/); assert.notEqual(calls.at(-1).values[3], token.token);
  assert.equal(await repo.tokenOwner('invalid'), null);
});

test('reader endpoints require account identity; MCP requires a separate token', async (t) => {
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const repo = { list: async () => [], tokenOwner: async () => null };
  const router = createReaderRouter({ repository: repo, resolveOwner: async (req, res) => { send(res, 401, { error: 'login-required' }); return null; }, send, readJson: async () => ({}) });
  const server = http.createServer((req, res) => void router.handle(req, res, req.url));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/api/reader/documents`)).status, 401);
  assert.equal((await fetch(`${url}/api/reader/mcp`, { method: 'POST', headers: { Authorization: 'Bearer forged' } })).status, 401);
});
