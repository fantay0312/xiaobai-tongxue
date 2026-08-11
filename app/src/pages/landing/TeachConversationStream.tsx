import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { DEMO } from './landingData';
import type { TeachDemoOutcome } from './landingTeachDemo';
import base from './WorkspaceScenes.module.css';
import s from './WorkspaceTeachScene.module.css';

export interface TeachDemoMessage {
  readonly id: string;
  readonly role: 'teacher' | 'xiaobai';
  readonly text: string;
  readonly label: string;
  readonly outcome?: Exclude<TeachDemoOutcome, 'pending'>;
  readonly note?: string;
  readonly typing?: boolean;
}

function LiveTypewriter({
  active,
  reducedMotion,
  text,
  onDone,
  onTick,
}: {
  active: boolean;
  reducedMotion: boolean;
  text: string;
  onDone: () => void;
  onTick: () => void;
}) {
  const chars = useMemo(() => Array.from(text), [text]);
  const [visible, setVisible] = useState(reducedMotion ? chars.length : 0);
  const doneRef = useRef(false);
  const doneCallbackRef = useRef(onDone);
  doneCallbackRef.current = onDone;

  useEffect(() => {
    if (reducedMotion && visible !== chars.length) setVisible(chars.length);
    if ((reducedMotion || visible >= chars.length) && !doneRef.current) {
      doneRef.current = true;
      doneCallbackRef.current();
    }
    if (reducedMotion || !active || visible >= chars.length) return;
    const nextChar = chars[visible] ?? '';
    const delay = visible === 0 ? 380 : /[，。？！]/u.test(nextChar) ? 86 : 26;
    const timer = window.setTimeout(() => setVisible((count) => count + 1), delay);
    return () => window.clearTimeout(timer);
  }, [active, chars, reducedMotion, visible]);
  useEffect(() => {
    if (visible > 0) onTick();
  }, [onTick, visible]);

  return (
    <>
      <span aria-hidden="true">
        {chars.slice(0, visible).join('')}
        {active && !reducedMotion && visible < chars.length ? <span className={base.caret} /> : null}
      </span>
      <span className={base.srOnly}>{text}</span>
    </>
  );
}

function TokenPrimer() {
  return (
    <figure className={base.tokenPrimer}>
      <figcaption>粉笔旁注 · 示意切法</figcaption>
      <div>
        {DEMO.tokenExamples.map((example) => (
          <p key={example.label}>
            <span>{example.label}</span>
            <code>{example.source}</code>
            <strong>{example.pieces.map((piece) => `[${piece}]`).join(' ')}</strong>
          </p>
        ))}
      </div>
      <small>字数并不能直接推出块数；实际切法由模型词表决定。</small>
    </figure>
  );
}

function outcomeClass(outcome?: TeachDemoMessage['outcome']): string {
  if (outcome === 'corrected') return s.correctedMessage;
  if (outcome === 'adopted') return s.adoptedMessage;
  if (outcome === 'needs-example') return s.probeMessage;
  return '';
}

function ConversationMessage({
  active,
  message,
  reducedMotion,
  onDone,
  onTypewriterTick,
}: {
  active: boolean;
  message: TeachDemoMessage;
  reducedMotion: boolean;
  onDone: (message: TeachDemoMessage) => void;
  onTypewriterTick: () => void;
}) {
  return (
    <article
      className={`${s.message} ${message.role === 'teacher' ? s.teacherMessage : s.pupilMessage} ${outcomeClass(message.outcome)}`}
      data-message-id={message.id}
    >
      <span>{message.label}</span>
      <div>
        <p>
          {message.typing ? (
            <LiveTypewriter
              active={active}
              reducedMotion={reducedMotion}
              text={message.text}
              onDone={() => onDone(message)}
              onTick={onTypewriterTick}
            />
          ) : message.text}
        </p>
        {message.id.startsWith('teacher-primer') ? <TokenPrimer /> : null}
        {message.note ? <small>{message.note}</small> : null}
      </div>
    </article>
  );
}

export function TeachConversationStream({
  active,
  busy,
  thinking,
  messages,
  reducedMotion,
  streamRef,
  onMessageDone,
  onTypewriterTick,
}: {
  active: boolean;
  busy: boolean;
  thinking: boolean;
  messages: TeachDemoMessage[];
  reducedMotion: boolean;
  streamRef: RefObject<HTMLDivElement | null>;
  onMessageDone: (message: TeachDemoMessage) => void;
  onTypewriterTick: () => void;
}) {
  return (
    <div
      className={s.stream}
      ref={streamRef}
      role="log"
      aria-live="polite"
      aria-busy={busy}
      aria-label="讲解对话"
    >
      {messages.map((message) => (
        <ConversationMessage
          active={active}
          key={message.id}
          message={message}
          reducedMotion={reducedMotion}
          onDone={onMessageDone}
          onTypewriterTick={onTypewriterTick}
        />
      ))}
      {thinking ? <div className={s.thinking} role="status"><span>小白正在琢磨</span><i /><i /><i /></div> : null}
    </div>
  );
}
