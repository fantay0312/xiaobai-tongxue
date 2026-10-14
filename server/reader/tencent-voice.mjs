import { createHash, createHmac, randomUUID } from 'node:crypto';
import { TENCENT_VOICES } from './tencent-voices.mjs';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const hmac = (key, text) => createHmac('sha256', key).update(text).digest();
const fail = (message, status = 502) => Object.assign(new Error(message), { status });

export function splitTencentText(text) {
  const chars = Array.from(text);
  // A mixed-language request follows the Chinese limit too, even if its first words are English.
  const limit = /\p{Script=Han}/u.test(text) ? 130 : 450;
  const chunks = [];
  for (let start = 0; start < chars.length;) {
    let end = Math.min(start + limit, chars.length);
    if (end < chars.length) {
      for (let at = end - 1; at >= start + Math.floor(limit / 2); at--) {
        if (/[。！？；.!?;\n]/.test(chars[at])) { end = at + 1; break; }
      }
    }
    const part = chars.slice(start, end).join('');
    if (part.trim()) chunks.push(part);
    start = end;
  }
  return chunks;
}

export async function tencentVoice(text, voice, env = process.env, signal, fetchImpl = fetch) {
  const secretId = env.TENCENT_ASR_SECRET_ID, secretKey = env.TENCENT_ASR_SECRET_KEY;
  if (!secretId || !secretKey) throw fail('服务器没有配置语音凭据。', 503);
  if (typeof text !== 'string' || !text.trim() || text.length > 6000 || !TENCENT_VOICES.some((v) => Number(v.id) === Number(voice))) throw fail('朗读内容或音色无效。', 400);
  const chunks = splitTencentText(text);
  const pcm = [];
  for (const part of chunks) {
    signal?.throwIfAborted();
    const payload = JSON.stringify({ Text: part, SessionId: randomUUID(), ModelType: 1, VoiceType: voice, PrimaryLanguage: /\p{Script=Han}/u.test(part) ? 1 : 2, Codec: 'pcm', SampleRate: 16000 });
    const timestamp = Math.floor(Date.now() / 1000), date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const scope = `${date}/tts/tc3_request`;
    const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:tts.tencentcloudapi.com\n\ncontent-type;host\n${sha(payload)}`;
    const signed = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha(canonical)}`;
    const key = hmac(hmac(hmac(`TC3${secretKey}`, date), 'tts'), 'tc3_request');
    const signature = createHmac('sha256', key).update(signed).digest('hex');
    const response = await fetchImpl('https://tts.tencentcloudapi.com/', { method: 'POST', headers: {
      'Content-Type': 'application/json; charset=utf-8', 'X-TC-Action': 'TextToVoice', 'X-TC-Version': '2019-08-23', 'X-TC-Region': 'ap-guangzhou', 'X-TC-Timestamp': String(timestamp),
      Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
    }, body: payload, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) });
    const result = (await response.json()).Response;
    if (!response.ok || result?.Error) throw fail(`腾讯云语音服务暂不可用（${result?.Error?.Code || response.status}）。`, result?.Error?.Code?.startsWith('RequestLimitExceeded') ? 429 : 502);
    if (!result?.Audio || !/^[A-Za-z0-9+/=\r\n]+$/.test(result.Audio)) throw fail('语音服务没有返回有效音频。');
    const bytes = Buffer.from(result.Audio, 'base64');
    if (!bytes.length || bytes.length % 2) throw fail('语音服务返回了无效音频。');
    pcm.push(bytes);
  }
  const audio = Buffer.concat(pcm); const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + audio.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(audio.length, 40);
  return { bytes: Buffer.concat([header, audio]), mime: 'audio/wav', model: 'tencent-tts', voice: String(voice) };
}
