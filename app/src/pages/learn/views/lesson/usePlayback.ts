/**
 * 课堂回放：老师的讲稿逐句推进（浏览器朗读或按字数计时），
 * 要点 / 板书随句子出现，同学插话穿插其间；测验和互动幕会停下来等学习者。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { plainText, sceneSegments, type Lesson, type PlaySegment, type SpeakerId } from '../../../../engine/lessonStudio';

export type PlayStatus = 'idle' | 'playing' | 'paused' | 'hold' | 'ended';
export const RATES = [0.8, 1, 1.25, 1.5] as const;

export interface TranscriptLine {
  key: string;
  speaker: SpeakerId;
  text: string;
  sceneIndex: number;
  kind: 'script' | 'interject' | 'reply' | 'ask' | 'answer' | 'react';
  /** 用 Markdown 渲染（举手提问的回答） */
  markdown?: boolean;
  /** 本地演示的回答 */
  local?: boolean;
  streaming?: boolean;
}

/** 临时插播的一句话：答题反馈、小白答题、提问后的同学补充 */
export interface AdhocLine {
  speaker: SpeakerId;
  text: string;
  kind?: TranscriptLine['kind'];
  /** 只朗读，不再往字幕记录里加（文字已经显示过） */
  silent?: boolean;
}

const VOICE_PROFILE: Record<SpeakerId, { pitch: number; rate: number; pick: number }> = {
  teacher: { pitch: 1, rate: 1, pick: 0 },
  xiaobai: { pitch: 1.35, rate: 1.04, pick: 1 },
  acheng: { pitch: 0.82, rate: 1.12, pick: 2 },
  user: { pitch: 1, rate: 1, pick: 0 },
};

export const speechSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

/** 起声失败过的语音不再选；连续两次起不了声，后面的句子直接按字数计时 */
const speechHealth = { failures: 0, bad: new Set<string>() };
const START_TIMEOUT_MS = 2_000;

function resetSpeechHealth() {
  speechHealth.failures = 0;
  speechHealth.bad.clear();
}

/**
 * 选一个中文语音。只在本机语音里挑：联网语音（如「Google 普通话」）连不上时既不出声也不报错。
 * 没有本机中文语音时退到第一个中文语音；一个都没有就返回 null，由 lang = zh-CN 交给浏览器默认。
 * 语音表是异步加载的，所以每次朗读前都重新读一遍。
 */
function pickVoice(pick: number): SpeechSynthesisVoice | null {
  const chinese = window.speechSynthesis.getVoices().filter((voice) => /^zh/i.test(voice.lang) && !speechHealth.bad.has(voice.voiceURI));
  if (!chinese.length) return null;
  // 普通话优先于粤语和台湾口音
  const mandarin = chinese.filter((voice) => !/HK|TW|yue/i.test(voice.lang));
  const pool = mandarin.length ? mandarin : chinese;
  const local = pool.filter((voice) => voice.localService);
  return local.length ? local[pick % local.length] : pool[0];
}

/**
 * 读一句话。开了语音就用浏览器朗读，否则按字数计时。
 * 返回取消函数；取消后不会再回调 onDone。
 */
