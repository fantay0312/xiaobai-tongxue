/** 备课页专属桌宠助教；问答按知识点保留于当前会话。 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAppStore } from '../../store/appStore';
import { appendCoachMessage, askCoach, COACH_QUICK_ASKS, getCoachThread, mockCoachReply,
  type CoachMessage } from '../../engine/coach';
import type { Topic } from '../../types';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { XiaoyanPet, type XiaoyanPetState } from './XiaoyanPet';
import paper from '../../styles/paper.module.css';
import s from './coach.module.css';

const uid = () => (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();

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
  /** 正在等回复的知识点 id；同一时刻只发一条，避免跨页回复串扰。 */
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
  const reducedMotion = useReducedMotion();

  const busy = busyTid === topic.topicId;
  const inputLocked = busyTid !== null;
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
    lastMsg && lastMsg.role === 'coach' && !revealedIds.has(lastMsg.id) && !reducedMotion
      ? lastMsg.id
      : null;
  const petState: XiaoyanPetState = busy
    ? 'working'
    : open && animatingId
      ? 'explaining'
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
    inputRef.current?.focus();
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
          id="prep-coach-panel"
          className={s.panel}
          role="dialog"
          aria-label="备课助教小砚"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !e.nativeEvent.isComposing) close();
          }}
        >
          <header className={`${s.panelHead} ${paper.texture}`}>
            <span className={s.panelName}>小砚 · 备课助教</span>
            <span className={settings.mode === 'mock' ? s.chipOffline : s.chipLive}>
              {settings.mode === 'mock' ? '离线锦囊' : '已连线'}
            </span>
            <button type="button" className={s.closeBtn} onClick={close} aria-label="收起助教面板">
              <Icon name="x" size={18} />
            </button>
          </header>
          <p className={s.panelTopic}>正在陪你备《{topic.title}》——问答不进课堂记录,放心打草稿。</p>
          <div className={s.msgList} ref={listRef}>
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
          <div className={s.srOnly} aria-live="polite">
            {busy ? '小砚思考中' : lastCoachText}
          </div>
          <span id="prep-coach-input-status" className={s.srOnly}>
            {inputLocked ? (busy ? '小砚正在回复' : '小砚正在处理另一节备课') : '可以提问'}
          </span>
          {messages.length === 0 && !busy && (
            <div className={s.chips}>
              {COACH_QUICK_ASKS.map((q) => (
                <button key={q} type="button" className={s.chip} disabled={inputLocked}
                  onClick={() => void send(q)}>
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
              readOnly={inputLocked}
              aria-disabled={inputLocked}
              aria-describedby="prep-coach-input-status"
              aria-label="向备课助教提问"
              placeholder={busy ? '小砚正在回复…'
                : inputLocked ? '小砚正在处理另一节备课…' : '问小砚:这一段怎么讲?'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="submit" className={s.sendBtn} disabled={inputLocked || !draft.trim()}>
              递上
            </button>
          </form>
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
