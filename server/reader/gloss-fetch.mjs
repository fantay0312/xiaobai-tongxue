// Parsing behavior from Nutlope/gloss 54b13b8; network access retains the host SSRF guard.
import { randomUUID } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { externalUrl, fetchPublic } from './importer.mjs';
import { imageStem, leadImage, prepareImages } from './gloss-images.mjs';
import { htmlToBlocks } from './gloss-html-to-blocks.mjs';
import { tidyTitle, undash, wordCount } from './gloss-article.mjs';

const fail = (message, status = 422) => Object.assign(new Error(message), { status });
export function normalizeArticleUrl(raw) {
  try {
    const u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|ref_src$|s$|t$|fbclid$|gclid$|mc_)/i.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.replace(/^www\./, '');
    return u.toString().replace(/\/$/, u.pathname === '/' ? '/' : '');
  } catch { return raw.trim(); }
}
export function arxivFullText(raw, format) {
  const u = new URL(raw);
  const match = /^(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?\/?$/.exec(u.hostname + u.pathname);
  return match ? `https://arxiv.org/${format}/${match[1]}` : null;
}
function revealStreamed(doc) {
  for (const seg of doc.querySelectorAll('div[hidden]')) {
    const match = /^S:(\d+)$/.exec(seg.id);
    if (!match) continue;
    const boundary = doc.getElementById(`B:${match[1]}`);
    const slot = boundary || doc.getElementById(`P:${match[1]}`);
    if (!slot?.parentNode) { seg.removeAttribute('hidden'); continue; }
    if (boundary) {
      let depth = 0;
      for (let n = boundary.nextSibling; n;) {
        const next = n.nextSibling;
        if (n.nodeType === 8) {
          if (n.data === '/$') { if (depth === 0) break; depth--; }
          else if (['$', '$?', '$!'].includes(n.data)) depth++;
        }
        n.parentNode?.removeChild(n);
        n = next;
      }
    }
    while (seg.firstChild) slot.parentNode.insertBefore(seg.firstChild, slot);
    slot.remove(); seg.remove();
  }
}
export function parseGlossHtml(html, url) {
  const { document } = parseHTML(html);
  const base = document.createElement('base'); base.setAttribute('href', url); document.head?.appendChild(base);
  revealStreamed(document);
  for (const table of document.querySelectorAll('table')) {
    if (!['presentation', 'navigation'].includes(table.getAttribute('role')) && table.querySelector('th,thead,caption')) table.removeAttribute('class');
  }
  let lead;
  try { lead = leadImage(document, url); prepareImages(document, url); } catch { /* Optional source images. */ }
  const parsed = new Readability(document, { charThreshold: 150 }).parse();
  if (!parsed?.content) throw fail('未找到文章正文，请使用“粘贴文字”。');
  const root = parseHTML(`<div id="article">${parsed.content}</div>`).document.getElementById('article');
  let blocks = htmlToBlocks(root, url);
  const title = tidyTitle(undash((parsed.title || new URL(url).hostname).trim()));
  const textOf = (b) => b.runs.map(r => r.text).join('');
  if (blocks[0]?.type.startsWith('h') && textOf(blocks[0]).trim() === title) blocks = blocks.slice(1);
  const stem = lead ? imageStem(lead) : null;
  const alreadyShown = src => { try { return src && stem && decodeURIComponent(src).includes(stem); } catch { return src && stem && src.includes(stem); } };
  if (lead && !blocks.slice(0, 4).some(b => b.type === 'figure') && !blocks.some(b => b.type === 'figure' && alreadyShown(b.src))) {
    blocks.unshift({ id: 'b0', type: 'figure', runs: [], src: lead });
  }
  if (!blocks.length || wordCount({ blocks }) < 20) throw fail('这个页面的正文太少，请复制正文后使用“粘贴文字”。');
  const excerpt = undash((parsed.excerpt || '').trim());
  const norm = s => s.toLowerCase().replace(/\s|[\p{P}\p{S}]/gu, '');
  const first = textOf(blocks.find(b => b.type === 'p') || { runs: [] });
  const dek = excerpt.length >= 20 && !norm(first).startsWith(norm(excerpt).slice(0, 60)) ? excerpt.slice(0, 280) : undefined;
  const publishedDate = parsed.publishedTime ? new Date(parsed.publishedTime) : null;
  return { id: randomUUID(), title, author: parsed.byline ? undash(parsed.byline.replace(/^by\s+/i, '').trim()).slice(0, 120) : undefined,
    published: publishedDate && Number.isFinite(publishedDate.getTime()) ? String(publishedDate.getFullYear()) : undefined,
    dek, source: parsed.siteName || new URL(url).hostname.replace(/^www\./, ''), sourceUrl: url, image: lead || undefined,
    blocks, origin: 'url', addedAt: Date.now() };
}
export async function fetchGlossArticle(raw, { pdf = true, fetcher = fetchPublic } = {}) {
  let source;
  try { source = externalUrl(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); }
  catch { throw fail('链接无效或不是可公开访问的网页，请检查地址。', 400); }
  if (/(^|\.)(x\.com|twitter\.com|threads\.net|bsky\.app|instagram\.com|facebook\.com|youtube\.com|youtu\.be|vimeo\.com|tiktok\.com)$/.test(source.hostname)) throw fail('社交帖子和视频请复制正文或字幕，使用“粘贴文字”。');
  const alternate = arxivFullText(source.href, pdf ? 'pdf' : 'html');
  let fetched;
  try { fetched = await fetcher(alternate || source.href, { maxBytes: 25000000 }); }
  catch (error) {
    if (alternate && !pdf) fetched = await fetcher(source.href, { maxBytes: 25000000 });
    else throw fail(error.message === 'reader-source-too-large' ? '网页或文件过大，请分段导入。' : '暂时无法读取这个网页，请检查链接或使用“粘贴文字”。', error.status || 502);
  }
  if (fetched.contentType.includes('pdf') || fetched.bytes.subarray(0, 5).toString() === '%PDF-') {
    if (!pdf) throw fail('这个链接是 PDF，请在阅读器中打开文件。');
    return { pdf: fetched.bytes, name: new URL(fetched.url).pathname.split('/').pop() || 'article.pdf' };
  }
  if (!fetched.contentType.includes('html')) throw fail('这个链接不是网页，请下载文件后导入。', 415);
  if (fetched.bytes.length > 6000000) throw fail('网页内容过大，请使用“粘贴文字”导入正文。', 413);
  return { article: parseGlossHtml(fetched.bytes.toString('utf8'), fetched.url) };
}
