import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Bold, Check, Code, Columns2, Download, Eye, Heading2, Italic, List, ListChecks, Quote, Sigma, SquarePen, X } from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { Button, IconButton, Segmented, toast } from '../../../../components/ui';
import { IconSpark } from '../../../../components/ui/icons';
import { logActivity } from '../../../../engine/activityLog';
import { mindNode, studyData, useStudyData, type StudyNote } from '../../../../store/studyData';
import { AiBlock, ItemOrigin, SendMenu, useAiRun, useCross, type AiBlockAction } from './AiKit';
import { useAiFocus } from './AskPanel';
import { REPLACING, TEXT_ACTIONS, runTextAction, type AiContext, type TextAction } from './ai';
import { caretRect, lineAt, rangeRects, replaceInArea, type LocalRect } from './caret';
import { generateMindMap } from './generate';
import { Float, PromptBox, SelectionBar, SlashMenu, filterSlash, type AnchorRect, type BarAction, type ContextChip, type SlashCommand } from './NoteAi';
import { exportNote } from './registry';
import { DetailHead, ICON_SM, ToolFrame, type ToolProps } from './shared';
import { clip, countWords, dayKey, dueDay, useAutosave, useNarrow, useWorkbenchNav } from './util';
import s from './workbench.module.css';
import n from './notes.module.css';

type Mode = 'edit' | 'split' | 'preview';
type Mark = 'bold' | 'italic' | 'heading' | 'list' | 'todo' | 'quote' | 'code' | 'math';

/** 一段选中的文字。from < 0：在预览里选的，源文里没有逐字对应的位置 */
interface Sel { from: number; to: number; text: string; range?: Range }
type Flow =
  | { kind: 'bar'; sel: Sel }
  | { kind: 'slash'; at: number; query: string; index: number }
  | { kind: 'prompt'; sel: Sel | null; caret: number }
  | { kind: 'block'; sel: Sel | null; caret: number; action: TextAction; instruction?: string }
  | null;

/** 编辑区里放正文的那一块（去掉两侧的大留白），宽的浮层和它对齐 */
function paneOf(el: HTMLElement) {
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const left = Math.max(0, (parseFloat(style.paddingLeft) || 0) - 26);
  const right = Math.max(0, (parseFloat(style.paddingRight) || 0) - 26);
  return { left: box.left + left, right: box.right - right, top: box.top, bottom: box.bottom };
}

/** 中文输入法下按 / 键打出来的是顿号，一样算 */
const SLASH_CHARS = '/、／';
const EMPTY_HINT = '输入 / 唤起 AI，或直接写';

export default function NotesTool(props: ToolProps) {
  const { owner } = props;
  const { notes } = useStudyData(owner);
  // 详情栏够宽才默认分栏；窄的时候先看排好版的预览，空笔记打开时再切到编辑
  const [mode, setMode] = useState<Mode>(() => (typeof window !== 'undefined' && window.innerWidth < 1320 ? 'preview' : 'split'));

  return (
    <ToolFrame
      tool="notes"
      view={props}
      empty={{
        title: '还没有笔记',
        description: '边学边记，支持 Markdown、公式和代码。写的时候输入 / 可以让小砚续写、列提纲、出自测题。',
        createLabel: '写第一篇笔记',
      }}
    >
      {(id) => {
        const note = notes.find((item) => item.id === id);
        return note ? <NoteEditor key={note.id} note={note} view={props} mode={mode} onMode={setMode} /> : null;
      }}
    </ToolFrame>
  );
}

