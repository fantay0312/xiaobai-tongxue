/**
 * 工作台里常驻的「问小砚」：它知道此刻打开的是什么（哪篇笔记、选中的节点、正在做的题、翻到的卡），
 * 回答时把这份内容带上；回答可以一键插回笔记、做成闪卡、出成题。
 * 各工具用 useAiFocus 把「正在看什么」报上来，面板在提问那一刻再取正文。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { ArrowUp, Copy, Eraser, PanelRightClose, Square } from 'lucide-react';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import { Badge, Button, IconButton, Shimmer, toast } from '../../../../components/ui';
import { IconFlashcard, IconNote, IconQuiz, IconSpark } from '../../../../components/ui/icons';
import { logActivity } from '../../../../engine/activityLog';
import { recordTutorTurn, tutorMemoryHints } from '../../../../engine/tutorMemory';
import { newId } from '../../../../store/studyData';
import type { TerminalViewProps } from '../types';
import { isAbort } from './actions';
import { useCross } from './AiKit';
import { aiErrorText, askPanel, type PanelTurn } from './ai';
import type { ItemKind } from './origins';
import { clip } from './util';
import a from './ai.module.css';

/* ── 正在看什么 ── */
export interface AiFocus {
  kind: ItemKind;
  id: string;
  /** 「笔记」「思维导图」…… */
  label: string;
  title: string;
  /** 此刻选中的东西：一段文字、一个节点、一道题、一张卡 */
  detail?: string;
  topicId?: string;
  /** 条目的可读正文，提问时再取 */
  getText: () => string;
  /** 把一段 Markdown 插进当前笔记（只有笔记提供） */
  insert?: (markdown: string) => void;
}

let current: AiFocus | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getAiFocus = () => current;

/** 工具把「正在看什么」报给面板。标题或选中的东西变了才重新上报，正文通过 getText 现取 */
export function useAiFocus(focus: AiFocus | null): void {
  const latest = useRef(focus);
  useEffect(() => { latest.current = focus; });
  const signature = focus ? `${focus.kind}:${focus.id}|${focus.title}|${focus.detail ?? ''}|${focus.insert ? 1 : 0}` : '';
  useEffect(() => {
    const now = latest.current;
    if (!now) return undefined;
    const published: AiFocus = {
      ...now,
      getText: () => latest.current?.getText() ?? '',
      ...(now.insert ? { insert: (markdown: string) => latest.current?.insert?.(markdown) } : {}),
    };
    current = published;
    emit();
    return () => {
      if (current === published) { current = null; emit(); }
    };
  }, [signature]);
}

/* ── 一段问答 ── */
export interface PanelMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'thinking' | 'streaming' | 'done' | 'error';
  local?: boolean;
  model?: string;
  note?: string;
  /** 这条回答对应的问题，给产物起名、记来源用 */
  question?: string;
}

export function useAskSession(view: TerminalViewProps) {
  const [messages, setMessages] = useState<PanelMessage[]>([]);
  const abort = useRef<AbortController | null>(null);
  const viewRef = useRef(view);
  const log = useRef<PanelMessage[]>([]);
  useEffect(() => { viewRef.current = view; log.current = messages; });
  useEffect(() => () => abort.current?.abort(), []);

  const busy = messages.some((message) => message.status === 'thinking' || message.status === 'streaming');

  const send = useCallback(async (raw: string) => {
    const question = raw.trim();
    if (!question) return;
    const { owner, topic, topics } = viewRef.current;
    const focus = getAiFocus();
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const history: PanelTurn[] = log.current
      .filter((message) => message.content.trim() && (message.role === 'user' || message.status === 'done'))
      .map((message) => ({ role: message.role, content: message.content }));
    const answerId = newId();
    const patch = (next: Partial<PanelMessage>) => setMessages((list) => list.map((message) => (message.id === answerId ? { ...message, ...next } : message)));
    setMessages((list) => [
      // 上一条还没答完就被新问题打断的，标成已停下
      ...list.map((message) => (message.status === 'thinking' || message.status === 'streaming' ? { ...message, status: 'done' as const } : message)).filter((message) => message.role === 'user' || message.content.trim() || message.note),
      { id: newId(), role: 'user', content: question },
      { id: answerId, role: 'assistant', content: '', status: 'thinking', question },
    ]);
    const topicId = focus?.topicId ?? topic?.topicId;
    const course = topicId ? topics.find((item) => item.topicId === topicId) ?? topic : topic;
    let last = 0;
    try {
      const outcome = await askPanel({
        question,
        history,
        focus: focus ? { label: focus.label, title: focus.title, text: focus.getText(), ...(focus.detail ? { detail: focus.detail } : {}) } : null,
        ...(course ? { topic: course } : {}),
        memory: tutorMemoryHints(owner, topicId, 4),
      }, {
        signal: controller.signal,
        onText: (text) => {
          const now = Date.now();
          if (now - last < 70) return;
          last = now;
          patch({ content: text, status: 'streaming' });
        },
      });
      if (controller.signal.aborted) return;
      patch({ content: outcome.text, status: 'done', local: outcome.local, ...(outcome.model ? { model: outcome.model } : {}), ...(outcome.note ? { note: outcome.note } : {}) });
      if (!outcome.local && outcome.text) {
        recordTutorTurn(owner, { ...(course ? { topicId: course.topicId, topicTitle: course.title } : {}), question, answer: outcome.text });
        logActivity(owner, {
          source: 'chat',
          summary: `在工作台问小砚：${clip(question.replace(/\s+/g, ' '), 60)}`,
          signal: 'interest',
          ...(course ? { topicId: course.topicId, topicTitle: course.title } : {}),
          ...(focus ? { detail: `当时在看${focus.label}《${focus.title || '未命名'}》`, ref: { kind: focus.kind, id: focus.id, title: focus.title } } : {}),
        });
      }
    } catch (error) {
      if (controller.signal.aborted || isAbort(error)) return;
      patch({ status: 'error', note: aiErrorText(error) });
    }
  }, []);

  const stop = useCallback(() => {
    abort.current?.abort();
    setMessages((list) => list
      .map((message) => (message.status === 'thinking' || message.status === 'streaming' ? { ...message, status: 'done' as const, note: message.content.trim() ? '已停止。' : undefined } : message))
      .filter((message) => message.role === 'user' || message.content.trim() || message.note));
  }, []);

  const clear = useCallback(() => { abort.current?.abort(); setMessages([]); }, []);

  return { messages, busy, send, stop, clear };
}
export type AskSession = ReturnType<typeof useAskSession>;

