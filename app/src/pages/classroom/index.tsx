/**
 * 讲解舱 /teach/:topicId?mode=teach|reteach|review —— 满幅黑板。
 * 顶部一条细栏（暂离 / 课程 › 知识点 / 轮次 / 下课），对话流独立滚动，底部居中一只大圆角讲桌输入框。
 * 小白坐在左下角（窄屏收进板头一行），点头像展开简介。
 * 挂载契约:store.live 存在且 topicId 吻合则直接接管,否则 startSession(topicId, mode)。
 * 下课:endSession() → /exam/:sessionId → /review/:sessionId;R4 退回备课:abandonSession() → /prep/:topicId。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  ArrowUp,
  Camera,
  ChevronRight,
  Film,
  ImagePlus,
  Mic,
  NotebookPen,
  PenLine,
  Route,
  Square,
  Swords,
  X,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { getDemoScript, getTopic } from '../../data';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { Badge, Button, IconButton, Shimmer, Spinner, ThinkingDots, Tip, cx } from '../../components/ui';
import { Tour, type TourStep } from '../../components/tour/Tour';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import type { ChatMessage, SessionMode, XiaobaiMood } from '../../types';
import { useDocTitle } from '../../hooks/useDocTitle';
// 语音转写与录音都是浏览器专用模块,按路径直引,不走 engine barrel
import { transcribe } from '../../engine/asr';
import { blobToWav16k, startRecording, type Recorder } from '../../lib/audio';
import {
  IMAGE_INPUT_ACCEPT,
  imageAttachmentErrorHint,
  prepareImageAttachment,
  revokeImageAttachment,
  type PreparedImageAttachment,
} from '../../lib/imageAttachment';
import { visionErrorHint } from '../../lib/vision';
import { getStageMeta } from '../../engine/evolution';
import { VideoFramePicker } from './VideoFramePicker';
import s from './classroom.module.css';

// 讲课进行中「不给学生看牌」:导演动作(误区注入/开窍复述/救援层级)一律不在现场显示——
// 它会直接告诉学生"这句是陷阱,别认同"。动作仍随消息落库,只在复盘/成长/教师页事后揭示。
// 现场粉笔小字只注小白的「心情」;另有两张事后贺签(金句被记下、心魔已被讲退),只夸已经发生的事。

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

/** 讲解舱引路(称呼纪律:课堂台词一律「老师」);只讲怎么用教室,不泄任何导演机关。
    末步跟着收尾按钮走 mode:teach/reteach 是「送小白赴考」,review 是「完成温故」 */
