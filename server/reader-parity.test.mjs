import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGlossHtml, fetchGlossArticle, normalizeArticleUrl } from './reader/gloss-fetch.mjs';
import { createGlossMcp, GLOSS_MCP_TOOLS } from './reader/gloss-mcp.mjs';
import { searchQuery } from './reader/gloss-prompts.mjs';

test('Gloss page extraction restores streamed text, metadata, relative links and data tables', () => {
  const text = '这是一段足够长的中文正文，说明为什么阅读需要证据和推理，并保留原始段落以及数据表格。';
  const html = `<html><head><title>中文阅读</title><meta property="article:published_time" content="2024-03-02"/><meta property="og:site_name" content="阅读测试"/></head><body><main><article><!--$?--><template id="B:0"></template><p>Loading</p><!--/$--><div hidden id="S:0"><h1>中文阅读</h1><p>${text}<a href="/evidence">查看证据</a></p><table class="sidebar navigation"><tr><th>指标</th><th>数值</th></tr><tr><td>阅读</td><td>42</td></tr></table><p>${text}</p></div></article></main></body></html>`;
  const article = parseGlossHtml(html, 'https://example.com/read');
  assert.equal(article.published, '2024');
  assert.equal(article.source, '阅读测试');
  assert.ok(article.blocks.some(b => b.type === 'table' && JSON.stringify(b.rows).includes('42')));
  assert.ok(article.blocks.some(b => b.runs.some(r => r.href === 'https://example.com/evidence')));
  assert.ok(article.blocks.every(b => !b.runs.some(r => /Loading/.test(r.text))));
  assert.ok(!article.blocks[0].type.startsWith('h'));
  assert.equal(article.dek, undefined);
});

test('Gloss importer keeps SSRF checks and distinguishes browser PDFs from agent HTML', async () => {
  let calls = [];
  const fetcher = async url => { calls.push(url); return { url, contentType: 'application/pdf', bytes: Buffer.from('%PDF-test') }; };
  await assert.rejects(fetchGlossArticle('http://127.0.0.1/private', { fetcher }));
  assert.equal(calls.length, 0);
  const result = await fetchGlossArticle('https://arxiv.org/abs/2610.07469', { fetcher });
  assert.ok(result.pdf); assert.equal(calls[0], 'https://arxiv.org/pdf/2610.07469');
  await assert.rejects(fetchGlossArticle('https://arxiv.org/abs/2610.07469', { pdf: false, fetcher }), /PDF/);
  assert.equal(calls[1], 'https://arxiv.org/html/2610.07469');
  assert.equal(normalizeArticleUrl('https://www.example.com/a/?utm_source=x#end'), 'https://example.com/a');
});

test('fact-check follow-ups search the newest question with the selected passage', () => {
  assert.equal(searchQuery({ action: 'check', quote: 'first claim', question: 'original' }, 'new claim'), 'new claim (about: "first claim")');
  assert.equal(searchQuery({ action: 'check', quote: 'first claim' }), 'first claim');
});

function harness() {
  const rows = new Map(); const docs = new Map();
  const gloss = {
    list: async owner => { assert.equal(owner, 'owner'); return [...rows.values()]; },
    article: async (owner, id) => { assert.equal(owner, 'owner'); return docs.get(id); },
    put: async (owner, collection, row) => { assert.equal(owner, 'owner'); rows.set(`${collection}:${row.id}`, { ...row, collection, deleted: false }); if (row.doc) docs.set(row.id, row.doc); return 1; },
  };
  let body; let response;
  const mcp = createGlossMcp({
    repository: { tokenIdentity: async token => token === 'valid' ? { owner: 'owner', label: '测试助手' } : null, list: async () => [] },
    postgres: { gloss, withTransaction: async fn => fn({ gloss }) },
    env: { PUBLIC_ORIGIN: 'https://reader.example' }, readJson: async () => body, quota: () => {},
    classify: async () => ({ topic: 'learning', tags: ['笔记'], scene: 'An open book' }),
    send: (_res, status, data) => { response = { status, data }; },
  });
  const request = async (value, token = 'valid') => {
    body = value; response = undefined;
    await mcp({ method: 'POST', headers: { authorization: `Bearer ${token}` } }, { writeHead: status => { response = { status }; }, end() {} });
    return response;
  };
  return { request, rows, docs };
}

test('MCP negotiates original versions, accepts batches and preserves tool schemas', async () => {
  const { request } = harness();
  const { data } = await request([{ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { method: 'notifications/initialized' }, { id: 2, method: 'tools/list' }]);
  assert.equal(data.length, 2); assert.equal(data[0].result.protocolVersion, '2025-06-18');
  const specs = data[1].result.tools;
  assert.deepEqual(specs.find(s => s.name === 'save_text').inputSchema.required, ['text']);
  for (const key of ['author', 'source', 'published']) assert.ok(specs.find(s => s.name === 'save_text').inputSchema.properties[key]);
  for (const key of ['topic', 'status', 'limit']) assert.ok(specs.find(s => s.name === 'search_library').inputSchema.properties[key]);
  assert.equal(GLOSS_MCP_TOOLS.length, 4);
  assert.equal((await request({ method: 'notifications/initialized' })).status, 202);
  assert.equal((await request({ id: 1, method: 'ping' }, 'revoked')).status, 401);
});

test('MCP saves native Markdown, provenance and metadata; filters and duplicate detection survive', async () => {
  const { request, docs, rows } = harness();
  const text = '# 中文标题\n\n一段 **重点** 和 [证据](https://example.com)。\n\n## 第二节\n\n| 项目 | 数量 |\n| --- | --- |\n| 书籍 | 3 |';
  const invoke = (name, args) => request({ id: 1, method: 'tools/call', params: { name, arguments: args } });
  const saved = await invoke('save_text', { text, author: '作者', source: '出处', published: '2024-03-02', url: 'https://www.example.com/source?utm_source=qa' });
  assert.equal(saved.data.result.structuredContent.status, 'saved');
  const doc = [...docs.values()][0]; const item = [...rows.values()][0].data;
  assert.equal(doc.title, '中文标题'); assert.equal(doc.author, '作者'); assert.equal(item.addedVia, '测试助手'); assert.equal(item.year, 2024);
  assert.ok(doc.blocks.some(b => b.type === 'table'));
  assert.ok(doc.blocks.some(b => b.runs.some(r => r.strong)));
  assert.equal((await invoke('save_text', { text, url: 'https://example.com/source' })).data.result.structuredContent.status, 'already_saved');
  assert.equal(docs.size, 1);
  assert.equal((await invoke('list_topics', {})).data.result.structuredContent.topics.find(t => t.key === 'learning').count, 1);
  assert.equal((await invoke('search_library', { query: '重点', topic: 'learning', status: 'unread', limit: 1 })).data.result.structuredContent.total, 1);
  assert.equal((await invoke('search_library', { status: 'finished' })).data.result.structuredContent.total, 0);
});
