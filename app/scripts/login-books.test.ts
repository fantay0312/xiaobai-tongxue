import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { safeNextPath } from '../src/lib/authNavigation';
import { deriveCourseRows, deriveCourseFocus } from '../src/pages/learn/views/feynman/data';
import { epubToArticle } from '../gloss/src/lib/epub';
import { blockText } from '../gloss/src/lib/article';
import type { Topic, TopicState } from '../src/types';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { DOMParser } = require('linkedom');
Object.defineProperty(globalThis, 'DOMParser', { value: DOMParser, configurable: true });

for (const target of ['/learn', '/learn?view=reading', '/prep/test']) assert.equal(safeNextPath(target), target);
for (const target of ['//evil.test', 'https://evil.test', '/login', '/login?next=/login', '/%6Cogin', '/x/../login', '/\\evil.test', '/bad\npath', '/%2fhost', '/%']) assert.equal(safeNextPath(target), '/learn', target);

const topic = { topicId: 'test', title: '测试课', checklist: [{ id: 'p1', point: '完整要点' }], misconceptions: [{ mcId: 'm1', belief: '错误说法' }] } as Topic;
const base = { knowledgeState: '懂了', mastery: 0.9, hitChecklist: ['p1'], mcStates: {}, prepDone: true } as TopicState;
const now = new Date('2026-10-22T00:00:00Z');
function focus(state: TopicState) {
  const [row] = deriveCourseRows({ topics: [topic], topicStates: { test: state }, events: [], now });
  return { row, focus: deriveCourseFocus({ row, state, events: [], reports: [], live: null }) };
}
assert.equal(focus(base).focus.primary.to, '/teach/test', 'unmastered courses must retain the quiz path');
const wrong = focus({ ...base, forgotten: true, mcStates: { m1: '被带偏' } });
assert.equal(wrong.row.standing, 'strayed');
assert.equal(wrong.focus.kind, 'correct');
assert.deepEqual(wrong.focus.beliefs, ['错误说法']);
assert.equal(wrong.focus.primary.to, '/teach/test?mode=reteach');
assert.equal(focus({ ...base, knowledgeState: '出师' }).focus.primary.to, '/teach/test?mode=review');

async function book(options: { missing?: boolean; encrypted?: boolean; empty?: boolean } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
  zip.file('OPS/book.opf', '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>自定义中文书</dc:title><dc:creator>验收作者</dc:creator></metadata><manifest><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
  zip.file('OPS/one.xhtml', `<html><body>${options.empty ? '' : '<h1>第一章</h1><p>第一章的正文。<strong>重点</strong><a href="two.xhtml">下一章</a></p><script>evil()</script><img src="https://example.com/tracker"/>'}</body></html>`);
  if (!options.missing) zip.file('OPS/two.xhtml', `<html><body>${options.empty ? '' : '<h2>第二章</h2><p>第二章的正文。</p>'}</body></html>`);
  if (options.encrypted) zip.file('META-INF/encryption.xml', '<encryption><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><EncryptionMethod Algorithm="drm"/></encryption>');
  return new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], 'my-book.epub', { type: 'application/epub+zip' });
}
const article = await epubToArticle(await book());
assert.equal(article.title, '自定义中文书');
assert.equal(article.author, '验收作者');
assert.equal(article.origin, 'file');
assert.deepEqual(article.blocks.filter((block) => block.type === 'h2').map(blockText), ['第一章', '第二章']);
assert.equal(new Set(article.blocks.map((block) => block.id)).size, article.blocks.length);
assert.ok(article.blocks.some((block) => block.runs.some((run) => run.strong)));
assert.ok(!JSON.stringify(article).includes('evil()'));
assert.ok(!JSON.stringify(article).includes('tracker'));
assert.ok(!article.blocks.some((block) => block.runs.some((run) => run.href === 'two.xhtml')));
await assert.rejects(epubToArticle(await book({ missing: true })), /缺少章节/);
await assert.rejects(epubToArticle(await book({ encrypted: true })), /加密/);
await assert.rejects(epubToArticle(await book({ empty: true })), /没有可提取/);
await assert.rejects(epubToArticle(new File(['not a zip'], 'broken.epub')), /完整的 EPUB/);
const bomb = await (await book()).arrayBuffer();
const bytes = new Uint8Array(bomb);
const view = new DataView(bomb);
for (let i = 0; i < bytes.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 90 * 1024 * 1024, true); break; }
await assert.rejects(epubToArticle(new File([bomb], 'oversized.epub')), /解压后过大/);
console.log('Login return routes, Feynman completion/correction paths, EPUB metadata/spine/sanitization/corruption/limits: passed.');
