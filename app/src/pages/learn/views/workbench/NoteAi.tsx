/**
 * 笔记里就地出现的 AI 界面件：选中文字后的浮动条、光标处的斜杠菜单、行内的「问 AI」输入框，
 * 以及把它们浮在光标旁边的定位层。状态与改写逻辑在 NotesTool 里，这里只管长什么样、放在哪。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp, BookOpenCheck, Code, GitBranch, Heading2, Languages, Lightbulb, List, ListChecks, ListTodo, ListTree, Minimize2, PenLine, Sigma,
  Table, TextCursorInput, Type, Wand2, X,
} from 'lucide-react';
import { IconButton, Kbd, cx } from '../../../../components/ui';
import { IconFlashcard, IconMindmap, IconQuiz, IconSpark } from '../../../../components/ui/icons';
import type { TextAction } from './ai';
import { clip } from './util';
import a from './ai.module.css';

const SM = { size: 15, strokeWidth: 1.75 } as const;

/* ── 浮动定位 ── */
export interface AnchorRect {
  left: number;
  top: number;
  bottom: number;
  /** 所在的编辑区：浮层不越过它的上下边，宽的浮层与它左对齐 */
  pane?: { left: number; right: number; top: number; bottom: number };
}
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * 把内容浮在锚点旁边（视口定位，挂到 body 上，不会被卡片的圆角裁掉）。
 * above：贴在选区上方的小条；below：从光标处往下展开的菜单；wide：与编辑区同宽的块。
 */
export function Float({ anchor, place, watch, onOutside, className, children }: {
  anchor: () => AnchorRect | null;
  place: 'above' | 'below' | 'wide';
  /** 变了就重新定位（正文、选区、流式内容） */
  watch: unknown;
  /** 点在浮层和编辑区以外 */
  onOutside?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden', top: 0, left: 0 });
  const latest = useRef({ anchor, onOutside });
  useEffect(() => { latest.current = { anchor, onOutside }; });

  const compute = useCallback(() => {
    const node = ref.current;
    const rect = latest.current.anchor();
    if (!node || !rect) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pane = rect.pane ?? { left: 8, right: vw - 8, top: 0, bottom: vh };
    const top = clamp(rect.top, pane.top, pane.bottom);
    const bottom = clamp(rect.bottom, pane.top, pane.bottom);
    if (place === 'above') {
      const height = node.offsetHeight;
      const y = top - height - 8 >= 8 ? top - height - 8 : bottom + 8;
      setStyle({ top: y, left: clamp(rect.left - 12, 8, vw - node.offsetWidth - 8) });
      return;
    }
    const width = place === 'wide' ? Math.min(640, pane.right - pane.left - 24, vw - 16) : undefined;
    const below = vh - bottom - 14;
    const above = top - 14;
    const cap = place === 'wide' ? 520 : 348;
    const down = below >= Math.min(cap, 240) || below >= above;
    const maxHeight = Math.max(140, Math.min(down ? below : above, cap));
    const height = Math.min(node.scrollHeight, maxHeight);
    setStyle({
      top: down ? bottom + 6 : Math.max(8, top - height - 6),
      left: place === 'wide' ? clamp(pane.left + 12, 8, vw - (width ?? 0) - 8) : clamp(rect.left, 8, vw - node.offsetWidth - 8),
      maxHeight,
      ...(width ? { width } : {}),
    });
  }, [place]);

  useLayoutEffect(() => { compute(); }, [compute, watch]);
  useEffect(() => {
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; compute(); }); };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const observer = typeof ResizeObserver !== 'undefined' && ref.current ? new ResizeObserver(schedule) : null;
    if (observer && ref.current) observer.observe(ref.current);
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && ref.current && !ref.current.contains(target)) latest.current.onOutside?.();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [compute]);

  return createPortal(
    <div ref={ref} className={cx(a.float, className)} data-place={place} data-note-ai="" style={style}>{children}</div>,
    document.body,
  );
}