/* ── 面板 ── */
const STARTERS: Record<ItemKind | 'none', (focus: AiFocus | null) => string[]> = {
  note: (focus) => [focus?.detail ? '讲讲我选中的这一段' : '这篇笔记有没有讲错或漏掉的地方？', '出 3 个追问，检查我是不是真懂', '用一个例子把这篇笔记的核心讲明白'],
  mindmap: (focus) => [focus?.detail ? `讲讲「${clip(focus.detail, 12)}」这个节点` : '哪个分支最值得展开？', '这张导图的结构有没有问题？', '还缺哪些分支？'],
  quiz: (focus) => [focus?.detail ? '这道题该怎么想？' : '这套题主要考哪些知识点？', '我的错题集中在哪儿？', '做这类题有什么通用的思路？'],
  deck: (focus) => [focus?.detail ? '这张卡为什么是这个答案？' : '这组卡里哪些概念容易混？', '帮我把这组卡串成一条线', '怎么记更牢？'],
  writing: () => ['这一篇最该先改哪一处？', '帮我把开头改得更有力', '有哪些表达可以换得更地道？'],
  'todo-list': () => ['今天先做哪一件？', '这些事怎么排更合理？', '哪一件可以拆得更小？'],
  none: () => ['今天该先学什么？', '怎么用工作台复习一门课？'],
};

