/**
 * 讲解舱 /teach/:topicId?mode=teach|reteach|review —— 亮书斋教室 + 木框黑板。
 * 房间是纸色的(与全站同一世界),黑板是挂在教室里的一件家具(--board 系只住在板内);
 * 左 1/3 讲台(暖光晕下的小白 + 木桌牌),右 2/3 木框黑板上的对话流,板下讲桌是输入区。
 * 挂载契约:store.live 存在且 topicId 吻合则直接接管,否则 startSession(topicId, mode)。
 * 下课:endSession() → /exam/:sessionId → /review/:sessionId;R4 退回备课:abandonSession() → /prep/:topicId。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { getDemoScript, getTopic } from '../../data';
import { Md } from '../../components/Md';
import { Icon } from '../../components/ui/Icon';
import { Tour, type TourStep } from '../../components/tour/Tour';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import type { ChatMessage, SessionMode, XiaobaiMood } from '../../types';
import { useDocTitle } from '../../hooks/useDocTitle';
// 语音转写与录音都是浏览器专用模块,按路径直引,不走 engine barrel
import { transcribe } from '../../engine/asr';
import { blobToWav16k, startRecording, type Recorder } from '../../lib/audio';
import s from './classroom.module.css';

// 讲课进行中「不给学生看牌」:导演动作(误区注入/开窍复述/救援层级)一律不在现场显示——
// 它会直接告诉学生"这句是陷阱,别认同"或"你刚讲对了"。动作仍随消息落库,只在复盘/成长/教师页事后揭示。
// 现场粉笔小字只注小白的「心情」,是角色表达,不泄露教学机关。

const MOOD_ZH: Record<XiaobaiMood, string> = {
  idle: '平静',
  curious: '好奇',
  confused: '困惑',
  thinking: '琢磨中',
  aha: '开窍了',
  happy: '开心',
  proud: '得意',
  shy: '不好意思',
};

const LEVEL_NAME = ['嫩芽期', '开窍期', '求索期', '问难期', '出师期'] as const;

/** 讲解舱引路(称呼纪律:课堂台词一律「老师」);只讲怎么用教室,不泄任何导演机关。
    末步跟着收尾按钮走 mode:teach/reteach 是「送小白赴考」,review 是「完成温故」 */
function buildTeachTour(mode: SessionMode): TourStep[] {
  return [
    {
      target: '[data-tour="stage"]',
      title: '讲台边的小白',
      text: '我就坐在这儿听课。桌牌上写着我的期数和心情——老师讲得清不清楚,看我的脸色就知道。',
    },
    {
      target: '[data-tour="board"]',
      title: '一块黑板',
      text: '对话都写在黑板上。我没读过标准答案,老师的话就是我的全部教材,听不懂我一定会问。',
    },
    {
      target: '[data-tour="input"]',
      title: '开讲',
      text: '在这里把知识讲给我听,Enter 发送。用老师自己的话讲,别背书——背书我听不懂。',
    },
    {
      target: '[data-tour="mic"]',
      title: '开口就讲',
      text: '打字累了就点这个,直接开口讲;再点一下,老师的话就变成文字落进输入框,改顺了再发给我。',
    },
    mode === 'review'
      ? {
          target: '[data-tour="end"]',
          title: '温故收尾',
          text: '帮我把忘了的想起来,讲得差不多就点「完成温故」——这一课的温故记录会留在档案里。',
        }
      : {
          target: '[data-tour="end"]',
          title: '送我赴考',
          text: '讲得差不多了,就送我去赴考。我在考场上的样子,就是老师讲解的成色。',
        },
  ];
}

const TRAILING_PROBE_PAUSE_MS = 760;

/** 尾句为追问时,找出它前面的句界;消息正文不插标记,回放与引文保持干净。 */
function trailingProbePauseAfter(text: string): number | null {
  const questionEnd = Math.max(text.lastIndexOf('?'), text.lastIndexOf('？'));
  if (questionEnd < 0 || text.slice(questionEnd + 1).trim()) return null;
  for (let i = questionEnd - 1; i >= 0; i -= 1) {
    if (/[。!?！？]/.test(text[i])) return i + 1;
  }
  return null;
}