function NoteEditor({ note, view, mode: pickedMode, onMode }: {
  note: StudyNote;
  view: ToolProps;
  mode: Mode;
  onMode: (mode: Mode) => void;
}) {
  const { owner, topic, topics, selectedSources, askHere } = view;
  const { go } = useWorkbenchNav();
  // 手机上放不下左右分栏：只在「编辑」和「预览」之间切换
  const narrow = useNarrow();
  // 触屏和窄屏：AI 条不浮在选区旁（会和系统的选择菜单打架），停在编辑区底部、键盘上方
  const docked = useNarrow('(max-width: 760px), (pointer: coarse)');
  const mode: Mode = narrow && pickedMode === 'split' ? 'preview' : pickedMode;
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState(note.tags);
  const [tagText, setTagText] = useState('');
  const [dirty, setDirty] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const marksRef = useRef<HTMLDivElement>(null);
  const draft = useMemo(() => ({ title, body, tags }), [title, body, tags]);

  /* ── AI 状态 ── */
  const ai = useAiRun();
  const cross = useCross(owner);
  const [flow, setFlow] = useState<Flow>(null);
  const [prompt, setPrompt] = useState('');
  const [use, setUse] = useState({ note: true, course: true, sources: true });
  const [hint, setHint] = useState<{ top: number; left: number } | null>(null);
  const [marks, setMarks] = useState<LocalRect[]>([]);
  const flowRef = useRef<Flow>(null);
  const bodyRef = useRef(body);
  const titleRef = useRef(title);
  const lastCaret = useRef<number | null>(null);
  const pointerDown = useRef(false);
  const edited = useRef(false);
  useEffect(() => { flowRef.current = flow; bodyRef.current = body; titleRef.current = title; });

  const course = note.topicId ? topics.find((item) => item.topicId === note.topicId) ?? (topic?.topicId === note.topicId ? topic : undefined) : topic;
  const sources = useMemo(() => selectedSources.filter((source) => source.content.trim()), [selectedSources]);
  const origin = useMemo(() => ({
    section: 'workbench' as const,
    label: `笔记：${clip(title || '未命名笔记', 24)}`,
    open: { view: 'workbench', params: { tool: 'notes', id: note.id } },
  }), [title, note.id]);

  const save = useCallback((value: typeof draft) => {
    // 已删除的笔记不写回
    if (!studyData.get(owner).notes.some((item) => item.id === note.id)) return;
    studyData.saveNote(owner, { id: note.id, ...value });
    setDirty(false);
  }, [owner, note.id]);
  useAutosave(draft, dirty, save);

  // 助理任务等从外部改了这篇笔记，而我这边没有未保存的改动时，跟上外部内容
  useEffect(() => {
    if (dirty) return;
    setTitle(note.title);
    setBody(note.body);
    setTags(note.tags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.updatedAt]);

  // 空笔记没有可预览的内容，打开时直接进编辑
  useEffect(() => {
    if (mode === 'preview' && !note.body.trim()) onMode('edit');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 这一次打开期间动过笔记：离开时记一条学习行为
  useEffect(() => () => {
    const text = bodyRef.current.trim();
    if (!edited.current || !text) return;
    const name = titleRef.current.trim() || '未命名笔记';
    logActivity(owner, {
      source: 'note',
      summary: `写了笔记《${clip(name, 30)}》，共 ${countWords(text)} 字`,
      ...(course ? { topicId: course.topicId, topicTitle: course.title } : {}),
      ref: { kind: 'note', id: note.id, title: name },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (next: string) => { edited.current = true; setBody(next); setDirty(true); };

  /* ── 改写正文：走文本框自己的编辑通道（⌘Z 能撤销），并给一个撤销提示 ── */
  const restore = (previous: string) => {
    const el = areaRef.current;
    if (el) replaceInArea(el, 0, el.value.length, previous); else edit(previous);
  };
  const write = (from: number, to: number, text: string, done: string) => {
    const before = bodyRef.current;
    const el = areaRef.current;
    if (el && el.value === before) replaceInArea(el, from, to, text);
    else edit(before.slice(0, from) + text + before.slice(to));
    toast(done, { action: { label: '撤销', onClick: () => restore(before) } });
  };
  /** 在 index 所在的那一行下面另起一段插入 */
  const insertBelow = (index: number, text: string, done: string) => {
    const now = bodyRef.current;
    const at = Math.max(0, Math.min(index, now.length));
    const line = lineAt(now, at);
    const tail = now.slice(line.end);
    const lead = now.slice(0, line.end).trim() ? '\n\n' : '';
    write(line.end, line.end, `${lead}${text.trim()}${tail && !tail.startsWith('\n\n') ? '\n' : ''}`, done);
  };
  /** 选区现在在源文里的位置：正文在等结果的时候可能被改过 */
  const locate = (sel: Sel): { from: number; to: number } | null => {
    const now = bodyRef.current;
    if (sel.from >= 0 && now.slice(sel.from, sel.to) === sel.text) return { from: sel.from, to: sel.to };
    const near = now.indexOf(sel.text, Math.max(0, sel.from - 400));
    const at = near >= 0 ? near : now.indexOf(sel.text);
    return at < 0 ? null : { from: at, to: at + sel.text.length };
  };
  /** 「插入到下方」落在哪：选区末尾那一行；预览里选的、对不上源文时按开头几个字找，再不行放到文末 */
  const belowIndex = (current: Exclude<Flow, null | { kind: 'bar' } | { kind: 'slash' }>) => {
    if (!current.sel) return current.caret;
    const hit = locate(current.sel);
    if (hit) return hit.to;
    const head = current.sel.text.split('\n')[0].slice(0, 10);
    const at = head.length >= 4 ? bodyRef.current.indexOf(head) : -1;
    return at >= 0 ? at : bodyRef.current.length;
  };

  /* ── 发起 AI ── */
  const context = (picked = { note: true, course: true, sources: true }): AiContext => ({
    noteTitle: title,
    ...(picked.note ? { noteBody: bodyRef.current } : {}),
    ...(picked.course && course ? { topic: course } : {}),
    sources: picked.sources ? sources : [],
  });
  const runAction = (action: TextAction, sel: Sel | null, caret: number, instruction?: string, picked?: typeof use) => {
    const before = bodyRef.current.slice(0, sel ? (sel.from >= 0 ? sel.from : bodyRef.current.length) : caret);
    const next: Flow = { kind: 'block', sel, caret, action, ...(instruction ? { instruction } : {}) };
    flowRef.current = next;
    setFlow(next);
    setHint(null);
    void ai.start((call) => runTextAction(action, { ...(sel ? { selection: sel.text } : {}), before, ...(instruction ? { instruction } : {}), context: context(picked) }, call));
  };
  const openPrompt = (sel: Sel | null, caret: number) => {
    setPrompt('');
    setHint(null);
    const next: Flow = { kind: 'prompt', sel, caret };
    flowRef.current = next;
    setFlow(next);
  };
  const close = () => {
    ai.reset();
    flowRef.current = null;
    setFlow(null);
    areaRef.current?.focus({ preventScroll: true });
  };

  /** 把选中的内容并进同一门课最近的导图；没有就新建一张 */
  const addToMap = async (text: string) => {
    const target = note.topicId
      ? [...studyData.get(owner).mindmaps].filter((map) => map.topicId === note.topicId).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))[0]
      : undefined;
    if (!target) {
      void cross('make-mindmap', { text, title: title || '未命名笔记', origin, ...(course ? { topicId: course.topicId, topicTitle: course.title } : {}) });
      return;
    }
    const id = toast.loading('正在加入导图…');
    try {
      const short = text.trim().length < 30 && !text.trim().includes('\n');
      const made = short ? null : await generateMindMap({ sources: [], text });
      const branch = made ? mindNode(clip(made.data.root.text || title || '笔记摘录', 24), made.data.root.children) : mindNode(text.trim());
      const fresh = studyData.get(owner).mindmaps.find((map) => map.id === target.id) ?? target;
      studyData.saveMindMap(owner, { ...fresh, root: { ...fresh.root, children: [...(fresh.root.children ?? []), branch] } });
      toast.success(`已加入导图《${clip(target.title || '未命名导图', 16)}》`, {
        id,
        description: made?.local ? '本地演示：按规则从选中的内容里整理，没有经过模型。' : undefined,
        action: { label: '打开', onClick: () => go('mindmap', target.id) },
      });
    } catch {
      toast.error('这次没有成功，可以再试一次', { id });
    }
  };

  const pickBar = (action: BarAction) => {
    const current = flowRef.current;
    if (current?.kind !== 'bar') return;
    const { sel } = current;
    const link = course ? { topicId: course.topicId, topicTitle: course.title } : {};
    if (action === 'cards') { setFlow(null); void cross('make-flashcards', { text: sel.text, title: title || '笔记摘录', origin, ...link }); return; }
    if (action === 'quiz') { setFlow(null); void cross('make-quiz', { text: sel.text, title: title || '笔记摘录', origin, ...link }); return; }
    if (action === 'map') { setFlow(null); void addToMap(sel.text); return; }
    if (action === 'ask') { openPrompt(sel, sel.to); return; }
    runAction(action, sel, sel.to);
  };

  /* ── 格式 ── */
  const apply = (mark: Mark) => {
    const el = areaRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const selected = value.slice(a, b);
    let next = value;
    let from = a;
    let to = b;
    const wrap = (left: string, right: string, placeholder: string) => {
      const inner = selected || placeholder;
      next = value.slice(0, a) + left + inner + right + value.slice(b);
      from = a + left.length;
      to = from + inner.length;
    };
    const prefix = (lead: string) => {
      const start = value.lastIndexOf('\n', a - 1) + 1;
      const block = value.slice(start, b);
      const replaced = block.split('\n').map((line) => lead + line).join('\n');
      next = value.slice(0, start) + replaced + value.slice(b);
      from = a + lead.length;
      to = b + replaced.length - block.length;
    };
    if (mark === 'bold') wrap('**', '**', '重点');
    else if (mark === 'italic') wrap('*', '*', '强调');
    else if (mark === 'code' && selected.includes('\n')) wrap('```\n', '\n```', '');
    else if (mark === 'code') wrap('`', '`', 'code');
    else if (mark === 'math') wrap('$', '$', 'x^2');
    else if (mark === 'heading') prefix('## ');
    else if (mark === 'list') prefix('- ');
    else if (mark === 'todo') prefix('- [ ] ');
    else prefix('> ');
    edit(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(from, to); });
  };

  /* ── 斜杠菜单 ── */
  const pickSlash = (command: SlashCommand) => {
    const el = areaRef.current;
    const current = flowRef.current;
    if (!el || current?.kind !== 'slash') return;
    const { at } = current;
    // 先收起菜单再删掉「/筛选词」，免得删字触发的改动又被当成筛选
    flowRef.current = null;
    setFlow(null);
    replaceInArea(el, at, Math.max(at, el.selectionStart), '');
    if (command.id === 'heading' || command.id === 'list' || command.id === 'todo') { apply(command.id); return; }
    if (command.id === 'code') { replaceInArea(el, at, at, '```\n\n```'); el.setSelectionRange(at + 4, at + 4); return; }
    if (command.id === 'todos') {
      const today = dayKey();
      const items = studyData.get(owner).todos.filter((todo) => { const day = dueDay(todo.due); return !todo.done && day !== null && day <= today; });
      if (!items.length) { toast('今天没有到期的待办'); return; }
      write(at, at, `${items.map((todo) => `- [ ] ${todo.text}`).join('\n')}\n`, `已插入今天的 ${items.length} 条待办`);
      return;
    }
    if (command.id === 'ask') { openPrompt(null, at); return; }
    runAction(command.id, null, at);
  };

  /* ── 空行提示 ── */
  const refreshHint = () => {
    const el = areaRef.current;
    if (!el || docked || flowRef.current || document.activeElement !== el || el.selectionStart !== el.selectionEnd || !el.value) { setHint(null); return; }
    if (lineAt(el.value, el.selectionStart).text !== '') { setHint(null); return; }
    const rect = caretRect(el, el.selectionStart);
    const box = el.getBoundingClientRect();
    const top = rect.top - box.top;
    setHint(top < 0 || top > box.height - rect.height ? null : { top, left: rect.left - box.left });
  };

  /* ── 文本框事件 ── */
  const syncSelection = () => {
    const el = areaRef.current;
    if (!el) return;
    lastCaret.current = el.selectionEnd;
    const current = flowRef.current;
    if (current && current.kind !== 'bar') return;
    if (pointerDown.current) return;
    const { selectionStart: from, selectionEnd: to } = el;
    const text = el.value.slice(from, to);
    if (to > from && text.trim().length >= 2) setFlow({ kind: 'bar', sel: { from, to, text } });
    else if (current) setFlow(null);
    refreshHint();
  };

  useEffect(() => {
    const up = () => {
      if (!pointerDown.current) return;
      pointerDown.current = false;
      // 松开鼠标后选区才定下来
      setTimeout(syncSelection, 0);
    };
    // 触屏上拖动选择手柄不会有键盘和鼠标事件：跟着选区变化走
    let timer: ReturnType<typeof setTimeout> | undefined;
    const moved = () => {
      if (document.activeElement !== areaRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(syncSelection, 200);
    };
    document.addEventListener('mouseup', up);
    document.addEventListener('touchend', up);
    document.addEventListener('selectionchange', moved);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchend', up);
      document.removeEventListener('selectionchange', moved);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 预览里选中文字：同样给出 AI 条
  useEffect(() => {
    if (mode === 'edit') return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const current = flowRef.current;
      if (current && current.kind !== 'bar') return;
      const picked = document.getSelection();
      const preview = previewRef.current;
      if (picked && preview && picked.rangeCount > 0 && !picked.isCollapsed && preview.contains(picked.anchorNode) && preview.contains(picked.focusNode)) {
        const text = picked.toString().trim();
        if (text.length >= 2) {
          const at = bodyRef.current.indexOf(text);
          setFlow({ kind: 'bar', sel: { from: at, to: at < 0 ? -1 : at + text.length, text, range: picked.getRangeAt(0).cloneRange() } });
          return;
        }
      }
      if (current?.kind === 'bar' && current.sel.range) setFlow(null);
    };
    const onChange = () => { clearTimeout(timer); timer = setTimeout(check, 220); };
    document.addEventListener('selectionchange', onChange);
    return () => { clearTimeout(timer); document.removeEventListener('selectionchange', onChange); };
  }, [mode]);

  const onAreaChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    const { value } = el;
    const caret = el.selectionStart;
    const grew = value.length - bodyRef.current.length;
    edit(value);
    bodyRef.current = value;
    const current = flowRef.current;
    if (current?.kind === 'slash') {
      const query = value.slice(current.at + 1, caret);
      const alive = caret > current.at && SLASH_CHARS.includes(value[current.at] ?? ' ') && !/\s/.test(query) && query.length <= 10 && filterSlash(query).length > 0;
      const next: Flow = alive ? { ...current, query, index: 0 } : null;
      flowRef.current = next;
      setFlow(next);
    } else if (!current && grew === 1 && caret > 0 && SLASH_CHARS.includes(value[caret - 1]) && (caret === 1 || /\s/.test(value[caret - 2]))) {
      const next: Flow = { kind: 'slash', at: caret - 1, query: '', index: 0 };
      flowRef.current = next;
      setFlow(next);
      setHint(null);
    } else if (current?.kind === 'bar') {
      setFlow(null);
    }
  };

  const onAreaKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const el = event.currentTarget;
    const mod = event.metaKey || event.ctrlKey;
    const current = flowRef.current;
    if (current?.kind === 'slash') {
      const items = filterSlash(current.query);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setFlow({ ...current, index: (current.index + step + items.length) % items.length });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); const picked = items[current.index]; if (picked) pickSlash(picked); return; }
      if (event.key === 'Escape') { event.preventDefault(); setFlow(null); return; }
    }
    if (event.key === 'Escape' && current) { event.preventDefault(); if (current.kind === 'bar') setFlow(null); else close(); return; }
    // 空行上按空格：打开「问 AI」
    if (event.key === ' ' && !current && !mod && !event.altKey && el.selectionStart === el.selectionEnd && el.value && lineAt(el.value, el.selectionStart).text === '') {
      event.preventDefault();
      openPrompt(null, el.selectionStart);
      return;
    }
    if (mod && event.key.toLowerCase() === 'b') { event.preventDefault(); apply('bold'); }
    else if (mod && event.key.toLowerCase() === 'i') { event.preventDefault(); apply('italic'); }
    else if (mod && event.key.toLowerCase() === 'j') { event.preventDefault(); askAi(); }
    else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const at = el.selectionStart;
      edit(`${el.value.slice(0, at)}  ${el.value.slice(el.selectionEnd)}`);
      requestAnimationFrame(() => el.setSelectionRange(at + 2, at + 2));
    }
  };

  const onAreaBlur = () => {
    setHint(null);
    // 焦点去了 AI 条、菜单或输入框时不收；点到别处才收起浮条和菜单
    setTimeout(() => {
      const current = flowRef.current;
      if (!current || (current.kind !== 'bar' && current.kind !== 'slash')) return;
      const active = document.activeElement;
      if (active === areaRef.current || (active instanceof HTMLElement && active.closest('[data-note-ai]'))) return;
      if (current.kind === 'bar' && current.sel.range) return;
      setFlow(null);
    }, 160);
  };

  /** 工具条上的「问 AI」：有选区就针对选区，没有就在光标处；预览里则落到文末 */
  const askAi = () => {
    const current = flowRef.current;
    if (current?.kind === 'bar') { openPrompt(current.sel, Math.max(0, current.sel.to)); return; }
    const el = areaRef.current;
    if (el && el.selectionEnd > el.selectionStart) {
      openPrompt({ from: el.selectionStart, to: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd) }, el.selectionEnd);
      return;
    }
    openPrompt(null, el ? el.selectionStart : lastCaret.current ?? bodyRef.current.length);
  };

  /* ── 等待结果时，在文本框下面垫出原来选中的那一段 ── */
  const pendingSel = flow && (flow.kind === 'block' || flow.kind === 'prompt') ? flow.sel : null;
  useEffect(() => {
    const el = areaRef.current;
    if (!el || !pendingSel || pendingSel.from < 0 || el.value.slice(pendingSel.from, pendingSel.to) !== pendingSel.text) { setMarks([]); return; }
    setMarks(rangeRects(el, pendingSel.from, pendingSel.to));
    if (marksRef.current) marksRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
  }, [pendingSel, body, mode]);

  /* ── 浮层的锚点 ── */
  const anchor = useCallback((): AnchorRect | null => {
    const current = flowRef.current;
    if (!current) return null;
    const el = areaRef.current;
    const sel = 'sel' in current ? current.sel : null;
    if (sel?.range) {
      const rect = sel.range.getBoundingClientRect();
      const pane = previewRef.current ? paneOf(previewRef.current) : undefined;
      if (rect.width || rect.height) return { left: rect.left, top: rect.top, bottom: rect.bottom, ...(pane ? { pane } : {}) };
    }
    if (el) {
      const pane = paneOf(el);
      if (current.kind === 'bar') {
        const start = caretRect(el, current.sel.from);
        const end = caretRect(el, current.sel.to);
        return { left: start.left, top: start.top, bottom: end.bottom, pane };
      }
      const index = current.kind === 'slash' ? current.at : sel && sel.from >= 0 ? sel.to : current.caret;
      const rect = caretRect(el, index);
      return { left: rect.left, top: rect.top, bottom: rect.bottom, pane };
    }
    const bar = barRef.current?.getBoundingClientRect();
    const host = previewRef.current ?? rootRef.current;
    return bar ? { left: bar.left + 16, top: bar.top, bottom: bar.bottom + 2, ...(host ? { pane: paneOf(host) } : {}) } : null;
  }, []);

  /* ── 问小砚面板：报告正在看的笔记 ── */
  useAiFocus({
    kind: 'note',
    id: note.id,
    label: '笔记',
    title,
    ...(flow?.kind === 'bar' ? { detail: flow.sel.text } : {}),
    ...(note.topicId ? { topicId: note.topicId } : {}),
    getText: () => bodyRef.current,
    insert: (markdown) => insertBelow(lastCaret.current ?? bodyRef.current.length, markdown, '已插入笔记'),
  });

  const addTag = () => {
    const tag = tagText.trim().replace(/^#/, '').slice(0, 16);
    setTagText('');
    if (!tag || tags.includes(tag)) return;
    setTags([...tags, tag].slice(0, 8));
    edited.current = true;
    setDirty(true);
  };

  const tools: { mark: Mark; label: string; icon: typeof Bold; shortcut?: string }[] = [
    { mark: 'heading', label: '小标题', icon: Heading2 },
    { mark: 'bold', label: '加粗', icon: Bold, shortcut: '⌘B' },
    { mark: 'italic', label: '强调', icon: Italic, shortcut: '⌘I' },
    { mark: 'list', label: '列表', icon: List },
    { mark: 'todo', label: '待核对项', icon: ListChecks },
    { mark: 'quote', label: '引用', icon: Quote },
    { mark: 'code', label: '代码', icon: Code },
    { mark: 'math', label: '公式', icon: Sigma },
  ];

  /* ── 当前浮层的内容 ── */
  const chips: ContextChip[] = [
    { id: 'note', label: '本篇笔记', on: use.note },
    ...(course ? [{ id: 'course' as const, label: `当前课程 · ${clip(course.title, 10)}`, on: use.course }] : []),
    ...(sources.length ? [{ id: 'sources' as const, label: `已选资料 ${sources.length} 份`, on: use.sources }] : []),
  ];
  let layer: { place: 'above' | 'below' | 'wide'; node: ReactNode; onOutside?: () => void } | null = null;
  if (flow?.kind === 'bar') {
    layer = { place: 'above', node: <SelectionBar onPick={pickBar} /> };
  } else if (flow?.kind === 'slash') {
    layer = {
      place: 'below',
      node: <SlashMenu items={filterSlash(flow.query)} index={flow.index} query={flow.query} onPick={pickSlash} onHover={(index) => setFlow({ ...flow, index })} />,
    };
  } else if (flow?.kind === 'prompt') {
    const { sel, caret } = flow;
    const quick: { id: TextAction; label: string }[] = sel
      ? [{ id: 'explain', label: '解释' }, { id: 'polish', label: '润色' }, { id: 'translate', label: '翻译' }]
      : [{ id: 'continue', label: '续写' }, { id: 'summarize', label: '总结上文' }, { id: 'outline', label: '列提纲' }, { id: 'example', label: '举例' }];
    layer = {
      place: 'wide',
      onOutside: () => { if (!prompt.trim()) close(); },
      node: (
        <PromptBox
          value={prompt}
          onChange={setPrompt}
          onSubmit={() => runAction('ask', sel, caret, prompt.trim(), use)}
          onClose={close}
          chips={chips}
          onToggle={(id) => setUse((current) => ({ ...current, [id]: !current[id] }))}
          {...(sel ? { selection: sel.text } : {})}
          quick={quick}
          onQuick={(id) => runAction(id, sel, caret, undefined, use)}
        />
      ),
    };
  } else if (flow?.kind === 'block') {
    const current = flow;
    const replaces = Boolean(current.sel) && REPLACING.includes(current.action);
    const text = ai.state.text;
    const finish = () => { ai.reset(); flowRef.current = null; setFlow(null); };
    const actions: AiBlockAction[] = [];
    if (replaces || (current.sel && current.action === 'ask')) {
      actions.push({
        label: '接受替换',
        primary: replaces,
        onClick: () => {
          const hit = current.sel ? locate(current.sel) : null;
          if (!hit) { toast('这段文字已经改动，对不上原来的位置了。可以改用「插入到下方」。'); return; }
          write(hit.from, hit.to, text, '已替换选中的文字');
          finish();
        },
      });
    }
    actions.push({
      label: current.sel ? '插入到下方' : '插入',
      primary: !replaces,
      onClick: () => {
        if (current.sel) insertBelow(belowIndex(current), text, '已插入到下方');
        else {
          const now = bodyRef.current;
          const at = Math.max(0, Math.min(current.caret, now.length));
          const line = lineAt(now, at);
          // 光标在空行上：就地放下；否则另起一段
          if (line.text.trim() === '') write(line.start, line.end, text.trim(), '已插入');
          else insertBelow(at, text, '已插入');
        }
        finish();
      },
    });
    const name = current.action === 'ask' && current.instruction ? `问 AI · ${clip(current.instruction, 18)}` : TEXT_ACTIONS[current.action].label;
    layer = {
      place: 'wide',
      node: (
        <AiBlock
          tone="float"
          state={ai.state}
          title={name}
          doing={TEXT_ACTIONS[current.action].doing}
          actions={actions}
          onRetry={() => void ai.retry()}
          onStop={ai.stop}
          onDiscard={close}
        />
      ),
    };
  }

  return (
    <div className={`${s.card} ${n.editor}`} ref={rootRef}>
      <DetailHead
        title={title}
        onTitle={(value) => { setTitle(value); edited.current = true; setDirty(true); }}
        badges={<ItemOrigin owner={owner} kind="note" id={note.id} origin={note.origin} />}
      >
        <Button variant="ghost" size="sm" icon={<IconSpark size={16} />} onClick={() => askHere()}>问小砚</Button>
        <SendMenu view={view} item={{ kind: 'note', id: note.id, label: '笔记', title, ...(note.topicId ? { topicId: note.topicId } : {}), text: () => bodyRef.current }} />
        <IconButton label="导出 Markdown" size="sm" onClick={() => exportNote({ title, body })}><Download {...ICON_SM} /></IconButton>
      </DetailHead>

      <div className={n.tags}>
        {tags.map((tag) => (
          <span key={tag} className={n.tag}>
            {tag}
            <button type="button" aria-label={`移除标签 ${tag}`} onClick={() => { setTags(tags.filter((item) => item !== tag)); setDirty(true); }}>
              <X size={12} strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          className={n.tagInput}
          value={tagText}
          placeholder={tags.length ? '添加标签' : '添加标签，回车确认'}
          aria-label="添加标签"
          onChange={(event) => setTagText(event.target.value)}
          onBlur={addTag}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',' || event.key === '，') { event.preventDefault(); addTag(); }
            if (event.key === 'Backspace' && !tagText && tags.length) { setTags(tags.slice(0, -1)); setDirty(true); }
          }}
        />
      </div>

      <div className={n.bar} ref={barRef}>
        <span className={n.askAi} onMouseDown={(event) => event.preventDefault()}>
          <Button variant="soft" size="sm" icon={<IconSpark size={16} />} title="问 AI（⌘J）。在空行按空格也可以" onClick={askAi}>问 AI</Button>
        </span>
        {/* 点格式按钮时不让焦点离开正文，手机上键盘不会收起再弹出 */}
        <div className={n.marks} data-off={mode === 'preview'} onMouseDown={(event) => event.preventDefault()}>
          {tools.map(({ mark, label, icon: Icon, shortcut }) => (
            <IconButton key={mark} label={label} shortcut={shortcut} size="sm" disabled={mode === 'preview'} onClick={() => apply(mark)}>
              <Icon {...ICON_SM} />
            </IconButton>
          ))}
        </div>
        <span className={s.saved} aria-live="polite">
          {dirty ? '正在保存…' : <><Check size={13} strokeWidth={2} />已保存</>}
          <span className={n.count}> · {countWords(body)} 字</span>
        </span>
        <Segmented
          size="sm"
          label="视图"
          value={mode}
          onChange={onMode}
          options={[
            { value: 'edit' as const, label: '编辑', icon: <SquarePen {...ICON_SM} /> },
            ...(narrow ? [] : [{ value: 'split' as const, label: '分栏', icon: <Columns2 {...ICON_SM} /> }]),
            { value: 'preview' as const, label: '预览', icon: <Eye {...ICON_SM} /> },
          ]}
        />
      </div>

      <div className={n.body} data-mode={mode} data-docked={docked && layer ? '' : undefined}>
        {mode !== 'preview' && (
          <div className={n.areaWrap}>
            <div className={n.marksLayer} aria-hidden="true">
              <div ref={marksRef}>
                {marks.map((rect, index) => <i key={index} style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />)}
              </div>
            </div>
            <textarea
              ref={areaRef}
              className={n.area}
              value={body}
              spellCheck={false}
              placeholder={`${EMPTY_HINT}\n\n支持 Markdown：## 小标题、- 要点、**重点**、\`代码\`、公式 $E = mc^2$\n在空行按空格，可以直接向小砚提要求`}
              aria-label="笔记正文"
              onChange={onAreaChange}
              onKeyDown={onAreaKey}
              onKeyUp={syncSelection}
              onSelect={syncSelection}
              onFocus={() => setTimeout(refreshHint, 0)}
              onBlur={onAreaBlur}
              onMouseDown={() => { pointerDown.current = true; }}
              onTouchStart={() => { pointerDown.current = true; }}
              onScroll={(event) => {
                if (marksRef.current) marksRef.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
                if (hint) refreshHint();
              }}
            />
            {hint && <span className={n.lineHint} style={{ top: hint.top, left: hint.left }} aria-hidden="true">{EMPTY_HINT}</span>}
          </div>
        )}
        {mode !== 'edit' && (
          <div className={`${n.preview} ${s.prose}`} ref={previewRef}>
            {body.trim() ? <CoachMarkdown text={body} /> : <p className={n.previewEmpty}>写下的内容会在这里排好版。</p>}
          </div>
        )}
      </div>

      {layer && (docked
        ? <div className={n.dock} data-note-ai="" data-kind={flow?.kind}>{layer.node}</div>
        : <Float anchor={anchor} place={layer.place} watch={`${flow?.kind}:${body.length}:${ai.state.status}:${ai.state.text.length}`} {...(layer.onOutside ? { onOutside: layer.onOutside } : {})}>{layer.node}</Float>)}
    </div>
  );
}
