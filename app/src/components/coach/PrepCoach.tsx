/**
 * 备课助教「小砚」—— 备课页右下角的墨滴小书童。
 * 点击展开答疑面板;LLM 走 engine/coach(proxy/api),失败或本地模式降级离线锦囊。
 * 只在 /prep 挂载:讲解舱里它就是答案机(防作弊红线),课堂绝不出现。
 * 问答记录按知识点缓存在 engine/coach 的模块级 Map(会话内换页不丢,登出清空,刷新即清)。
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAppStore } from '../../store/appStore';
import {
  appendCoachMessage, askCoach, COACH_QUICK_ASKS, getCoachThread, mockCoachReply,
  type CoachMessage,
} from '../../engine/coach';
import type { Topic } from '../../types';
import { Icon } from '../ui/Icon';
import s from './coach.module.css';

const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

/** 首次引导气泡:点开过一次就永久收起 */
const HINT_KEY = 'xiaobai-coach-hint-done';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 已放映过打字机的回复 id(模块级,面板开合/换页不重放) */
const revealedIds = new Set<string>();

/** 等待期状态轮播:小砚不能干等,要让人看见它在干活 */
const THINK_LINES = [
  '小砚翻着这门课的备课材料…',
  '研墨中…',
  '在琢磨怎么讲最顺口…',
  '快好了,再蘸一笔…',
] as const;

/** 打字机逐字浮现(与讲解舱 TypewriterText 同款节奏,26ms/字) */
function CoachTypewriter({ text, animate, onTick, onDone }: {
  text: string;
  animate: boolean;
  onTick?: () => void;
  onDone?: () => void;
}) {
  const [n, setN] = useState(animate ? 0 : text.length);
  const cbRef = useRef({ onTick, onDone });
  cbRef.current = { onTick, onDone };

  useEffect(() => {
    if (!animate) {
      setN(text.length);
      return;
    }
    setN(0);
    let v = 0;
    const id = window.setInterval(() => {
      v += 1;
      setN(v);
      cbRef.current.onTick?.();
      if (v >= text.length) {
        window.clearInterval(id);
        cbRef.current.onDone?.();
      }
    }, 26);
    return () => window.clearInterval(id);
  }, [text, animate]);

  const typing = animate && n < text.length;
  return (
    <>
      {text.slice(0, n)}
      {typing ? <span className={s.caret} aria-hidden="true">▍</span> : null}
    </>
  );
}

