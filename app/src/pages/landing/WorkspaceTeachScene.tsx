import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link } from 'react-router';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { Icon } from '../../components/ui/Icon';
import { TeachConversationStream, type TeachDemoMessage } from './TeachConversationStream';
import {
  createTeachDemoReply,
  INITIAL_TEACH_DEMO_SESSION,
  type TeachDemoOutcome,
  type TeachDemoSessionSummary,
} from './landingTeachDemo';
import { DEMO } from './landingData';
import type { DemoMotionMode } from './useLearningDemo';
import {
  usePausableReplyTimer,
  useTeachStreamScroll,
  type TeachDemoPhase,
} from './useTeachSceneRuntime';
import base from './WorkspaceScenes.module.css';
import s from './WorkspaceTeachScene.module.css';

function initialMessages(epoch: number): TeachDemoMessage[] {
  return [
    { id: `teacher-primer-${epoch}`, role: 'teacher', label: '你 · 第 1 轮', text: DEMO.teachLine },
    {
      id: `xiaobai-question-${epoch}`,
      role: 'xiaobai',
      label: '小白 · 追问',
      text: DEMO.misconceptionLine,
      typing: true,
    },
  ];
}

function statusCopy(phase: TeachDemoPhase, outcome: TeachDemoOutcome) {
  if (phase === 'auto-draft') return ['自动示范', '点输入框即可接管'];
  if (phase === 'thinking') return ['小白正在琢磨', '生成时先等一等'];
  if (phase === 'reply') return ['小白正在回应', ''];
  if (phase === 'question') return ['小白正在追问', ''];
  if (outcome === 'corrected') return ['误区已纠正', ''];
  if (outcome === 'adopted') return ['误区被带偏', '会带进下一场赴考'];
  if (outcome === 'needs-example') return ['小白继续追问', '还差一个对比'];
  return ['等你接着讲', ''];
}

