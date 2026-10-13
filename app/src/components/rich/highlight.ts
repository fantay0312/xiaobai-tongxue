/**
 * 代码高亮：只注册课程里用得到的语言，体积可控。
 * 颜色不在这里定，token 类名由 CodeBlock.module.css 用皮肤变量上色。
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import latex from 'highlight.js/lib/languages/latex';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import matlab from 'highlight.js/lib/languages/matlab';
import mipsasm from 'highlight.js/lib/languages/mipsasm';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import verilog from 'highlight.js/lib/languages/verilog';
import x86asm from 'highlight.js/lib/languages/x86asm';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, go, ini, java, javascript, json, kotlin, latex, lua, makefile,
  markdown, matlab, mipsasm, php, python, r, ruby, rust, shell, sql, swift, typescript, verilog,
  x86asm, xml, yaml,
};

for (const [name, grammar] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, grammar);

// 模型常写、但语法包自带别名里没有的叫法
const EXTRA_ALIASES: Record<string, string[]> = {
  c: ['h'],
  javascript: ['jsx', 'node'],
  typescript: ['tsx'],
  python: ['python3', 'py3'],
  xml: ['vue'],
  json: ['jsonc', 'json5'],
  x86asm: ['asm', 'assembly', 'nasm'],
  mipsasm: ['mips'],
  shell: ['console', 'terminal'],
  bash: ['zsh'],
};
for (const [languageName, aliases] of Object.entries(EXTRA_ALIASES)) {
  hljs.registerAliases(aliases, { languageName });
}

const LABELS: Record<string, string> = {
  bash: 'Bash', c: 'C', cpp: 'C++', csharp: 'C#', css: 'CSS', diff: 'Diff', go: 'Go', ini: 'INI',
  java: 'Java', javascript: 'JavaScript', json: 'JSON', kotlin: 'Kotlin', latex: 'LaTeX', lua: 'Lua',
  makefile: 'Makefile', markdown: 'Markdown', matlab: 'MATLAB', mipsasm: 'MIPS 汇编', php: 'PHP',
  python: 'Python', r: 'R', ruby: 'Ruby', rust: 'Rust', shell: '终端', sql: 'SQL', swift: 'Swift',
  typescript: 'TypeScript', verilog: 'Verilog', x86asm: '汇编', xml: 'HTML', yaml: 'YAML',
  mermaid: 'Mermaid', text: '文本', plaintext: '文本', plain: '文本', txt: '文本',
  pseudocode: '伪代码', pseudo: '伪代码', 伪代码: '伪代码',
};

const MAX_LENGTH = 80_000;
const CACHE_LIMIT = 160;
const cache = new Map<string, string>();

// 语法对象 → 注册名，用来把 py / c++ / html 这类别名归一
const REGISTERED = new Map<unknown, string>(
  Object.keys(LANGUAGES).map((name) => [hljs.getLanguage(name), name]),
);

/** 规范化语言名：找不到对应语法时原样返回小写名。 */
function canonical(language: string): string {
  const name = language.trim().toLowerCase();
  const grammar = hljs.getLanguage(name);
  return (grammar && REGISTERED.get(grammar)) || name;
}

/** 代码块标题栏上显示的语言名。 */
export function languageLabel(language: string): string {
  const name = language.trim();
  if (!name) return '代码';
  const key = canonical(name);
  return LABELS[key] ?? (name.length <= 3 ? name.toUpperCase() : name);
}

/**
 * 返回高亮后的 HTML（highlight.js 已转义）；语言未知或内容过长时返回 null，由调用方按纯文本显示。
 * `remember` 为 false 时不进缓存：流式输出中每一帧内容都不同，缓存只会白占内存。
 */
export function highlightCode(code: string, language: string, remember = true): string | null {
  const name = language.trim().toLowerCase();
  if (!name || !code || code.length > MAX_LENGTH || !hljs.getLanguage(name)) return null;
  const key = `${name}\u0000${code}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  let html: string;
  try {
    html = hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
  if (remember) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    cache.set(key, html);
  }
  return html;
}
