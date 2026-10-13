/**
 * 工作台里 AI 的统一样子：一个「AI 块」（流式结果 + 接受 / 插入 / 重试 / 丢弃 / 复制）、一个 AI 菜单、
 * 条目的「来源」与「发送到」。六个工具都用这一套，图标只用 IconSpark。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ArrowUpRight, Copy, Forward, RotateCcw, Square, X } from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { stashHandoff } from '../../../../components/handoff/stash';
import { useOpenTarget } from '../../../../components/handoff/useOpenTarget';
import { Badge, Button, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Shimmer, Skeleton, cx, toast } from '../../../../components/ui';
import { IconAgent, IconChat, IconClassroom, IconFlashcard, IconMindmap, IconNote, IconQuiz, IconSpark, IconTeach, IconTodo } from '../../../../components/ui/icons';
import { CROSS_ACTION_LABELS, runCrossAction, type CrossAction, type CrossActionInput } from '../../../../lib/crossActions';
import type { Origin } from '../../../../store/studyData';
import type { TerminalViewProps } from '../types';
import { isAbort } from './actions';
import { aiErrorText, type AiOutcome, type AiTask } from './ai';
import { ORIGIN_SECTION_LABELS, itemKey, useItemOrigin, type ItemKind } from './origins';
import { clip } from './util';
import a from './ai.module.css';

/* ── 一次 AI 调用的状态 ── */
export interface AiRunState {
  status: 'idle' | 'thinking' | 'streaming' | 'done' | 'error';
  text: string;
  local: boolean;
  model?: string;
  note?: string;
  error?: string;
}
const IDLE: AiRunState = { status: 'idle', text: '', local: false };

export function useAiRun() {
  const [state, setState] = useState<AiRunState>(IDLE);
  const abort = useRef<AbortController | null>(null);
  const task = useRef<AiTask | null>(null);
  const stream = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | null }>({ text: '', timer: null });

  useEffect(() => () => {
    abort.current?.abort();
    if (stream.current.timer) clearTimeout(stream.current.timer);
  }, []);

  /** 开始一次调用；不传任务就是重试上一次 */
  const start = useCallback(async (next?: AiTask): Promise<AiOutcome | null> => {
    const run = next ?? task.current;
    if (!run) return null;
    task.current = run;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    stream.current.text = '';
    setState({ status: 'thinking', text: '', local: false });
    // 流式文字攒一小会儿再刷，免得每个字都重排一次 Markdown
    const flush = () => {
      stream.current.timer = null;
      if (controller.signal.aborted) return;
      setState((current) => (current.status === 'thinking' || current.status === 'streaming' ? { ...current, status: 'streaming', text: stream.current.text } : current));
    };
    try {
      const outcome = await run({
        signal: controller.signal,
        onText: (text) => {
          stream.current.text = text;
          if (!stream.current.timer) stream.current.timer = setTimeout(flush, 70);
        },
      });
      if (controller.signal.aborted) return null;
      if (stream.current.timer) { clearTimeout(stream.current.timer); stream.current.timer = null; }
      setState({ status: 'done', text: outcome.text, local: outcome.local, ...(outcome.model ? { model: outcome.model } : {}), ...(outcome.note ? { note: outcome.note } : {}) });
      return outcome;
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) return null;
      setState({ status: 'error', text: '', local: false, error: aiErrorText(error) });
      return null;
    }
  }, []);

  /** 停下：已经出来的文字留着 */
  const stop = useCallback(() => {
    abort.current?.abort();
    if (stream.current.timer) { clearTimeout(stream.current.timer); stream.current.timer = null; }
    setState((current) => (stream.current.text.trim() ? { status: 'done', text: stream.current.text.trim(), local: false, note: '已停止，下面是停下之前写出的部分。' } : current.status === 'done' ? current : IDLE));
  }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    task.current = null;
    setState(IDLE);
  }, []);

  return { state, start, retry: () => start(), stop, reset };
}
export type AiRun = ReturnType<typeof useAiRun>;

/* ── AI 块 ── */
export interface AiBlockAction { label: string; onClick: () => void; primary?: boolean; icon?: ReactNode }

