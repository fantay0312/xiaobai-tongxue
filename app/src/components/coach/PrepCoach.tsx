/**
 * 备课页专属桌宠助教「小砚」;问答按知识点保留于当前会话。
 * 三种用法在同一面板里切换:
 *  - 答疑:问讲法(情境化快捷问 + 答完可追问「再短一点 / 换个类比 / 给我示范句」);
 *  - 试讲:小砚扮小白抛一个误区,老师现场接,小砚再点评接没接住(摸底未完成不开放——剧本就是摸底答案);
 *  - 草稿:讲稿草稿本(按知识点落 localStorage),一键让小砚逐句挑毛病;小砚的回答也能一键记进草稿。
 * 外观(2026-08-29 重做):一张从桌宠脚边升起的纸面卡——头像圆像 + 呼吸状态点、分段页签滑块、
 * 无边框气泡、建议卡列表、胶囊输入;开合/切页/消息入场都有动效,reduced-motion 全部关掉。
 */
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import { useAppStore } from '../../store/appStore';
import {
  appendCoachMessage, askCoach, COACH_FOLLOW_UPS, critiqueDraft, deriveQuickAsks, getCoachThread,
  getDraft, mockCoachReply, mockCritiqueReply, mockRehearsalReply, rehearseWithCoach, setDraft,
  splitRehearsal, type CoachMessage, type PrepContext,
} from '../../engine/coach';
import type { Misconception, Topic } from '../../types';
import { Icon, type IconName } from '../ui/Icon';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { CoachMarkdownMessage } from './CoachMarkdown';
import { markdownToPlainText } from './coachMarkdownText';
import { XiaoyanPet, type XiaoyanPetState } from './XiaoyanPet';
import s from './coach.module.css';

const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

type CoachMode = 'ask' | 'rehearse' | 'draft';
const MODES: { id: CoachMode; label: string; icon: IconName }[] = [
  { id: 'ask', label: '答疑', icon: 'lightbulb' },
  { id: 'rehearse', label: '试讲', icon: 'swords' },
  { id: 'draft', label: '草稿', icon: 'pen' },
];

/** 小砚头像:从桌宠图集里裁出第一帧的头部(纯 CSS 背景裁切,不另出资源) */
const ATLAS_URL = `${import.meta.env.BASE_URL}xiaoyan-prep-coach-atlas.webp`;
const portraitStyle: CSSProperties = { backgroundImage: `url(${ATLAS_URL})` };

/** 首次引导气泡:点开过一次就永久收起 */
const HINT_KEY = 'xiaobai-coach-hint-done';
/** 已放映过打字机的回复 id(模块级,面板开合/换页不重放) */
const revealedIds = new Set<string>();
/** 关面板的退场时长(与 coach.module.css 的 coach-out 对齐) */
const CLOSE_MS = 200;
/** 等待期状态轮播:小砚不能干等,要让人看见它在干活 */
const THINK_LINES = [
  '翻着这门课的备课材料…',
  '研墨中…',
  '在琢磨怎么讲最顺口…',
  '快好了,再蘸一笔…',
] as const;
const REHEARSE_THINK_LINES = [
  '小白歪着头在想…',
  '对照纠正标准…',
  '快好了,再蘸一笔…',
] as const;

/** 案头便签:小砚此刻知道老师备到哪(逐项渲染成小签) */
function contextBits(ctx: PrepContext): string[] {
  const bits: string[] = [];
  if (ctx.quiz.total > 0) {
    bits.push(ctx.quiz.done ? `摸底 ${ctx.quiz.correct}/${ctx.quiz.total}` : `摸底 ${ctx.quiz.answered}/${ctx.quiz.total}`);
  }
  if (ctx.weakBeliefs.length > 0) bits.push(`栽了 ${ctx.weakBeliefs.length} 处`);
  bits.push(`在读 ${ctx.section}`);
  if (ctx.selfCheck.total > 0 && ctx.materialsOpen) bits.push(`自检 ${ctx.selfCheck.done}/${ctx.selfCheck.total}`);
  return bits;
}

