/**
 * 腾讯云实时语音识别（WebSocket）签名。
 * 浏览器直连 wss://asr.cloud.tencent.com，音频不经本网关中转；这里只用 SecretKey 给一次连接签名。
 * 签名规则：除 signature 外的参数按字典序拼成「host + path + ?query」（不含 wss://），HMAC-SHA1 后 Base64，再整体 URL 编码。
 */
import { createHmac, randomInt, randomUUID } from 'node:crypto';

const HOST = 'asr.cloud.tencent.com';

export function createRealtimeAsrSigner({ appId, secretId, secretKey, engine = '16k_zh_en', ttlSeconds = 120 } = {}) {
  const id = String(appId ?? '').trim();
  if (!/^\d{6,14}$/.test(id) || !secretId || !secretKey) return null;
  const model = /^[\w.-]{2,40}$/.test(engine) ? engine : '16k_zh_en';
  return function sign(now = Date.now()) {
    const timestamp = Math.floor(now / 1000);
    const params = {
      convert_num_mode: 1,
      engine_model_type: model,
      expired: timestamp + ttlSeconds,
      filter_modal: 1,
      needvad: 1,
      nonce: randomInt(1, 1_000_000_000),
      secretid: secretId,
      timestamp,
      vad_silence_time: 800,
      voice_format: 1,
      voice_id: randomUUID(),
    };
    const query = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&');
    const base = `${HOST}/asr/v2/${id}?${query}`;
    const signature = encodeURIComponent(createHmac('sha1', secretKey).update(base).digest('base64'));
    return { url: `wss://${base}&signature=${signature}`, engine: model, sampleRate: 16000, expiresAt: (timestamp + ttlSeconds) * 1000 };
  };
}
