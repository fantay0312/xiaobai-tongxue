/**
 * 语音：朗读（浏览器 speechSynthesis）与听写。
 * 听写优先用网关开通的实时语音识别（边说边出字，见 lib/realtimeAsr）；没有开通时退回浏览器自带的 SpeechRecognition。
 * 两者都不可用时，对应按钮不显示。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuthStore } from '../../../store/authStore';
import { realtimeAsrAvailable, startDictation, type Dictation } from '../../../lib/realtimeAsr';

/* ── 朗读：全局同一时间只读一条 ── */
let speakingId: string | null = null;
let session = 0;
const listeners = new Set<() => void>();

function setSpeaking(id: string | null) {
  if (speakingId === id) return;
  speakingId = id;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const speechSupported = typeof window !== 'undefined'
  && 'speechSynthesis' in window
  && typeof window.SpeechSynthesisUtterance !== 'undefined';

/** 正在朗读的消息 id */
export function useSpeakingId(): string | null {
  return useSyncExternalStore(subscribe, () => speakingId, () => null);
}

/** 把 Markdown 变成适合读出来的文字 */
function speechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(?:```|$)/g, '（此处有一段代码）')
    .replace(/\$\$[\s\S]*?\$\$/g, '（此处有一个公式）')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/\[\d+]/g, '')
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, '')
    .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, '')
    .replace(/[*_`~$|\\]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 分句成段：长文本一次性送入时，部分浏览器会在十几秒后静音 */
function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const sentence of text.split(/(?<=[。！？!?；;\n])/)) {
    if (current && current.length + sentence.length > 160) { chunks.push(current); current = ''; }
    current += sentence;
  }
  if (current.trim()) chunks.push(current);
  return chunks.map((chunk) => chunk.trim()).filter(Boolean).slice(0, 80);
}

export function stopSpeaking() {
  if (!speechSupported) return;
  session += 1;
  window.speechSynthesis.cancel();
  setSpeaking(null);
}

/** 朗读这条消息；再点一次停止。返回是否开始朗读。 */
export function toggleSpeak(id: string, markdown: string): boolean {
  if (!speechSupported) return false;
  if (speakingId === id) { stopSpeaking(); return false; }
  const chunks = speechChunks(speechText(markdown));
  if (!chunks.length) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const token = ++session;
  // 优先本机语音：Chrome 自带的联网语音在国内经常连不上，会表现为点了没声音
  const voices = synth.getVoices().filter((item) => /^zh/i.test(item.lang));
  const voice = voices.find((item) => item.localService) ?? voices[0];
  const finish = () => { if (session === token) setSpeaking(null); };
  chunks.forEach((chunk, index) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = 'zh-CN';
    if (voice) utterance.voice = voice;
    utterance.onerror = finish;
    if (index === chunks.length - 1) utterance.onend = finish;
    synth.speak(utterance);
  });
  setSpeaking(id);
  return true;
}

/* ── 听写 ── */
interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const host = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

export const dictationSupported = recognitionCtor() !== null;

/** 一次实时识别会话；连接途中句柄还没回来，先记下用户的意图 */
interface LiveSession { handle: Dictation | null; muted: boolean; stopRequested: boolean }

/**
 * 语音听写：识别结果接在开始听写时的文字后面。
 * onError 收到错误码：实时识别是 lib/realtimeAsr 的 DictationError，浏览器识别是浏览器自己的码（not-allowed、network…）。
 */
export function useDictation({ getValue, onChange, onError, maxLength = 3000 }: {
  getValue: () => string;
  onChange: (value: string) => void;
  onError?: (code: string) => void;
  maxLength?: number;
}) {
  const [listening, setListening] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const user = useAuthStore((state) => state.user);
  const recognition = useRef<Recognition | null>(null);
  const live = useRef<LiveSession | null>(null);
  const latest = useRef({ getValue, onChange, onError });
  latest.current = { getValue, onChange, onError };

  useEffect(() => {
    let alive = true;
    void realtimeAsrAvailable().then((available) => { if (alive) setRealtime(available); });
    return () => { alive = false; };
  }, [user]);

  const startLive = useCallback(() => {
    if (live.current) return;
    const session: LiveSession = { handle: null, muted: false, stopRequested: false };
    live.current = session;
    setListening(true);
    const base = latest.current.getValue();
    void startDictation({
      onText: (committed, interim) => {
        if (!session.muted) latest.current.onChange(`${base}${committed}${interim}`.slice(0, maxLength));
      },
      onError: (code) => { if (!session.muted) latest.current.onError?.(code); },
      onEnd: () => {
        if (live.current === session) live.current = null;
        setListening(false);
      },
    }).then((handle) => {
      session.handle = handle;
      // 连接途中就点了结束或发送
      if (session.muted) handle.cancel(); else if (session.stopRequested) handle.stop();
    });
  }, [maxLength]);

  const stop = useCallback(() => {
    const session = live.current;
    if (session) {
      if (session.handle) session.handle.stop(); else session.stopRequested = true;
      return;
    }
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (realtime) { startLive(); return; }
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    const instance = new Ctor();
    const base = latest.current.getValue();
    instance.lang = 'zh-CN';
    instance.continuous = true;
    instance.interimResults = true;
    instance.onresult = (event) => {
      let heard = '';
      for (let index = 0; index < event.results.length; index += 1) heard += event.results[index][0].transcript;
      latest.current.onChange(`${base}${heard}`.slice(0, maxLength));
    };
    instance.onerror = (event) => {
      // no-speech / aborted 是正常收尾，不提示
      if (event.error !== 'no-speech' && event.error !== 'aborted') latest.current.onError?.(event.error);
    };
    instance.onend = () => {
      if (recognition.current === instance) recognition.current = null;
      setListening(false);
    };
    try {
      instance.start();
      recognition.current = instance;
      setListening(true);
    } catch {
      latest.current.onError?.('start-failed');
    }
  }, [maxLength, realtime, startLive]);

  const toggle = useCallback(() => {
    if (live.current || recognition.current) stop(); else start();
  }, [start, stop]);

  /** 立即结束并丢弃还没落定的识别结果（发送时用，避免迟到的结果把文字写回输入框） */
  const cancel = useCallback(() => {
    const session = live.current;
    if (session) {
      session.muted = true;
      live.current = null;
      session.handle?.cancel();
      setListening(false);
    }
    const instance = recognition.current;
    if (!instance) return;
    recognition.current = null;
    instance.onresult = null;
    instance.onerror = null;
    instance.onend = null;
    instance.abort();
    setListening(false);
  }, []);

  useEffect(() => () => {
    const session = live.current;
    live.current = null;
    if (session) { session.muted = true; session.handle?.cancel(); }
    const instance = recognition.current;
    recognition.current = null;
    if (instance) { instance.onresult = null; instance.onerror = null; instance.onend = null; instance.abort(); }
  }, []);

  return { listening, supported: realtime || dictationSupported, toggle, stop, cancel };
}
