/**
 * 讲解舱 /teach/:topicId?mode=teach|reteach|review —— 一间夜课教室。
 * 黑板是老师的板面(老师的话直接写在板上,公式代码走 CoachMarkdown);小白坐在黑板左手边的课桌后,
 * 他的话是从座位上说出来的气泡。板下是讲桌:讲法提示签 + 输入框。窄屏时小白收进顶栏成一枚头像签。
 * 课堂节奏(第几轮、用时、小白跟得怎么样)只从明面上的对话、心情与两类事后事件派生,见 ./lesson。
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
import { flushSync } from 'react-dom';
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
import { XiaobaiFace } from '../../components/xiaobai/XiaobaiAvatar';
import type { ChatMessage, SessionMode, XiaobaiMood } from '../../types';
import { useDocTitle } from '../../hooks/useDocTitle';
// 语音转写与录音都是浏览器专用模块,按路径直引,不走 engine barrel
import { transcribe } from '../../engine/asr';
import { DICTATION_MESSAGES, realtimeAsrAvailable, startDictation, type Dictation } from '../../lib/realtimeAsr';
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
import { DismissalDialog, EndedPanel, type LessonSummary } from './Dismissal';
import { LessonClock, Notebook, XiaobaiChip, XiaobaiSeat } from './Seat';
import {
  MOOD_ZH,
  SCAFFOLDS,
  appendStarter,
  clock,
  deriveFollow,
  deriveNotebook,
  groupRounds,
  moodTone,
  partingLine,
  taughtDigest,
  thoughtOf,
  type LessonRound,
} from './lesson';
import s from './classroom.module.css';

// 讲课进行中「不给学生看牌」:导演动作(误区注入/开窍复述/救援层级)一律不在现场显示——
// 它会直接告诉学生"这句是陷阱,别认同"。动作仍随消息落库,只在复盘/成长/教师页事后揭示。
// 现场粉笔小字只注小白的「心情」;另有两张事后贺签(金句被记下、心魔已被讲退),只夸已经发生的事。

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

/** 宽窄两种教室:窄屏不摆课桌,小白收进顶栏 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

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

/** 实时字幕只留尾巴:讲桌状态行最多两行,新说的字要看得见 */
const CAPTION_TAIL = 40;

/** 讲桌上的麦克风:点一下开录,再点一下收音转文字,落进输入框由老师改定再发。
    实时字幕与出错提示经 onStatus 交给讲桌的状态行显示(同一处,不另浮一张笺) */