export function AiBlock({ state, title, doing, actions = [], onRetry, onDiscard, onStop, format, plain, tone = 'inline', className, children }: {
  state: AiRunState;
  /** 这一块在做什么：润色、讲解这道题…… */
  title: string;
  /** 进行中的说法：正在润色 */
  doing?: string;
  /** 结果出来后的去向：接受替换、插入到下方…… */
  actions?: AiBlockAction[];
  onRetry?: () => void;
  onDiscard?: () => void;
  onStop?: () => void;
  /** 显示前整理一下文字（不影响交给 actions 的原文） */
  format?: (text: string) => string;
  /** 按原样显示，不当 Markdown 渲染 */
  plain?: boolean;
  /** float：浮在正文上面的卡片；inline：嵌在版面里 */
  tone?: 'inline' | 'float';
  className?: string;
  children?: ReactNode;
}) {
  const { status, text } = state;
  if (status === 'idle') return null;
  const running = status === 'thinking' || status === 'streaming';
  const usable = status === 'done' && Boolean(text.trim());
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => toast('已复制'), () => toast.error('复制没有成功'));
  };

  return (
    <section className={cx(a.block, className)} data-tone={tone} data-status={status} aria-live="polite" aria-busy={running || undefined}>
      <header className={a.blockHead}>
        <span className={a.spark} data-running={running || undefined}><IconSpark size={16} /></span>
        <span className={a.blockTitle}>{title}</span>
        {running && <Shimmer className={a.doing}>{doing ?? '正在思考'}…</Shimmer>}
        {status === 'done' && (state.local
          ? <Badge tone="warn" title="当前没有可用模型，结果按规则从手头的内容里整理">本地演示</Badge>
          : state.model && <span className={a.model} title="生成这段内容的模型">{state.model}</span>)}
        <span className={a.blockTools}>
          {usable && <IconButton label="复制" size="sm" onClick={copy}><Copy size={14} strokeWidth={1.75} /></IconButton>}
          {onDiscard && <IconButton label={running ? '取消' : '丢弃'} size="sm" onClick={onDiscard}><X size={15} strokeWidth={1.75} /></IconButton>}
        </span>
      </header>

      <div className={a.blockBody}>
        {status === 'thinking' && (
          <div className={a.lines} aria-hidden="true">
            <Skeleton width="92%" />
            <Skeleton width="76%" />
            <Skeleton width="54%" />
          </div>
        )}
        {text.trim() && (plain
          ? <div className={a.plain}>{format ? format(text) : text}</div>
          : <div className={a.md}><CoachMarkdown text={format ? format(text) : text} /></div>)}
        {children}
        {status === 'done' && state.note && <p className={a.note}>{state.note}</p>}
        {status === 'error' && <p className={a.error} role="alert">{state.error}</p>}
      </div>

      <footer className={a.blockFoot}>
        {running && onStop && <Button variant="soft" size="sm" icon={<Square size={12} strokeWidth={2} />} onClick={onStop}>停止</Button>}
        {usable && actions.map((action) => (
          <Button key={action.label} variant={action.primary ? 'solid' : 'soft'} size="sm" icon={action.icon} onClick={action.onClick}>{action.label}</Button>
        ))}
        {!running && onRetry && <Button variant="ghost" size="sm" icon={<RotateCcw size={14} strokeWidth={1.75} />} onClick={onRetry}>重试</Button>}
        {!running && onDiscard && <Button variant="ghost" size="sm" onClick={onDiscard}>{usable ? '丢弃' : '关闭'}</Button>}
      </footer>
    </section>
  );
}

/* ── AI 菜单 ── */
export type AiMenuEntry =
  | { key: string; label: string; hint?: string; icon?: ReactNode; onSelect: () => void }
  | { key: string; heading: string }
  | { key: string; separator: true };