export function PrepCoach({ topic, ctx }: { topic: Topic; ctx: PrepContext }) {
  const settings = useAppStore((st) => st.settings);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
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
  const closeTimer = useRef<number | null>(null);
  /* 长 await 续体必须校验知识点未切换(同 submitTeaching 的 sessionId 纪律) */
  const topicIdRef = useRef(topic.topicId);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const reducedMotion = useReducedMotion();
  const busy = busyTid === topic.topicId;
  const inputLocked = busyTid !== null;
  const rehearseLocked = !ctx.quiz.done && ctx.quiz.total > 0;
  const live = settings.mode !== 'mock';
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
    if (open && !closing) inputRef.current?.focus();
  }, [open, closing, mode]);

  /* 「已记进草稿」回执 1.6s 后收起 */
  useEffect(() => {
    if (!savedNote) return;
    const id = window.setTimeout(() => setSavedNote(null), 1600);
    return () => window.clearTimeout(id);
  }, [savedNote]);
  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  /** 关面板:先放退场动画,再卸载;焦点还给宠物按钮(dialog 的焦点归还契约) */
  const close = () => {
    if (closing) return;
    petBtnRef.current?.focus();
    if (reducedMotion) {
      setOpen(false);
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      closeTimer.current = null;
    }, CLOSE_MS);
  };

  const toggle = () => {
    if (open) {
      close();
    } else {
      setOpen(true);
    }
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

  const submit = () => {
    if (mode === 'rehearse') void rehearse(input);
    else void send(input);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };
  /* Escape 同样要过输入法守卫:取消拼音候选窗的 Esc 不该把整个面板关掉 */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) close();
  };

  const quickAsks = deriveQuickAsks(topic, ctx);
  const showFollowUps =
    !busy && lastMsg?.role === 'coach' && (!lastMsg.kind || lastMsg.kind === 'critique') && !animatingId;
  const composerLocked = inputLocked || (mode === 'rehearse' && (rehearseLocked || !rehearseMc));
  const placeholder = busy
    ? (mode === 'rehearse' ? '小白在听…' : '小砚正在回复…')
    : inputLocked
      ? '小砚正在处理另一节备课…'
      : mode === 'rehearse'
        ? (rehearseMc ? '对小白说:先重复它的话,再翻过来…' : '先挑一个误区,小白就开口')
        : '问小砚:这一段怎么讲?';
  const modeIndex = MODES.findIndex((m) => m.id === mode);
  /** 切页会重挂正文:正在放映的打字机记为已放映,免得回来整条重放 */
  const switchMode = (next: CoachMode) => {
    if (animatingId) revealedIds.add(animatingId);
    setMode(next);
  };
  const emptyThread = messages.length === 0 && !busy;

  return (
    <div className={s.root}>
      {open && (
        <section
          id="prep-coach-panel"
          className={s.panel}
          data-closing={closing || undefined}
          role="dialog"
          aria-label="备课助教小砚"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) close();
          }}
        >
          {/* ── 头:圆像 + 名号 + 呼吸状态点 ── */}
          <header className={s.head}>
            <span className={s.portrait} style={portraitStyle} aria-hidden="true" />
            <div className={s.headText}>
              <span className={s.name}>小砚</span>
              <span className={s.role}>
                备课助教
                <span className={`${s.status} ${live ? s.statusLive : s.statusOffline}`}>
                  <i className={s.statusDot} aria-hidden="true" />
                  {live ? '已连线' : '离线锦囊'}
                </span>
              </span>
            </div>
            <button type="button" className={s.closeBtn} onClick={close} aria-label="收起助教面板">
              <Icon name="x" size={16} />
            </button>
          </header>

          {/* ── 案头便签:一行细字,小砚知道老师备到哪 ── */}
          <p className={s.ctx}>
            <span className={s.ctxTopic}>《{topic.title}》</span>
            {contextBits(ctx).map((b) => (
              <span key={b} className={s.ctxBit}>{b}</span>
            ))}
          </p>

          {/* ── 分段页签:滑块跟着走 ── */}
          <div className={s.seg} role="tablist" aria-label="助教用法" style={{ '--i': modeIndex } as CSSProperties}>
            <span className={s.segThumb} aria-hidden="true" />
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                className={`${s.segBtn} ${mode === m.id ? s.segOn : ''}`}
                onClick={() => switchMode(m.id)}
              >
                <Icon name={m.icon} size={14} />
                {m.label}
                {m.id === 'draft' && draftText.trim() && <i className={s.segDot} aria-hidden="true" />}
              </button>
            ))}
          </div>

          {mode === 'draft' ? (
            <div key="draft" className={`${s.body} ${s.draftPad}`}>
              <div className={s.draftHead}>
                <span className={s.draftTitle}>讲稿草稿</span>
                <span className={s.draftCount}>{draftText.length} / 3000 字 · 不进课堂记录</span>
              </div>
              <textarea
                className={s.draftArea}
                value={draftText}
                maxLength={3000}
                aria-label="讲稿草稿"
                placeholder={`比如:开场先抛小白的第一问——「${topic.checklist[0]?.probeLine ?? ''}」,再用一个生活里的画面接住它…`}
                onChange={(e) => updateDraft(e.target.value)}
              />
              <div className={s.draftBar}>
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
                  className={s.primaryBtn}
                  disabled={inputLocked || draftText.trim().length < 20}
                  onClick={() => void critique()}
                >
                  <Icon name="sparkles" size={14} />让小砚挑毛病
                </button>
              </div>
            </div>
          ) : (
            <div key={mode} className={s.body}>
              <div className={s.list} ref={listRef}>
                {/* 空态:小砚自报家门 + 建议卡 */}
                {emptyThread && (
                  <div className={s.empty}>
                    <span className={`${s.portrait} ${s.portraitLg}`} style={portraitStyle} aria-hidden="true" />
                    <p className={s.emptyTitle}>老师好,我是小砚。</p>
                    <p className={s.emptyText}>
                      {mode === 'rehearse'
                        ? '我来扮小白,用它的错误直觉试探你;你接一句,我再告诉你接没接住。'
                        : '开场白、讲课顺序、类比、误区试探怎么接——这节课的事都能问我。'}
                    </p>
                  </div>
                )}
                {messages.map((m, i) => {
                  const delay = { animationDelay: `${Math.min(i, 6) * 35}ms` };
                  if (m.role === 'teacher') {
                    return (
                      <div key={m.id} className={`${s.row} ${s.rowTeacher}`} style={delay}>
                        <div className={`${s.bubble} ${s.bubbleTeacher}`}>{m.text}</div>
                      </div>
                    );
                  }
                  const isProbe = m.kind === 'rehearsal-probe';
                  const isVerdict = m.kind === 'rehearsal-verdict';
                  return (
                    <div key={m.id} className={`${s.row} ${s.rowCoach}`} style={delay}>
                      {isProbe ? (
                        <span className={s.whoXiaobai} aria-hidden="true">白</span>
                      ) : (
                        <span className={`${s.portrait} ${s.portraitSm}`} style={portraitStyle} aria-hidden="true" />
                      )}
                      <div className={s.rowBody}>
                        {(isProbe || isVerdict || m.kind === 'critique') && (
                          <span className={`${s.who} ${isProbe ? s.whoWarn : ''}`}>
                            {isProbe ? '小白 · 试探' : isVerdict ? '小砚 · 点评' : '小砚 · 挑毛病'}
                          </span>
                        )}
                        <div className={`${s.bubble} ${isProbe ? s.bubbleXiaobai : s.bubbleCoach}`}>
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
                            <Icon name="notebook" size={12} />记进草稿
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {busy && (
                  <div className={`${s.row} ${s.rowCoach}`}>
                    <span className={`${s.portrait} ${s.portraitSm}`} style={portraitStyle} aria-hidden="true" />
                    <div className={`${s.bubble} ${s.bubbleCoach} ${s.typing}`}>
                      <span className={s.thinkDots}><i /><i /><i /></span>
                      <span key={thinkIdx} className={s.thinkText}>{thinkLines[thinkIdx]}</span>
                    </div>
                  </div>
                )}

                {/* 建议卡:答疑空态给情境化快捷问;试讲给误区名单 */}
                {mode === 'ask' && emptyThread && (
                  <ul className={s.suggest}>
                    {quickAsks.map((q, i) => (
                      <li key={q} style={{ animationDelay: `${120 + i * 45}ms` }}>
                        <button type="button" className={s.suggestBtn} disabled={inputLocked}
                          onClick={() => void send(q)}>
                          <span className={s.suggestMark} aria-hidden="true">✦</span>
                          <span className={s.suggestText}>{q}</span>
                          <Icon name="arrow-right" size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {mode === 'rehearse' && (
                  rehearseLocked ? (
                    <p className={s.notice}>
                      <Icon name="eye" size={14} />
                      摸完底再试讲——误区剧本就是摸底题的答案,小砚不剧透。
                    </p>
                  ) : (
                    <div className={s.pick}>
                      <p className={s.pickLead}>
                        {rehearseMc ? '换一个误区继续练:' : '挑一个误区,小白先开口:'}
                      </p>
                      <ul className={s.pickList}>
                        {topic.misconceptions.map((mc, i) => {
                          const stumbled = ctx.weakBeliefs.includes(mc.belief);
                          const on = rehearseMc?.mcId === mc.mcId;
                          return (
                            <li key={mc.mcId} style={{ animationDelay: `${120 + i * 45}ms` }}>
                              <button
                                type="button"
                                className={`${s.pickBtn} ${on ? s.pickOn : ''}`}
                                disabled={inputLocked}
                                onClick={() => startRehearsal(mc)}
                                aria-pressed={on}
                              >
                                <span className={`${s.pickRing} ${stumbled ? s.pickRingWarn : ''}`} aria-hidden="true" />
                                <span className={s.pickText}>{mc.belief}</span>
                                {stumbled && <span className={s.pickTag}>栽过</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )
                )}
              </div>

              <div className={s.srOnly} aria-live="polite">
                {busy ? '小砚思考中' : savedNote ?? lastCoachText}
              </div>
              <span id="prep-coach-input-status" className={s.srOnly}>
                {inputLocked ? (busy ? '小砚正在回复' : '小砚正在处理另一节备课') : '可以提问'}
              </span>
              {savedNote && <p className={s.toast} aria-hidden="true">{savedNote}</p>}

              {mode === 'ask' && showFollowUps && (
                <div className={s.followUps}>
                  {COACH_FOLLOW_UPS.map((f) => (
                    <button key={f.label} type="button" className={s.followBtn}
                      disabled={inputLocked} onClick={() => void send(f.ask)}>
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              <form className={`${s.composer} ${composerLocked ? s.composerLocked : ''}`} onSubmit={onSubmit}>
                <textarea
                  ref={inputRef}
                  className={s.field}
                  rows={1}
                  maxLength={800}
                  readOnly={composerLocked}
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
                  className={s.send}
                  disabled={composerLocked || !input.trim()}
                  aria-label={mode === 'rehearse' ? '接住' : '递上'}
                  title={mode === 'rehearse' ? '接住' : '递上'}
                >
                  <Icon name="send" size={15} />
                </button>
              </form>
            </div>
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
