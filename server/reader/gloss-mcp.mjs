// Gloss MCP contracts adapted to the host's account tokens and native reader storage.
import { randomUUID } from 'node:crypto';
import { textToArticle, wordCount, blockText } from './gloss-article.mjs';
import { fetchGlossArticle, normalizeArticleUrl } from './gloss-fetch.mjs';
import { legacyRows } from './gloss-legacy.mjs';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const TOPICS = Object.entries({ ai: 'AI', programming: '编程', infra: '基础设施', data: '数据', security: '安全', tech: '科技与互联网', design: '设计', product: '产品', startups: '创业', business: '商业', work: '工作与职业', economics: '经济', money: '财务', science: '科学', health: '健康', mind: '心理', climate: '气候与能源', philosophy: '哲学', history: '历史', politics: '政治与社会', culture: '文化', writing: '写作', learning: '学习', living: '生活', unsorted: '未分类' }).map(([key, name]) => ({ key, name }));
const topicOf = key => TOPICS.find(t => t.key === key) || TOPICS.at(-1);
const field = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const toolError = text => ({ content: [{ type: 'text', text }], isError: true });
const result = (text, structuredContent) => ({ content: [{ type: 'text', text }], structuredContent });
const schema = properties => ({ type: 'object', properties, additionalProperties: false });
export const GLOSS_MCP_TOOLS = [
  { name: 'save_articles', title: 'Save articles to the library', description: 'Save full web articles, essays or papers. Send their own URLs, not social posts. Skips duplicates. Up to 25 URLs per call.', inputSchema: { ...schema({ urls: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 25 } }), required: ['urls'] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: 'save_text', title: 'Save a text to the library', description: 'Save full Markdown read by the agent: social posts, transcripts or pages behind login. Send the source text, not a summary, and its original URL when available.', inputSchema: { ...schema({ text: { type: 'string', minLength: 1, maxLength: 400000 }, title: { type: 'string' }, author: { type: 'string' }, url: { type: 'string' }, source: { type: 'string' }, published: { type: 'string' } }), required: ['text'] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: 'search_library', title: 'Search the library', description: 'Search titles, authors, source text, highlights and notes. Filter by topic or reading status. No arguments lists recent texts.', inputSchema: schema({ query: { type: 'string' }, topic: { type: 'string', enum: TOPICS.map(t => t.key) }, status: { type: 'string', enum: ['unread', 'reading', 'finished'] }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }), annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: 'list_topics', title: 'List topics', description: 'List topics with the number of texts on each.', inputSchema: schema({}), annotations: { readOnlyHint: true, openWorldHint: false } },
];

export function createGlossMcp({ repository, postgres, env, send, readJson, quota, classify = async () => ({}), fetchArticle = fetchGlossArticle }) {
  const origin = new URL(env.PUBLIC_ORIGIN || 'https://xiaobai.tokentosea.com').origin;
  const readerLink = id => `${origin}/reader/#/${id ? `read/${id}` : 'library'}`;
  async function shelfOf(owner) {
    const rows = await postgres.gloss.list(owner);
    const ids = new Set(rows.filter(r => r.collection === 'articles').map(r => r.id));
    for (const entry of await repository.list(owner)) {
      if (ids.has(entry.id) || entry.deleted) continue;
      const doc = await repository.get(owner, entry.id);
      if (doc) rows.push(...legacyRows(doc).rows);
    }
    return rows.filter(r => r.collection === 'articles' && !r.deleted && r.data?.origin !== 'sample').map(r => ({
      id: r.id, data: r.data, pct: rows.find(p => p.collection === 'progress' && p.id === r.id && !p.deleted)?.data?.pct || 0,
      related: rows.filter(p => p.articleId === r.id && p.collection !== 'articles' && !p.deleted).map(p => p.data),
    }));
  }
  async function save(owner, article, via) {
    const sorting = await classify(owner, article).catch(() => ({}));
    const item = { id: article.id, title: article.title, author: article.author, source: article.source, sourceUrl: article.sourceUrl, origin: article.origin, words: wordCount(article), addedAt: Date.now(),
      year: Number.parseInt(article.published || '', 10) || undefined, dek: article.dek, image: article.image, topic: topicOf(sorting.topic).key,
      tags: Array.isArray(sorting.tags) ? sorting.tags.filter(x => typeof x === 'string').slice(0, 3) : [], scene: field(sorting.scene)?.slice(0, 400), addedBy: 'agent', addedVia: via };
    await postgres.withTransaction(tx => tx.gloss.put(owner, 'articles', { id: article.id, articleId: article.id, data: item, doc: article, revision: 0 }));
    return item;
  }
  const budgetLeft = shelf => 1000 - shelf.filter(r => r.data.addedBy === 'agent' && r.data.addedAt > Date.now() - 86400000).length;
  const knownUrl = (shelf, url) => url && shelf.find(r => r.data.sourceUrl && normalizeArticleUrl(r.data.sourceUrl) === normalizeArticleUrl(url));
  async function call(owner, via, name, args) {
    const shelf = await shelfOf(owner);
    if (name === 'list_topics') {
      const topics = TOPICS.map(t => ({ ...t, count: shelf.filter(r => topicOf(r.data.topic).key === t.key).length }));
      return result(topics.filter(t => t.count).map(t => `${t.name} (${t.key}): ${t.count}`).join('\n') || '书库为空。', { topics });
    }
    if (name === 'search_library') {
      const words = String(args.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      const found = [];
      for (const r of shelf.sort((a, b) => b.data.addedAt - a.data.addedAt)) {
        const status = r.pct >= 1 ? 'finished' : r.pct > 0 ? 'reading' : 'unread';
        if (args.topic && topicOf(r.data.topic).key !== args.topic || args.status && status !== args.status) continue;
        let haystack = JSON.stringify([r.data, r.related]).toLowerCase();
        if (words.some(w => !haystack.includes(w))) haystack += JSON.stringify(await postgres.gloss.article(owner, r.id)).toLowerCase();
        if (words.some(w => !haystack.includes(w))) continue;
        found.push({ title: r.data.title, author: r.data.author, url: r.data.sourceUrl, topic: topicOf(r.data.topic).name, tags: r.data.tags || [], minutes: Math.max(1, Math.round((r.data.words || 0) / 230)), status, addedAt: new Date(r.data.addedAt || 0).toISOString().slice(0, 10), readInGloss: readerLink(r.id) });
      }
      const results = found.slice(0, Math.min(50, Math.max(1, Number(args.limit) || 20)));
      return result(results.length ? `找到 ${found.length} 篇文章。\n${results.map(r => `- ${r.title} (${r.topic})`).join('\n')}` : '没有匹配内容。', { total: found.length, results });
    }
    if (name === 'save_text') {
      const text = field(args.text);
      if (!text || text.length > 400000) return toolError('请提供不超过 400000 字符的完整正文。');
      let url;
      if (field(args.url)) {
        try { const u = new URL(args.url); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); url = u.href; }
        catch { return toolError('原文链接必须是 http 或 https 网页地址。'); }
      }
      const known = knownUrl(shelf, url);
      if (known) return result(`已在书库：${known.data.title}`, { status: 'already_saved', title: known.data.title, readInGloss: readerLink(known.id) });
      if (budgetLeft(shelf) <= 0) return toolError('今天已达到 1000 篇保存上限，请明天继续。');
      const title = field(args.title);
      const article = textToArticle(text, { title, origin: 'paste' }); article.id = randomUUID();
      if (title && article.blocks[0]?.type.startsWith('h') && blockText(article.blocks[0]).trim().toLowerCase() === title.toLowerCase()) article.blocks.shift();
      if (!article.blocks.length) return toolError('没有找到可阅读的正文。');
      Object.assign(article, { author: field(args.author), source: field(args.source) || (url ? new URL(url).hostname.replace(/^www\./, '') : undefined), sourceUrl: url, published: field(args.published) });
      const item = await save(owner, article, via);
      return result(`已保存：${item.title}（${topicOf(item.topic).name}）`, { status: 'saved', title: item.title, topic: topicOf(item.topic).name, words: item.words, readInGloss: readerLink(item.id) });
    }
    if (name === 'save_articles') {
      if (!Array.isArray(args.urls) || !args.urls.length || args.urls.length > 25 || args.urls.some(u => typeof u !== 'string')) return toolError('每次请提供 1 至 25 个文章链接。');
      let budget = budgetLeft(shelf);
      const seen = new Set();
      const queue = args.urls.filter(url => { const key = normalizeArticleUrl(url); if (seen.has(key)) return false; seen.add(key); return true; }).map((url, order) => ({ url, order }));
      const results = [];
      const one = async ({ url, order }) => {
        let known = knownUrl(shelf, url);
        if (known) return { url, order, status: 'already_saved', title: known.data.title, topic: topicOf(known.data.topic).name };
        if (budget-- <= 0) return { url, order, status: 'failed', reason: '今天已达到保存上限。' };
        try {
          const { article } = await fetchArticle(url, { pdf: false });
          known = knownUrl(shelf, article.sourceUrl);
          if (known) return { url, order, status: 'already_saved', title: known.data.title };
          const item = await save(owner, article, via); shelf.push({ id: item.id, data: item, pct: 0, related: [] });
          return { url, order, status: 'saved', title: item.title, topic: topicOf(item.topic).name };
        } catch (e) { return { url, order, status: 'failed', reason: e.status ? e.message : '暂时无法读取该网页，请重试或使用 save_text。' }; }
      };
      const worker = async () => { for (let entry = queue.shift(); entry; entry = queue.shift()) results.push(await one(entry)); };
      await Promise.all([worker(), worker(), worker(), worker()]);
      results.sort((a, b) => a.order - b.order); results.forEach(r => delete r.order);
      const count = status => results.filter(r => r.status === status).length;
      return result(`已保存 ${count('saved')} 篇，已在书库 ${count('already_saved')} 篇，失败 ${count('failed')} 篇。`, { saved: count('saved'), alreadySaved: count('already_saved'), failed: count('failed'), results });
    }
    return toolError(`未知工具：${name}`);
  }
  return async function mcp(req, res) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const who = repository?.tokenIdentity ? await repository.tokenIdentity(token) : { owner: await repository?.tokenOwner(token), label: 'Agent' };
    if (!who?.owner) return send(res, 401, { error: 'reader-token-invalid' });
    if (req.headers.origin && req.headers.origin !== origin) return send(res, 403, { error: 'reader-origin-invalid' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method-not-allowed' });
    if (!postgres) return send(res, 503, { error: 'reader-storage-unavailable' });
    const body = await readJson(req, 1600000);
    const messages = Array.isArray(body) ? body : [body];
    if (!messages.length || messages.length > 50 || messages.some(m => !m || typeof m !== 'object' || typeof m.method !== 'string')) return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    quota(who.owner);
    const answers = [];
    for (const m of messages) {
      if (m.id === undefined || m.method.startsWith('notifications/')) continue;
      let answer;
      if (m.method === 'initialize') answer = { protocolVersion: VERSIONS.includes(m.params?.protocolVersion) ? m.params.protocolVersion : VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'xiaobai-reader', title: '阅读书库', version: '1.1.0', websiteUrl: readerLink() }, instructions: 'Save full source articles to the reader library. For social posts or videos, use save_text with the complete source text and original URL, not a summary.' };
      else if (m.method === 'ping') answer = {};
      else if (m.method === 'tools/list') answer = { tools: GLOSS_MCP_TOOLS };
      else if (m.method === 'tools/call') {
        try { answer = await call(who.owner, who.label, m.params?.name, m.params?.arguments || {}); }
        catch { answer = toolError('书库暂时不可用，请稍后重试。'); }
      } else { answers.push({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } }); continue; }
      answers.push({ jsonrpc: '2.0', id: m.id, result: answer });
    }
    if (!answers.length) { res.writeHead(202); res.end(); return; }
    return send(res, 200, Array.isArray(body) ? answers : answers[0]);
  };
}
