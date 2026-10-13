/**
 * Markdown 预处理（纯函数）。做两件事：
 * 1. 把模型常见的不规范写法收拾成 remark 能稳定解析的形态：
 *    \(…\) \[…\] 定界符、裸露的 \begin{aligned} 环境、单行 $$…$$、价格里的美元符号、中文标点旁的加粗。
 * 2. 把流式输出的半截结构补全：没闭合的代码围栏、公式、行内代码、加粗、写到一半的表头，
 *    让每一帧都能渲染而不闪烁、不抛错。
 */
import { isMarkdownTableStart, splitMarkdownTableRow } from '../coach/markdownTable';

/** 写在围栏信息串里的标记：这段代码还没写完（预处理补了结尾）。 */
export const OPEN_FENCE_FLAG = 'xb-open';

/** 可以脱离定界符单独出现、应当按独立公式渲染的 LaTeX 环境。 */
const DISPLAY_ENVS = new Set([
  'aligned', 'align', 'align*', 'alignat', 'alignat*', 'alignedat', 'equation', 'equation*',
  'gather', 'gather*', 'gathered', 'split', 'cases', 'dcases', 'rcases', 'array', 'subarray',
  'matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix', 'CD',
]);

const CJK_RE = /[㐀-鿿豈-﫿]/;
const MATHY_RE = /[\\^_={}<>+*/|]|^[A-Za-z0-9]{1,3}$/;
const CONTAINER_RE = /^(?:[ \t]*(?:>|[-+*](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*/;
const HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]/;

const isTableRow = (line: string) => /^[ \t]*\|/.test(line);

/** 行首的容器前缀（引用、列表记号、缩进），以及续行要用的等宽前缀。 */
export function containerPrefix(line: string): { raw: string; cont: string } {
  const raw = CONTAINER_RE.exec(line)?.[0] ?? '';
  return { raw, cont: raw.replace(/[-+*]|\d{1,9}[.)]/g, (marker) => ' '.repeat(marker.length)) };
}

/* ───────────────────────── 代码围栏 ───────────────────────── */

export interface TextSegment { kind: 'text'; text: string }
export interface FenceSegment {
  kind: 'fence';
  /** 开头那一行的容器前缀（原样） */
  prefix: string;
  /** 续行前缀，补结尾时使用 */
  cont: string;
  marker: string;
  info: string;
  body: string[];
  /** 原文里已经闭合时保留原结尾行 */
  closer: string | null;
}
export type Segment = TextSegment | FenceSegment;

function fenceOpener(line: string): { prefix: string; cont: string; marker: string; info: string } | null {
  const { raw, cont } = containerPrefix(line);
  const match = /^(`{3,}|~{3,})(.*)$/.exec(line.slice(raw.length));
  if (!match) return null;
  // 反引号围栏的信息串里不能再有反引号，否则那是一段行内代码
  if (match[1][0] === '`' && match[2].includes('`')) return null;
  return { prefix: raw, cont, marker: match[1], info: match[2].trim() };
}

function isFenceCloser(line: string, marker: string): boolean {
  const rest = line.slice(containerPrefix(line).raw.length);
  const match = /^(`{3,}|~{3,})[ \t]*$/.exec(rest);
  return Boolean(match && match[1][0] === marker[0] && match[1].length >= marker.length);
}

/** 按代码围栏切段。围栏内的内容之后原样保留，不参与公式处理。 */
export function splitFences(source: string): Segment[] {
  const segments: Segment[] = [];
  let text: string[] = [];
  let fence: FenceSegment | null = null;
  const flushText = () => {
    if (text.length) segments.push({ kind: 'text', text: text.join('\n') });
    text = [];
  };
  for (const line of source.split('\n')) {
    if (fence) {
      if (isFenceCloser(line, fence.marker)) {
        fence.closer = line;
        segments.push(fence);
        fence = null;
      } else {
        fence.body.push(line);
      }
      continue;
    }
    const opener = fenceOpener(line);
    if (opener) {
      flushText();
      fence = { kind: 'fence', ...opener, body: [], closer: null };
    } else {
      text.push(line);
    }
  }
  if (fence) segments.push(fence);
  flushText();
  return segments;
}

/** 还原围栏；没闭合的补上结尾并打上流式标记。 */
export function renderFence(fence: FenceSegment): string {
  if (fence.closer !== null) {
    return [`${fence.prefix}${fence.marker}${fence.info}`, ...fence.body, fence.closer].join('\n');
  }
  const body = [...fence.body];
  // 结尾围栏只敲出一两个字符时先不显示，避免在代码里闪一下
  const tail = body.at(-1);
  if (tail !== undefined && new RegExp(`^[ \\t>]*\\${fence.marker[0]}{1,2}[ \\t]*$`).test(tail)) body.pop();
  const info = `${fence.info || 'text'} ${OPEN_FENCE_FLAG}`;
  return [`${fence.prefix}${fence.marker}${info}`, ...body, `${fence.cont}${fence.marker}`].join('\n');
}

/* ───────────────────────── 公式 ───────────────────────── */

/**
 * 一对单美元符号之间是不是公式。参照 Pandoc 的规则再加两条中文语境的保护：
 * `$5 和 $10`、`花费 $5，其中$x$…` 都不是公式。
 */
export function isInlineMath(body: string, nextChar: string): boolean {
  const tex = body.trim();
  if (!tex || body.includes('`')) return false;
  if (/\d/.test(nextChar)) return false;
  if (/^\d/.test(tex) && CJK_RE.test(tex) && !tex.includes('\\')) return false;
  if (tex.length !== body.length) return MATHY_RE.test(tex);
  return true;
}

/** `\[…\]` 里是不是公式：排除被转义的引用标记 `\[1\]` 和普通方括号文字。 */
export function isBracketMath(body: string): boolean {
  const tex = body.trim();
  if (!tex) return false;
  if (/^\d+(?:\s*[,，、-]\s*\d+)*$/.test(tex)) return false;
  if (CJK_RE.test(tex) && !/[\\^_=]/.test(tex)) return false;
  return true;
}

/**
 * 把写到一半的 LaTeX 补成能排版的形态：去掉结尾的半截命令，补齐花括号、\left 和未结束的环境。
 * 只用于流式输出中尚未闭合的独立公式；补不好时 KaTeX 会退回显示源码，不影响后续。
 */
export function balanceTex(source: string): string {
  let tex = source
    .replace(/\\(?:begin|end)\{[^}]*$/, '')
    .replace(/(?<!\\)\\[A-Za-z]*$/, '')
    .replace(/[\^_\s]+$/, '');
  let depth = 0;
  for (let i = 0; i < tex.length; i += 1) {
    if (tex[i] === '\\') i += 1;
    else if (tex[i] === '{') depth += 1;
    else if (tex[i] === '}') depth = Math.max(0, depth - 1);
  }
  tex += '}'.repeat(depth);
  const lefts = (tex.match(/\\left(?![A-Za-z])/g) ?? []).length;
  const rights = (tex.match(/\\right(?![A-Za-z])/g) ?? []).length;
  tex += '\\right.'.repeat(Math.max(0, lefts - rights));
  const stack: string[] = [];
  for (const match of tex.matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
    if (match[1] === 'begin') stack.push(match[2]);
    else if (stack[stack.length - 1] === match[2]) stack.pop();
  }
  while (stack.length) tex += `\n\\end{${stack.pop()}}`;
  return tex;
}

function indexOfUnescaped(input: string, needle: string, from: number, limit = input.length): number {
  let at = input.indexOf(needle, from);
  while (at !== -1 && at < limit) {
    let slashes = 0;
    while (at - slashes - 1 >= 0 && input[at - slashes - 1] === '\\') slashes += 1;
    if (slashes % 2 === 0) return at;
    at = input.indexOf(needle, at + 1);
  }
  return -1;
}

/**
 * 统一公式定界符，并保护不是公式的美元符号。
 * `isTail` 表示这段文字位于全文末尾：只有这时才把没闭合的结构当作“正在输出”来补全。
 */
export function normalizeMathText(input: string, isTail: boolean): string {
  if (!/[\\`$]/.test(input)) return input;
  const n = input.length;
  const special = /[\\`$]/g;
  let out = '';
  let i = 0;

  const lineStartOf = (pos: number) => input.lastIndexOf('\n', pos - 1) + 1;
  const lineEndOf = (pos: number) => {
    const end = input.indexOf('\n', pos);
    return end === -1 ? n : end;
  };
  const lineAt = (pos: number) => input.slice(lineStartOf(pos), lineEndOf(pos));
  const paragraphEndOf = (pos: number) => {
    const blank = /\n[ \t]*\n/g;
    blank.lastIndex = pos;
    return blank.exec(input)?.index ?? n;
  };

  const inline = (body: string, pos: number): string => {
    let tex = body.replace(/\s*\n\s*/g, ' ').trim();
    // 表格里的竖线会被当成列分隔，换成等价的 \vert
    if (isTableRow(lineAt(pos))) tex = tex.replace(/(?<!\\)\|/g, '\\vert ');
    return tex.includes('$') ? `$$${tex}$$` : `$${tex}$`;
  };

  /** 独立公式写成 `$$` 独占一行的块；表格和标题里放不下块，退回行内。 */
  const display = (body: string, start: number, end: number): string => {
    const line = lineAt(start);
    if (isTableRow(line) || HEADING_RE.test(line)) return body.trim() ? inline(body, start) : '';
    const { raw, cont } = containerPrefix(line);
    const quoted = cont.includes('>');
    const rows = body
      .split('\n')
      .map((row) => (quoted ? row.replace(/^[ \t]*(?:>[ \t]?)*/, '') : row).trim())
      .filter(Boolean);
    if (!rows.length) return '';
    const hasBefore = input.slice(lineStartOf(start) + raw.length, start).trim() !== '';
    const hasAfter = input.slice(end, lineEndOf(end)).trim() !== '';
    return [
      hasBefore ? `\n${cont}` : '',
      '$$\n',
      rows.map((row) => `${cont}${row}\n`).join(''),
      `${cont}$$`,
      hasAfter ? `\n${cont}` : '',
    ].join('');
  };

  /** 末尾没闭合的独立公式：只在它一直延伸到全文结尾时才认。 */
  const openDisplay = (bodyStart: number, start: number): string | null => {
    const lead = /^\s*/.exec(input.slice(bodyStart))?.[0].length ?? 0;
    if (!isTail || paragraphEndOf(bodyStart + lead) !== n) return null;
    // 结尾定界符只敲出一半时先去掉，再把括号和环境补齐，让公式边写边排
    return display(balanceTex(input.slice(bodyStart).replace(/\$$/, '')), start, n);
  };

  while (i < n) {
    special.lastIndex = i;
    const hit = special.exec(input);
    if (!hit) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, hit.index);
    i = hit.index;
    const ch = input[i];

    if (ch === '\\') {
      const next = input[i + 1];
      if (next === '(') {
        const end = indexOfUnescaped(input, '\\)', i + 2, paragraphEndOf(i));
        if (end !== -1 && input.slice(i + 2, end).trim()) {
          out += inline(input.slice(i + 2, end), i);
          i = end + 2;
          continue;
        }
      } else if (next === '[') {
        const end = indexOfUnescaped(input, '\\]', i + 2);
        if (end !== -1) {
          if (isBracketMath(input.slice(i + 2, end))) {
            out += display(input.slice(i + 2, end), i, end + 2);
            i = end + 2;
            continue;
          }
        } else if (isBracketMath(input.slice(i + 2))) {
          const open = openDisplay(i + 2, i);
          if (open !== null) {
            out += open;
            break;
          }
        }
      } else if (input.startsWith('\\begin{', i)) {
        const env = /^\\begin\{([A-Za-z]+\*?)\}/.exec(input.slice(i, i + 32))?.[1];
        if (env && DISPLAY_ENVS.has(env)) {
          const closer = `\\end{${env}}`;
          const end = input.indexOf(closer, i);
          if (end !== -1) {
            out += display(input.slice(i, end + closer.length), i, end + closer.length);
            i = end + closer.length;
            continue;
          }
          const open = openDisplay(i, i);
          if (open !== null) {
            out += open;
            break;
          }
        }
      }
      out += input.slice(i, i + 2);
      i += 2;
      continue;
    }

    if (ch === '`') {
      let run = 1;
      while (input[i + run] === '`') run += 1;
      const limit = paragraphEndOf(i);
      let close = -1;
      let j = i + run;
      while (j < limit) {
        const at = input.indexOf('`', j);
        if (at === -1 || at >= limit) break;
        let length = 1;
        while (input[at + length] === '`') length += 1;
        if (length === run) {
          close = at;
          break;
        }
        j = at + length;
      }
      if (close !== -1) {
        out += input.slice(i, close + run);
        i = close + run;
        continue;
      }
      if (isTail && run < 3 && lineEndOf(i) === n) {
        // 正在输出的行内代码：先按代码闭合；只敲出反引号时暂不显示
        const rest = input.slice(i + run);
        if (rest.trim()) out += `${input.slice(i)}${'`'.repeat(run)}`;
        break;
      }
      out += input.slice(i, i + run);
      i += run;
      continue;
    }

    // ch === '$'
    if (input[i + 1] === '$') {
      const end = indexOfUnescaped(input, '$$', i + 2);
      if (end !== -1) {
        out += display(input.slice(i + 2, end), i, end + 2);
        i = end + 2;
        continue;
      }
      const open = openDisplay(i + 2, i);
      if (open !== null) {
        out += open;
        break;
      }
      out += '\\$\\$';
      i += 2;
      continue;
    }
    const close = indexOfUnescaped(input, '$', i + 1, paragraphEndOf(i));
    if (close !== -1 && input[close + 1] !== '$') {
      const body = input.slice(i + 1, close);
      // 跨行的行内公式少见，要求里面确实有 LaTeX 命令才认
      const plausible = !body.includes('\n') || /\\[A-Za-z]/.test(body);
      if (plausible && isInlineMath(body, input[close + 1] ?? '')) {
        out += inline(body, i);
        i = close + 1;
        continue;
      }
    }
    out += '\\$';
    i += 1;
  }
  return out;
}

/* ───────────────────────── 中文加粗 ───────────────────────── */

const HAIR_SPACE = ' ';
const PUNCT_RE = /[\p{P}\p{S}]/u;
const SPACE_OR_PUNCT_RE = /[\s\p{P}\p{S}]/u;

/**
 * `**注意：**后文` 在 CommonMark 里不会加粗（结尾记号夹在标点和文字之间）。
 * 中文模型输出里这种写法极常见，这里在记号外侧垫一个极窄空格让它成立。
 */
export function fixCjkEmphasis(text: string): string {
  if (!text.includes('**')) return text;
  return text.replace(/\*\*([^*\n]+?)\*\*/g, (match, inner: string, offset: number) => {
    const before = text[offset - 1] ?? '';
    const after = text[offset + match.length] ?? '';
    const first = inner[0];
    const last = inner[inner.length - 1];
    if (/\s/.test(first) || /\s/.test(last)) return match;
    const padBefore = PUNCT_RE.test(first) && before !== '' && !SPACE_OR_PUNCT_RE.test(before);
    const padAfter = PUNCT_RE.test(last) && after !== '' && !SPACE_OR_PUNCT_RE.test(after);
    return `${padBefore ? HAIR_SPACE : ''}${match}${padAfter ? HAIR_SPACE : ''}`;
  });
}

/* ───────────────────────── 流式尾部 ───────────────────────── */

/** 最后一行里没闭合的加粗：补上结尾；刚敲出开头记号时先藏起来。 */
export function closeInlineTail(text: string): string {
  const cut = text.lastIndexOf('\n') + 1;
  const line = text.slice(cut);
  if (!line.includes('*')) return text;
  const bare = line.replace(/`[^`]*`/g, '').replace(/\$[^$]*\$/g, '');
  if ((bare.match(/\*\*/g) ?? []).length % 2 === 0) return text;
  if (/\*\*$/.test(line)) return text.slice(0, -2);
  const trimmed = text.trimEnd();
  return /(?<!\*)\*$/.test(trimmed) ? `${trimmed}*` : `${trimmed}**`;
}

/**
 * 表头写完、分隔行还没到（或只写了一半）时先补一条分隔行，
 * 这样表格从第一行起就按表格排版，而不是先显示成一行竖线再跳变。
 */
export function completeStreamingTable(text: string): string {
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lines = body.split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (!isTableRow(last)) return text;
  const previous = lines[lines.length - 2] ?? '';
  const indent = /^[ \t]*/.exec(last)?.[0] ?? '';
  const divider = (cells: number) => `${indent}|${' --- |'.repeat(cells)}`;

  if (!isTableRow(previous)) {
    const cells = splitMarkdownTableRow(last).length;
    if (cells < 2 && !(cells === 1 && /^[ \t]*\|[ \t]/.test(last))) return text;
    const header = /\|[ \t]*$/.test(last) && last.trim().length > 1 ? last : `${last.trimEnd()} |`;
    return [...lines.slice(0, -1), header, divider(cells)].join('\n');
  }
  const beforePrevious = lines[lines.length - 3] ?? '';
  if (!isTableRow(beforePrevious) && /^[ \t]*\|[ \t:|-]*$/.test(last) && !isMarkdownTableStart(previous, last)) {
    const cells = splitMarkdownTableRow(previous).length;
    if (cells < 1) return text;
    return [...lines.slice(0, -1), divider(cells)].join('\n');
  }
  return text;
}

/* ───────────────────────── 入口 ───────────────────────── */

export function normalizeMarkdown(source: string): string {
  const segments = splitFences(source.replace(/\r\n?/g, '\n'));
  return segments
    .map((segment, index) => {
      if (segment.kind === 'fence') return renderFence(segment);
      const isTail = index === segments.length - 1;
      const text = fixCjkEmphasis(normalizeMathText(segment.text, isTail));
      return isTail ? completeStreamingTable(closeInlineTail(text)) : text;
    })
    .join('\n');
}