export function TeachScene({
  motionMode,
  reducedMotion,
  onInteract,
  onSessionChange,
}: {
  motionMode: DemoMotionMode;
  reducedMotion: boolean;
  onInteract: () => void;
  onSessionChange: (session: TeachDemoSessionSummary) => void;
}) {
  const [epoch, setEpoch] = useState(0);
  const [messages, setMessages] = useState<TeachDemoMessage[]>(() => initialMessages(0));
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState<TeachDemoPhase>('question');
  const [outcome, setOutcome] = useState<TeachDemoOutcome>('pending');
  const [interactive, setInteractive] = useState(false);
  const [busy, setBusy] = useState(false);
  const generationRef = useRef(0);
  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const turnRef = useRef(1);
  const animationActive = !reducedMotion && (motionMode !== 'paused' || interactive);
  const { cancelReply, scheduleReply } = usePausableReplyTimer({ interactive, motionMode, phase });
  const { followTypewriterIfNearBottom, streamRef } = useTeachStreamScroll(messages);
  useEffect(() => onSessionChange(INITIAL_TEACH_DEMO_SESSION), [onSessionChange]);

  const takeOver = useCallback(() => {
    if (interactive) return;
    setInteractive(true);
    if (phase === 'auto-draft') {
      setDraft('');
      setPhase('ready');
    }
    onInteract();
  }, [interactive, onInteract, phase]);

  const sendLine = useCallback((rawText: string, automatic = false) => {
    const text = rawText.trim();
    if (!text || busy || sendingRef.current) return;
    sendingRef.current = true;
    if (!automatic) {
      setInteractive(true);
      onInteract();
    }
    const reply = createTeachDemoReply(text);
    const turn = turnRef.current + 1;
    const generation = generationRef.current;
    const teacherMessage: TeachDemoMessage = {
      id: `teacher-${generation}-${turn}`,
      role: 'teacher',
      label: `你 · 第 ${turn} 轮`,
      text,
      note: automatic ? DEMO.missedCorrection : undefined,
    };
    turnRef.current = turn;
    setMessages((current) => [...current, teacherMessage].slice(-7));
    setDraft('');
    setOutcome('pending');
    onSessionChange({ outcome: 'pending', teacherLine: text, turn });
    setBusy(true);
    setPhase('thinking');
    const deliverReply = () => {
      if (generationRef.current !== generation) return;
      const pupilMessage: TeachDemoMessage = {
        id: `xiaobai-${generation}-${turn}`,
        role: 'xiaobai',
        label: reply.outcome === 'adopted' ? '小白 · 错误理解' : '小白 · 回应',
        text: reply.text,
        outcome: reply.outcome,
        note: reply.evidence,
        typing: true,
      };
      setMessages((current) => [...current, pupilMessage].slice(-7));
      setOutcome(reply.outcome);
      onSessionChange({ outcome: reply.outcome, teacherLine: text, turn });
      setPhase('reply');
    };
    if (reducedMotion) {
      deliverReply();
    } else {
      scheduleReply(deliverReply);
    }
  }, [busy, onInteract, onSessionChange, reducedMotion, scheduleReply]);

  useEffect(() => {
    if (phase !== 'auto-draft') return;
    if (reducedMotion) {
      sendLine(DEMO.adoptedTeacherLine, true);
      return;
    }
    if (!animationActive) return;
    if (draft.length < DEMO.adoptedTeacherLine.length) {
      const timer = window.setTimeout(() => {
        const next = Math.min(DEMO.adoptedTeacherLine.length, draft.length + 2);
        setDraft(DEMO.adoptedTeacherLine.slice(0, next));
      }, 34);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => sendLine(DEMO.adoptedTeacherLine, true), 360);
    return () => window.clearTimeout(timer);
  }, [animationActive, draft, phase, reducedMotion, sendLine]);

  const handleMessageDone = (message: TeachDemoMessage) => {
    if (message.id.startsWith('xiaobai-question')) {
      if (phase !== 'question') return;
      if (interactive) {
        setPhase('ready');
      } else {
        setPhase('auto-draft');
      }
      return;
    }
    const latestMessage = messages[messages.length - 1];
    if (message.outcome && phase === 'reply' && latestMessage?.id === message.id) {
      sendingRef.current = false;
      setBusy(false);
      setPhase('ready');
    }
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    sendLine(draft);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };
  const fillSample = (text: string) => {
    takeOver();
    inputRef.current?.focus();
    setDraft(text);
  };
  const resetSession = () => {
    const nextEpoch = epoch + 1;
    generationRef.current += 1;
    cancelReply();
    setEpoch(nextEpoch);
    setMessages(initialMessages(nextEpoch));
    setDraft('');
    setPhase('question');
    setOutcome('pending');
    onSessionChange(INITIAL_TEACH_DEMO_SESSION);
    setBusy(false);
    sendingRef.current = false;
    setInteractive(true);
    turnRef.current = 1;
    onInteract();
  };

  const [status, statusDetail] = statusCopy(phase, outcome);
  const mood = phase === 'thinking'
    ? 'thinking'
    : outcome === 'corrected' ? 'aha' : outcome === 'adopted' ? 'confused' : 'curious';
  const speaking = animationActive && (phase === 'question' || phase === 'reply');

  return (
    <section
      className={`${base.scene} ${base.boardScene}`}
      data-motion={motionMode}
      data-demo-phase={phase}
      data-demo-turn={turnRef.current}
      data-interactive={interactive}
    >
      <header className={base.sceneHeading}>
        <div><span>讲解舱</span><h3>你正在讲：{DEMO.title}</h3></div>
        <p>可随时接管</p>
      </header>
      <aside className={base.branchNotice} aria-label="试讲说明">
        <span>试讲不留档</span>
      </aside>
      <div className={base.classroom}>
        <aside className={base.pupilStage}>
          <XiaobaiAvatar mood={mood} level={1} size={118} variant="board" speaking={speaking} />
          <div className={base.pupilIdentity}><strong>小白</strong><small>好奇型 · 已讲 {turnRef.current} 轮</small></div>
          <div className={base.branchStatus} aria-live="polite">
            <span>状态</span><strong>{status}</strong>{statusDetail ? <small>{statusDetail}</small> : null}
          </div>
        </aside>
        <div className={s.liveLesson}>
          <TeachConversationStream
            active={animationActive}
            busy={busy}
            thinking={phase === 'thinking'}
            messages={messages}
            reducedMotion={reducedMotion}
            streamRef={streamRef}
            onMessageDone={handleMessageDone}
            onTypewriterTick={followTypewriterIfNearBottom}
          />
          <form className={s.composer} onSubmit={submit} aria-label="把知识讲给小白">
            <label htmlFor="landing-teach-draft">轮到你 · 可以直接改写</label>
            <textarea
              id="landing-teach-draft"
              ref={inputRef}
              rows={2}
              value={draft}
              disabled={busy}
              placeholder="把这一点讲给小白听……"
              onFocus={takeOver}
              onChange={(event) => { takeOver(); setDraft(event.target.value); }}
              onKeyDown={handleKeyDown}
            />
            <div className={s.composerFoot}>
              <div className={s.sampleActions}>
                <button type="button" onClick={() => fillSample(DEMO.adoptedTeacherLine)}>试试错误讲法</button>
                <button type="button" onClick={() => fillSample(DEMO.correctedTeacherLine)}>试试正确纠正</button>
              </div>
              <span>{draft.length} 字</span>
              <button className={s.sendButton} type="submit" disabled={busy || !draft.trim()}>
                <Icon name="send" size={14} />讲给小白
              </button>
            </div>
          </form>
          <div className={s.lessonActions}>
            <button type="button" onClick={resetSession}><Icon name="play" size={14} />重新开始试讲</button>
            <Link to="/study" onClick={onInteract}>
              进入完整讲解舱（支持图片、拍照、语音）<Icon name="arrow-right" size={14} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
