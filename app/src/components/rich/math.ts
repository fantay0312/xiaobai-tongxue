/**
 * KaTeX 渲染（带缓存）。流式输出时整段 Markdown 会反复重排，
 * 已经出现过的公式直接取缓存，不重复排版。
 */
import katex from 'katex';

const CACHE_LIMIT = 800;
const cache = new Map<string, string>();

/** 这些顶层环境只能在独立公式里用；出现在行内时改按独立公式排。 */
const DISPLAY_ONLY_RE = /\\begin\{(?:align|alignat|equation|gather|CD)\*?\}/;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] ?? ch));
}

/** 去掉 KaTeX 不认、且不影响显示的命令。 */
export function cleanTex(tex: string): string {
  return tex.replace(/\\label\{[^{}]*\}/g, '').trim();
}

/** 返回 KaTeX 生成的 HTML；语法有误时返回带 `katex-error` 类名的原文，不抛错。 */
export function renderMath(source: string, display: boolean): string {
  const tex = cleanTex(source);
  const displayMode = display || DISPLAY_ONLY_RE.test(tex);
  const key = `${displayMode ? 'D' : 'I'}${tex}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let html: string;
  try {
    html = katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml',
    });
  } catch {
    html = `<span class="katex-error">${escapeHtml(tex)}</span>`;
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, html);
  return html;
}
