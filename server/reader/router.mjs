import { randomUUID } from 'node:crypto';
import { importArticle, fetchPublic } from './importer.mjs';
import { DOMParser } from 'linkedom';
import { createReaderMedia } from './media.mjs';
import { createGlossRouter } from './gloss-router.mjs';
import { createModelCatalog } from '../model-catalog.mjs';
import { createModelGatewayService } from '../model-gateway.mjs';

export const READER_TOPICS = ['unsorted', 'philosophy', 'mind', 'science', 'ai', 'programming', 'tech', 'data', 'design', 'product', 'writing', 'learning', 'history', 'culture', 'politics', 'economics', 'money', 'business', 'startups', 'work', 'health', 'living', 'climate', 'security', 'infra'];
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function validateReaderDocument(input) {
  if (!input || !UUID.test(input.id) || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500
    || !Array.isArray(input.blocks) || input.blocks.length > 10000 || !Array.isArray(input.marks) || !Array.isArray(input.threads)
    || JSON.stringify(input).length > 4_000_000 || (input.sourceUrl && !/^https?:\/\//.test(input.sourceUrl))) throw fail('reader-document-invalid');
  for (const block of input.blocks) if (typeof block.id !== 'string' || typeof block.text !== 'string' || block.text.length > 200000
    || !['paragraph', 'heading', 'code', 'table', 'image'].includes(block.kind) || (block.src && !/^https?:\/\//.test(block.src))) throw fail('reader-document-invalid');
  const blocks = new Map(input.blocks.map((block) => [block.id, block]));
  if (blocks.size !== input.blocks.length) throw fail('reader-document-invalid');
  const validAnchors = (anchors) => Array.isArray(anchors) && anchors.length <= 1000 && anchors.every((anchor) => anchor && blocks.has(anchor.block) && Number.isSafeInteger(anchor.start) && Number.isSafeInteger(anchor.end) && anchor.start >= 0 && anchor.end >= anchor.start && anchor.end <= blocks.get(anchor.block).text.length);
  for (const mark of input.marks) if (!mark || typeof mark.id !== 'string' || !validAnchors(mark.anchors) || typeof mark.quote !== 'string' || typeof mark.note !== 'string' || !['yellow', 'green', 'blue', 'pink'].includes(mark.color)) throw fail('reader-document-invalid');
  for (const thread of input.threads) if (!thread || typeof thread.id !== 'string' || !validAnchors(thread.anchors) || typeof thread.quote !== 'string' || !Array.isArray(thread.turns) || thread.turns.length > 200 || thread.turns.some((turn) => !turn || !['user', 'assistant'].includes(turn.role) || typeof turn.text !== 'string') || (thread.sources && (!Array.isArray(thread.sources) || thread.sources.length > 10 || thread.sources.some((source) => !source || typeof source.title !== 'string' || !/^https?:\/\//.test(source.url))))) throw fail('reader-document-invalid');
  if (input.marks.length > 10000 || input.threads.length > 3000 || (input.cover && !/^(data:image\/(png|jpeg|webp);base64,|https?:\/\/)/.test(input.cover))) throw fail('reader-document-invalid');
  return { id: input.id, title: input.title, author: String(input.author || '').slice(0, 500), sourceUrl: input.sourceUrl || '',
    blocks: input.blocks, marks: input.marks, threads: input.threads, topic: READER_TOPICS.includes(input.topic) ? input.topic : 'unsorted',
    tags: Array.isArray(input.tags) ? input.tags.filter((tag) => typeof tag === 'string').slice(0, 6).map((tag) => tag.slice(0, 60)) : [],
    createdAt: Number(input.createdAt) || Date.now(), updatedAt: Date.now(), progress: Math.min(1, Math.max(0, Number(input.progress) || 0)),
    favorite: input.favorite === true, deleted: input.deleted === true, agent: input.agent === true,
    brief: typeof input.brief === 'string' ? input.brief.slice(0, 80000) : '', cover: input.cover || '', pdfFileId: UUID.test(input.pdfFileId) ? input.pdfFileId : '', wordCount: Math.max(0, Math.min(3000000, Number(input.wordCount) || input.blocks.reduce((sum, block) => sum + block.text.length, 0))),
  };
}
export async function readerSearch(query, env = process.env) {
  if (env.EXA_API_KEY) {
    const response = await fetch('https://api.exa.ai/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': env.EXA_API_KEY },
      body: JSON.stringify({ query, type: 'auto', numResults: 5, contents: { text: { maxCharacters: 2200 } } }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw fail('reader-search-unavailable', 502);
    const body = await response.json();
    return (body.results || []).map((item) => ({ title: item.title, url: item.url, text: item.text || '' }));
  }
  // Public web RSS provides a working baseline without adding a billable provider.
  const result = await fetchPublic(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, { maxBytes: 500000 });
  const document = new DOMParser().parseFromString(result.bytes.toString('utf8'), 'text/xml');
  return [...document.querySelectorAll('item')].slice(0, 5).map((item) => ({ title: item.querySelector('title')?.textContent || '', url: item.querySelector('link')?.textContent || '', text: item.querySelector('description')?.textContent || '' }))
    .filter((item) => /^https?:\/\//.test(item.url));
}

export function createReaderRouter({ repository, postgres, library, cfg = {}, resolveOwner, send, readJson, readRaw, env = process.env, reserveCalls = async () => true }) {
  const media = createReaderMedia({ cfg, env });
  const modelService = cfg.apiKey && cfg.upstreamBaseUrl ? createModelGatewayService({ baseUrl: cfg.upstreamBaseUrl, apiKey: cfg.apiKey, catalog: createModelCatalog(cfg) }) : null;
  const gloss = createGlossRouter({ postgres, legacy: repository, library, modelService, media, resolveOwner, send, readJson, readRaw, reserveCalls });
  const windows = new Map();
  function quota(owner, cost = 1) {
    const now = Date.now(); const day = Math.floor(now / 86400000); const minute = Math.floor(now / 60000);
    const entry = windows.get(owner) || { day, minute, daily: 0, count: 0 };
    if (entry.day !== day) { entry.day = day; entry.daily = 0; }
    if (entry.minute !== minute) { entry.minute = minute; entry.count = 0; }
    entry.count += cost; entry.daily += cost; windows.set(owner, entry);
    if (windows.size > 10000) for (const [key, value] of windows) if (value.day < day) windows.delete(key);
    if (entry.count > 60 || entry.daily > 1000) throw fail('reader-rate-limited', 429);
  }
  async function mcp(req, res) {
    if (!repository) throw fail('reader-storage-unavailable', 503);
    const token = String(req.headers.authorization || '').replace(/^Bearer /i, '');
    const owner = await repository.tokenOwner(token);
    if (!owner) throw fail('reader-token-invalid', 401);
    if (req.headers.origin) {
      let expected; try { expected = new URL(env.PUBLIC_ORIGIN || 'https://xiaobai.tokentosea.com').origin; } catch { expected = ''; }
      if (req.headers.origin !== expected) throw fail('reader-origin-invalid', 403);
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' });
    const message = await readJson(req, 800000);
    quota(owner);
    const reply = (result) => send(res, 200, { jsonrpc: '2.0', id: message.id, result });
    if (message.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (message.method === 'initialize') return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'xiaobai-reader', version: '1.0.0' } });
    if (message.method === 'ping') return reply({});
    const specs = [
      { name: 'save_articles', description: 'Save public article URLs to the reader library', inputSchema: { type: 'object', properties: { urls: { type: 'array', items: { type: 'string' }, maxItems: 25 } }, required: ['urls'] } },
      { name: 'save_text', description: 'Save text or Markdown to the reader library', inputSchema: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, url: { type: 'string' } }, required: ['title', 'text'] } },
      { name: 'search_library', description: 'Search saved titles, text, highlights and notes', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'list_topics', description: 'List reader library topics', inputSchema: { type: 'object', properties: {} } },
    ];
    if (message.method === 'tools/list') return reply({ tools: specs });
    if (message.method !== 'tools/call') return send(res, 200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
    const { name, arguments: args = {} } = message.params || {}; let data;
    if (name === 'list_topics') data = READER_TOPICS;
    else if (name === 'search_library') {
      const query = String(args.query || '').toLowerCase().slice(0, 200);
      const list = await repository.list(owner);
      data = list.filter((doc) => !doc.deleted && `${doc.title} ${doc.tags.join(' ')}`.toLowerCase().includes(query)).slice(0, 50);
      if (data.length < 50) for (const item of list.filter((d) => !d.deleted && !data.some((x) => x.id === d.id)).slice(0, 200)) {
        const doc = await repository.get(owner, item.id);
        if (JSON.stringify([doc.blocks, doc.marks]).toLowerCase().includes(query)) data.push(item);
        if (data.length >= 50) break;
      }
      if (postgres && data.length < 50) {
        const rows = await postgres.gloss.list(owner);
        for (const row of rows.filter((r) => r.collection === 'articles' && !r.deleted)) {
          if (data.some((x) => x.id === row.id)) continue;
          const doc = await postgres.gloss.article(owner, row.id);
          if (JSON.stringify([row.data, doc, rows.filter((r) => r.articleId === row.id && !r.deleted).map((r) => r.data)]).toLowerCase().includes(query)) data.push(row.data);
          if (data.length >= 50) break;
        }
      }
    } else if (name === 'save_text' || name === 'save_articles') {
      const list = await repository.list(owner);
      if (postgres) list.push(...(await postgres.gloss.list(owner)).filter((row) => row.collection === 'articles' && !row.deleted).map((row) => row.data));
      const save = async (article) => {
        if (article.pdf) throw fail('reader-mcp-pdf-use-upload');
        const existing = article.sourceUrl && list.find((d) => !d.deleted && d.sourceUrl === article.sourceUrl);
        if (existing) return { id: existing.id, status: 'already-saved' };
        const blocks = article.blocks || String(article.text || '').split(/\n\s*\n/).filter(Boolean).map((text, index) => ({ id: `p${index + 1}`, kind: 'paragraph', text }));
        const doc = validateReaderDocument({ ...article, id: randomUUID(), blocks, marks: [], threads: [], agent: true });
        await repository.put(owner, doc); list.push(doc); return { id: doc.id, title: doc.title, status: 'saved' };
      };
      if (name === 'save_text') {
        if (typeof args.text !== 'string' || args.text.length > 400000) throw fail('reader-text-invalid');
        data = await save({ title: args.title, text: args.text, sourceUrl: args.url });
      } else {
        if (!Array.isArray(args.urls) || args.urls.length > 25) throw fail('reader-urls-invalid');
        quota(owner, args.urls.length); data = [];
        for (const url of args.urls) { try { data.push({ url, ...await save(await importArticle(url)) }); } catch (error) { data.push({ url, error: error.message }); } }
      }
    } else throw fail('reader-tool-unknown');
    return reply({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  }
  return { async handle(req, res, pathname) {
    try {
      if (pathname.startsWith('/api/reader/gloss/')) return await gloss.handle(req, res, pathname);
      if (pathname === '/api/reader/mcp' || pathname.startsWith('/api/reader/mcp/')) {
        if (pathname.startsWith('/api/reader/mcp/')) req.headers.authorization = `Bearer ${pathname.slice('/api/reader/mcp/'.length)}`;
        return await mcp(req, res);
      }
      const owner = await resolveOwner(req, res); if (!owner) return;
      const ownerId = owner.id;
      const part = pathname.slice('/api/reader'.length);
      if (req.method === 'GET' && part === '/status') return send(res, 200, { sync: !!repository, search: true, speech: !!env.READER_TTS_KEY, covers: !!env.READER_IMAGE_KEY, mcp: !!repository });
      if (part === '/import' && req.method === 'POST') {
        quota(ownerId); const { url } = await readJson(req, 10000);
        return send(res, 200, await importArticle(url));
      }
      if (part === '/search' && req.method === 'POST') {
        quota(ownerId); const { query } = await readJson(req, 10000);
        if (typeof query !== 'string' || !query.trim() || query.length > 500) throw fail('reader-query-invalid');
        return send(res, 200, { results: await readerSearch(query, env) });
      }
      if (part === '/text' && req.method === 'POST') {
        quota(ownerId); const { fileId } = await readJson(req, 1000);
        if (!UUID.test(fileId) || !library) throw fail('reader-file-invalid');
        return send(res, 200, await library.sources(owner, [fileId], '', { fullText: true }));
      }
      if (part === '/speech' && req.method === 'POST') {
        const ownKey = String(req.headers['x-reader-service-key'] || '').trim();
        if (ownKey.length > 500 || /[\s\r\n]/.test(ownKey)) throw fail('reader-service-key-invalid');
        const key = ownKey || env.READER_TTS_KEY;
        if (!key) throw fail('reader-speech-unconfigured', 503);
        if (!await reserveCalls(owner, res)) return;
        const input = await readJson(req, 20000);
        if (typeof input.text !== 'string' || input.text.length > 6000) throw fail('reader-text-invalid');
        const response = await fetch(ownKey ? 'https://api.together.xyz/v1/audio/speech' : env.READER_TTS_URL || 'https://api.together.xyz/v1/audio/speech', { method: 'POST', signal: AbortSignal.timeout(45000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: env.READER_TTS_MODEL || 'cartesia/sonic-3', input: input.text, voice: env.READER_TTS_VOICE || '26403c37-80c1-4a1a-8692-540551ca2ae5', response_format: 'mp3' }) });
        if (!response.ok) throw fail('reader-speech-failed', 502);
        const audio = Buffer.from(await response.arrayBuffer());
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }); res.end(audio); return;
      }
      if (part === '/cover' && req.method === 'POST') {
        const ownKey = String(req.headers['x-reader-service-key'] || '').trim();
        if (ownKey.length > 500 || /[\s\r\n]/.test(ownKey)) throw fail('reader-service-key-invalid');
        const key = ownKey || env.READER_IMAGE_KEY;
        if (!key) throw fail('reader-cover-unconfigured', 503);
        if (!await reserveCalls(owner, res)) return;
        const { title, topic } = await readJson(req, 5000);
        const response = await fetch(ownKey ? 'https://api.together.xyz/v1/images/generations' : env.READER_IMAGE_URL || 'https://api.together.xyz/v1/images/generations', { method: 'POST', signal: AbortSignal.timeout(90000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: env.READER_IMAGE_MODEL || 'black-forest-labs/FLUX.2-dev', prompt: `Editorial gouache illustration, book cover, no words, subject: ${String(title).slice(0, 300)}, topic: ${String(topic).slice(0, 60)}`, width: 640, height: 640, n: 1, response_format: 'base64', prompt_upsampling: false }) });
        if (!response.ok) throw fail('reader-cover-failed', 502);
        const result = await response.json(); const image = result.data?.[0]?.b64_json;
        if (typeof image !== 'string' || image.length > 3000000) throw fail('reader-cover-failed', 502);
        return send(res, 200, { cover: `data:image/png;base64,${image}` });
      }
      if (!repository) throw fail('reader-storage-unavailable', 503);
      if (part === '/search-library' && req.method === 'POST') {
        const { query } = await readJson(req, 1000);
        if (typeof query !== 'string' || query.length > 200) throw fail('reader-query-invalid');
        return send(res, 200, { documents: await repository.search(ownerId, query) });
      }
      if (part === '/documents' && req.method === 'GET') return send(res, 200, { documents: await repository.list(ownerId) });
      const match = /^\/documents\/([\da-f-]{36})$/.exec(part);
      if (match && UUID.test(match[1])) {
        if (req.method === 'GET') {
          const doc = await repository.get(ownerId, match[1]);
          return send(res, doc ? 200 : 404, doc || { error: 'reader-not-found' });
        }
        if (req.method === 'PUT') {
          const input = await readJson(req, 4500000); const doc = validateReaderDocument(input.document);
          if (doc.id !== match[1] || !Number.isSafeInteger(input.revision) || input.revision < 0) throw fail('reader-document-invalid');
          return send(res, 200, { revision: await repository.put(ownerId, doc, input.revision) });
        }
      }
      if (part === '/tokens') {
        if (req.method === 'GET') return send(res, 200, { tokens: await repository.tokens(ownerId) });
        if (req.method === 'POST') {
          const { name } = await readJson(req, 1000);
          if (typeof name !== 'string' || !name.trim() || name.length > 100) throw fail('reader-token-name-invalid');
          if ((await repository.tokens(ownerId)).length >= 10) throw fail('reader-token-limit', 409);
          return send(res, 201, await repository.tokenCreate(ownerId, name.trim()));
        }
      }
      const token = /^\/tokens\/([\da-f-]{36})$/.exec(part);
      if (token && UUID.test(token[1]) && req.method === 'DELETE') { await repository.tokenRevoke(ownerId, token[1]); return send(res, 200, { ok: true }); }
      send(res, 404, { error: 'not-found' });
    } catch (error) { send(res, error.status || 502, { error: error.status ? error.message : 'reader-service-failed' }); }
  } };
}