export function PrepCoach({ topic }: { topic: Topic }) {
  const settings = useAppStore((st) => st.settings);
  const [open, setOpen] = useState(false);
  /** 正在等回复的知识点 id:busy 态只作用于所属知识点,换页不锁新页的输入 */
  const [busyTid, setBusyTid] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<CoachMessage[]>(() => getCoachThread(topic.topicId));
  const [hintOn, setHintOn] = useState(() => {
    try { return localStorage.getItem(HINT_KEY) !== '1'; } catch { return true; }
  });
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const petBtnRef = useRef<HTMLButtonElement>(null);
  /* 长 await 续体必须校验知识点未切换(同 submitTeaching 的 sessionId 纪律) */
  const topicIdRef = useRef(topic.topicId);

  const busy = busyTid === topic.topicId;

  /* 等待期状态轮播(仅 busy 时转) */
  const [thinkIdx, setThinkIdx] = useState(0);
  useEffect(() => {
    if (!busy) return;
    setThinkIdx(0);
    const id = window.setInterval(
      () => setThinkIdx((i) => (i + 1) % THINK_LINES.length),
      2200,
    );
    return () => window.clearInterval(id);
  }, [busy]);

  /** 打字机每字跟滚:只在贴近底部时才跟随(讲解舱同款纪律,不把回看中的用户拽回去) */
  const followTick = () => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
      el.scrollTop = el.scrollHeight;
    }
  };

  /** 当前应放映打字机的回复:最新一条、未放映过的小砚消息 */
  const lastMsg = messages[messages.length - 1];
  const animatingId =
    lastMsg && lastMsg.role === 'coach' && !revealedIds.has(lastMsg.id) && !prefersReducedMotion()
      ? lastMsg.id
      : null;
  /* 放映被打断(关面板/换知识点/离开备课页)也算放映过——重开不整条重放 */
  useEffect(() => {
    if (!open || !animatingId) return;
    return () => {
      revealedIds.add(animatingId);
    };
  }, [open, animatingId]);

  /** 读屏专用通道:回复到达时一次性播报全文(动画区已对读屏隐藏,免得逐字排队轰炸) */
  const lastCoachText = [...messages].reverse().find((m) => m.role === 'coach')?.text ?? '';

  /* 换知识点:载入对应缓存 */
  useEffect(() => {
    topicIdRef.current = topic.topicId;
    setMessages(getCoachThread(topic.topicId));
  }, [topic.topicId]);

  /* 新消息滚到底;面板打开聚焦输入框 */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

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

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busyTid !== null) return;
    const tid = topic.topicId;
    setDraft('');
    setBusyTid(tid);
    const history = getCoachThread(tid);
    setMessages(appendCoachMessage(tid, { id: uid(), role: 'teacher', text, t: now() }));
    let reply: string;
    try {
      reply = await askCoach({ topic, history, question: text, settings });
    } catch (e) {
      const offline = mockCoachReply(topic, text);
      const reason = e instanceof Error ? e.message : '';
      reply = reason === 'llm-auth'
        ? `(连线模式需要先登入书斋,这里先给你离线锦囊)\n${offline}`
        : reason === 'llm-api-unavailable' && settings.mode === 'api'
          ? `(连线模式还没配好 API,可在右上角设置里补全;先给你离线锦囊)\n${offline}`
          : offline;
    }
    // 回复始终落对应知识点的缓存;仅当用户仍停留在该知识点时才更新可见列表
    const next = appendCoachMessage(tid, { id: uid(), role: 'coach', text: reply, t: now() });
    if (topicIdRef.current === tid) setMessages(next);
    setBusyTid(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };
  /* Escape 同样要过输入法守卫:取消拼音候选窗的 Esc 不该把整个面板关掉 */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
    }
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) close();
  };

  return (
    <div className={s.root}>
      {open && (
        <section
          className={s.panel}
          role="dialog"
          aria-label="备课助教小砚"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) close();
          }}
        >
          <header className={s.panelHead}>
            <span className={s.headFace} aria-hidden="true"><PetFace /></span>
            <span className={s.panelName}>小砚 · 备课助教</span>
            <span className={settings.mode === 'mock' ? s.chipOffline : s.chipLive}>
              {settings.mode === 'mock' ? '离线锦囊' : '已连线'}
            </span>
            <button type="button" className={s.closeBtn} onClick={close} aria-label="收起助教面板">
              <Icon name="x" size={18} />
            </button>
          </header>
          <p className={s.panelTopic}>正在陪你备《{topic.title}》——问答不进课堂记录,放心打草稿。</p>
          {/* 动画区对读屏隐藏:逐字变更 + 状态轮播会把 live region 轰炸成噪音 */}
          <div className={s.msgList} ref={listRef} aria-hidden="true">
            <div className={`${s.msg} ${s.msgCoach}`}>
              老师好,我是小砚。开场白、讲课顺序、类比、误区试探怎么接——这节课的事都能问我。
            </div>
            {messages.map((m) => (
              <div key={m.id} className={`${s.msg} ${m.role === 'teacher' ? s.msgTeacher : s.msgCoach}`}>
                {m.role === 'coach' ? (
                  <CoachTypewriter
                    text={m.text}
                    animate={m.id === animatingId}
                    onTick={followTick}
                    onDone={() => revealedIds.add(m.id)}
                  />
                ) : (
                  m.text
                )}
              </div>
            ))}
            {busy && (
              <div className={`${s.msg} ${s.msgCoach} ${s.typing}`}>
                <span className={s.thinkDots}><i /><i /><i /></span>
                <span key={thinkIdx} className={s.thinkText}>{THINK_LINES[thinkIdx]}</span>
              </div>
            )}
          </div>
          {/* 读屏通道:忙碌播一次、回复全文播一次 */}
          <div className={s.srOnly} aria-live="polite">
            {busy ? '小砚思考中' : lastCoachText}
          </div>
          {messages.length === 0 && !busy && (
            <div className={s.chips}>
              {COACH_QUICK_ASKS.map((q) => (
                <button key={q} type="button" className={s.chip} onClick={() => void send(q)}>
                  {q}
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
              placeholder="问小砚:这一段怎么讲?"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="submit" className={s.sendBtn} disabled={busy || !draft.trim()}>
              递上
            </button>
          </form>
        </section>
      )}
      {!open && hintOn && (
        <span className={s.hint} aria-hidden="true">备课卡住了?找小砚</span>
      )}
      <button
        ref={petBtnRef}
        type="button"
        className={s.petBtn}
        data-tour="coach"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? '收起备课助教' : '召唤备课助教小砚'}
        title="小砚 · 备课助教"
      >
        <PetSvg />
      </button>
    </div>
  );
}