/* ── 选中文字后的 AI 条 ── */
export type BarAction = TextAction | 'cards' | 'quiz' | 'map';
const BAR: { id: BarAction; label: string; icon: ReactNode; group: 0 | 1 | 2 }[] = [
  { id: 'ask', label: '问 AI', icon: <IconSpark size={16} />, group: 0 },
  { id: 'polish', label: '润色', icon: <Wand2 {...SM} />, group: 1 },
  { id: 'expand', label: '扩写', icon: <PenLine {...SM} />, group: 1 },
  { id: 'shorten', label: '精简', icon: <Minimize2 {...SM} />, group: 1 },
  { id: 'explain', label: '解释', icon: <Lightbulb {...SM} />, group: 1 },
  { id: 'translate', label: '翻译', icon: <Languages {...SM} />, group: 1 },
  { id: 'continue', label: '续写', icon: <TextCursorInput {...SM} />, group: 1 },
  { id: 'cards', label: '做成闪卡', icon: <IconFlashcard size={16} />, group: 2 },
  { id: 'quiz', label: '出题', icon: <IconQuiz size={16} />, group: 2 },
  { id: 'map', label: '加入导图', icon: <IconMindmap size={16} />, group: 2 },
];

export function SelectionBar({ onPick }: { onPick: (action: BarAction) => void }) {
  return (
    // 点按钮时不让焦点离开正文：选区还在，手机上键盘也不会收起
    <div className={a.selBar} role="toolbar" aria-label="对选中的文字用 AI" onMouseDown={(event) => event.preventDefault()}>
      {BAR.map((item, index) => (
        <span key={item.id} className={a.selGroup}>
          {index > 0 && BAR[index - 1].group !== item.group && <i className={a.selSep} aria-hidden="true" />}
          <button type="button" className={a.selBtn} data-lead={item.group === 0 || undefined} onClick={() => onPick(item.id)}>
            {item.icon}{item.label}
          </button>
        </span>
      ))}
    </div>
  );
}

/* ── 斜杠菜单 ── */
export type SlashId = Exclude<TextAction, 'polish' | 'expand' | 'shorten' | 'explain' | 'translate'> | 'todos' | 'heading' | 'list' | 'todo' | 'code';
export interface SlashCommand { id: SlashId; label: string; hint: string; keys: string; icon: ReactNode; group: 'AI' | '基础' }

export const SLASH: SlashCommand[] = [
  { id: 'ask', label: '问 AI', hint: '写一句要求，让小砚来写', keys: 'wen ai ask', icon: <IconSpark size={16} />, group: 'AI' },
  { id: 'continue', label: '续写', hint: '接着上文往下写', keys: 'xuxie xx continue', icon: <TextCursorInput {...SM} />, group: 'AI' },
  { id: 'summarize', label: '总结上文', hint: '收成几条要点', keys: 'zongjie zj summary', icon: <ListChecks {...SM} />, group: 'AI' },
  { id: 'outline', label: '列提纲', hint: '嵌套列表', keys: 'tigang tg outline', icon: <ListTree {...SM} />, group: 'AI' },
  { id: 'table', label: '生成表格', hint: '把可对比的内容排成表', keys: 'biaoge bg table', icon: <Table {...SM} />, group: 'AI' },
  { id: 'formula', label: '写公式', hint: 'LaTeX', keys: 'gongshi gs formula latex', icon: <Sigma {...SM} />, group: 'AI' },
  { id: 'flowchart', label: '画流程图', hint: 'mermaid', keys: 'liuchengtu lct flow mermaid', icon: <GitBranch {...SM} />, group: 'AI' },
  { id: 'example', label: '举例', hint: '给上文配一个例子', keys: 'juli jl example', icon: <Lightbulb {...SM} />, group: 'AI' },
  { id: 'selftest', label: '出自测题', hint: '三道题，带答案', keys: 'ziceti zct zice test quiz', icon: <BookOpenCheck {...SM} />, group: 'AI' },
  { id: 'todos', label: '插入今日待办', hint: '把今天到期的待办列进来', keys: 'daiban db todo jinri', icon: <ListTodo {...SM} />, group: '基础' },
  { id: 'heading', label: '小标题', hint: '##', keys: 'biaoti bt heading h2', icon: <Heading2 {...SM} />, group: '基础' },
  { id: 'list', label: '列表', hint: '-', keys: 'liebiao lb list', icon: <List {...SM} />, group: '基础' },
  { id: 'todo', label: '待核对项', hint: '- [ ]', keys: 'hedui hd check', icon: <Type {...SM} />, group: '基础' },
  { id: 'code', label: '代码块', hint: '```', keys: 'daima dm code', icon: <Code {...SM} />, group: '基础' },
];