/** 打字机逐字浮现(像在想怎么说) */
function TypewriterText({ text, animate, onTick, onDone }: {
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
    let timer = 0;
    const pauseAfter = trailingProbePauseAfter(text);
    const step = () => {
      v += 1;
      setN(v);
      cbRef.current.onTick?.();
      if (v >= text.length) {
        cbRef.current.onDone?.();
        return;
      }
      timer = window.setTimeout(step, v === pauseAfter ? TRAILING_PROBE_PAUSE_MS : 26);
    };
    if (text.length === 0) cbRef.current.onDone?.();
    else timer = window.setTimeout(step, 26);
    return () => window.clearTimeout(timer);
  }, [text, animate]);

  const typing = animate && n < text.length;
  return (
    <>
      {text.slice(0, n)}
      {typing ? <span className={s.caret} aria-hidden="true">▍</span> : null}
    </>
  );
}

/** 情绪 → 粉笔配色档:开窍系黛绿(aha 额外闪一次水洗光)、受挫系藤黄,其余默认灰粉笔 */
const MOOD_TONE: Partial<Record<XiaobaiMood, string>> = {
  aha: `${s.moodGlad} ${s.moodAha}`, happy: s.moodGlad, proud: s.moodGlad,
  confused: s.moodWarm, shy: s.moodWarm,
};

/** 录音错误/转写错误 → 人话提示(不暴露错误码) */
function asrErrorHint(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return '麦克风权限被拒了,在浏览器地址栏允许后再试';
    if (e.name === 'NotFoundError') return '没找到麦克风设备';
    if (e.name === 'EncodingError') return '这段录音没录上,再录一次';
  }
  const code = e instanceof Error ? e.message : '';
  if (code === 'record-failed') return '录音出了岔子,再试一次';
  if (code === 'asr-auth') return '语音输入要登录后才能用';
  if (code === 'asr-disabled') return '服务器还没开通语音服务';
  if (code === 'asr-unconfigured') return '先去设置里把语音服务配好';
  if (code === 'asr-rate-limited') return '说得太频繁了,歇一会儿再试';
  if (code === 'asr-daily-limit') return '今天的语音额度用完了,明天再来(打字不受限)';
  if (code === 'asr-timeout') return '转写超时了,再试一次';
  if (code.startsWith('asr-http-') || code === 'asr-empty') return '转写没成功,再试一次';
  // 网络层直接抛 TypeError:按当前模式给对症的话
  return useAppStore.getState().asrSettings.mode === 'api'
    ? '连不上自配的转写服务,检查 Base URL 和网络'
    : '语音服务连不上——需登录使用,或在设置里自配转写服务';
}

/** 录音上限:16k WAV ≈ 32KB/s,3 分钟 ≈ 5.6MB,仍在网关 8MB 限内 */
const MAX_REC_SECONDS = 180;

