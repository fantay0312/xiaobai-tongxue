/**
 * 对话流：自己的滚动容器 + 消息行。
 * 生成时贴住底部；用户往上翻就松开，并给出「回到底部」。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { ArtifactOrigin } from '../../../lib/artifacts';
import { AssistantMessage, PendingMessage, UserMessage, type FeedHandlers } from './Message';
import { stopSpeaking, useSpeakingId } from './speech';
import type { ChatFeedProps } from './types';
import { useModelCatalog } from './useModelCatalog';
import s from './feed.module.css';

/** 距底部这么近就算「在底部」 */
const NEAR_BOTTOM = 32;

export function ChatFeed(props: ChatFeedProps) {
  const { conversation, busy, phase, streamingId, empty, handoff } = props;
  const messages = conversation.messages;
  // 从这段对话交出去的内容，来源都指回这段对话
  const origin = useMemo<ArtifactOrigin>(() => ({
    section: 'chat',
    label: `对话：${conversation.title}`,
    open: { view: 'ask', params: { chat: conversation.id }, ...(handoff?.topicId ? { topicId: handoff.topicId } : {}) },
  }), [conversation.id, conversation.title, handoff?.topicId]);
  /** 每条回答对应的那句提问 */
  const askedBy = useMemo(() => {
    const result = new Map<string, string>();
    let question = '';
    for (const message of messages) {
      if (message.role === 'user') question = message.text;
      else result.set(message.id, question);
    }
    return result;
  }, [messages]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const lastTop = useRef(0);
  const touchY = useRef(0);
  /** 点「回到底部」后的平滑滚动期间，不因中途位置松开 */
  const holdUntil = useRef(0);
  const [pinned, setPinnedState] = useState(true);

  const setPinned = useCallback((next: boolean) => {
    if (pinnedRef.current === next) return;
    pinnedRef.current = next;
    setPinnedState(next);
  }, []);

  const scrollToBottom = useCallback((smooth = false) => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    // 外层没有限定高度时自己不会滚动，退回让最近的滚动祖先露出末尾
    if (node.scrollHeight <= node.clientHeight + 1) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  /**
   * 用户有往上看的意图：立即松开，不等滚出阈值（触控板一次只滚几像素，否则会被流式更新拽回去）。
   * 滚轮也可能被消息里的内层滚动区（代码块、思考过程）吃掉，所以稍后复查：位置没动就重新贴底。
   */
  const recheck = useRef<number | undefined>(undefined);
  const release = useCallback(() => {
    const node = scrollerRef.current;
    if (!node || node.scrollHeight <= node.clientHeight + 1 || Date.now() <= holdUntil.current) return;
    setPinned(false);
    window.clearTimeout(recheck.current);
    recheck.current = window.setTimeout(() => {
      if (node.scrollHeight - node.scrollTop - node.clientHeight < 1) setPinned(true);
    }, 160);
  }, [setPinned]);
  useEffect(() => () => window.clearTimeout(recheck.current), []);

  const onScroll = () => {
    const node = scrollerRef.current;
    if (!node) return;
    const top = node.scrollTop;
    const distance = node.scrollHeight - top - node.clientHeight;
    // 内容变矮导致的位置回收也会让 scrollTop 变小，所以向上且离底较远才算松开
    if (top < lastTop.current - 1 && distance > NEAR_BOTTOM) {
      if (Date.now() > holdUntil.current) setPinned(false);
    } else if (top >= lastTop.current && distance <= NEAR_BOTTOM) {
      setPinned(true);
    }
    lastTop.current = top;
  };

  const jumpToBottom = () => {
    holdUntil.current = Date.now() + 700;
    setPinned(true);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    scrollToBottom(!reduced);
  };

  // 换对话：回到底部，并停掉上一段朗读
  useLayoutEffect(() => {
    setPinned(true);
    scrollToBottom();
    return () => stopSpeaking();
  }, [conversation.id, scrollToBottom, setPinned]);

  // 自己刚发出一条提问：无论之前翻到哪里都回到底部
  const lastMessage = messages[messages.length - 1];
  const lastUserId = lastMessage?.role === 'user' ? lastMessage.id : null;
  useLayoutEffect(() => {
    if (lastUserId) setPinned(true);
  }, [lastUserId, setPinned]);

  // 内容更新（流式写入、新消息、等待行出现）时跟到底
  useLayoutEffect(() => {
    if (pinnedRef.current) scrollToBottom();
  }, [messages, busy, streamingId, phase, scrollToBottom]);

  const isEmpty = messages.length === 0 && !busy;

  // 图片、公式、折叠件等异步改变高度，以及输入框长高、软键盘弹出。
  // 欢迎区与消息列是两个节点，切换时要重新观察
  useEffect(() => {
    const scroller = scrollerRef.current;
    const column = columnRef.current;
    if (!scroller || !column || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (pinnedRef.current) scrollToBottom(); });
    observer.observe(scroller);
    observer.observe(column);
    return () => observer.disconnect();
  }, [isEmpty, scrollToBottom]);

  // 回调包一层稳定引用，流式更新时只有变化的那条消息重绘
  const latest = useRef(props);
  latest.current = props;
  const handlers = useMemo<FeedHandlers>(() => ({
    onAsk: (text) => latest.current.onAsk(text),
    onSource: (source) => latest.current.onSource(source),
    onSaveNote: (text, sources) => latest.current.onSaveNote(text, sources),
    onInteraction: (messageId, blockId, state) => latest.current.onInteraction(messageId, blockId, state),
    onRegenerate: (messageId) => latest.current.onRegenerate(messageId),
  }), []);

  const speakingId = useSpeakingId();
  // 只有消息里记了模型 id 时才需要目录来换成显示名
  const catalog = useModelCatalog(messages.some((message) => Boolean(message.model)));
  const modelLabel = (id?: string) => (id ? catalog?.models.find((item) => item.id === id)?.label ?? id.split('/').pop() : undefined);

  return (
    <div className={s.root}>
      <div
        ref={scrollerRef}
        className={s.scroller}
        onScroll={onScroll}
        onWheel={(event) => { if (event.deltaY < 0) release(); }}
        onTouchStart={(event) => { touchY.current = event.touches[0]?.clientY ?? 0; }}
        onTouchMove={(event) => { if ((event.touches[0]?.clientY ?? 0) - touchY.current > 6) release(); }}
        onKeyDown={(event) => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) release(); }}
      >
        {isEmpty ? (
          <div ref={columnRef} className={s.emptyWrap}>{empty}</div>
        ) : (
          <div ref={columnRef} className={s.column} role="log" aria-label="与小砚的对话" aria-busy={busy}>
            {messages.map((message, index) => (message.role === 'user' ? (
              <UserMessage key={message.id} message={message} />
            ) : (
              <AssistantMessage
                key={message.id}
                message={message}
                streaming={streamingId === message.id}
                last={index === messages.length - 1}
                busy={busy}
                speaking={speakingId === message.id}
                modelLabel={modelLabel(message.model)}
                handlers={handlers}
                handoff={handoff}
                origin={origin}
                asked={askedBy.get(message.id)}
              />
            )))}
            {busy && !streamingId && <PendingMessage phase={phase} />}
          </div>
        )}
        <div ref={endRef} className={s.end} aria-hidden="true" />
      </div>

      <div className={s.toBottomWrap} data-visible={(!pinned && !isEmpty) || undefined}>
        <button type="button" className={s.toBottom} tabIndex={pinned || isEmpty ? -1 : 0} onClick={jumpToBottom}>
          <ArrowDown size={15} strokeWidth={2} />
          {busy ? '回到最新' : '回到底部'}
        </button>
      </div>
    </div>
  );
}