export function filterSlash(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH;
  return SLASH.filter((item) => item.label.toLowerCase().includes(q) || item.keys.split(' ').some((key) => key.startsWith(q)));
}

export function SlashMenu({ items, index, query, onPick, onHover }: {
  items: SlashCommand[];
  index: number;
  query: string;
  onPick: (command: SlashCommand) => void;
  onHover: (index: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  return (
    <div className={a.slash} onMouseDown={(event) => event.preventDefault()}>
      <div className={a.slashList} ref={list} role="listbox" aria-label="插入内容">
        {items.map((item, at) => (
          <div key={item.id} className={a.slashRow}>
            {(at === 0 || items[at - 1].group !== item.group) && <div className={a.slashGroup}>{item.group === 'AI' ? '让小砚来写' : '基础'}</div>}
            <button
              type="button"
              role="option"
              aria-selected={at === index}
              data-active={at === index}
              className={a.slashItem}
              onMouseEnter={() => onHover(at)}
              onClick={() => onPick(item)}
            >
              <span className={a.slashIcon} data-ai={item.group === 'AI' || undefined}>{item.icon}</span>
              <span className={a.slashLabel}>{item.label}</span>
              <span className={a.slashHint}>{item.hint}</span>
            </button>
          </div>
        ))}
      </div>
      <div className={a.slashFoot}>
        {query ? <span>筛选：{clip(query, 10)}</span> : <span>接着打字筛选</span>}
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd>选择<Kbd>Enter</Kbd>确认</span>
      </div>
    </div>
  );
}

/* ── 行内的「问 AI」输入框 ── */
export interface ContextChip { id: 'note' | 'course' | 'sources'; label: string; on: boolean }

export function PromptBox({ value, onChange, onSubmit, onClose, chips, onToggle, selection, quick, onQuick }: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  chips: ContextChip[];
  onToggle: (id: ContextChip['id']) => void;
  /** 针对的那段选中文字 */
  selection?: string;
  /** 输入框空着时的快捷动作 */
  quick: { id: TextAction; label: string }[];
  onQuick: (id: TextAction) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (value.trim()) onSubmit(); }
    else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    else if (event.key === 'Backspace' && !value) { event.preventDefault(); onClose(); }
  };
  return (
    <div className={a.prompt}>
      {selection && <p className={a.promptQuote}>{clip(selection.replace(/\s+/g, ' '), 90)}</p>}
      <div className={a.promptRow}>
        <span className={a.spark}><IconSpark size={17} /></span>
        <textarea
          ref={input}
          className={a.promptInput}
          rows={1}
          value={value}
          placeholder={selection ? '想让小砚对这段做什么' : '让小砚写点什么，例如：用一个例子讲清上面的概念'}
          aria-label="问 AI"
          enterKeyHint="send"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKey}
        />
        <IconButton label="发送" size="sm" variant="solid" round disabled={!value.trim()} onClick={onSubmit}><ArrowUp size={15} strokeWidth={2} /></IconButton>
        <IconButton label="关闭" size="sm" onClick={onClose}><X size={15} strokeWidth={1.75} /></IconButton>
      </div>
      <div className={a.promptFoot}>
        <span className={a.promptLabel}>参考</span>
        {chips.map((chip) => (
          <button key={chip.id} type="button" className={a.ctxChip} aria-pressed={chip.on} onClick={() => onToggle(chip.id)}>{chip.label}</button>
        ))}
        {!value && quick.length > 0 && (
          <span className={a.promptQuick}>
            {quick.map((item) => <button key={item.id} type="button" className={a.quickBtn} onClick={() => onQuick(item.id)}>{item.label}</button>)}
          </span>
        )}
      </div>
    </div>
  );
}
