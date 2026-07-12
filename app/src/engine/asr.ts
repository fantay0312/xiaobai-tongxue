/**
 * 语音转写统一封装 —— transcribe(wavBlob, settings)
 * proxy 模式:WAV 原始体 POST 同源网关 /api/asr(密钥在服务器侧);
 * api 模式:浏览器直连自配 OpenAI 兼容端点 <baseUrl>/audio/transcriptions(multipart)。
 * 浏览器专用(FormData/Blob),铁律:不得 re-export 进 engine/index barrel
 * (simulate 在 Node 加载 barrel;与 recall/journey 同一纪律)。
 */
import type { AsrSettings } from '../types';
import { API_BASE } from '../lib/api';

export const DEFAULT_ASR: AsrSettings = {
  mode: 'proxy',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: '',
  model: 'qwen/qwen3-asr-flash-2026-02-10',
};

/** 转写上游普遍要跑音频时长量级的处理时间,超时给足 */
const TIMEOUT_MS = 60_000;

/** 兼容三种 baseUrl 写法:…/api/v1 / …/api / 直接粘贴完整 …/audio/transcriptions */
export function transcriptionsUrl(baseUrl: string): string {
  const root = baseUrl.trim().replace(/\/+$/, '').replace(/\/audio\/transcriptions$/, '');
  return `${root}/audio/transcriptions`;
}

export async function transcribe(wav: Blob, settings: AsrSettings): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    if (settings.mode === 'proxy') {
      res = await fetch(`${API_BASE}/asr`, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav,
        signal: ctrl.signal,
      });
      if (res.status === 401) throw new Error('asr-auth');
      if (res.status === 503) throw new Error('asr-disabled');
    } else {
      if (!settings.baseUrl || !settings.apiKey) throw new Error('asr-unconfigured');
      const fd = new FormData();
      fd.append('file', wav, 'speech.wav');
      fd.append('model', settings.model || DEFAULT_ASR.model);
      res = await fetch(transcriptionsUrl(settings.baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${settings.apiKey}` },
        body: fd,
        signal: ctrl.signal,
      });
    }
    if (res.status === 429) {
      // 网关区分分钟窗与日封顶,提示语两回事:读 body 再定码
      const body: unknown = await res.json().catch(() => null);
      const code = (body as { error?: unknown })?.error;
      throw new Error(code === 'daily-limit' ? 'asr-daily-limit' : 'asr-rate-limited');
    }
    if (!res.ok) throw new Error(`asr-http-${res.status}`);
    const data = await res.json();
    const text: unknown = data?.text;
    if (typeof text !== 'string') throw new Error('asr-empty');
    return text.trim();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('asr-timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
