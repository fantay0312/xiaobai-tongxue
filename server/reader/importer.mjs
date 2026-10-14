import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  // Only global unicast IPv6; excludes mapped IPv4, loopback, ULA, multicast and link-local.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0|10|20):/i.test(address) && !/^2002:/i.test(address);
}
export function externalUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw fail('reader-url-invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw fail('reader-url-invalid');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host) || (isIP(host) && !publicAddress(host))) throw fail('reader-url-private');
  return url;
}
export async function fetchPublic(raw, { maxBytes = 8 * 1024 * 1024, redirects = 4, lookupImpl = lookup } = {}) {
  const url = externalUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookupImpl(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw fail('reader-url-private');
  const chosen = addresses[0];
  // Pin the checked address to this connection. Redirects perform the same validation again.
  const response = await new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      headers: { 'User-Agent': 'XiaobaiReader/1.0', Accept: 'text/html,text/plain,application/pdf,application/json' },
      lookup: (_hostname, options, callback) => callback(null, options?.all ? [chosen] : chosen.address, chosen.family),
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); resolve({ redirect: res.headers.location }); return; }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(fail('reader-source-unavailable', 502)); return; }
      const chunks = []; let bytes = 0;
      res.on('data', (chunk) => { bytes += chunk.length; if (bytes > maxBytes) { res.destroy(); reject(fail('reader-source-too-large', 413)); } else chunks.push(chunk); });
      res.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: res.headers['content-type'] ?? '', url: url.href }));
      res.on('error', reject);
    });
    request.setTimeout(15000, () => request.destroy(fail('reader-source-timeout', 504)));
    request.on('error', reject);
  });
  if (response.redirect !== undefined) {
    if (!response.redirect || redirects <= 0) throw fail('reader-redirect-limit');
    return fetchPublic(new URL(response.redirect, url).href, { maxBytes, redirects: redirects - 1, lookupImpl });
  }
  return response;
}

export function articleFromHtml(html, url) {
  const { document } = parseHTML(html);
  for (const node of document.querySelectorAll('script,style,iframe,object,embed,form,nav,footer')) node.remove();
  const article = new Readability(document, { charThreshold: 80, keepClasses: false }).parse();
  if (!article?.content) throw fail('reader-no-article');
  const body = parseHTML(article.content).document;
  const blocks = [];
  const clean = (s) => String(s ?? '').replace(/[\t ]+/g, ' ').trim();
  function walk(node) {
    if (blocks.length >= 4000) return;
    const tag = node.tagName?.toLowerCase();
    if (tag === 'img') {
      try {
        const src = externalUrl(new URL(node.getAttribute('src'), url).href).href;
        blocks.push({ id: `p${blocks.length + 1}`, kind: 'image', text: clean(node.getAttribute('alt')), src });
      } catch { /* Ignore unsafe media URLs. */ }
    } else if (tag === 'table') {
      const rows = [...node.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((td) => clean(td.textContent).replace(/\|/g, '\\|')));
      if (rows.length) {
        const width = Math.max(...rows.map((row) => row.length));
        const render = (row) => `| ${Array.from({ length: width }, (_, i) => row[i] || '').join(' | ')} |`;
        blocks.push({ id: `p${blocks.length + 1}`, kind: 'table', text: [render(rows[0]), render(Array(width).fill('---')), ...rows.slice(1).map(render)].join('\n') });
      }
    } else if (['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'figcaption'].includes(tag)) {
      const text = clean(node.textContent);
      if (text) blocks.push({ id: `p${blocks.length + 1}`, kind: /^h\d$/.test(tag) ? 'heading' : tag === 'pre' ? 'code' : 'paragraph', text });
      for (const image of node.querySelectorAll('img')) walk(image);
    } else for (const child of node.children ?? []) walk(child);
  }
  walk(body);
  if (!blocks.length) throw fail('reader-no-article');
  return { title: clean(article.title) || new URL(url).hostname, author: clean(article.byline), sourceUrl: url, blocks };
}

export async function importArticle(raw) {
  const incoming = externalUrl(raw);
  if (/(^|\.)arxiv\.org$/.test(incoming.hostname) && incoming.pathname.startsWith('/abs/')) raw = `https://arxiv.org/pdf/${incoming.pathname.slice(5)}`;
  if (/(^|\.)(youtube\.com|youtu\.be|x\.com|twitter\.com|threads\.net|bsky\.app)$/.test(incoming.hostname)) throw fail('reader-social-use-paste');
  const result = await fetchPublic(raw);
  if (result.contentType.includes('pdf') || result.bytes.subarray(0, 5).toString() === '%PDF-') return { pdf: result.bytes.toString('base64'), sourceUrl: result.url };
  if (result.contentType.includes('text/plain') || result.contentType.includes('text/markdown')) return { title: new URL(result.url).pathname.split('/').pop() || '文章', sourceUrl: result.url, text: result.bytes.toString('utf8') };
  if (!result.contentType.includes('html')) throw fail('reader-source-type');
  return articleFromHtml(result.bytes.toString('utf8'), result.url);
}