export function AiMenu({ entries, label = 'AI', iconOnly, align = 'end', size = 'sm', variant = 'ghost' }: {
  entries: AiMenuEntry[];
  label?: string;
  /** 只显示图标（行内、工具条里） */
  iconOnly?: boolean;
  align?: 'start' | 'center' | 'end';
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'soft' | 'outline';
}) {
  if (!entries.some((entry) => 'onSelect' in entry)) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        {iconOnly
          ? <IconButton label={label} size={size} tip={false} className={a.menuIcon}><IconSpark size={16} /></IconButton>
          : <Button variant={variant} size={size} icon={<IconSpark size={16} />} className={a.menuBtn}>{label}</Button>}
      </MenuTrigger>
      <MenuContent align={align} onCloseAutoFocus={(event) => event.preventDefault()}>
        {entries.map((entry) => ('heading' in entry
          ? <MenuLabel key={entry.key}>{entry.heading}</MenuLabel>
          : 'separator' in entry
            ? <MenuSeparator key={entry.key} />
            : <MenuItem key={entry.key} icon={entry.icon ?? <IconSpark size={15} />} hint={entry.hint} onSelect={entry.onSelect}>{entry.label}</MenuItem>))}
      </MenuContent>
    </Menu>
  );
}

/* ── 跨工具：把一段内容变成别的东西 ── */
const DONE_LABELS: Record<CrossAction, string> = {
  'save-note': '已存为笔记', 'make-flashcards': '闪卡做好了', 'make-mindmap': '导图整理好了', 'make-quiz': '题目出好了', 'add-todos': '已加入待办',
};

/** 执行跨板块动作，并用提示条报告进度与结果；结果条上可以直接打开 */
export function useCross(owner: string | null) {
  const open = useOpenTarget();
  return useCallback(async (action: CrossAction, input: Omit<CrossActionInput, 'signal'>) => {
    if (!input.text.trim()) { toast('这里还没有可以处理的内容'); return null; }
    const id = toast.loading(`正在${CROSS_ACTION_LABELS[action]}…`);
    try {
      const result = await runCrossAction(owner, action, input);
      toast.success(`${DONE_LABELS[action]}：${clip(result.title, 20)}`, {
        id,
        description: result.method === 'local' ? '本地演示：按规则从内容里整理，没有经过模型。' : undefined,
        action: { label: '打开', onClick: () => open(result.open) },
      });
      return result;
    } catch (reason) {
      toast.error(reason instanceof Error && reason.message ? reason.message : '这次没有成功，可以再试一次', { id });
      return null;
    }
  }, [owner, open]);
}

/* ── 来源 ── */
/** 条目标题旁的来源：记了具体来源就显示可以跳回去的那一条，否则只标「助理 / 对话」 */
export function ItemOrigin({ owner, kind, id, origin, originKey }: {
  owner: string | null;
  kind: ItemKind;
  id: string;
  origin: Origin;
  /** 来源表里的键不是 `${kind}:${id}` 时另给（单条待办记在 todo:<id> 上） */
  originKey?: string;
}) {
  const from = useItemOrigin(owner, originKey ?? itemKey(kind, id));
  const open = useOpenTarget();
  if (!from) {
    if (origin === 'agent') return <Badge tone="accent" title="由助理任务写入">助理</Badge>;
    if (origin === 'chat') return <Badge title="从对话保存">对话</Badge>;
    return null;
  }
  const text = `${ORIGIN_SECTION_LABELS[from.section] ?? '别处'}${from.label ? ` · ${clip(from.label.replace(/^(对话|助理任务|工作台|AI 课堂|科研台)[：:·\s]+/, ''), 18)}` : ''}`;
  const target = from.open;
  if (!target) return <span className={a.origin} title={from.label}>来自{text}</span>;
  return (
    <button type="button" className={a.origin} title={`回到来源：${from.label ?? text}`} onClick={() => open(target)}>
      来自{text}<ArrowUpRight size={13} strokeWidth={1.75} />
    </button>
  );
}

/* ── 发送到 ── */
export interface SendItem {
  kind: ItemKind;
  id: string;
  /** 「笔记」「思维导图」…… */
  label: string;
  title: string;
  topicId?: string;
  /** 条目的可读正文（Markdown），点选时再取 */
  text: () => string;
}

