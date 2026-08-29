/**
 * 备课页专属桌宠助教「小砚」;问答按知识点保留于当前会话。
 * 三种用法在同一面板里切换:
 *  - 答疑:问讲法(情境化快捷问 + 答完可追问「再短一点 / 换个类比 / 给我示范句」);
 *  - 试讲:小砚扮小白抛一个误区,老师现场接,小砚再点评接没接住(摸底未完成不开放——剧本就是摸底答案);
 *  - 草稿:讲稿草稿本(按知识点落 localStorage),一键让小砚逐句挑毛病;小砚的回答也能一键记进草稿。
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAppStore } from '../../store/appStore';
import {
  appendCoachMessage, askCoach, COACH_FOLLOW_UPS, critiqueDraft, deriveQuickAsks, getCoachThread,
  getDraft, mockCoachReply, mockCritiqueReply, mockRehearsalReply, rehearseWithCoach, setDraft,
  splitRehearsal, type CoachMessage, type PrepContext,
} from '../../engine/coach';
import type { Misconception, Topic } from '../../types';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { CoachMarkdownMessage } from './CoachMarkdown';
import { markdownToPlainText } from './coachMarkdownText';
import { XiaoyanPet, type XiaoyanPetState } from './XiaoyanPet';
import s from './coach.module.css';

const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

type CoachMode = 'ask' | 'rehearse' | 'draft';
const MODE_LABEL: Record<CoachMode, string> = { ask: '答疑', rehearse: '试讲', draft: '草稿' };

/** 首次引导气泡:点开过一次就永久收起 */
const HINT_KEY = 'xiaobai-coach-hint-done';
/** 已放映过打字机的回复 id(模块级,面板开合/换页不重放) */
const revealedIds = new Set<string>();
/** 等待期状态轮播:小砚不能干等,要让人看见它在干活 */
const THINK_LINES = [
  '小砚翻着这门课的备课材料…',
  '研墨中…',
  '在琢磨怎么讲最顺口…',
  '快好了,再蘸一笔…',
] as const;
const REHEARSE_THINK_LINES = [
  '小白歪着头在想…',
  '小砚在对照纠正标准…',
  '快好了,再蘸一笔…',
] as const;

/** 面板顶部的「案头便签」:小砚此刻知道老师备到哪 */
function contextLine(ctx: PrepContext): string {
  const bits: string[] = [];
  if (ctx.quiz.total > 0) {
    bits.push(ctx.quiz.done ? `摸底 ${ctx.quiz.correct}/${ctx.quiz.total}` : `摸底 ${ctx.quiz.answered}/${ctx.quiz.total}`);
  }
  if (ctx.weakBeliefs.length > 0) bits.push(`栽了 ${ctx.weakBeliefs.length} 处`);
  bits.push(`在读 ${ctx.section}`);
  if (ctx.selfCheck.total > 0 && ctx.materialsOpen) bits.push(`自检 ${ctx.selfCheck.done}/${ctx.selfCheck.total}`);
  return bits.join(' · ');
}