function speakLine(text: string, speaker: SpeakerId, voiceOn: boolean, rate: number, onDone: () => void): () => void {
  let settled = false;
  let timer: number | undefined;
  let startTimer: number | undefined;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    window.clearTimeout(startTimer);
    onDone();
  };
  const spoken = plainText(text);
  const readMs = Math.min(15_000, Math.max(1_300, spoken.length * 215)) / rate;
  const byTimer = (elapsed = 0) => { timer = window.setTimeout(finish, spoken ? Math.max(600, readMs - elapsed) : 350); };

  if (!voiceOn || !speechSupported() || !spoken || speechHealth.failures >= 2) {
    byTimer();
    return () => { settled = true; window.clearTimeout(timer); };
  }
  const synth = window.speechSynthesis;
  const profile = VOICE_PROFILE[speaker];
  const utterance = new SpeechSynthesisUtterance(spoken);
  const chosen = pickVoice(profile.pick);
  const startedAt = Date.now();
  let started = false;
  utterance.lang = 'zh-CN';
  if (chosen) utterance.voice = chosen;
  utterance.rate = Math.min(2, rate * profile.rate);
  utterance.pitch = profile.pitch;

  /** 这一句读不出来：改成按字数计时的字幕，课不停 */
  const fallBack = (blame: boolean) => {
    if (settled) return;
    if (blame) {
      speechHealth.failures += 1;
      // 本机语音偶尔被上一句的 cancel 吞掉，不因此弃用；联网语音起不了声就换掉
      if (chosen && !chosen.localService) speechHealth.bad.add(chosen.voiceURI);
    }
    window.clearTimeout(timer);
    window.clearTimeout(startTimer);
    utterance.onstart = null;
    utterance.onboundary = null;
    utterance.onend = null;
    utterance.onerror = null;
    synth.cancel();
    byTimer(Date.now() - startedAt);
  };
  const markStarted = () => {
    if (started) return;
    started = true;
    speechHealth.failures = 0;
    window.clearTimeout(startTimer);
  };
  utterance.onstart = markStarted;
  utterance.onboundary = markStarted;
  utterance.onend = finish;
  // 被别处打断、或浏览器要求先有用户手势，不算这个语音坏了
  utterance.onerror = (event) => fallBack(!['interrupted', 'canceled', 'not-allowed'].includes(event.error));
  // 个别浏览器长句不触发 onend，留一个看门狗
  timer = window.setTimeout(finish, readMs * 2.4 + 4_000);
  // 两秒还没起声：语音包没装好或联网语音连不上
  startTimer = window.setTimeout(() => { if (!started) fallBack(true); }, START_TIMEOUT_MS);
  if (synth.speaking || synth.pending) synth.cancel();
  synth.speak(utterance);
  return () => {
    // 已经读完的句子不必再 cancel，避免紧跟着的下一句被吞掉
    const wasSpeaking = !settled;
    settled = true;
    window.clearTimeout(timer);
    window.clearTimeout(startTimer);
    if (wasSpeaking) synth.cancel();
  };
}