const CONVERT: Record<ItemKind, CrossAction[]> = {
  note: ['make-flashcards', 'make-quiz', 'make-mindmap', 'add-todos'],
  mindmap: ['save-note', 'make-flashcards', 'make-quiz'],
  quiz: ['make-flashcards', 'save-note'],
  deck: ['save-note', 'make-quiz'],
  writing: ['save-note'],
  'todo-list': [],
};
const CROSS_ICONS: Record<CrossAction, ReactNode> = {
  'save-note': <IconNote size={16} />,
  'make-flashcards': <IconFlashcard size={16} />,
  'make-mindmap': <IconMindmap size={16} />,
  'make-quiz': <IconQuiz size={16} />,
  'add-todos': <IconTodo size={16} />,
};
const TOOL_OF: Record<ItemKind, string> = { note: 'notes', mindmap: 'mindmap', quiz: 'quiz', deck: 'flashcards', writing: 'writing', 'todo-list': 'todos' };

/** 这个条目能去的地方：问小砚、讲给小白、交给助理、生成 AI 课，以及变成另一种学习材料 */
export function SendMenu({ view, item }: { view: TerminalViewProps; item: SendItem }) {
  const navigate = useNavigate();
  const cross = useCross(view.owner);
  const topicId = item.topicId ?? view.topic?.topicId;
  const course = topicId ? view.topics.find((topic) => topic.topicId === topicId) : undefined;
  const key = itemKey(item.kind, item.id);
  const name = item.title.trim() || `未命名${item.label}`;
  const origin = { section: 'workbench' as const, label: `${item.label}：${clip(name, 24)}`, open: { view: 'workbench', params: { tool: TOOL_OF[item.kind], id: item.id } } };
  const body = () => item.text().trim();
  const need = () => {
    const text = body();
    if (!text) toast(`这份${item.label}还是空的，先写点内容`);
    return text;
  };

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="发送到" size="sm" tip={false}><Forward size={15} strokeWidth={1.75} /></IconButton>
      </MenuTrigger>
      <MenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
        <MenuLabel>发送到</MenuLabel>
        <MenuItem
          icon={<IconChat size={16} />}
          hint="带着这份内容回到对话"
          onSelect={() => { const text = need(); if (text) view.onAsk(`请看看我的${item.label}《${name}》，哪里讲错了、漏了什么，请直接指出来：\n\n${clip(text, 1800)}`); }}
        >
          问小砚
        </MenuItem>
        {course && (
          <MenuItem icon={<IconTeach size={16} />} hint={`把《${clip(course.title, 12)}》讲出来`} onSelect={() => navigate(`/teach/${encodeURIComponent(course.topicId)}`)}>讲给小白</MenuItem>
        )}
        <MenuItem
          icon={<IconAgent size={16} />}
          hint="让小砚接着把事办完"
          onSelect={() => {
            const text = need();
            if (!text) return;
            const handoff = stashHandoff({ title: name, text, origin });
            view.onView('agent', { goal: `根据我的${item.label}《${name}》继续往下做：查漏补缺，再出几道题检查理解。\n\n${clip(text, 500)}`, handoff });
          }}
        >
          交给助理
        </MenuItem>
        <MenuItem
          icon={<IconClassroom size={16} />}
          hint="用这份内容排一堂可以播放的课"
          onSelect={() => {
            const text = need();
            if (!text) return;
            view.onView('classroom', { from: key, handoff: stashHandoff({ title: name, text, origin }) });
          }}
        >
          生成 AI 课
        </MenuItem>
        {CONVERT[item.kind].length > 0 && <MenuSeparator />}
        {CONVERT[item.kind].length > 0 && <MenuLabel>变成</MenuLabel>}
        {CONVERT[item.kind].map((action) => (
          <MenuItem
            key={action}
            icon={CROSS_ICONS[action]}
            onSelect={() => { const text = need(); if (text) void cross(action, { text, title: name, origin, ...(topicId ? { topicId } : {}), ...(course ? { topicTitle: course.title } : {}) }); }}
          >
            {CROSS_ACTION_LABELS[action]}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
