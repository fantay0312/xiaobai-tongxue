import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import s from './CoachMarkdown.module.css';
import {
  isMarkdownTableBodyRow,
  isMarkdownTableStart,
  splitMarkdownTableRow,
} from './markdownTable';

type MarkdownBlock =
  | { kind: 'code'; code: string; language: string }
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'list'; items: string[]; ordered: boolean; start: number }
  | { kind: 'paragraph' | 'quote'; lines: string[] }
  | { kind: 'rule' }
  | { kind: 'table'; headers: string[]; rows: string[][] };

const FENCE_RE = /^\s*```([\w.+-]*)\s*$/;
const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const LIST_RE = /^\s*([-+*]|\d+[.)])\s+(.+)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const INLINE_RE =
  /(!\[[^\]\n]*]\((?:[^()\s]|\([^)\s]*\))+\)|\[[^\]\n]+]\((?:[^()\s]|\([^)\s]*\))+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function linkedText(token: string, key: string): ReactNode {
  const match = token.match(/^!?\[([^\]]*)]\(((?:[^()\s]|\([^)\s]*\))+)\)$/);
  if (!match) return token;
  const [, label, rawUrl] = match;
  if (token.startsWith('!')) {
    return <span key={key} className={s.imageOmitted}>〔图片：{label || '未命名'}〕</span>;
  }
  const href = safeHttpUrl(rawUrl);
  if (!href) return <span key={key}>{label}</span>;
  return (
    <a key={key} className={s.link} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE_RE).filter(Boolean).map((token, index) => {
    const key = `${keyBase}-${index}`;
    if (token.startsWith('![') || token.startsWith('[')) return linkedText(token, key);
    if (token.startsWith('`') && token.endsWith('`')) {
      return <code key={key} className={s.inlineCode}>{token.slice(1, -1)}</code>;
    }
    if ((token.startsWith('**') && token.endsWith('**'))
      || (token.startsWith('__') && token.endsWith('__'))) {
      return <strong key={key}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith('~~') && token.endsWith('~~')) {
      return <del key={key}>{token.slice(2, -2)}</del>;
    }
    if ((token.startsWith('*') && token.endsWith('*'))
      || (token.startsWith('_') && token.endsWith('_'))) {
      return <em key={key}>{token.slice(1, -1)}</em>;
    }
    return <Fragment key={key}>{token}</Fragment>;
  });
}

function isTableStart(lines: string[], index: number): boolean {
  return index + 1 < lines.length
    && isMarkdownTableStart(lines[index], lines[index + 1]);
}

function readCode(lines: string[], start: number): [MarkdownBlock, number] {
  const language = lines[start].match(FENCE_RE)?.[1] ?? '';
  const body: string[] = [];
  let index = start + 1;
  while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
    body.push(lines[index]);
    index += 1;
  }
  return [
    { kind: 'code', code: body.join('\n'), language },
    index < lines.length ? index + 1 : index,
  ];
}

function readList(lines: string[], start: number): [MarkdownBlock, number] {
  const first = lines[start].match(LIST_RE);
  const ordered = Boolean(first && /^\d/.test(first[1]));
  const startNumber = ordered ? Number.parseInt(first?.[1] ?? '1', 10) : 1;
  const items: string[] = [];
  let index = start;
  while (index < lines.length) {
    const match = lines[index].match(LIST_RE);
    if (!match || Boolean(/^\d/.test(match[1])) !== ordered) break;
    items.push(match[2]);
    index += 1;
  }
  return [{ kind: 'list', items, ordered, start: startNumber }, index];
}

function readQuote(lines: string[], start: number): [MarkdownBlock, number] {
  const body: string[] = [];
  let index = start;
  while (index < lines.length) {
    const match = lines[index].match(QUOTE_RE);
    if (!match) break;
    body.push(match[1]);
    index += 1;
  }
  return [{ kind: 'quote', lines: body }, index];
}

function readTable(lines: string[], start: number): [MarkdownBlock, number] {
  const headers = splitMarkdownTableRow(lines[start]);
  const rows: string[][] = [];
  let index = start + 2;
  while (index < lines.length && isMarkdownTableBodyRow(lines[index])) {
    rows.push(splitMarkdownTableRow(lines[index]));
    index += 1;
  }
  return [{ kind: 'table', headers, rows }, index];
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  return FENCE_RE.test(line)
    || HEADING_RE.test(line)
    || LIST_RE.test(line)
    || QUOTE_RE.test(line)
    || RULE_RE.test(line)
    || isTableStart(lines, index);
}

function readParagraph(lines: string[], start: number): [MarkdownBlock, number] {
  const body: string[] = [];
  let index = start;
  while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
    body.push(lines[index]);
    index += 1;
  }
  return [{ kind: 'paragraph', lines: body }, index];
}

function parseBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) { index += 1; continue; }
    if (FENCE_RE.test(lines[index])) {
      const [block, next] = readCode(lines, index); blocks.push(block); index = next; continue;
    }
    if (isTableStart(lines, index)) {
      const [block, next] = readTable(lines, index); blocks.push(block); index = next; continue;
    }
    const heading = lines[index].match(HEADING_RE);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      index += 1; continue;
    }
    if (LIST_RE.test(lines[index])) {
      const [block, next] = readList(lines, index); blocks.push(block); index = next; continue;
    }
    if (QUOTE_RE.test(lines[index])) {
      const [block, next] = readQuote(lines, index); blocks.push(block); index = next; continue;
    }
    if (RULE_RE.test(lines[index])) { blocks.push({ kind: 'rule' }); index += 1; continue; }
    const [block, next] = readParagraph(lines, index); blocks.push(block); index = next;
  }
  return blocks;
}

function inlineLines(lines: string[], keyBase: string): ReactNode {
  return lines.map((line, index) => (
    <Fragment key={`${keyBase}-${index}`}>
      {inline(line, `${keyBase}-${index}`)}
      {index < lines.length - 1 ? <br /> : null}
    </Fragment>
  ));
}

function MarkdownTable({ block, index }: { block: Extract<MarkdownBlock, { kind: 'table' }>; index: number }) {
  return (
    <div className={s.tableScroll} tabIndex={0} role="region" aria-label="小砚回复中的表格">
      <table>
        <thead><tr>{block.headers.map((cell, cellIndex) => (
          <th key={`h-${cellIndex}`} scope="col">{inline(cell, `${index}-h-${cellIndex}`)}</th>
        ))}</tr></thead>
        <tbody>{block.rows.map((row, rowIndex) => (
          <tr key={`r-${rowIndex}`}>{block.headers.map((_, cellIndex) => (
            <td key={`c-${cellIndex}`}>{inline(row[cellIndex] ?? '', `${index}-${rowIndex}-${cellIndex}`)}</td>
          ))}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function MarkdownBlockView({ block, index }: { block: MarkdownBlock; index: number }) {
  if (block.kind === 'code') return (
    <div className={s.codeBlock}>
      {block.language ? <span className={s.codeLanguage}>{block.language}</span> : null}
      <pre tabIndex={0} role="region" aria-label={`小砚回复中的${block.language ? ` ${block.language}` : ''}代码`}>
        <code>{block.code}</code>
      </pre>
    </div>
  );
  if (block.kind === 'table') return <MarkdownTable block={block} index={index} />;
  if (block.kind === 'rule') return <hr />;
  if (block.kind === 'heading') {
    const content = inline(block.text, `${index}-heading`);
    if (block.level === 1) return <h3>{content}</h3>;
    if (block.level === 2) return <h4>{content}</h4>;
    return <h5>{content}</h5>;
  }
  if (block.kind === 'list') {
    const items = block.items.map((item, itemIndex) => (
      <li key={itemIndex}>{inline(item, `${index}-item-${itemIndex}`)}</li>
    ));
    return block.ordered ? <ol start={block.start}>{items}</ol> : <ul>{items}</ul>;
  }
  if (block.kind === 'quote') return <blockquote>{inlineLines(block.lines, `${index}-quote`)}</blockquote>;
  return <p>{inlineLines(block.lines, `${index}-paragraph`)}</p>;
}

export function CoachMarkdown({ text }: { text: string }) {
  return (
    <div className={s.markdown}>
      {parseBlocks(text).map((block, index) => (
        <MarkdownBlockView key={index} block={block} index={index} />
      ))}
    </div>
  );
}

export function CoachMarkdownMessage({ text, animate, onTick, onDone }: {
  text: string;
  animate: boolean;
  onTick?: () => void;
  onDone?: () => void;
}) {
  const [visibleLength, setVisibleLength] = useState(animate ? 0 : text.length);
  const callbacks = useRef({ onTick, onDone });
  callbacks.current = { onTick, onDone };
  useEffect(() => {
    if (!animate) { setVisibleLength(text.length); return; }
    setVisibleLength(0);
    let nextLength = 0;
    // 每拍落 3 字(≈125 字/秒):看得出在写,但一条 300 字的回复 3 秒内落完,不让老师干等
    const timer = window.setInterval(() => {
      nextLength = Math.min(text.length, nextLength + 3);
      setVisibleLength(nextLength);
      callbacks.current.onTick?.();
      if (nextLength >= text.length) {
        window.clearInterval(timer);
        callbacks.current.onDone?.();
      }
    }, 24);
    return () => window.clearInterval(timer);
  }, [animate, text]);
  const typing = animate && visibleLength < text.length;
  if (!typing) return <CoachMarkdown text={text} />;
  return (
    <span className={s.streaming} aria-hidden="true">
      {text.slice(0, visibleLength)}<span className={s.caret}>▍</span>
    </span>
  );
}
