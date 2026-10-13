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

function chineseVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  const voices = window.speechSynthesis.getVoices().filter((voice) => /^zh([-_](CN|Hans))?/i.test(voice.lang) && !/HK|TW|yue/i.test(voice.lang));
  // 本机语音优先：离线可用，起声快
  return voices.sort((a, b) => Number(b.localService) - Number(a.localService));
}

/**
 * 读一句话。开了语音就用浏览器朗读，否则按字数计时。
 * 返回取消函数；取消后不会再回调 onDone。
 */
function speakLine(text: string, speaker: SpeakerId, voiceOn: boolean, rate: number, onDone: () => void): () => void {
  let settled = false;
  let timer: number | undefined;
  const finish = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    onDone();
  };
  const spoken = plainText(text);
  const readMs = Math.min(15_000, Math.max(1_300, spoken.length * 215)) / rate;
  const byTimer = () => { timer = window.setTimeout(finish, spoken ? readMs : 350); };

  if (!voiceOn || !speechSupported() || !spoken) {
    byTimer();
    return () => { settled = true; window.clearTimeout(timer); };
  }
  const synth = window.speechSynthesis;
  const profile = VOICE_PROFILE[speaker];
  const utterance = new SpeechSynthesisUtterance(spoken);
  const voices = chineseVoices();
  utterance.lang = 'zh-CN';
  if (voices.length) utterance.voice = voices[profile.pick % voices.length];
  utterance.rate = Math.min(2, rate * profile.rate);
  utterance.pitch = profile.pitch;
  utterance.onend = finish;
  utterance.onerror = (event) => {
    if (settled) return;
    // 浏览器拒绝朗读（没有用户手势、没有语音包）时改用计时，不要一口气跳完整堂课
    if (event.error === 'interrupted' || event.error === 'canceled') return;
    window.clearTimeout(timer);
    byTimer();
  };
  // 个别浏览器长句不触发 onend，留一个看门狗
  timer = window.setTimeout(finish, readMs * 2.4 + 4_000);
  if (synth.speaking || synth.pending) synth.cancel();
  synth.speak(utterance);
  return () => {
    // 已经读完的句子不必再 cancel，避免紧跟着的下一句被吞掉
    const wasSpeaking = !settled;
    settled = true;
    window.clearTimeout(timer);
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