/** 讲桌上的麦克风:点一下开录,再点一下收音转文字,落进输入框由老师改定再发 */
function MicButton({ disabled, onText }: { disabled: boolean; onText: (t: string) => void }) {
  const [phase, setPhase] = useState<'idle' | 'rec' | 'busy'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [hint, setHint] = useState('');
  const recRef = useRef<Recorder | null>(null);
  const hintTimerRef = useRef(0);
  /** getUserMedia 悬挂期间的双击/卸载守卫:开录中不许再开,卸载后拿到的流当场回收 */
  const startingRef = useRef(false);
  const disposedRef = useRef(false);

  // 卸载(下课/暂离)时回收麦克风,别让采音红点挂在标签页上
  useEffect(() => () => {
    disposedRef.current = true;
    recRef.current?.cancel();
    recRef.current = null;
    window.clearTimeout(hintTimerRef.current);
  }, []);

  const showHint = useCallback((m: string) => {
    setHint(m);
    window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setHint(''), 6000);
  }, []);

  const finish = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    setPhase('busy');
    try {
      const raw = await rec.stop();
      const wav = await blobToWav16k(raw);
      const text = await transcribe(wav, useAppStore.getState().asrSettings);
      if (text) onText(text);
      else showHint('没听清,靠近麦克风再说一次');
    } catch (e) {
      showHint(asrErrorHint(e));
    } finally {
      setPhase('idle');
    }
  }, [onText, showHint]);

  // 录音计时(updater 保持纯函数;到限自动收音由下面的独立 effect 判)
  useEffect(() => {
    if (phase !== 'rec') return;
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);
  useEffect(() => {
    if (phase === 'rec' && seconds >= MAX_REC_SECONDS) void finish();
  }, [phase, seconds, finish]);

  const toggle = async () => {
    if (phase === 'busy' || startingRef.current) return;
    if (phase === 'rec') return void finish();
    setHint('');
    // HTTP 明文站点(裸 IP 部署)拿不到麦克风:浏览器只在安全上下文暴露 mediaDevices
    if (!window.isSecureContext) {
      return showHint('浏览器只在 HTTPS(或本机调试)下开放麦克风,这个站点暂时用不了语音');
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return showHint('这个浏览器不支持录音');
    }
    startingRef.current = true;
    try {
      const rec = await startRecording();
      // 权限弹窗悬挂期间可能已下课离场:拿到的流当场回收,别让采音红点挂着
      if (disposedRef.current) {
        rec.cancel();
        return;
      }
      recRef.current = rec;
      setPhase('rec');
    } catch (e) {
      if (!disposedRef.current) showHint(asrErrorHint(e));
    } finally {
      startingRef.current = false;
    }
  };

  const label = phase === 'rec'
    ? `停止录音(已录 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')})`
    : phase === 'busy' ? '正在转写' : '语音输入:开口把知识讲给小白';

  return (
    <>
      <button
        type="button"
        className={phase === 'rec' ? `${s.micBtn} ${s.micRec}` : s.micBtn}
        data-tour="mic"
        onClick={() => void toggle()}
        disabled={disabled || phase === 'busy'}
        aria-label={label}
        title={label}
        aria-pressed={phase === 'rec'}
      >
        {phase === 'rec' ? (
          <>
            <span className={s.micDot} aria-hidden="true" />
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
          </>
        ) : phase === 'busy' ? (
          <span className={s.micBusy}>听写中…</span>
        ) : (
          <Icon name="mic" size={16} />
        )}
      </button>
      {hint && <span className={s.micHint} role="status">{hint}</span>}
    </>
  );
}

function XiaobaiBubble({ m, animate, onTick, onDone }: {
  m: ChatMessage;
  animate: boolean;
  onTick: () => void;
  onDone: () => void;
}) {
  const tone = m.mood ? MOOD_TONE[m.mood] ?? '' : '';
  return (
    <div className={`${s.rowX} ${tone}`}>
      {m.mood ? <span className={s.anno}>﹝{MOOD_ZH[m.mood]}﹞</span> : null}
      <div className={s.bubbleX}>
        <TypewriterText text={m.text} animate={animate} onTick={onTick} onDone={onDone} />
      </div>
    </div>
  );
}

