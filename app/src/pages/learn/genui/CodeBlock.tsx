import { useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { Check, Copy, SquareCode } from 'lucide-react';
import { IconButton } from '../../../components/ui';
import type { LearningUiBlockOf } from '../../../../../server/shared/learning-ui.mjs';
import { BlockCard, Md, copyText } from './parts';
import styles from './genui.module.css';

const ALIASES: Record<string, string> = { 'c++': 'cpp', 'c#': 'csharp', sh: 'bash', shell: 'bash', zsh: 'bash', js: 'javascript', ts: 'typescript', py: 'python', golang: 'go', text: 'plaintext', txt: 'plaintext' };
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * 高亮后按行切开。highlight.js 只产出自己转义过的 <span class="hljs-…">，
 * 跨行的 span（多行注释、字符串）在每行末尾补上闭合、下一行开头重新打开。
 */
function highlightLines(code: string, language: string): string[] {
  const name = ALIASES[language] ?? language;
  let html: string;
  try {
    html = hljs.getLanguage(name) ? hljs.highlight(code, { language: name, ignoreIllegals: true }).value : escapeHtml(code);
  } catch {
    html = escapeHtml(code);
  }
  const open: string[] = [];
  return html.split('\n').map((raw) => {
    const prefix = open.join('');
    for (const tag of raw.match(/<span[^>]*>|<\/span>/g) ?? []) {
      if (tag === '</span>') open.pop();
      else open.push(tag);
    }
    return `${prefix}${raw}${'</span>'.repeat(open.length)}` || ' ';
  });
}

export function CodeBlockView({ item }: { item: LearningUiBlockOf<'code'> }) {
  const lines = useMemo(() => highlightLines(item.code, item.language), [item.code, item.language]);
  const notes = useMemo(() => new Map(item.notes.map((note) => [note.line, note.text])), [item.notes]);
  const [active, setActive] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!(await copyText(item.code))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const toggle = (line: number) => setActive((current) => (current === line ? null : line));
  return (
    <BlockCard
      item={item}
      icon={<SquareCode size={16} strokeWidth={1.75} />}
      meta={item.language === 'text' ? `${lines.length} 行` : `${item.language} · ${lines.length} 行`}
      actions={
        <IconButton label={copied ? '已复制' : '复制代码'} tip size="sm" onClick={copy}>
          {copied ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.75} />}
        </IconButton>
      }
    >
      <div className={styles.code} tabIndex={0} role="region" aria-label={`${item.title}代码`}>
        <ol className={styles.codeLines}>
          {lines.map((html, index) => {
            const line = index + 1;
            const noted = notes.has(line);
            return (
              <li key={line} className={styles.codeLine} data-noted={noted} data-active={active === line}>
                {noted ? (
                  <button type="button" className={styles.lineNo} aria-label={`第 ${line} 行，查看讲解`} aria-pressed={active === line} onClick={() => toggle(line)}>{line}</button>
                ) : (
                  <span className={styles.lineNo} aria-hidden="true">{line}</span>
                )}
                <code dangerouslySetInnerHTML={{ __html: html }} />
              </li>
            );
          })}
        </ol>
      </div>
      {item.notes.length ? (
        <ul className={styles.codeNotes} aria-label="逐行讲解">
          {item.notes.map((note) => (
            <li key={note.line}>
              <button type="button" className={styles.codeNote} data-active={active === note.line} aria-pressed={active === note.line} onClick={() => toggle(note.line)}>
                <span className={styles.codeNoteLine}>第 {note.line} 行</span>
                <Md text={note.text} tight />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {item.explanation ? <Md text={item.explanation} className={styles.codeExplain} /> : null}
    </BlockCard>
  );
}
