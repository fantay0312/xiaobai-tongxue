import { useCallback, useEffect, useRef } from 'react';
import type { TeachDemoMessage } from './TeachConversationStream';
import type { DemoMotionMode } from './useLearningDemo';

export type TeachDemoPhase = 'question' | 'auto-draft' | 'thinking' | 'reply' | 'ready';

export function usePausableReplyTimer({
  interactive,
  motionMode,
  phase,
}: {
  interactive: boolean;
  motionMode: DemoMotionMode;
  phase: TeachDemoPhase;
}) {
  const timerRef = useRef(0);
  const remainingRef = useRef(680);
  const pendingReplyRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    if (phase !== 'thinking' || !pendingReplyRef.current) return;
    if (!interactive && motionMode === 'paused') return;
    const startedAt = performance.now();
    timerRef.current = window.setTimeout(() => {
      const deliverReply = pendingReplyRef.current;
      pendingReplyRef.current = null;
      remainingRef.current = 680;
      deliverReply?.();
    }, remainingRef.current);
    return () => {
      window.clearTimeout(timerRef.current);
      if (pendingReplyRef.current) {
        remainingRef.current = Math.max(
          0,
          remainingRef.current - (performance.now() - startedAt),
        );
      }
    };
  }, [interactive, motionMode, phase]);

  const scheduleReply = useCallback((deliverReply: () => void) => {
    remainingRef.current = 680;
    pendingReplyRef.current = deliverReply;
  }, []);
  const cancelReply = useCallback(() => {
    window.clearTimeout(timerRef.current);
    pendingReplyRef.current = null;
    remainingRef.current = 680;
  }, []);
  return { cancelReply, scheduleReply };
}

export function useTeachStreamScroll(messages: TeachDemoMessage[]) {
  const streamRef = useRef<HTMLDivElement>(null);
  const lastMessageIdRef = useRef(messages.at(-1)?.id);
  useEffect(() => {
    const latestId = messages.at(-1)?.id;
    if (!latestId || latestId === lastMessageIdRef.current) return;
    lastMessageIdRef.current = latestId;
    const frame = window.requestAnimationFrame(() => {
      const stream = streamRef.current;
      if (!stream) return;
      const latestMessage = messages[messages.length - 1];
      const previousMessage = messages[messages.length - 2];
      const pairAnchor = latestMessage?.role === 'xiaobai' && latestMessage.outcome
        ? previousMessage
        : latestMessage;
      if (window.matchMedia('(max-width: 560px)').matches && pairAnchor) {
        const anchor = stream.querySelector<HTMLElement>(`[data-message-id="${pairAnchor.id}"]`);
        stream.scrollTop = Math.max(0, (anchor?.offsetTop ?? 0) - stream.offsetTop - 4);
        return;
      }
      stream.scrollTop = stream.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  const followTypewriterIfNearBottom = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || window.matchMedia('(max-width: 560px)').matches) return;
    const distance = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    if (distance > 64) return;
    window.requestAnimationFrame(() => {
      stream.scrollTop = stream.scrollHeight;
    });
  }, []);
  return { followTypewriterIfNearBottom, streamRef };
}