export default function ClassroomPage() {
  const { topicId = '' } = useParams();
  const [sp] = useSearchParams();
  const rawMode = sp.get('mode');
  const mode: SessionMode =
    rawMode === 'reteach' || rawMode === 'review' ? rawMode : 'teach';
  const navigate = useNavigate();

  const live = useAppStore((st) => st.live);
  const events = useAppStore((st) => st.events);
  const g = useAppStore((st) => st.global);
  const submitTeaching = useAppStore((st) => st.submitTeaching);
  const closeLookup = useAppStore((st) => st.closeLookup);
  const endSession = useAppStore((st) => st.endSession);
  const abandonSession = useAppStore((st) => st.abandonSession);

  const topic = getTopic(topicId);
  useDocTitle(topic ? `学堂夜课 · ${topic.title}` : undefined);
  // 演示助手是一键满分讲稿 = 内置答案键,正式部署里对学生隐藏。
  // 只在本地开发(npm run dev)或答辩时显式带 ?demo=1 才出现,生产构建默认剥离。
  const demoEnabled = import.meta.env.DEV || sp.get('demo') === '1';
  const demoLines = demoEnabled ? getDemoScript(topicId) : [];

  const [draft, setDraft] = useState('');
  const [demoOpen, setDemoOpen] = useState(false);
  const [typingNow, setTypingNow] = useState(false);
  const [tapMood, setTapMood] = useState<XiaobaiMood | null>(null);
  const [tapReactionId, setTapReactionId] = useState(0);
  const [reducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );

  /** 挂载时已存在的消息不再重放打字机 */
  const preExistingRef = useRef<Set<string> | null>(null);
  let preIds = preExistingRef.current;
  if (preIds === null) {
    preIds = new Set((useAppStore.getState().live?.messages ?? []).map((m) => m.id));
    preExistingRef.current = preIds;
  }
  const finishedRef = useRef(new Set<string>());
  const streamRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const tapTimerRef = useRef(0);

  useEffect(() => {
    if (live?.busy) {
      window.clearTimeout(tapTimerRef.current);
      tapTimerRef.current = 0;
      setTapMood(null);
    }
    return () => window.clearTimeout(tapTimerRef.current);
  }, [live?.busy]);

  // ── 跨页契约:接管或开新会话 ──
  useEffect(() => {
    if (!topic || topic.locked) return;
    const st = useAppStore.getState();
    if (st.live && st.live.topicId === topicId) return; // 直接接管
    void st.startSession(topicId, mode);
  }, [topicId, mode, topic]);

  // force=false 时只在贴近底部才跟随:打字机每帧置底会把用户往上回看的滚动反复拽回去
  const scrollToBottom = (force = true) => {
    const el = streamRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    if (force || nearBottom) el.scrollTop = el.scrollHeight;
  };
  const prevCountRef = useRef(0);

  const msgCount = live?.messages.length ?? 0;
  const lastXiaobai = live
    ? [...live.messages].reverse().find((m) => m.role === 'xiaobai')
    : undefined;
  const animateId =
    !reducedMotion && lastXiaobai
      && !preIds.has(lastXiaobai.id) && !finishedRef.current.has(lastXiaobai.id)
      ? lastXiaobai.id
      : null;
  const delayedSystemId = animateId && live
    ? live.messages.find((message, index) =>
      message.role === 'system' && live.messages[index - 1]?.id === animateId)?.id ?? null
    : null;

  useEffect(() => {
    if (animateId) setTypingNow(true);
    // 只有新消息落地才强制置底;打字结束/忙碌翻转不把回看中的用户拽回去
    const isNewMessage = msgCount > prevCountRef.current;
    prevCountRef.current = msgCount;
    scrollToBottom(isNewMessage);
  }, [animateId, msgCount, live?.busy]);

  if (!topic || topic.locked) {
    return (
      <div className={s.holder}>
        <p>
          这间教室还没有开放。<Link to="/study"><Icon name="arrow-left" size={15} />回书斋</Link>
        </p>
      </div>
    );
  }
  if (!live || live.topicId !== topicId) {
    return (
      <div className={s.holder}>
        <p>正在把教室的灯打开……</p>
      </div>
    );
  }

  const canSend = !live.busy && !live.ended && draft.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    const text = draft;
    setDraft('');
    void submitTeaching(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const triggerTapReaction = (mood: 'confused' | 'happy') => {
    if (live.busy) return;
    window.clearTimeout(tapTimerRef.current);
    setTapMood(mood);
    setTapReactionId((id) => id + 1);
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = 0;
      setTapMood(null);
    }, 900);
  };
  const onXiaobaiPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || e.button !== 0 || live.busy) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    const pointerY = (e.clientY - bounds.top) / bounds.height;
    triggerTapReaction(pointerY < 0.38 ? 'confused' : 'happy');
  };
  const onXiaobaiKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    triggerTapReaction('happy');
  };

  const quit = () => {
    abandonSession();
    navigate('/study');
  };
  const dismissClass = () => {
    const sid = endSession();
    navigate(sid ? (mode === 'review' ? `/review/${sid}` : `/exam/${sid}`) : '/study');
  };
  const backToPrep = () => {
    abandonSession();
    navigate(`/prep/${topicId}`);
  };
  const handleTypeDone = (id: string) => {
    finishedRef.current.add(id);
    setTypingNow(false);
  };

  // 金句现场微反馈:本会话 golden_analogy_saved 事件的引文逐字出自老师原话(评估层
  // 已做归一化子串校验),回贴到命中的老师气泡上。这是唯一不泄导演机关的现场彩蛋——
  // 只夸讲得好,不提示哪句是陷阱;误区注入/救援层级仍然只在复盘事后揭示。
  const normQuote = (t: string) => t.replace(/\s+/g, '');
  const goldenQuotes = events
    .filter((e) => e.sessionId === live.sessionId && e.type === 'golden_analogy_saved')
    .map((e) => normQuote(String(e.payload.text ?? '')))
    .filter(Boolean);
  const isGoldenRow = (text: string) => {
    if (goldenQuotes.length === 0) return false;
    const t = normQuote(text);
    return goldenQuotes.some((q) => t.includes(q));
  };

  const lookupItem = live.lookupChecklistId
    ? topic.checklist.find((c) => c.id === live.lookupChecklistId) ?? null
    : null;
  const lastSystemText = [...live.messages].reverse().find((m) => m.role === 'system')?.text;
  const finishLabel = mode === 'review' ? '完成温故' : '送小白赴考';
  const finishIcon = mode === 'review' ? 'pen' : 'route';
  const examCued = mode !== 'review' && live.examCuedAt !== undefined;
  const displayedMood = live.busy ? 'thinking' : tapMood ?? live.mood;

  return (
    <div className={s.room}>
      {/* ── 顶栏 ── */}
      <header className={s.topbar}>
        <button type="button" className={s.quitBtn} onClick={quit}>
          <Icon name="arrow-left" size={16} />
          <span>暂离学堂</span>
        </button>
        <div className={s.topTitle}>
          <span className={s.topCourse}>第二章 · 学堂夜课 · {topic.course}</span>
          <span className={s.topName}>{topic.title}</span>
        </div>
        {!live.ended && (
          <button
            type="button"
            className={`${s.endBtn} ${examCued ? s.endBtnReady : ''}`}
            data-tour="end"
            onClick={dismissClass}
            disabled={live.busy}
          >
            <Icon name={finishIcon} size={16} />
            {finishLabel}
          </button>
        )}
      </header>
      {mode !== 'teach' && (
        <div className={s.modeBanner}>
          {mode === 'reteach'
            ? '重讲验证 —— 上次被带偏的地方,这次要把它讲明白。'
            : '帮小白复习 —— 它把上次学的忘了一些,快帮它想起来。'}
        </div>
      )}

      <div className={s.main}>
        {/* ── 左 1/3:讲台(暖光晕下的小白) ── */}
        <aside className={s.stage} data-tour="stage">
          <div
            className={s.boardFrame}
            role="button"
            tabIndex={0}
            aria-label="逗逗小白"
            aria-disabled={live.busy}
            aria-live="off"
            onPointerDown={onXiaobaiPointerDown}
            onKeyDown={onXiaobaiKeyDown}
          >
            <XiaobaiAvatar
              mood={displayedMood}
              level={g.learningLevel}
              speaking={typingNow}
              size={170}
              variant="board"
            />
            {tapMood ? <span key={tapReactionId} className={s.tapBlush} aria-hidden="true" /> : null}
          </div>
          <div className={s.plate}>
            <div className={s.plateName}>小白</div>
            <div className={s.plateRow}>{LEVEL_NAME[g.learningLevel - 1]} · {g.persona}</div>
            <div className={s.plateRow}>在学:{topic.title}</div>
            <div className={s.plateRow}>
              心情:{MOOD_ZH[live.busy ? 'thinking' : live.mood]} · 已讲 {live.traces.length} 轮
            </div>
          </div>
          {live.busy && <div className={s.stageThinking}>小白正在琢磨…</div>}
          <p className={s.stageHint}>
            把知识讲给小白听——它没读过标准答案,你的话就是它的全部教材。
          </p>
        </aside>

        {/* ── 右 2/3:木框黑板(对话流写在板上,板下粉笔槽) ── */}
        <section className={s.chat}>
          <div className={s.boardObj} data-tour="board">
            <div className={s.stream} ref={streamRef}>
              {live.messages.map((m) =>
              m.role === 'system' ? (
                m.id === delayedSystemId ? null : (
                  <div key={m.id} className={s.rowSys}>
                    <span className={s.sysTag}>导演</span>
                    {m.text}
                  </div>
                )
              ) : m.role === 'teacher' ? (
                isGoldenRow(m.text) ? (
                  <div key={m.id} className={`${s.rowT} ${s.rowGold}`}>
                    <div className={s.bubbleT}>{m.text}</div>
                    <span className={s.goldNote}>﹝小白把这句记进小本本了﹞</span>
                  </div>
                ) : (
                  <div key={m.id} className={s.rowT}>
                    <div className={s.bubbleT}>{m.text}</div>
                  </div>
                )
              ) : (
                <XiaobaiBubble
                  key={m.id}
                  m={m}
                  animate={m.id === animateId}
                  onTick={() => scrollToBottom(false)}
                  onDone={() => handleTypeDone(m.id)}
                />
              ),
            )}
            {live.busy && (
              <div className={s.rowX}>
                <div className={s.thinking}>
                  小白正在琢磨
                  <span className={s.dots}><i>.</i><i>.</i><i>.</i></span>
                </div>
              </div>
            )}
              <p className={s.srOnly} aria-live="polite">
                {!typingNow && !live.busy ? lastXiaobai?.text ?? '' : ''}
              </p>
            </div>
            {/* 粉笔槽:板下木沿,搁着一截粉笔和板擦 */}
            <div className={s.tray} aria-hidden="true" />
          </div>

          {/* ── 底部讲桌:结束面板 或 演示助手 + 输入区 ── */}
          <div className={s.dock}>
            {live.ended ? (
              <div className={s.endedPanel}>
                <p className={s.endedTitle}>本轮讲解已结束</p>
                <p className={s.endedNote}>
                  {lastSystemText ?? '导演:这一轮先到这里,盲区已记录在案。'}
                </p>
                <div className={s.endedBtns}>
                  <button type="button" className={s.primaryBtn} onClick={backToPrep}>
                    回去备课
                  </button>
                  <button type="button" className={s.ghostBtn} onClick={dismissClass}>
                    {mode === 'review' ? '查看温故记录' : '送小白赴考'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {demoLines.length > 0 && (
                  <div className={s.demoWrap}>
                    <button
                      type="button"
                      className={s.demoToggle}
                      aria-expanded={demoOpen}
                      onClick={() => setDemoOpen((o) => !o)}
                    >
                      <Icon
                        name="chevron-right"
                        size={15}
                        className={demoOpen ? s.chevronOpen : s.chevron}
                      />
                      {demoOpen ? '演示助手(点击话术填入输入框,不会直接发送)' : '演示助手'}
                    </button>
                    <div className={`${s.demoBody} ${demoOpen ? s.demoBodyOpen : ''}`}>
                      <div className={s.demoInner}>
                        {demoLines.map((l) => (
                          <button
                            key={l.label}
                            type="button"
                            className={s.demoLine}
                            onClick={() => {
                              setDraft(l.text);
                              inputRef.current?.focus();
                            }}
                          >
                            <span className={s.demoLabel}>{l.label}</span>
                            <span className={s.demoNote}>{l.note}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                <div className={s.inputBar} data-tour="input">
                  <textarea
                    ref={inputRef}
                    className={s.input}
                    value={draft}
                    rows={3}
                    placeholder="把这个知识点讲给小白听……(Enter 发送,Shift+Enter 换行)"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    disabled={live.busy}
                  />
                  <div className={s.inputSide}>
                    <span className={s.count}>{draft.length} 字</span>
                    <div className={s.sideBtns}>
                      <MicButton
                        disabled={live.ended}
                        onText={(text) => {
                          setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')}\n${text}` : text));
                          inputRef.current?.focus();
                        }}
                      />
                      <button
                        type="button"
                        className={s.sendBtn}
                        onClick={send}
                        disabled={!canSend}
                      >
                        <Icon name="send" size={16} />
                        讲给小白
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      {/* ── 新手引路(首访自动开一次;只讲教室怎么用,不碰导演机关) ── */}
      <Tour tourKey="teach" steps={buildTeachTour(mode)} />

      {/* ── R2 查书侧栏:黑教室里一页被台灯照亮的书 ── */}
      {lookupItem && !live.ended && (
        <aside className={s.lookup}>
          <p className={s.lookupTag}>一起查书 · R2</p>
          <h3 className={s.lookupTitle}>{lookupItem.point}</h3>
          <Md text={lookupItem.lookupCard} className={s.lookupMd} />
          <button type="button" className={s.lookupBtn} onClick={closeLookup}>
            我来接着讲
          </button>
        </aside>
      )}
    </div>
  );
}