export function PrepCoach({ topic, ctx }: { topic: Topic; ctx: PrepContext }) {
  const settings = useAppStore((st) => st.settings);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CoachMode>('ask');
  /** 正在等回复的知识点 id;同一时刻只发一条,避免跨页回复串扰。 */
  const [busyTid, setBusyTid] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<CoachMessage[]>(() => getCoachThread(topic.topicId));
  const [, refreshRevealed] = useState(0);
  const [hintOn, setHintOn] = useState(() => {
    try { return localStorage.getItem(HINT_KEY) !== '1'; } catch { return true; }
  });
  /** 试讲:当前扮演的误区 */
  const [rehearseMc, setRehearseMc] = useState<Misconception | null>(null);
  /** 草稿本(按知识点落 localStorage) */
  const [draftText, setDraftText] = useState(() => getDraft(topic.topicId));
  /** 「已记进草稿」一闪即逝的回执 */
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const petBtnRef = useRef<HTMLButtonElement>(null);
  /* 长 await 续体必须校验知识点未切换(同 submitTeaching 的 sessionId 纪律) */
  const topicIdRef = useRef(topic.topicId);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const reducedMotion = useReducedMotion();
  const busy = busyTid === topic.topicId;
  const inputLocked = busyTid !== null;
  const rehearseLocked = !ctx.quiz.done && ctx.quiz.total > 0;
  const [thinkIdx, setThinkIdx] = useState(0);
  const thinkLines = mode === 'rehearse' ? REHEARSE_THINK_LINES : THINK_LINES;
  useEffect(() => {
    if (!busy) return;
    setThinkIdx(0);
    const id = window.setInterval(
      () => setThinkIdx((i) => (i + 1) % thinkLines.length),
      2200,
    );
    return () => window.clearInterval(id);
  }, [busy, thinkLines.length]);

  /** 打字机每字跟滚:只在贴近底部时才跟随(讲解舱同款纪律,不把回看中的用户拽回去) */
  const followTick = () => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
      el.scrollTop = el.scrollHeight;
    }
  };

  /** Markdown 替换纯文本后高度会变化;仅替原本贴底的用户补最后一次跟滚。 */
  const finishReply = (messageId: string) => {
    const el = listRef.current;
    const wasPinned = Boolean(el && el.scrollHeight - el.scrollTop - el.clientHeight < 48);
    revealedIds.add(messageId);
    refreshRevealed((version) => version + 1);
    if (!wasPinned) return;
    window.requestAnimationFrame(() => {
      const current = listRef.current;
      if (current) current.scrollTop = current.scrollHeight;
    });
  };

  /** 当前应放映打字机的回复:最新一条、未放映过的小砚消息 */
  const lastMsg = messages[messages.length - 1];
  const animatingId =
    lastMsg && lastMsg.role === 'coach' && !revealedIds.has(lastMsg.id) && !reducedMotion
      ? lastMsg.id
      : null;
  const petState: XiaoyanPetState = busy
    ? 'working'
    : open && animatingId
      ? 'explaining'
      : open && mode === 'rehearse'
        ? 'thinking'
        : open
          ? 'listening'
          : 'idle';
  /* 放映被打断(关面板/换知识点/离开备课页)也算放映过——重开不整条重放 */
  useEffect(() => {
    if (!open || !animatingId) return;
    return () => {
      revealedIds.add(animatingId);
    };
  }, [open, animatingId]);

  /** 读屏专用通道:回复到达时一次性播报全文(动画区已对读屏隐藏,免得逐字排队轰炸) */
  const lastCoachText = markdownToPlainText(
    [...messages].reverse().find((m) => m.role === 'coach')?.text ?? '',
  );

  /* 换知识点:载入对应缓存与草稿,试讲对象归零 */
  useEffect(() => {
    topicIdRef.current = topic.topicId;
    setMessages(getCoachThread(topic.topicId));
    setDraftText(getDraft(topic.topicId));
    setRehearseMc(null);
  }, [topic.topicId]);

  /* 新消息滚到底;面板打开聚焦输入框 */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open, mode]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, mode]);

  /* 「已记进草稿」回执 1.6s 后收起 */
  useEffect(() => {
    if (!savedNote) return;
    const id = window.setTimeout(() => setSavedNote(null), 1600);
    return () => window.clearTimeout(id);
  }, [savedNote]);

  /** 关面板把焦点还给宠物按钮(dialog 的焦点归还契约,键盘/读屏用户不迷路) */
  const close = () => {
    setOpen(false);
    petBtnRef.current?.focus();
  };

  const toggle = () => {
    setOpen((o) => !o);
    if (hintOn) {
      setHintOn(false);
      try { localStorage.setItem(HINT_KEY, '1'); } catch { /* 隐私模式下无妨 */ }
    }
  };

  /** 收口:把小砚的回复落进当前知识点缓存;仅当用户仍停留在该知识点时才更新可见列表 */
  const settle = (tid: string, list: CoachMessage[]) => {
    let next = getCoachThread(tid);
    list.forEach((m) => { next = appendCoachMessage(tid, m); });
    if (topicIdRef.current === tid) setMessages(next);
    setBusyTid(null);
  };

  const fallbackNote = (e: unknown): string => {
    const reason = e instanceof Error ? e.message : '';
    if (reason === 'llm-auth') return '(连线模式需要先登入书斋,这里先给你离线锦囊)\n';
    if (reason === 'llm-api-unavailable' && settings.mode === 'api') {
      return '(连线模式还没配好 API,可在右上角设置里补全;先给你离线锦囊)\n';
    }
    return '';
  };

  /** 答疑:普通提问 */
  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busyTid !== null) return;
    const tid = topic.topicId;
    inputRef.current?.focus();
    setInput('');
    setBusyTid(tid);
    const history = getCoachThread(tid);
    setMessages(appendCoachMessage(tid, { id: uid(), role: 'teacher', text, t: now() }));
    let reply: string;
    try {
      reply = await askCoach({ topic, history, question: text, settings, ctx: ctxRef.current });
    } catch (e) {
      reply = fallbackNote(e) + mockCoachReply(topic, text, ctxRef.current);
    }
    settle(tid, [{ id: uid(), role: 'coach', text: reply, t: now() }]);
  };

  /** 试讲:老师接小白的试探 */
  const rehearse = async (raw: string) => {
    const text = raw.trim();
    if (!text || busyTid !== null || !rehearseMc) return;
    const tid = topic.topicId;
    const mc = rehearseMc;
    inputRef.current?.focus();
    setInput('');
    setBusyTid(tid);
    setMessages(appendCoachMessage(tid, { id: uid(), role: 'teacher', text, t: now() }));
    let reply: string;
    try {
      reply = await rehearseWithCoach({ topic, mc, answer: text, settings, ctx: ctxRef.current });
    } catch (e) {
      reply = fallbackNote(e) + mockRehearsalReply(mc, text);
    }
    const { probe, verdict } = splitRehearsal(reply);
    const out: CoachMessage[] = [];
    if (probe) out.push({ id: uid(), role: 'coach', text: probe, t: now(), kind: 'rehearsal-probe' });
    out.push({ id: uid(), role: 'coach', text: verdict, t: now(), kind: 'rehearsal-verdict' });
    settle(tid, out);
  };

  /** 试讲:挑一个误区,小白先开口 */
  const startRehearsal = (mc: Misconception) => {
    if (busyTid !== null) return;
    setRehearseMc(mc);
    setMessages(appendCoachMessage(topic.topicId, {
      id: uid(), role: 'coach', text: mc.triggerLine, t: now(), kind: 'rehearsal-probe',
    }));
    inputRef.current?.focus();
  };

  /** 草稿:一键送审 */
  const critique = async () => {
    const text = draftText.trim();
    if (text.length < 20 || busyTid !== null) return;
    const tid = topic.topicId;
    setBusyTid(tid);
    setMode('ask');
    setMessages(appendCoachMessage(tid, {
      id: uid(), role: 'teacher', text: `(把草稿递给小砚挑毛病,${text.length} 字)`, t: now(),
    }));
    let reply: string;
    try {
      reply = await critiqueDraft({ topic, draft: text, settings, ctx: ctxRef.current });
    } catch (e) {
      reply = fallbackNote(e) + mockCritiqueReply(topic, text, ctxRef.current);
    }
    settle(tid, [{ id: uid(), role: 'coach', text: reply, t: now(), kind: 'critique' }]);
  };

  /** 把小砚的一条回复记进草稿本 */
  const keepToDraft = (m: CoachMessage) => {
    const plain = markdownToPlainText(m.text).trim();
    if (!plain) return;
    const next = draftText.trim() ? `${draftText.trimEnd()}\n\n${plain}` : plain;
    setDraftText(next);
    setDraft(topic.topicId, next);
    setSavedNote('已记进草稿');
  };

  const updateDraft = (text: string) => {
    setDraftText(text);
    setDraft(topic.topicId, text);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'rehearse') void rehearse(input);
    else void send(input);
  };
  /* Escape 同样要过输入法守卫:取消拼音候选窗的 Esc 不该把整个面板关掉 */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (mode === 'rehearse') void rehearse(input);
      else void send(input);
    }
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) close();
  };

  const quickAsks = deriveQuickAsks(topic, ctx);
  const showFollowUps =
    !busy && lastMsg?.role === 'coach' && (!lastMsg.kind || lastMsg.kind === 'critique') && !animatingId;
  const placeholder = busy
    ? (mode === 'rehearse' ? '小白在听…' : '小砚正在回复…')
    : inputLocked
      ? '小砚正在处理另一节备课…'
      : mode === 'rehearse'
        ? (rehearseMc ? '对小白说:先重复它的话,再翻过来…' : '先在上面挑一个误区,小白就开口')
        : '问小砚:这一段怎么讲?';

  return (
    <div className={s.root}>
      {open && (
        <section
          id="prep-coach-panel"
          className={s.panel}
          role="dialog"
          aria-label="备课助教小砚"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) close();
          }}
        >
          <header className={s.panelHead}>
            <div className={s.panelTitle}>
              <span className={s.panelName}>小砚</span>
              <span className={s.panelRole}>备课助教</span>
            </div>
            <span className={settings.mode === 'mock' ? s.chipOffline : s.chipLive}>
              {settings.mode === 'mock' ? '离线锦囊' : '已连线'}
            </span>
            <button type="button" className={s.closeBtn} onClick={close} aria-label="收起助教面板">
              <Icon name="x" size={18} />
            </button>
          </header>
          {/* 案头便签:小砚知道老师备到哪——回答才落得准 */}
          <p className={s.panelTopic}>
            <span className={s.panelTopicName}>《{topic.title}》</span>
            <span className={s.panelCtx}>{contextLine(ctx)}</span>
          </p>
          <div className={s.modes} role="tablist" aria-label="助教用法">
            {(['ask', 'rehearse', 'draft'] as CoachMode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={`${s.modeBtn} ${mode === m ? s.modeOn : ''}`}
                onClick={() => setMode(m)}
              >
                {MODE_LABEL[m]}
                {m === 'draft' && draftText.trim() && <i className={s.modeDot} aria-hidden="true" />}
              </button>
            ))}
          </div>

          {mode === 'draft' ? (
            <div className={s.draftPad}>
              <p className={s.draftLead}>
                讲稿写在这儿,不进课堂记录。写完一段就递给小砚挑毛病;它的回答也能「记进草稿」。
              </p>
              <textarea
                className={s.draftArea}
                value={draftText}
                maxLength={3000}
                aria-label="讲稿草稿"
                placeholder={`比如:开场先抛小白的第一问——「${topic.checklist[0]?.probeLine ?? ''}」,再用一个生活里的画面接住它…`}
                onChange={(e) => updateDraft(e.target.value)}
              />
              <div className={s.draftBar}>
                <span className={s.draftCount}>{draftText.length} / 3000</span>
                <button
                  type="button"
                  className={s.ghostBtn}
                  disabled={!draftText.trim()}
                  onClick={() => updateDraft('')}
                >
                  清空
                </button>
                <button
                  type="button"
                  className={s.sendBtn}
                  disabled={inputLocked || draftText.trim().length < 20}
                  onClick={() => void critique()}
                >
                  让小砚挑毛病
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className={s.msgList} ref={listRef}>
                <div className={`${s.msg} ${s.msgCoach}`}>
                  老师好,我是小砚。开场白、讲课顺序、类比、误区试探怎么接——这节课的事都能问我;想真刀真枪练一遍就切到「试讲」。
                </div>
                {messages.map((m) => {
                  if (m.role === 'teacher') {
                    return <div key={m.id} className={`${s.msg} ${s.msgTeacher}`}>{m.text}</div>;
                  }
                  const isProbe = m.kind === 'rehearsal-probe';
                  const isVerdict = m.kind === 'rehearsal-verdict';
                  return (
                    <div key={m.id} className={s.msgGroup}>
                      {(isProbe || isVerdict || m.kind === 'critique') && (
                        <span className={`${s.msgWho} ${isProbe ? s.msgWhoXiaobai : ''}`}>
                          {isProbe ? '小白' : isVerdict ? '小砚点评' : '小砚挑毛病'}
                        </span>
                      )}
                      <div className={`${s.msg} ${isProbe ? s.msgXiaobai : s.msgCoach}`}>
                        {isProbe ? (
                          `「${m.text}」`
                        ) : (
                          <CoachMarkdownMessage
                            text={m.text}
                            animate={m.id === animatingId}
                            onTick={followTick}
                            onDone={() => finishReply(m.id)}
                          />
                        )}
                      </div>
                      {!isProbe && m.id !== animatingId && (
                        <button
                          type="button"
                          className={s.keepBtn}
                          onClick={() => keepToDraft(m)}
                          aria-label="把这条记进草稿"
                        >
                          <Icon name="notebook" size={13} />记进草稿
                        </button>
                      )}
                    </div>
                  );
                })}
                {busy && (
                  <div className={`${s.msg} ${s.msgCoach} ${s.typing}`}>
                    <span className={s.thinkDots}><i /><i /><i /></span>
                    <span key={thinkIdx} className={s.thinkText}>{thinkLines[thinkIdx]}</span>
                  </div>
                )}
              </div>
              <div className={s.srOnly} aria-live="polite">
                {busy ? '小砚思考中' : savedNote ?? lastCoachText}
              </div>
              <span id="prep-coach-input-status" className={s.srOnly}>
                {inputLocked ? (busy ? '小砚正在回复' : '小砚正在处理另一节备课') : '可以提问'}
              </span>
              {savedNote && <p className={s.savedNote} aria-hidden="true">{savedNote}</p>}

              {mode === 'rehearse' && (
                <div className={s.rehearseBar}>
                  {rehearseLocked ? (
                    <p className={s.rehearseNote}>摸完底再试讲——误区剧本就是摸底题的答案,小砚不剧透。</p>
                  ) : (
                    <>
                      <p className={s.rehearseNote}>
                        {rehearseMc ? '小白已开口,你来接;想换一个就点别的。' : '挑一个误区,小白会先开口:'}
                      </p>
                      <div className={s.chips}>
                        {topic.misconceptions.map((mc) => {
                          const stumbled = ctx.weakBeliefs.includes(mc.belief);
                          const on = rehearseMc?.mcId === mc.mcId;
                          return (
                            <button
                              key={mc.mcId}
                              type="button"
                              className={`${s.chip} ${on ? s.chipOn : ''} ${stumbled ? s.chipWarn : ''}`}
                              disabled={inputLocked}
                              onClick={() => startRehearsal(mc)}
                              title={mc.belief}
                            >
                              {stumbled && <span className={s.chipMark}>栽过</span>}
                              {mc.belief.length > 16 ? `${mc.belief.slice(0, 16)}…` : mc.belief}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {mode === 'ask' && messages.length === 0 && !busy && (
                <div className={s.chips}>
                  {quickAsks.map((q) => (
                    <button key={q} type="button" className={s.chip} disabled={inputLocked}
                      onClick={() => void send(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {mode === 'ask' && showFollowUps && (
                <div className={s.chips}>
                  {COACH_FOLLOW_UPS.map((f) => (
                    <button key={f.label} type="button" className={`${s.chip} ${s.chipFollow}`}
                      disabled={inputLocked} onClick={() => void send(f.ask)}>
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              <form className={s.inputRow} onSubmit={onSubmit}>
                <textarea
                  ref={inputRef}
                  className={s.input}
                  rows={1}
                  maxLength={800}
                  readOnly={inputLocked || (mode === 'rehearse' && (rehearseLocked || !rehearseMc))}
                  aria-disabled={inputLocked}
                  aria-describedby="prep-coach-input-status"
                  aria-label={mode === 'rehearse' ? '对小白说' : '向备课助教提问'}
                  placeholder={placeholder}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                />
                <button
                  type="submit"
                  className={s.sendBtn}
                  disabled={inputLocked || !input.trim() || (mode === 'rehearse' && !rehearseMc)}
                >
                  {mode === 'rehearse' ? '接住' : '递上'}
                </button>
              </form>
            </>
          )}
        </section>
      )}
      {!open && hintOn && (
        <span className={s.hint} aria-hidden="true">备课卡住了?找小砚</span>
      )}
      <XiaoyanPet
        ref={petBtnRef}
        state={petState} suppressReply={hintOn}
        data-tour="coach"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="prep-coach-panel"
        aria-haspopup="dialog"
        aria-label={open ? '收起备课助教' : '召唤备课助教小砚'}
        title="小砚 · 备课助教"
      />
    </div>
  );
}
