import { createHash, createHmac, randomUUID } from 'node:crypto';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const hmac = (key, text) => createHmac('sha256', key).update(text).digest();
export async function tencentVoice(text, voice, env = process.env, signal) {
  const secretId = env.TENCENT_ASR_SECRET_ID, secretKey = env.TENCENT_ASR_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error('服务器没有配置语音凭据。');
  const chunks = []; let current = '';
  for (const char of text) { if (current.length >= (/[\u4e00-\u9fff]/.test(current) ? 130 : 450)) { chunks.push(current); current = ''; } current += char; }
  if (current) chunks.push(current);
  const pcm = [];
  for (const part of chunks) {
    const payload = JSON.stringify({ Text: part, SessionId: randomUUID(), ModelType: 1, VoiceType: voice, PrimaryLanguage: /[\u4e00-\u9fff]/.test(part) ? 1 : 2, Codec: 'pcm', SampleRate: 16000 });
    const timestamp = Math.floor(Date.now() / 1000), date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const scope = `${date}/tts/tc3_request`;
    const canonical = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:tts.tencentcloudapi.com\n\ncontent-type;host\n${sha(payload)}`;
    const signed = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha(canonical)}`;
    const key = hmac(hmac(hmac(`TC3${secretKey}`, date), 'tts'), 'tc3_request');
    const signature = createHmac('sha256', key).update(signed).digest('hex');
    const response = await fetch('https://tts.tencentcloudapi.com/', { method: 'POST', headers: {
      'Content-Type': 'application/json; charset=utf-8', 'X-TC-Action': 'TextToVoice', 'X-TC-Version': '2019-08-23', 'X-TC-Region': 'ap-guangzhou', 'X-TC-Timestamp': String(timestamp),
      Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
    }, body: payload, signal: signal ?? AbortSignal.timeout(45000) });
    const result = (await response.json()).Response;
    if (!response.ok || result?.Error) throw new Error(`语音服务暂不可用（${result?.Error?.Code || response.status}）。`);
    if (!result?.Audio) throw new Error('语音服务没有返回音频。');
    pcm.push(Buffer.from(result.Audio, 'base64'));
  }
  const audio = Buffer.concat(pcm); const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + audio.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(audio.length, 40);
  return { bytes: Buffer.concat([header, audio]), mime: 'audio/wav', model: `tencent-tts:${voice}` };
}