function MicButton({ disabled, onText, onStatus }: {
  disabled: boolean;
  onText: (t: string) => void;
  onStatus: (status: string) => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'rec' | 'busy'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [hint, setHint] = useState('');
  const recRef = useRef<Recorder | null>(null);
  const hintTimerRef = useRef(0);
  // 实时识别：网关开通时边说边出字，说完直接落进输入框；没开通走原来的「录完再转写」
  const [realtime, setRealtime] = useState(false);
  const [live, setLive] = useState('');
  const liveRef = useRef<Dictation | null>(null);
  const liveTextRef = useRef('');
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
      liveRef.current?.cancel();
      liveRef.current = null;
      window.clearTimeout(hintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void realtimeAsrAvailable().then((available) => { if (alive) setRealtime(available); });
    return () => { alive = false; };
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
  const stopLive = useCallback(() => {
    if (!liveRef.current) return false;
    setPhase('busy');
    liveRef.current.stop();
    return true;
  }, []);

  useEffect(() => {
    if (phase === 'rec' && seconds >= MAX_REC_SECONDS && !stopLive()) void finish();
  }, [phase, seconds, finish, stopLive]);

  const startLive = async () => {
    startingRef.current = true;
    liveTextRef.current = '';
    setLive('');
    setPhase('rec');
    let ended = false;
    const handle = await startDictation({
      onText: (committed, interim) => {
        liveTextRef.current = `${committed}${interim}`;
        if (!disposedRef.current) setLive(liveTextRef.current);
      },
      onError: (code) => { if (!disposedRef.current) showHint(DICTATION_MESSAGES[code]); },
      onEnd: () => {
        ended = true;
        liveRef.current = null;
        if (disposedRef.current) return;
        const text = liveTextRef.current.trim();
        setLive('');
        setPhase('idle');
        if (text) onText(text);
      },
    });
    startingRef.current = false;
    if (disposedRef.current) { handle.cancel(); return; }
    if (!ended) liveRef.current = handle;
  };

  const toggle = async () => {
    if (phase === 'busy' || startingRef.current) return;
    if (phase === 'rec') { if (!stopLive()) void finish(); return; }
    setHint('');
    if (realtime) return void startLive();
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

  const status = live ? (live.length > CAPTION_TAIL ? `…${live.slice(-CAPTION_TAIL)}` : live) : hint;
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  useEffect(() => { statusRef.current(status); }, [status]);
  useEffect(() => () => statusRef.current(''), []);

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
    </>
  );
}

/** 小白的一句话:从座位上说出来的气泡,左边一枚他当时的表情 */
function XiaobaiLine({ m, animate, onTick, onDone }: {
  m: ChatMessage;
  animate: boolean;
  onTick: () => void;
  onDone: () => void;
}) {
  return (
    <div className={s.rowX} data-tone={m.mood ? moodTone(m.mood) : 'calm'} data-mood={m.mood}>
      <XiaobaiFace mood={m.mood ?? 'idle'} size={36} className={s.face} />
      <div className={s.say}>
        <span className={s.anno}>
          小白{m.mood ? <i>{MOOD_ZH[m.mood]}</i> : null}
        </span>
        <div className={s.bubbleX}>
          <TypewriterText text={m.text} animate={animate} onTick={onTick} onDone={onDone} />
        </div>
      </div>
    </div>
  );
}

/** 老师的话直接写在板上:不套气泡,公式与代码走 CoachMarkdown。
    两种现场彩蛋都只在事后夸奖——金句被记下、心魔被老师讲退;不预告任何导演机关。 */
function TeacherWriting({ message, golden, vanquished }: {
  message: ChatMessage;
  golden: boolean;
  vanquished: boolean;
}) {
  return (
    <div className={cx(s.rowT, golden && s.rowGold, vanquished && s.rowVanquished)}>
      <span className={s.mark} aria-hidden="true">师</span>
      <div className={s.writing}>
        <span className={s.srOnly}>老师讲：</span>
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
          <div className={s.teacherText}><CoachMarkdown text={message.text} className={s.md} /></div>
        ) : null}
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
  const [micStatus, setMicStatus] = useState('');
  const [demoOpen, setDemoOpen] = useState(false);
  const [typingNow, setTypingNow] = useState(false);
  const [tapMood, setTapMood] = useState<XiaobaiMood | null>(null);
  const [tapReactionId, setTapReactionId] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [byeOpen, setByeOpen] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [roomEl, setRoomEl] = useState<HTMLDivElement | null>(null);
  const [reducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  const compact = useMediaQuery('(max-width: 900px)');

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
  const pendingImageRef = useRef<PreparedImageAttachment | null>(null);
  const imageTaskRef = useRef(0);
  const imageTopicRef = useRef(topicId);
  const disposedRef = useRef(false);
  const sendingRef = useRef(false);
  const sendGenerationRef = useRef(0);
  const tapTimerRef = useRef(0);

  // 手机键盘弹起时,布局视口不变、可视视口变矮:把教室钉在可视视口里,
  // 顶栏不被推走,讲桌正好坐在键盘上沿(样式只在窄屏读这两个变量)。双指放大时不跟。
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!roomEl || !viewport) return;
    const sync = () => {
      if (viewport.scale > 1.01) {
        roomEl.style.removeProperty('--vvh');
        roomEl.style.removeProperty('--vv-top');
        delete roomEl.dataset.keyboard;
        return;
      }
      const keyboardOpen = window.innerHeight - viewport.height > 120;
      roomEl.style.setProperty('--vvh', `${Math.round(viewport.height)}px`);
      roomEl.style.setProperty('--vv-top', `${Math.round(viewport.offsetTop)}px`);
      if (keyboardOpen) roomEl.dataset.keyboard = 'open';
      else delete roomEl.dataset.keyboard;
      // 键盘刚弹起时板面变矮,把最新一句留在视线里
      if (keyboardOpen) {
        const stream = streamRef.current;
        if (stream) stream.scrollTop = stream.scrollHeight;
      }
    };
    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    };
  }, [roomEl]);
  // 输入框随内容长高(上限由样式的 max-height 兜住,超出后框内滚动)
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }, [draft, live?.sessionId, live?.ended, compact]);
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
  // 会话在本页之外被清掉(重置数据、开发时模块热替换)时重新开一场,不把人晾在「开灯」上;
  // 自己下课/暂离时 leavingRef 先立起来,不会在跳转前又开一场。
  const leavingRef = useRef(false);
  const sessionMissing = !live || live.topicId !== topicId;
  useEffect(() => {
    if (!topic || topic.locked || leavingRef.current) return;
    const st = useAppStore.getState();
    if (st.live && st.live.topicId === topicId) return; // 直接接管
    void st.startSession(topicId, mode);
  }, [topicId, mode, topic, sessionMissing]);

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
  /** 讲法提示签:只往草稿里添一句开头,把光标放到句尾,发不发由老师定 */
  const insertStarter = (starter: string) => {
    if (live.busy || live.ended) return;
    // 先把新草稿落进输入框,再同步放光标:紧接着打的字一定接在这句开头后面
    flushSync(() => setDraft((current) => appendStarter(current, starter)));
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.scrollTop = input.scrollHeight;
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
    leavingRef.current = true;
    abandonSession();
    navigate(`/prep/${topicId}`);
  };
  const dismissClass = () => {
    leavingRef.current = true;
    const sid = endSession();
    navigate(sid ? (mode === 'review' ? `/review/${sid}` : `/exam/${sid}`) : '/learn');
  };
  const backToPrep = () => {
    leavingRef.current = true;
    abandonSession();
    navigate(`/prep/${topicId}`);
  };
  const handleTypeDone = (id: string) => {
    finishedRef.current.add(id);
    setTypingNow(false);
  };

  // 金句现场微反馈:本会话 golden_analogy_saved 事件的引文逐字出自老师原话(评估层
  // 已做归一化子串校验),回贴到命中的老师那段板书上。现场彩蛋只夸讲得好,
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
  const finishLabel = mode === 'review' ? '完成温故' : '送小白赴考';
  const examCued = mode !== 'review' && live.examCuedAt !== undefined;
  const latestTeacher = [...live.messages].reverse().find((message) => message.role === 'teacher');
  const isLookingAtImage = live.busy && (pendingImage !== null || latestTeacher?.image !== undefined);
  const displayedMood = live.busy ? 'thinking' : tapMood ?? live.mood;
  const stageMeta = getStageMeta(g.learningLevel);
  const roundsDone = live.traces.length;
  const modeWord = mode === 'review' ? '温故' : mode === 'reteach' ? '重讲' : '夜课';
  const thinkingText = live.messages.length === 0
    ? '小白在找座位'
    : isLookingAtImage ? '小白在看图' : '小白在琢磨';
  const mediaLocked = live.busy || imagePreparing;
  const countText = imagePreparing
    ? '图片处理中…'
    : draft.length > 0 || pendingImage
      ? `${draft.length} 字${pendingImage ? ' · 1 图' : ''}`
      : '';
  const statusText = micStatus || imageHint;

  // ── 课堂节奏:只看明面上的对话、心情与两类事后事件 ──
  const rounds: LessonRound[] = groupRounds(live.messages);
  if (rounds.length === 0) rounds.push({ key: 'prelude', teacher: null, replies: [] });
  const follow = deriveFollow(live.messages);
  const notebook = deriveNotebook(events, live.sessionId);
  const goldenCount = notebook.filter((entry) => entry.kind === 'golden').length;
  const clearedCount = notebook.length - goldenCount;
  const latestBeat = !live.busy && latestTeacher
    ? isGoldenRow(latestTeacher.text) ? 'golden' : vanquishedIds.has(latestTeacher.id) ? 'cleared' : null
    : null;
  // 头顶的小念头:说话时不出;被点了一下、刚记了金句、刚被拉回来,各有一句
  const thought = live.ended
    ? null
    : live.busy
      ? (isLookingAtImage ? '我看看这张图…' : thoughtOf('thinking'))
      : typingNow
        ? null
        : tapMood
        ? '在呢'
        : latestBeat === 'golden'
          ? '这句我记下了'
          : latestBeat === 'cleared'
            ? '差点想岔了'
            : thoughtOf(live.mood);
  const summary: LessonSummary = {
    mode,
    topicTitle: topic.title,
    rounds: roundsDone,
    startedAt: live.startedAt,
    digest: taughtDigest(live.messages),
    goldenCount,
    clearedCount,
    follow,
    parting: partingLine({ mode, rounds: roundsDone, follow, goldenCount, clearedCount }),
    level: g.learningLevel,
  };

  const onAvatarClick = () => {
    setProfileOpen((open) => !open);
    triggerTapReaction('happy');
  };
  const profile = (
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
        <div><dt>课上</dt><dd>已讲 {roundsDone} 轮 · {follow.label}</dd></div>
      </dl>
      {live.busy && (
        <div className={s.stageThinking}><Shimmer>{thinkingText}…</Shimmer></div>
      )}
      {compact ? <Notebook entries={notebook} follow={follow} compact /> : null}
      <p className={s.stageHint}>
        把知识讲给小白听——它没读过标准答案,你的话就是它的全部教材。
      </p>
    </section>
  );
  const seatShared = {
    mood: displayedMood,
    level: g.learningLevel,
    speaking: typingNow,
    avatarRef,
    profileOpen,
    onAvatarClick,
    blushKey: tapMood ? tapReactionId : null,
  };
  const endButton = !live.ended && (
    <Button
      variant={examCued ? 'accent' : 'outline'}
      pill
      className={cx(s.endBtn, examCued && s.endBtnReady)}
      data-tour="end"
      onClick={() => setByeOpen(true)}
      disabled={live.busy}
      icon={mode === 'review'
        ? <PenLine size={16} strokeWidth={1.75} />
        : <Route size={16} strokeWidth={1.75} />}
    >
      {finishLabel}
    </Button>
  );

  return (
    <div
      className={s.room}
      ref={setRoomEl}
      data-compact={compact || undefined}
      data-lookup={lookupItem && !live.ended ? '' : undefined}
    >
      {/* ── 顶栏:暂离 / 课程 › 知识点(窄屏换成小白头像签) / 课堂节奏 / 下课 ── */}
      <header className={s.topbar}>
        <IconButton label="暂离课堂,回学习终端" tip="bottom" onClick={quit}>
          <ArrowLeft size={18} strokeWidth={1.75} />
        </IconButton>
        {compact ? (
          <XiaobaiChip {...seatShared}>{profile}</XiaobaiChip>
        ) : (
          <div className={s.crumb}>
            <span className={s.crumbCourse}>{topic.course}</span>
            <ChevronRight className={s.crumbSep} size={14} strokeWidth={1.75} aria-hidden="true" />
            <span className={s.crumbTopic}>{topic.title}</span>
            {mode !== 'teach' && (
              <Badge tone="warn" className={s.modeBadge}>{mode === 'reteach' ? '重讲验证' : '温故'}</Badge>
            )}
          </div>
        )}
        {compact ? <span className={s.topSpacer} /> : (
          <div
            className={s.flow}
            role="group"
            aria-label={`第 ${roundsDone + 1} 轮,已讲完 ${roundsDone} 轮,小白${follow.label}`}
          >
            <ChalkTally count={roundsDone} />
            <span>第 {roundsDone + 1} 轮</span>
            <i className={s.flowSep} aria-hidden="true" />
            <LessonClock startedAt={live.startedAt} />
            <i className={s.flowSep} aria-hidden="true" />
            <span className={s.flowFollow} data-tone={follow.tone}>{follow.label}</span>
          </div>
        )}
        {endButton}
      </header>
      {mode !== 'teach' && (
        <div className={s.modeBanner}>
          {mode === 'reteach'
            ? '重讲验证 —— 上次被带偏的地方,这次要把它讲明白。'
            : '帮小白复习 —— 它把上次学的忘了一些,快帮它想起来。'}
        </div>
      )}

      <div className={s.main}>
        {/* ── 课桌后的小白(宽屏) ── */}
        {compact ? null : (
          <XiaobaiSeat
            {...seatShared}
            stageName={stageMeta.name}
            thought={thought}
            thinking={live.busy}
            entries={notebook}
            follow={follow}
          >
            {profile}
          </XiaobaiSeat>
        )}

        <section className={s.stage}>
          {/* ── 黑板:板头粉笔字 + 一轮一轮的讲解 ── */}
          <div className={s.board} data-tour="board">
            <div className={s.chalkHead}>
              <span className={s.chalkTopic}>
                <small>今日课题</small>
                {topic.title}
              </span>
              <span className={s.chalkMeta}>
                {modeWord} · 第 {roundsDone + 1} 轮
                {compact ? <> · <LessonClock startedAt={live.startedAt} /></> : null}
              </span>
            </div>
            <div className={s.stream} ref={streamRef}>
              {rounds.map((round, index) => {
                const isCurrent = index === rounds.length - 1;
                return (
                  <section
                    key={round.key}
                    className={cx(s.round, isCurrent ? s.roundNow : s.roundPast)}
                    aria-label={round.teacher ? `第 ${index + (rounds[0].teacher ? 1 : 0)} 段讲解` : '开场'}
                  >
                    {round.teacher ? (
                      <TeacherWriting
                        message={round.teacher}
                        golden={isGoldenRow(round.teacher.text)}
                        vanquished={vanquishedIds.has(round.teacher.id)}
                      />
                    ) : null}
                    {round.replies.map((m) =>
                      m.role === 'system' ? (
                        m.id === delayedSystemId ? null : (
                          <div key={m.id} className={s.rowSys}>
                            <span className={s.sysTag}>旁白</span>
                            <span>{m.text}</span>
                          </div>
                        )
                      ) : (
                        <XiaobaiLine
                          key={m.id}
                          m={m}
                          animate={m.id === animateId}
                          onTick={() => scrollToBottom(false)}
                          onDone={() => handleTypeDone(m.id)}
                        />
                      ),
                    )}
                    {isCurrent && live.busy ? (
                      <div className={cx(s.rowX, s.rowThinking)} data-tone="think">
                        <XiaobaiFace mood="thinking" size={36} className={s.face} />
                        <div className={s.say}>
                          <div className={s.pondering} role="status">
                            <Shimmer>{thinkingText}…</Shimmer>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </section>
                );
              })}
              <p className={s.srOnly} aria-live="polite">
                {!typingNow && !live.busy ? lastXiaobai?.text ?? '' : ''}
              </p>
            </div>
            <div className={s.ledge} aria-hidden="true"><i /><i /><b /></div>
          </div>

          {/* ── 讲桌:提前结束的小结 或 讲法提示 + 输入框 ── */}
          <div className={s.dock}>
            {live.ended ? (
              <EndedPanel summary={summary} onFinish={dismissClass} onBackToPrep={backToPrep} />
            ) : (
              <>
                {demoLines.length > 0 && demoOpen ? (
                  <div className={s.demoSheet} id="classroom-demo-lines" role="group" aria-label="演示话术">
                    <p className={s.demoTip}>点一条话术填进输入框,不会直接发送。</p>
                    <div className={s.demoInner}>
                      {demoLines.map((l) => (
                        <button
                          key={l.label}
                          type="button"
                          className={s.demoLine}
                          onClick={() => {
                            setDraft(l.text);
                            setDemoOpen(false);
                            inputRef.current?.focus();
                          }}
                        >
                          <span className={s.demoLabel}>{l.label}</span>
                          <span className={s.demoNote}>{l.note}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className={s.dockTop}>
                  <div className={s.scaffolds} role="group" aria-label="讲法提示:点一下,往草稿里添一句开头">
                    <span className={s.scaffoldLead} aria-hidden="true">讲法</span>
                    {SCAFFOLDS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={s.scaffold}
                        onClick={() => insertStarter(item.starter)}
                        disabled={live.busy}
                        title={`添一句开头:${item.starter}…`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  {demoLines.length > 0 && (
                    <button
                      type="button"
                      className={s.demoToggle}
                      aria-expanded={demoOpen}
                      aria-controls="classroom-demo-lines"
                      onClick={() => setDemoOpen((o) => !o)}
                    >
                      演示助手
                      <ChevronRight
                        size={14}
                        strokeWidth={1.75}
                        className={demoOpen ? s.chevronOpen : s.chevron}
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
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
                    placeholder={compact ? '把知识点讲给小白听' : '把知识点讲给小白听,也可以附上图片或视频画面'}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    disabled={live.busy}
                    aria-label="讲给小白的话"
                    aria-describedby={statusText ? 'classroom-image-status' : undefined}
                  />
                  {statusText ? (
                    <span id="classroom-image-status" className={s.status} role="status">
                      {statusText}
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
                        onStatus={setMicStatus}
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
                        {live.busy ? (
                          <>
                            <ThinkingDots label="小白正在回应" />
                            <span className={s.sendText}>小白在想</span>
                          </>
                        ) : (
                          <>
                            <span className={s.sendText}>讲给小白</span>
                            <ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" />
                          </>
                        )}
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

      {/* ── 下课:送考前的小收场(挂在教室里,沿用黑板配色) ── */}
      <DismissalDialog
        open={byeOpen && !live.ended}
        onOpenChange={setByeOpen}
        container={roomEl}
        summary={summary}
        onFinish={dismissClass}
        onBackToPrep={backToPrep}
      />

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