function buildTeachTour(mode: SessionMode): TourStep[] {
  return [
    {
      target: '[data-tour="stage"]',
      title: '讲台边的小白',
      text: '我就坐在这儿听课。桌牌上写着我的科名和心情——老师讲得清不清楚,看我的脸色就知道。',
    },
    {
      target: '[data-tour="board"]',
      title: '一块黑板',
      text: '对话都写在黑板上。我没读过标准答案,老师的话就是我的全部教材,听不懂我一定会问。',
    },
    {
      target: '[data-tour="input"]',
      title: '开讲',
      text: '在这里把知识讲给我听，也可选图或拍照辅助讲解，Enter 发送。用老师自己的话讲，别背书——背书我听不懂。',
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

/** 头像旁心情签的配色档,与板上粉笔配色同一套 */
const MOOD_CHIP_TONE: Partial<Record<XiaobaiMood, 'glad' | 'warm' | 'think'>> = {
  aha: 'glad', happy: 'glad', proud: 'glad', confused: 'warm', shy: 'warm', thinking: 'think',
};

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** 板角的粉笔计数:每讲完一轮添一笔,五笔一组(第五笔斜划过去) */
function ChalkTally({ count }: { count: number }) {
  const groups: number[] = [];
  for (let rest = Math.min(count, 15); rest > 0; rest -= 5) groups.push(Math.min(5, rest));
  if (groups.length === 0) return null;
  return (
    <span className={s.tally} aria-hidden="true">
      {groups.map((strokes, group) => (
        <svg key={group} viewBox="0 0 22 16" width="22" height="16">
          {Array.from({ length: Math.min(strokes, 4) }, (_, i) => (
            <line key={i} x1={3 + i * 5} y1={2.5} x2={3.7 + i * 5} y2={13.5} />
          ))}
          {strokes === 5 ? <line x1={0.8} y1={12} x2={20.6} y2={4} /> : null}
        </svg>
      ))}
    </span>
  );
}

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
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      recRef.current?.cancel();
      recRef.current = null;
      window.clearTimeout(hintTimerRef.current);
    };
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
    ? `停止录音(已录 ${clock(seconds)})`
    : phase === 'busy' ? '正在转写' : '语音输入:开口把知识讲给小白';

  return (
    <>
      <Tip label={phase === 'rec' ? '再点一下,收音转成文字' : phase === 'busy' ? '正在转写' : '语音:开口讲给小白'}>
        <button
          type="button"
          className={cx(s.micBtn, phase === 'rec' && s.micRec, phase === 'busy' && s.micBusy)}
          data-tour="mic"
          onClick={() => void toggle()}
          disabled={disabled || phase === 'busy'}
          aria-label={label}
          aria-pressed={phase === 'rec'}
        >
          {phase === 'rec' ? (
            <>
              <span className={s.micDot} aria-hidden="true" />
              <span className={s.micClock}>{clock(seconds)}</span>
              <Square size={11} strokeWidth={0} fill="currentColor" aria-hidden="true" />
            </>
          ) : phase === 'busy' ? (
            <>
              <Spinner size={14} />
              <span>听写中</span>
            </>
          ) : (
            <Mic size={18} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </Tip>
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
      <span className={s.anno}>
        小白{m.mood ? <i>﹝{MOOD_ZH[m.mood]}﹞</i> : null}
      </span>
      <div className={s.bubbleX}>
        <TypewriterText text={m.text} animate={animate} onTick={onTick} onDone={onDone} />
      </div>
    </div>
  );
}

/** 老师的话写在板上:粉笔色气泡,公式与代码走 CoachMarkdown。
    两种现场彩蛋都只在事后夸奖——金句被记下、心魔被老师讲退;不预告任何导演机关。 */
function TeacherBubble({ message, golden, vanquished }: {
  message: ChatMessage;
  golden: boolean;
  vanquished: boolean;
}) {
  return (
    <div className={cx(s.rowT, golden && s.rowGold, vanquished && s.rowVanquished)}>
      <div className={cx(s.bubbleT, message.image && s.bubbleTWithImage)}>
        {message.image ? (
          <img
            className={s.teacherImage}
            src={message.image.objectUrl}
            width={message.image.width}
            height={message.image.height}
            alt="老师本轮上传的辅助讲图"
            decoding="async"
          />
        ) : null}
        {message.text ? (
          <div className={s.teacherText}><CoachMarkdown text={message.text} /></div>
        ) : null}
      </div>
      {golden ? (
        <span className={cx(s.beat, s.beatGold)}>
          <NotebookPen size={14} strokeWidth={1.75} aria-hidden="true" />
          金句 · 小白把这句记进小本本了
        </span>
      ) : null}
      {vanquished ? (
        <span className={cx(s.beat, s.beatDemon)}>
          <Swords size={14} strokeWidth={1.75} aria-hidden="true" />
          心魔退散 · 小白被老师拉回来了
        </span>
      ) : null}
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
  const customTopicsStatus = useAppStore((st) => st.customTopicsStatus);
  const submitTeaching = useAppStore((st) => st.submitTeaching);
  const closeLookup = useAppStore((st) => st.closeLookup);
  const endSession = useAppStore((st) => st.endSession);
  const abandonSession = useAppStore((st) => st.abandonSession);

  const topic = getTopic(topicId);
  useDocTitle(topic ? `学堂夜课 · ${topic.title}` : undefined);
  // 演示助手是一键满分讲稿 = 内置答案键,仅在本地开发构建中开放。
  const demoEnabled = import.meta.env.DEV;
  const demoLines = demoEnabled ? getDemoScript(topicId) : [];

  const [draft, setDraft] = useState('');
  const [pendingImage, setPendingImage] = useState<PreparedImageAttachment | null>(null);
  const [imagePreparing, setImagePreparing] = useState(false);
  const [imageHint, setImageHint] = useState('');
  const [demoOpen, setDemoOpen] = useState(false);
  const [typingNow, setTypingNow] = useState(false);
  const [tapMood, setTapMood] = useState<XiaobaiMood | null>(null);
  const [tapReactionId, setTapReactionId] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
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
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const profileRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const pendingImageRef = useRef<PreparedImageAttachment | null>(null);
  const imageTaskRef = useRef(0);
  const imageTopicRef = useRef(topicId);
  const disposedRef = useRef(false);
  const sendingRef = useRef(false);
  const sendGenerationRef = useRef(0);
  const tapTimerRef = useRef(0);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const sync = () => mainRef.current?.style.setProperty('--composer-height', `${dock.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [live?.sessionId]);
  // 输入框随内容长高(上限由样式的 max-height 兜住,超出后框内滚动)
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }, [draft, live?.sessionId, live?.ended]);
  // 小白答完把光标还给老师:只在键鼠设备上做,触屏不主动弹键盘;焦点在别处时不抢
  const busyNow = live?.busy ?? false;
  const wasBusyRef = useRef(false);
  useEffect(() => {
    const finished = wasBusyRef.current && !busyNow;
    wasBusyRef.current = busyNow;
    if (!finished || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    const active = document.activeElement;
    if (!active || active === document.body) inputRef.current?.focus({ preventScroll: true });
  }, [busyNow]);
  useEffect(() => {
    if (!profileOpen) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !profileRef.current?.contains(target) && !avatarRef.current?.contains(target)) setProfileOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { setProfileOpen(false); avatarRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [profileOpen]);

  useEffect(() => {
    // React StrictMode 会在开发环境执行 setup→cleanup→setup，每次 setup 都要恢复挂载态。
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      imageTaskRef.current += 1;
      sendGenerationRef.current += 1;
      sendingRef.current = false;
      if (pendingImageRef.current) revokeImageAttachment(pendingImageRef.current);
    };
  }, []);

  useEffect(() => {
    if (imageTopicRef.current === topicId) return;
    imageTopicRef.current = topicId;
    imageTaskRef.current += 1;
    sendGenerationRef.current += 1;
    sendingRef.current = false;
    if (pendingImageRef.current) revokeImageAttachment(pendingImageRef.current);
    pendingImageRef.current = null;
    setPendingImage(null);
    setImagePreparing(false);
    setImageHint('');
  }, [topicId]);

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
    const loadingCustom = topicId.startsWith('custom-')
      && (customTopicsStatus === 'idle' || customTopicsStatus === 'loading');
    return (
      <div className={s.holder}>
        {loadingCustom ? (
          <p><Shimmer>正在把自选讲义送进教室</Shimmer></p>
        ) : (
          <>
            <p>这间教室还没有开放。</p>
            <Button asChild variant="outline" pill icon={<ArrowLeft size={16} strokeWidth={1.75} />}>
              <Link to="/learn">回学习终端</Link>
            </Button>
          </>
        )}
      </div>
    );
  }
  if (!live || live.topicId !== topicId) {
    return (
      <div className={s.holder}>
        <p><Shimmer>正在把教室的灯打开</Shimmer></p>
      </div>
    );
  }

  const replacePendingImage = (next: PreparedImageAttachment | null, revokePrevious = true) => {
    const previous = pendingImageRef.current;
    if (revokePrevious && previous && previous !== next) revokeImageAttachment(previous);
    pendingImageRef.current = next;
    setPendingImage(next);
  };
  const chooseImage = async (file: File | undefined) => {
    if (!file || live.busy || imagePreparing) return;
    const task = imageTaskRef.current + 1;
    imageTaskRef.current = task;
    setImagePreparing(true);
    setImageHint('正在把图片夹进讲义…');
    try {
      const prepared = await prepareImageAttachment(file);
      if (disposedRef.current || imageTaskRef.current !== task) {
        revokeImageAttachment(prepared);
        return;
      }
      replacePendingImage(prepared);
      setImageHint('图片已夹好，可以配上讲解再发');
    } catch (error) {
      if (!disposedRef.current && imageTaskRef.current === task) {
        setImageHint(imageAttachmentErrorHint(error));
      }
    } finally {
      if (!disposedRef.current && imageTaskRef.current === task) setImagePreparing(false);
    }
  };
  const onImageSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    void chooseImage(file);
  };
  const removePendingImage = () => {
    if (live.busy || imagePreparing) return;
    replacePendingImage(null);
    setImageHint('已移除辅助讲图');
    inputRef.current?.focus();
  };

  const canSend = !live.busy && !live.ended && !imagePreparing
    && (draft.trim().length > 0 || pendingImage !== null);
  const send = async () => {
    if (!canSend || sendingRef.current) return;
    sendingRef.current = true;
    const generation = sendGenerationRef.current + 1;
    sendGenerationRef.current = generation;
    const sessionId = live.sessionId;
    const text = draft;
    const image = pendingImageRef.current ?? undefined;
    if (!image) setDraft('');
    else setImageHint('小白正在看这张图…');
    try {
      const result = await submitTeaching(text, image);
      const stillCurrent = !disposedRef.current
        && sendGenerationRef.current === generation
        && useAppStore.getState().live?.sessionId === sessionId;
      if (!stillCurrent) return;
      if (result.accepted) {
        // 等待期间用户可能点了演示话术；新草稿不能被旧请求清掉。
        setDraft((current) => current === text ? '' : current);
        if (image && pendingImageRef.current === image) replacePendingImage(null);
        setImageHint('');
        return;
      }
      if (!image) setDraft((current) => current || text);
      if (image) setImageHint(visionErrorHint(result.error));
    } finally {
      if (sendGenerationRef.current === generation) sendingRef.current = false;
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
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

  const quit = () => {
    abandonSession();
    navigate(`/prep/${topicId}`);
  };
  const dismissClass = () => {
    const sid = endSession();
    navigate(sid ? (mode === 'review' ? `/review/${sid}` : `/exam/${sid}`) : '/learn');
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
  // 已做归一化子串校验),回贴到命中的老师气泡上。现场彩蛋只夸讲得好,
  // 不提示哪句是陷阱;误区注入/救援层级仍然只在复盘事后揭示。
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

  // 心魔退散:本会话 misconception_corrected 事件落在哪句老师的话之后,贺签就贴在那句话下面。
  // 只在纠正成功之后出现(事后夸奖,与金句同一纪律);注入与被带偏仍然只在复盘揭示。
  const teacherMessages = live.messages.filter((m) => m.role === 'teacher');
  const vanquishedIds = new Set<string>();
  for (const e of events) {
    if (e.sessionId !== live.sessionId || e.type !== 'misconception_corrected') continue;
    const hit = [...teacherMessages].reverse().find((m) => m.t <= e.t);
    if (hit) vanquishedIds.add(hit.id);
  }

  const lookupItem = live.lookupChecklistId
    ? topic.checklist.find((c) => c.id === live.lookupChecklistId) ?? null
    : null;
  const lastSystemText = [...live.messages].reverse().find((m) => m.role === 'system')?.text;
  const finishLabel = mode === 'review' ? '完成温故' : '送小白赴考';
  const examCued = mode !== 'review' && live.examCuedAt !== undefined;
  const latestTeacher = [...live.messages].reverse().find((message) => message.role === 'teacher');
  const isLookingAtImage = live.busy && (pendingImage !== null || latestTeacher?.image !== undefined);
  const displayedMood = live.busy ? 'thinking' : tapMood ?? live.mood;
  const stageMeta = getStageMeta(g.learningLevel);
  const roundsDone = live.traces.length;
  const modeWord = mode === 'review' ? '温故' : mode === 'reteach' ? '重讲' : '夜课';
  const thinkingText = isLookingAtImage ? '小白正在看图' : '小白正在琢磨';
  const mediaLocked = live.busy || imagePreparing;
  const countText = imagePreparing
    ? '图片处理中…'
    : live.busy
      ? `${thinkingText}…`
      : draft.length > 0 || pendingImage
        ? `${draft.length} 字${pendingImage ? ' · 1 图' : ''}`
        : '';

  return (
    <div className={s.room}>
      {/* ── 顶栏:暂离 / 课程 › 知识点 / 轮次 / 下课 ── */}
      <header className={s.topbar}>
        <IconButton label="暂离课堂,回学习终端" tip="bottom" onClick={quit}>
          <ArrowLeft size={18} strokeWidth={1.75} />
        </IconButton>
        <div className={s.crumb}>
          <span className={s.crumbCourse}>{topic.course}</span>
          <ChevronRight className={s.crumbSep} size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className={s.crumbTopic}>{topic.title}</span>
          {mode !== 'teach' && (
            <Badge tone="warn" className={s.modeBadge}>{mode === 'reteach' ? '重讲验证' : '温故'}</Badge>
          )}
        </div>
        <div className={s.rounds} role="status" aria-label={`第 ${roundsDone + 1} 轮,已讲完 ${roundsDone} 轮`}>
          <ChalkTally count={roundsDone} />
          <span>第 {roundsDone + 1} 轮</span>
        </div>
        {!live.ended && (
          <Button
            variant={examCued ? 'accent' : 'outline'}
            pill
            className={cx(s.endBtn, examCued && s.endBtnReady)}
            data-tour="end"
            onClick={dismissClass}
            disabled={live.busy}
            icon={mode === 'review'
              ? <PenLine size={16} strokeWidth={1.75} />
              : <Route size={16} strokeWidth={1.75} />}
          >
            {finishLabel}
          </Button>
        )}
      </header>
      {mode !== 'teach' && (
        <div className={s.modeBanner}>
          {mode === 'reteach'
            ? '重讲验证 —— 上次被带偏的地方,这次要把它讲明白。'
            : '帮小白复习 —— 它把上次学的忘了一些,快帮它想起来。'}
        </div>
      )}

      <div className={s.main} ref={mainRef}>
        {/* ── 讲台边的小白:宽屏坐在左下角,窄屏收成板头一行 ── */}
        <aside className={s.stage} data-tour="stage">
          <button
            ref={avatarRef}
            type="button"
            className={s.boardFrame}
            aria-label="查看小白简介"
            aria-expanded={profileOpen}
            aria-controls="classroom-xiaobai-profile"
            aria-live="off"
            onClick={() => { setProfileOpen((open) => !open); triggerTapReaction('happy'); }}
          >
            <XiaobaiAvatar
              mood={displayedMood}
              level={g.learningLevel}
              speaking={typingNow}
              size={96}
              variant="board"
            />
            {tapMood ? <span key={tapReactionId} className={s.tapBlush} aria-hidden="true" /> : null}
          </button>
          <span className={s.moodChip} data-tone={MOOD_CHIP_TONE[displayedMood]} aria-hidden="true">
            <b>小白</b>
            {MOOD_ZH[displayedMood]}
          </span>
          <section
            id="classroom-xiaobai-profile"
            ref={profileRef}
            className={s.profilePopover}
            hidden={!profileOpen}
            aria-label="小白简介"
          >
            <header className={s.profileHead}>
              <strong>小白</strong>
              <Badge tone="accent">{stageMeta.name}</Badge>
              <span>{stageMeta.description}</span>
            </header>
            <dl className={s.profileRows}>
              <div><dt>性子</dt><dd>{g.persona}</dd></div>
              <div><dt>在学</dt><dd>{topic.title}</dd></div>
              <div><dt>心情</dt><dd>{MOOD_ZH[live.busy ? 'thinking' : live.mood]}</dd></div>
              <div><dt>课上</dt><dd>已讲 {roundsDone} 轮</dd></div>
            </dl>
            {live.busy && (
              <div className={s.stageThinking}><Shimmer>{thinkingText}…</Shimmer></div>
            )}
            <p className={s.stageHint}>
              把知识讲给小白听——它没读过标准答案,你的话就是它的全部教材。
            </p>
          </section>
        </aside>

        <section className={s.chat}>
          {/* ── 黑板:板头粉笔字 + 对话流 ── */}
          <div className={s.slate} data-tour="board">
            <div className={s.chalkHead} aria-hidden="true">
              <span className={s.chalkTopic}>
                <small>今日课题</small>
                {topic.title}
              </span>
              <span className={s.chalkMeta}>{modeWord} · 第 {roundsDone + 1} 轮</span>
            </div>
            <div className={s.stream} ref={streamRef}>
              {live.messages.map((m) =>
                m.role === 'system' ? (
                  m.id === delayedSystemId ? null : (
                    <div key={m.id} className={s.rowSys}>
                      <span className={s.sysTag}>导演</span>
                      <span>{m.text}</span>
                    </div>
                  )
                ) : m.role === 'teacher' ? (
                  <TeacherBubble
                    key={m.id}
                    message={m}
                    golden={isGoldenRow(m.text)}
                    vanquished={vanquishedIds.has(m.id)}
                  />
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
                  <span className={s.anno}>小白<i>﹝{MOOD_ZH.thinking}﹞</i></span>
                  <div className={s.thinking}>
                    <Shimmer>{thinkingText}</Shimmer>
                    <ThinkingDots label={thinkingText} />
                  </div>
                </div>
              )}
              <p className={s.srOnly} aria-live="polite">
                {!typingNow && !live.busy ? lastXiaobai?.text ?? '' : ''}
              </p>
            </div>
          </div>

          {/* ── 讲桌:结束面板 或 演示助手 + 输入框 ── */}
          <div className={s.dock} ref={dockRef}>
            {live.ended ? (
              <div className={s.endedPanel}>
                <p className={s.endedTitle}>本轮讲解已结束</p>
                <p className={s.endedNote}>
                  {lastSystemText ?? '导演:这一轮先到这里,盲区已记录在案。'}
                </p>
                <div className={s.endedBtns}>
                  <Button variant="solid" size="lg" pill onClick={backToPrep}>
                    回去备课
                  </Button>
                  <Button variant="outline" size="lg" pill onClick={dismissClass}>
                    {mode === 'review' ? '查看温故记录' : '送小白赴考'}
                  </Button>
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
                      <ChevronRight
                        size={14}
                        strokeWidth={1.75}
                        className={demoOpen ? s.chevronOpen : s.chevron}
                        aria-hidden="true"
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
                <div className={s.composer} data-tour="input" aria-busy={live.busy || imagePreparing}>
                  {videoFile && (
                    <VideoFramePicker file={videoFile} onClose={() => setVideoFile(null)} onFrame={chooseImage} />
                  )}
                  {pendingImage ? (
                    <div className={s.attachRow}>
                      <div className={s.attachChip} role="group" aria-label="待发送的辅助讲图">
                        <img
                          className={s.attachThumb}
                          src={pendingImage.attachment.objectUrl}
                          width={pendingImage.attachment.width}
                          height={pendingImage.attachment.height}
                          alt="待发送的辅助讲图预览"
                        />
                        <span className={s.attachMeta}>
                          <strong>辅助讲图</strong>
                          <small>
                            {pendingImage.attachment.width} × {pendingImage.attachment.height}
                            {' · '}{Math.max(1, Math.round(pendingImage.attachment.byteSize / 1024))}KB
                          </small>
                        </span>
                        <IconButton
                          label="移除待发送的辅助讲图"
                          size="sm"
                          round
                          onClick={removePendingImage}
                          disabled={mediaLocked}
                        >
                          <X size={14} strokeWidth={2} />
                        </IconButton>
                      </div>
                    </div>
                  ) : null}
                  <textarea
                    ref={inputRef}
                    className={s.input}
                    value={draft}
                    rows={2}
                    placeholder="把知识点讲给小白听,也可以附上图片或视频画面"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    disabled={live.busy}
                    aria-label="讲给小白的话"
                    aria-describedby={imageHint ? 'classroom-image-status' : undefined}
                  />
                  {imageHint ? (
                    <span id="classroom-image-status" className={s.status} role="status">
                      {imageHint}
                    </span>
                  ) : null}
                  <div className={s.toolbar}>
                    <div className={s.tools}>
                      <input
                        ref={galleryInputRef}
                        className={s.fileInput}
                        type="file"
                        accept={IMAGE_INPUT_ACCEPT}
                        onChange={onImageSelected}
                        tabIndex={-1}
                      />
                      <input
                        ref={cameraInputRef}
                        className={s.fileInput}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={onImageSelected}
                        tabIndex={-1}
                      />
                      <input
                        ref={videoInputRef}
                        className={s.fileInput}
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        tabIndex={-1}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = '';
                          if (!file) return;
                          if (file.size > 80 * 1024 * 1024) { setImageHint('视频超过 80MB，请先截短或压缩后再选。'); return; }
                          setVideoFile(file);
                        }}
                      />
                      <IconButton
                        label="图片"
                        round
                        onClick={() => galleryInputRef.current?.click()}
                        disabled={mediaLocked}
                      >
                        <ImagePlus size={18} strokeWidth={1.75} />
                      </IconButton>
                      <IconButton
                        label="拍照"
                        round
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={mediaLocked}
                      >
                        <Camera size={18} strokeWidth={1.75} />
                      </IconButton>
                      <IconButton
                        label="视频取帧"
                        round
                        onClick={() => videoInputRef.current?.click()}
                        disabled={mediaLocked || videoFile !== null}
                      >
                        <Film size={18} strokeWidth={1.75} />
                      </IconButton>
                      <MicButton
                        disabled={live.ended || mediaLocked}
                        onText={(text) => {
                          setDraft((d) => (d.trim() ? `${d.replace(/\s+$/, '')}\n${text}` : text));
                          inputRef.current?.focus();
                        }}
                      />
                    </div>
                    <span className={s.count}>{countText}</span>
                    <Tip label={live.busy ? '小白正在回应' : '讲给小白'} shortcut={live.busy ? undefined : 'Enter'}>
                      <button
                        type="button"
                        className={cx(s.sendBtn, live.busy && s.sendBusy)}
                        onClick={() => void send()}
                        disabled={!canSend}
                        aria-label={live.busy ? '小白正在回应' : '讲给小白'}
                      >
                        {live.busy
                          ? <Spinner size={16} />
                          : <ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" />}
                      </button>
                    </Tip>
                  </div>
                </div>
                <p className={s.dockHint}>Enter 发送 · Shift + Enter 换行 · 用自己的话讲,别背书</p>
              </>
            )}
          </div>
        </section>
      </div>

      {/* ── 新手引路(首访自动开一次;只讲教室怎么用,不碰导演机关) ── */}
      <Tour tourKey="teach" steps={buildTeachTour(mode)} />

      {/* ── 一起查书:黑教室里一页被台灯照亮的书(纸质故事物件) ── */}
      {lookupItem && !live.ended && (
        <aside className={s.lookup} data-story aria-label="一起查书">
          <p className={s.lookupTag}>一起查书</p>
          <h3 className={s.lookupTitle}>{lookupItem.point}</h3>
          <div className={s.lookupMd}><CoachMarkdown text={lookupItem.lookupCard} /></div>
          <button type="button" className={s.lookupBtn} onClick={closeLookup}>
            我来接着讲
          </button>
        </aside>
      )}
    </div>
  );
}
