/**
 * 浏览器语音：朗读（speechSynthesis）与听写（SpeechRecognition）。
 * 都是浏览器本机能力，不经过服务器；不支持的浏览器里对应按钮不显示。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

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
  const voice = synth.getVoices().find((item) => /^zh/i.test(item.lang));
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

/**
 * 语音听写（zh-CN）：识别结果接在开始听写时的文字后面。
 * onError 收到浏览器的错误码（not-allowed、audio-capture、network…）。
 */
export function useDictation({ getValue, onChange, onError, maxLength = 3000 }: {
  getValue: () => string;
  onChange: (value: string) => void;
  onError?: (code: string) => void;
  maxLength?: number;
}) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const latest = useRef({ getValue, onChange, onError });
  latest.current = { getValue, onChange, onError };

  const stop = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const start = useCallback(() => {
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
  }, [maxLength]);

  const toggle = useCallback(() => {
    if (recognition.current) stop(); else start();
  }, [start, stop]);

  /** 立即结束并丢弃还没落定的识别结果（发送时用，避免迟到的结果把文字写回输入框） */
  const cancel = useCallback(() => {
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
    const instance = recognition.current;
    recognition.current = null;
    if (instance) { instance.onresult = null; instance.onerror = null; instance.onend = null; instance.abort(); }
  }, []);

  return { listening, toggle, stop, cancel };
}