export function useLessonPlayback(lesson: Lesson) {
  const total = lesson.scenes.length;
  const [sceneIndex, setSceneIndex] = useState(0);
  const [segIndex, setSegIndex] = useState(0);
  const [status, setStatus] = useState<PlayStatus>('idle');
  const [voice, setVoice] = useState(speechSupported);
  const [rate, setRate] = useState<number>(1);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [speaking, setSpeaking] = useState<SpeakerId | null>(null);
  const [caption, setCaption] = useState<{ speaker: SpeakerId; text: string } | null>(null);
  const [adhoc, setAdhoc] = useState<{ id: number; items: AdhocLine[]; index: number } | null>(null);
  /** 测验答完 / 互动做完，可以离开当前停留 */
  const [holdDone, setHoldDone] = useState(false);
  const adhocSeq = useRef(0);

  // 语音表异步加载：先读一次触发加载，加载完再读一次，第一句就能选到本机中文语音
  useEffect(() => {
    if (!speechSupported()) return undefined;
    const synth = window.speechSynthesis;
    const warm = () => { synth.getVoices(); };
    warm();
    synth.addEventListener?.('voiceschanged', warm);
    return () => synth.removeEventListener?.('voiceschanged', warm);
  }, []);

  // 重新打开语音时再给朗读一次机会
  useEffect(() => {
    if (voice) resetSpeechHealth();
  }, [voice]);

  const index = Math.min(sceneIndex, Math.max(0, total - 1));
  const scene = lesson.scenes[index];
  const segments = useMemo<PlaySegment[]>(() => (scene ? sceneSegments(scene) : []), [scene]);

  const pushLine = useCallback((line: TranscriptLine) => {
    setLines((current) => {
      const at = current.findIndex((item) => item.key === line.key);
      if (at >= 0) return current.map((item, i) => (i === at ? line : item));
      return [...current, line].slice(-160);
    });
  }, []);

  const quiet = useCallback(() => {
    setSpeaking(null);
    setCaption(null);
  }, []);

  // 临时插播优先于正课
  useEffect(() => {
    if (!adhoc) return;
    const item = adhoc.items[adhoc.index];
    if (!item) {
      setAdhoc(null);
      quiet();
      return;
    }
    if (!item.silent) pushLine({ key: `adhoc-${adhoc.id}-${adhoc.index}`, speaker: item.speaker, text: item.text, sceneIndex: index, kind: item.kind ?? 'react' });
    // 静音且不朗读的条目没有必要占时间
    if (item.silent && !(voice && speechSupported())) {
      setAdhoc((current) => (current && current.id === adhoc.id ? { ...current, index: current.index + 1 } : current));
      return;
    }
    setSpeaking(item.speaker);
    setCaption(item.silent ? null : { speaker: item.speaker, text: item.text });
    return speakLine(item.text, item.speaker, voice, rate, () => {
      setAdhoc((current) => (current && current.id === adhoc.id ? { ...current, index: current.index + 1 } : current));
    });
  }, [adhoc, voice, rate, index, pushLine, quiet]);

  // 正课逐句推进
  useEffect(() => {
    if (adhoc || !scene) return;
    if (status === 'hold') {
      if (!holdDone) return;
      const timer = window.setTimeout(() => {
        if (index >= total - 1) setStatus('ended');
        else {
          setSceneIndex(index + 1);
          setSegIndex(0);
          setHoldDone(false);
          setStatus('playing');
        }
      }, 900);
      return () => window.clearTimeout(timer);
    }
    if (status !== 'playing') return;
    const segment = segments[segIndex];
    if (!segment) {
      quiet();
      // 测验等学习者作答，互动等学习者动手
      if ((scene.type === 'quiz' || scene.type === 'interactive') && !holdDone) {
        setStatus('hold');
        return;
      }
      if (index >= total - 1) {
        setStatus('ended');
        return;
      }
      const timer = window.setTimeout(() => {
        setSceneIndex(index + 1);
        setSegIndex(0);
        setHoldDone(false);
      }, 800);
      return () => window.clearTimeout(timer);
    }
    pushLine({ key: `${scene.id}-${segIndex}`, speaker: segment.speaker, text: segment.text, sceneIndex: index, kind: segment.kind });
    setSpeaking(segment.speaker);
    setCaption({ speaker: segment.speaker, text: segment.text });
    return speakLine(segment.text, segment.speaker, voice, rate, () => setSegIndex((value) => value + 1));
  }, [adhoc, scene, segments, segIndex, status, holdDone, index, total, voice, rate, pushLine, quiet]);

  // 离开课堂时停止朗读
  useEffect(() => () => {
    if (speechSupported()) window.speechSynthesis.cancel();
  }, []);

  const goScene = useCallback((next: number, autoplay?: boolean) => {
    const target = Math.min(total - 1, Math.max(0, next));
    setAdhoc(null);
    quiet();
    setSceneIndex(target);
    setSegIndex(0);
    setHoldDone(false);
    setStatus((current) => (autoplay || current === 'playing' || current === 'hold' ? 'playing' : current === 'ended' ? 'paused' : current));
  }, [total, quiet]);

  const pause = useCallback(() => {
    setStatus((current) => (current === 'playing' ? 'paused' : current));
    quiet();
  }, [quiet]);

  const play = useCallback(() => {
    // 上完了再点播放：从头再上一遍
    if (status === 'ended') {
      setSceneIndex(0);
      setSegIndex(0);
      setHoldDone(false);
    }
    setStatus('playing');
  }, [status]);

  /** 结束当前停留，进入下一幕 */
  const continueHold = useCallback(() => {
    if (index >= total - 1) {
      setStatus('ended');
      return;
    }
    goScene(index + 1, true);
  }, [goScene, index, total]);

  const toggle = useCallback(() => {
    if (status === 'playing') pause();
    else if (status === 'hold') continueHold();
    else play();
  }, [status, pause, play, continueHold]);

  /** 插播几句话（答题反馈等），播完回到原来的状态 */
  const say = useCallback((items: AdhocLine[]) => {
    if (!items.length) return;
    adhocSeq.current += 1;
    setAdhoc({ id: adhocSeq.current, items, index: 0 });
  }, []);

  const stopAdhoc = useCallback(() => {
    setAdhoc(null);
    quiet();
  }, [quiet]);

  // 正在逐句播放（或播到一半暂停）时按进度显示，否则整幕全部显示，方便翻看
  const midScene = segIndex < segments.length && (status === 'playing' || (status === 'paused' && segIndex > 0));
  const reveal = midScene ? segments[segIndex].reveal : Number.POSITIVE_INFINITY;
  const sceneProgress = segments.length ? Math.min(1, segIndex / segments.length) : 1;

  return {
    scene, sceneIndex: index, segIndex, segments, status, total,
    voice, setVoice, rate, setRate,
    lines, pushLine, speaking, caption, reveal, sceneProgress,
    adhocActive: !!adhoc, holdDone,
    play, pause, toggle, goScene, continueHold, say, stopAdhoc,
    completeHold: useCallback(() => setHoldDone(true), []),
  };
}

export type LessonPlayback = ReturnType<typeof useLessonPlayback>;