/** 墨滴小书童:趴在砚台上的一滴墨,呼吸浮动 + 眨眼 */
function PetSvg() {
  return (
    <svg className={s.pet} viewBox="0 0 64 64" aria-hidden="true">
      {/* 砚台 */}
      <rect x="13" y="49" width="38" height="8" rx="4" fill="currentColor" opacity="0.28" />
      <ellipse cx="32" cy="50" rx="15" ry="2.6" fill="currentColor" opacity="0.36" />
      {/* 墨滴本体(呼吸浮动) */}
      <g className={s.petBody}>
        <path
          d="M32 10 C 26 19, 16 25, 16 36.5 A 16 15.5 0 0 0 48 36.5 C 48 25, 38 19, 32 10 Z"
          fill="currentColor"
        />
        {/* 高光 */}
        <ellipse cx="25" cy="27" rx="3.4" ry="5" fill="#fff" opacity="0.18" transform="rotate(-18 25 27)" />
        {/* 眼睛(眨) */}
        <g className={s.petEyes}>
          <ellipse cx="26" cy="37" rx="2.5" ry="3.4" fill="var(--paper, #f6f1e5)" />
          <ellipse cx="38" cy="37" rx="2.5" ry="3.4" fill="var(--paper, #f6f1e5)" />
        </g>
        {/* 腮红 */}
        <circle cx="21.5" cy="42" r="2" fill="var(--cinnabar, #bc4630)" opacity="0.4" />
        <circle cx="42.5" cy="42" r="2" fill="var(--cinnabar, #bc4630)" opacity="0.4" />
        {/* 嘴 */}
        <path d="M30 43.5 q2 1.8 4 0" stroke="var(--paper, #f6f1e5)" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

/** 面板头像:同一只小砚的头部特写 */
function PetFace() {
  return (
    <svg viewBox="14 18 36 32" aria-hidden="true">
      <path
        d="M32 10 C 26 19, 16 25, 16 36.5 A 16 15.5 0 0 0 48 36.5 C 48 25, 38 19, 32 10 Z"
        fill="currentColor"
      />
      <ellipse cx="26" cy="37" rx="2.5" ry="3.4" fill="var(--paper, #f6f1e5)" />
      <ellipse cx="38" cy="37" rx="2.5" ry="3.4" fill="var(--paper, #f6f1e5)" />
      <path d="M30 43.5 q2 1.8 4 0" stroke="var(--paper, #f6f1e5)" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  );
}
