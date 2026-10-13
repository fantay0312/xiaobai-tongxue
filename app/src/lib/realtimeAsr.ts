/**
 * 实时语音识别（边说边出字）—— 腾讯云实时语音识别 WebSocket。
 * 网关只负责签名（/api/asr/realtime），浏览器直连腾讯云发送 16k 单声道 PCM，音频不经本站服务器。
 * 没有网关或网关未开通时 realtimeAsrAvailable() 为 false，调用方回退到浏览器自带的语音识别。
 */
import { API_BASE, currentAuthEpoch, gatewayFetch } from './api';

export type DictationError =
  | 'unsupported' | 'insecure' | 'permission' | 'no-device' | 'unavailable' | 'auth' | 'rate-limited' | 'quota' | 'network' | 'failed';

export interface DictationCallbacks {
  /** committed：已经定稿的句子；interim：正在说的这一句，可能还会变 */
  onText: (committed: string, interim: string) => void;
  onError: (code: DictationError) => void;
  /** 连接已就绪，开始收音 */
  onListening?: () => void;
  /** 会话结束（正常收尾或出错之后都会调用一次） */
  onEnd: () => void;
}

export interface Dictation {
  /** 说完了：把剩余音频发完，等最后一句定稿后结束 */
  stop: () => void;
  /** 立即结束，丢弃还没定稿的内容 */
  cancel: () => void;
}

const TARGET_RATE = 16000;
/** 每包 100ms（16k、16bit、单声道 = 3200 字节） */
const PACKET_BYTES = 3200;
/** 握手完成前最多缓存 1.5 秒音频 */
const PREBUFFER_BYTES = TARGET_RATE * 2 * 1.5;
/** 单次听写上限，到点自动收尾 */
const MAX_SESSION_MS = 5 * 60_000;

export function microphoneSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
    && typeof (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) !== 'undefined'
    && typeof WebSocket !== 'undefined';
}

let availability: { epoch: number; value: Promise<boolean> } | null = null;
/** 网关是否开通了实时语音；按登录态缓存 */
export function realtimeAsrAvailable(): Promise<boolean> {
  const epoch = currentAuthEpoch();
  if (availability?.epoch === epoch) return availability.value;
  const value = (async () => {
    if (!microphoneSupported()) return false;
    try {
      const response = await gatewayFetch(`${API_BASE}/asr/realtime/status`);
      return response.ok && (await response.json()).available === true;
    } catch {
      return false;
    }
  })();
  availability = { epoch, value };
  return value;
}

function mediaError(error: unknown): DictationError {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'permission';
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return 'no-device';
  }
  return 'failed';
}

/** 向网关要一次连接的签名地址 */
async function requestSession(): Promise<string> {
  const response = await gatewayFetch(`${API_BASE}/asr/realtime`, { method: 'POST' });
  if (response.status === 429) throw new Error('rate-limited');
  if (response.status === 401 || response.status === 403) throw new Error('auth');
  if (!response.ok) throw new Error('unavailable');
  const data = await response.json() as { url?: unknown };
  if (typeof data.url !== 'string' || !data.url.startsWith('wss://asr.cloud.tencent.com/')) throw new Error('unavailable');
  return data.url;
}

function sessionError(error: unknown): DictationError {
  if (error instanceof Error && (error.message === 'rate-limited' || error.message === 'auth' || error.message === 'unavailable')) return error.message;
  return 'network';
}

/** 腾讯云返回的错误码 → 本地错误类别 */
function upstreamError(code: number): DictationError {
  if (code === 4002) return 'auth';
  if (code === 4003 || code === 4004 || code === 4005) return 'quota';
  if (code === 4006) return 'rate-limited';
  return 'failed';
}

/** 把任意采样率的浮点采样降到 16k、16bit。按区间取平均，简单抗混叠；跨块保留小数位置。 */
function createDownsampler(inputRate: number) {
  const ratio = inputRate / TARGET_RATE;
  let position = 0;
  let carry = new Float32Array(0);
  return (chunk: Float32Array): Int16Array => {
    const input = new Float32Array(carry.length + chunk.length);
    input.set(carry);
    input.set(chunk, carry.length);
    const count = Math.max(0, Math.floor((input.length - position) / ratio));
    const output = new Int16Array(count);
    for (let index = 0; index < count; index += 1) {
      const start = Math.floor(position + index * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor(position + (index + 1) * ratio)));
      let sum = 0;
      for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor];
      const sample = Math.max(-1, Math.min(1, sum / (end - start)));
      output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    const consumed = Math.floor(position + count * ratio);
    position = position + count * ratio - consumed;
    carry = input.slice(consumed);
    return output;
  };
}