export function AskPanel({ view, session, onClose, sheet }: {
  view: TerminalViewProps;
  session: AskSession;
  onClose: () => void;
  /** 在底部面板里（手机）：标题和关闭由外面的面板提供 */
  sheet?: boolean;
}) {
  const focus = useSyncExternalStore(subscribe, getAiFocus, () => null);
  const { messages, busy, send, stop, clear } = session;
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const cross = useCross(view.owner);

  // 新内容出来时跟到底部；用户自己往上翻了就不打扰
  const pinned = useRef(true);
  useEffect(() => {
    const box = scroller.current;
    if (box && pinned.current) box.scrollTop = box.scrollHeight;
  }, [messages]);

  const submit = () => {
    if (!draft.trim() || busy) return;
    pinned.current = true;
    void send(draft);
    setDraft('');
  };
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
  };

  const topicId = focus?.topicId ?? view.topic?.topicId;
  const course = topicId ? view.topics.find((topic) => topic.topicId === topicId) : undefined;
  const make = (action: 'save-note' | 'make-flashcards' | 'make-quiz', message: PanelMessage) => void cross(action, {
    text: message.content,
    title: clip(message.question ?? '小砚的回答', 24),
    origin: {
      section: 'workbench',
      label: `问小砚：${clip(message.question ?? '', 24)}`,
      ...(focus ? { open: { view: 'workbench', params: { tool: TOOL_OF[focus.kind], id: focus.id, ai: '1' } } } : { open: { view: 'workbench', params: { ai: '1' } } }),
    },
    ...(topicId ? { topicId } : {}),
    ...(course ? { topicTitle: course.title } : {}),
  });
  const starters = STARTERS[focus?.kind ?? 'none'](focus);

  return (
    <div className={a.panel} data-sheet={sheet || undefined}>
      {!sheet && (
        <header className={a.panelHead}>
          <span className={a.spark}><IconSpark size={17} /></span>
          <h3>问小砚</h3>
          <span className={a.panelTools}>
            {messages.length > 0 && <IconButton label="清空对话" size="sm" onClick={clear}><Eraser size={15} strokeWidth={1.75} /></IconButton>}
            <IconButton label="收起" size="sm" onClick={onClose}><PanelRightClose size={16} strokeWidth={1.75} /></IconButton>
          </span>
        </header>
      )}

      <div className={a.seeing} title={focus ? `${focus.label}《${focus.title || '未命名'}》` : undefined}>
        <span>正在看</span>
        {focus
          ? <b>{focus.label} · {clip(focus.title || '未命名', 16)}</b>
          : <b>工作台概览</b>}
        {focus?.detail && <em>{clip(focus.detail.replace(/\s+/g, ' '), 22)}</em>}
        {sheet && messages.length > 0 && <button type="button" className={a.seeingClear} onClick={clear}>清空</button>}
      </div>

      <div
        className={a.thread}
        ref={scroller}
        onScroll={(event) => {
          const box = event.currentTarget;
          pinned.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
        }}
      >
        {messages.length === 0 ? (
          <div className={a.starters}>
            <p>{focus ? `小砚看得到你打开的这份${focus.label}，可以直接问。` : '打开一篇笔记、一张导图或一套题，小砚会带着它回答。'}</p>
            {starters.map((text) => (
              <button key={text} type="button" className={a.starter} onClick={() => { pinned.current = true; void send(text); }}>{text}</button>
            ))}
          </div>
        ) : messages.map((message) => (message.role === 'user' ? (
          <div key={message.id} className={a.ask}>{message.content}</div>
        ) : (
          <div key={message.id} className={a.answer} data-status={message.status}>
            {message.status === 'thinking' && <Shimmer>小砚正在看你打开的内容…</Shimmer>}
            {message.content.trim() && <div className={a.md}><CoachMarkdown text={message.content} /></div>}
            {message.note && <p className={message.status === 'error' ? a.error : a.note}>{message.note}</p>}
            {message.status === 'error' && message.question && (
              <div className={a.answerTools}><Button variant="soft" size="sm" onClick={() => void send(message.question ?? '')}>重试</Button></div>
            )}
            {message.status === 'done' && message.content.trim() && (
              <div className={a.answerTools}>
                {message.local
                  ? <Badge tone="warn" title="当前没有可用模型，结果按关键词从手头的内容里查找">本地演示</Badge>
                  : message.model && <span className={a.model}>{message.model}</span>}
                <span className={a.answerActions}>
                  {focus?.insert
                    ? <Button variant="soft" size="sm" icon={<IconNote size={15} />} onClick={() => focus.insert?.(message.content)}>插入笔记</Button>
                    : <Button variant="soft" size="sm" icon={<IconNote size={15} />} onClick={() => make('save-note', message)}>存为笔记</Button>}
                  <Button variant="ghost" size="sm" icon={<IconFlashcard size={15} />} onClick={() => make('make-flashcards', message)}>做成闪卡</Button>
                  <Button variant="ghost" size="sm" icon={<IconQuiz size={15} />} onClick={() => make('make-quiz', message)}>出题</Button>
                  <IconButton label="复制" size="sm" onClick={() => void navigator.clipboard?.writeText(message.content).then(() => toast('已复制'), () => toast.error('复制没有成功'))}>
                    <Copy size={14} strokeWidth={1.75} />
                  </IconButton>
                </span>
              </div>
            )}
          </div>
        )))}
      </div>

      <div className={a.composer}>
        <textarea
          ref={input}
          className={a.composerInput}
          rows={2}
          value={draft}
          placeholder={focus ? `就这份${focus.label}问小砚` : '问小砚'}
          aria-label="问小砚"
          enterKeyHint="send"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
        />
        {busy
          ? <IconButton label="停止" variant="soft" round onClick={stop}><Square size={13} strokeWidth={2} /></IconButton>
          : <IconButton label="发送" variant="solid" round disabled={!draft.trim()} onClick={submit}><ArrowUp size={17} strokeWidth={2} /></IconButton>}
      </div>
    </div>
  );
}

const TOOL_OF: Record<ItemKind, string> = { note: 'notes', mindmap: 'mindmap', quiz: 'quiz', deck: 'flashcards', writing: 'writing', 'todo-list': 'todos' };