export async function startDictation(callbacks: DictationCallbacks): Promise<Dictation> {
  let ended = false;
  let stopping = false;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let socket: WebSocket | null = null;
  let ready = false;
  let pending = new Uint8Array(0);
  const committed: string[] = [];
  let interim = '';
  let finishTimer = 0;
  let capTimer = 0;

  const releaseAudio = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    void context?.close().catch(() => {});
    context = null;
  };
  const end = (error?: DictationError) => {
    if (ended) return;
    ended = true;
    window.clearTimeout(finishTimer);
    window.clearTimeout(capTimer);
    releaseAudio();
    if (socket) {
      socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.onopen = null;
      try { socket.close(); } catch { /* 已经关闭 */ }
      socket = null;
    }
    if (error) callbacks.onError(error);
    callbacks.onEnd();
  };
  const flush = (all: boolean) => {
    if (!socket || !ready || socket.readyState !== WebSocket.OPEN) return;
    while (pending.length >= PACKET_BYTES || (all && pending.length > 0)) {
      const size = Math.min(PACKET_BYTES, pending.length);
      socket.send(pending.slice(0, size));
      pending = pending.slice(size);
    }
  };
  const push = (samples: Int16Array) => {
    if (ended || stopping || !samples.length) return;
    const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
    let merged = new Uint8Array(pending.length + bytes.length);
    merged.set(pending);
    merged.set(bytes, pending.length);
    // 握手完成前只留最近 1.5 秒，避免连上后一次灌入过多音频被判超速
    if (!ready && merged.length > PREBUFFER_BYTES) merged = merged.slice(merged.length - PREBUFFER_BYTES);
    pending = merged;
    flush(false);
  };
  const stop = () => {
    if (ended || stopping) return;
    stopping = true;
    releaseAudio();
    if (socket && ready && socket.readyState === WebSocket.OPEN) {
      flush(true);
      socket.send(JSON.stringify({ type: 'end' }));
      // 等最后一句定稿；网络慢也不让界面一直卡在收尾
      finishTimer = window.setTimeout(() => end(), 2500);
    } else end();
  };
  const handle: Dictation = { stop, cancel: () => end() };

  if (!window.isSecureContext) { end('insecure'); return handle; }
  if (!microphoneSupported()) { end('unsupported'); return handle; }

  try {
    const [mediaResult, sessionResult] = await Promise.allSettled([
      navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
      requestSession(),
    ]);
    // 先接住麦克风流，后面任何一步失败都由 end() 统一回收
    if (mediaResult.status === 'fulfilled') stream = mediaResult.value;
    if (mediaResult.status === 'rejected') { end(mediaError(mediaResult.reason)); return handle; }
    if (sessionResult.status === 'rejected') { end(sessionError(sessionResult.reason)); return handle; }
    if (ended) { releaseAudio(); return handle; }
    const media = mediaResult.value;
    const session = sessionResult.value;

    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    context = new Context();
    if (context.state === 'suspended') await context.resume().catch(() => {});
    const source = context.createMediaStreamSource(media);
    const downsample = createDownsampler(context.sampleRate);
    // 采音节点不出声：接一个静音增益再到输出，保证节点被拉动
    const mute = context.createGain();
    mute.gain.value = 0;
    mute.connect(context.destination);
    try {
      // 采音脚本放在 public 下按真实文件加载：打包内联成 data: 地址会被站点安全策略拦掉
      await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-capture-worklet.js`);
      const node = new AudioWorkletNode(context, 'xb-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => push(downsample(event.data));
      source.connect(node);
      node.connect(mute);
    } catch {
      // 旧浏览器没有 AudioWorklet：退回 ScriptProcessor
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => push(downsample(new Float32Array(event.inputBuffer.getChannelData(0))));
      source.connect(processor);
      processor.connect(mute);
    }

    socket = new WebSocket(session);
    socket.binaryType = 'arraybuffer';
    socket.onerror = () => end(ready ? 'network' : 'unavailable');
    socket.onclose = () => end(stopping ? undefined : 'network');
    socket.onmessage = (event) => {
      let message: { code?: number; final?: number; result?: { slice_type?: number; voice_text_str?: string } };
      try { message = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)); } catch { return; }
      if (message.code !== 0) { end(upstreamError(Number(message.code))); return; }
      if (!ready) {
        ready = true;
        callbacks.onListening?.();
        capTimer = window.setTimeout(stop, MAX_SESSION_MS);
        flush(false);
      }
      const result = message.result;
      if (result && typeof result.voice_text_str === 'string') {
        if (result.slice_type === 2) { if (result.voice_text_str) committed.push(result.voice_text_str); interim = ''; }
        else interim = result.voice_text_str;
        callbacks.onText(committed.join(''), interim);
      }
      if (message.final === 1) end();
    };
  } catch (error) {
    end(mediaError(error));
  }
  return handle;
}

export const DICTATION_MESSAGES: Record<DictationError, string> = {
  unsupported: '这个浏览器不支持语音输入',
  insecure: '浏览器只在 HTTPS 下开放麦克风',
  permission: '麦克风权限被拒绝了，请在浏览器地址栏允许后再试',
  'no-device': '没有找到麦克风',
  unavailable: '语音服务暂时连不上，请稍后再试',
  auth: '语音输入需要登录后使用',
  'rate-limited': '语音用得太频繁了，歇一会儿再试',
  quota: '语音识别额度不足，请联系管理员',
  network: '语音连接中断了，已保留识别到的文字',
  failed: '语音输入没有成功，请再试一次',
};
