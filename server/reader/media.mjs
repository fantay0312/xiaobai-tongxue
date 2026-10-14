import { tencentVoice } from './tencent-voice.mjs';
import { TENCENT_VOICES, TENCENT_DEFAULT_VOICE, tencentEnabled, resolveTencentVoice } from './tencent-voices.mjs';
import { createTokenhubImages, DEFAULT_TOKENHUB_IMAGE } from './tokenhub-images.mjs';
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
const mediaId = (host, model) => `${host}:${model}`;

/** Credentials remain attached to the exact origin from their existing configuration. */
export function readerMediaProviders(cfg) {
  const candidates = [['upstreamBaseUrl', 'apiKey'], ['visionUpstreamUrl', 'visionApiKey'], ['asrUpstreamUrl', 'asrApiKey']];
  const seen = new Set();
  return candidates.flatMap(([urlKey, keyKey]) => {
    try {
      const url = new URL(cfg[urlKey]); const key = cfg[keyKey];
      if (url.protocol !== 'https:' || !key || url.hostname !== 'openrouter.ai' || seen.has(url.origin)) return [];
      seen.add(url.origin);
      return [{ origin: url.origin, host: url.hostname, base: `${url.origin}/api/v1`, key, credential: keyKey }];
    } catch { return []; }
  });
}

export function createReaderMedia({ cfg = {}, env = process.env, fetchImpl = fetch }) {
  const providers = readerMediaProviders(cfg); let cache; let pending;
  const tokenhub = createTokenhubImages({ env, fetchImpl });
  async function discover() {
    if (cache && Date.now() - cache.at < 300000) return cache;
    pending ??= (async () => {
      const routes = [];
      for (const provider of providers) {
        const read = async (path) => {
          try {
            const response = await fetchImpl(`${provider.base}/${path}`, { headers: { Authorization: `Bearer ${provider.key}` }, signal: AbortSignal.timeout(20000) });
            if (!response.ok) return [];
            const body = await response.json();
            return Array.isArray(body.data) ? body.data : [];
          } catch { return []; }
        };
        const [models, imageModels] = await Promise.all([read('models'), read('images/models')]);
        for (const model of models) {
          const outputs = model.architecture?.output_modalities ?? [];
          const inputs = model.architecture?.input_modalities ?? [];
          for (const kind of ['audio', 'image']) if (outputs.includes(kind)) routes.push({ id: mediaId(provider.host, model.id), model: model.id, label: model.name || model.id, kind, provider });
          if (inputs.includes('image') && outputs.includes('text')) routes.push({ id: mediaId(provider.host, model.id), model: model.id, label: model.name || model.id, kind: 'vision', provider });
        }
        for (const model of imageModels) {
          routes.push({ id: `image-api:${mediaId(provider.host, model.id)}`, model: model.id, label: model.name || model.id, kind: 'image', dedicated: true, provider });
        }
      }
      cache = { at: Date.now(), routes }; return cache;
    })().finally(() => { pending = undefined; });
    return pending;
  }
  const publicRoute = ({ id, model, label }) => ({ id, model, label, provider: 'OpenRouter' });
  async function catalog() {
    const { routes } = await discover();
    const speech = routes.filter((r) => r.kind === 'audio'); const images = routes.filter((r) => r.kind === 'image');
    const tencent = tencentEnabled(env) ? [{ id: 'tencent-tts', model: 'tencent-tts', label: '腾讯云 TTS', provider: '腾讯云', voices: TENCENT_VOICES, defaultVoice: TENCENT_DEFAULT_VOICE }] : [];
    let local = [];
    try { const r = await fetchImpl('http://127.0.0.1:18082/health', { signal: AbortSignal.timeout(1500) }); if (r.ok) local = (await r.json()).voices.map((voice) => ({ id: `kokoro:${voice}`, model: 'Kokoro-82M-v1.1-zh', label: `Kokoro 自然语音 · ${voice}`, provider: '本机' })); } catch { /* Optional local worker is not running. */ }
    const prefer = (list, ids) => ids.map((id) => list.find((x) => x.model === id)).find(Boolean) ?? list[0];
    return { speech: [...tencent, ...local, ...speech.filter((s) => s.model.startsWith('openai/')).map((s) => ({ ...publicRoute(s), voices: VOICES.map((id) => ({ id, label: id })), defaultVoice: 'alloy' }))], images: tokenhub.available ? tokenhub.models : images.map(publicRoute), voices: VOICES,
      defaultSpeech: tencent[0]?.id || local[0]?.id || prefer(speech, ['openai/gpt-audio-mini', 'openai/gpt-audio'])?.id || null,
      defaultImage: tokenhub.available ? DEFAULT_TOKENHUB_IMAGE : prefer(images.filter((r) => r.dedicated), ['bytedance-seed/seedream-5-0-flash', 'tencent/hy-image-v3.5-preview', 'black-forest-labs/flux.2-klein-4b'])?.id ?? null };
  }
  async function route(kind, id) {
    const found = (await discover()).routes.filter((r) => r.kind === kind);
    const chosen = id ? found.find((r) => r.id === id) : found.find((r) => r.model === (kind === 'audio' ? 'openai/gpt-audio-mini' : kind === 'vision' ? 'google/gemini-2.5-flash' : 'google/gemini-3.1-flash-lite-image')) ?? found[0];
    if (!chosen) throw fail('服务器没有可用的对应模型，请在设置中选择已提供的模型。', 503);
    return chosen;
  }
  async function request(selected, input, signal) {
    const response = await fetchImpl(`${selected.provider.base}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${selected.provider.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, model: selected.model }), signal });
    if (!response.ok) { await response.body?.cancel(); throw fail(response.status === 402 ? '服务器模型账户余额不足，请联系管理员充值。' : response.status === 429 ? '模型服务繁忙，请稍后重试。' : response.status === 403 ? '这个模型在当前服务器线路不可用，请切换模型。' : '模型服务暂时无法完成请求。', [402, 429].includes(response.status) ? response.status : 502); }
    return response;
  }
  return {
    catalog,
    async speech({ text, model, voice = 'alloy', signal }) {
      if (typeof text !== 'string' || !text.trim() || text.length > 6000) throw fail('朗读内容无效。', 400);
      const chosen = model || (tencentEnabled(env) ? 'tencent-tts' : (await catalog()).defaultSpeech);
      if (chosen === 'tencent-tts' || chosen?.startsWith('tencent-tts:')) {
        if (!tencentEnabled(env)) throw fail('腾讯云语音尚未启用。', 503);
        const id = resolveTencentVoice(chosen, voice);
        if (!id) throw fail('音色无效。', 400);
        return tencentVoice(text, Number(id), env, signal, fetchImpl);
      }
      if (chosen?.startsWith('kokoro:')) {
        const local = await fetchImpl('http://127.0.0.1:18082/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: chosen.slice(7) }), signal: signal ?? AbortSignal.timeout(90000) });
        if (!local.ok) throw fail(local.status === 429 ? '语音正在生成，请稍后重试。' : '语音生成失败，请重试。', local.status === 429 ? 429 : 502);
        return { bytes: Buffer.from(await local.arrayBuffer()), mime: 'audio/wav', model: chosen };
      }
      if (!VOICES.includes(voice)) throw fail('音色无效。', 400);
      const selected = await route('audio', model); const chunks = []; let bytes = 0;
      const response = await request(selected, { messages: [{ role: 'user', content: `请逐字朗读下面的文字，不添加开场白、不解释：\n${text}` }], modalities: ['text', 'audio'], audio: { voice, format: 'mp3' }, stream: true, max_tokens: 4000 }, signal ?? AbortSignal.timeout(90000));
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      const consume = (frame) => {
        const raw = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
        if (!raw || raw === '[DONE]') return;
        const item = JSON.parse(raw); if (item.error) throw fail('语音模型生成失败。');
        const data = item.choices?.[0]?.delta?.audio?.data;
        if (data) { const chunk = Buffer.from(data, 'base64'); bytes += chunk.length; if (bytes > 20 * 1024 * 1024) throw fail('音频超出上限。'); chunks.push(chunk); }
      };
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n'); const frames = buffer.split('\n\n'); buffer = frames.pop() ?? ''; frames.forEach(consume); } if (buffer.trim()) consume(buffer); }
      finally { await reader.cancel().catch(() => {}); }
      if (!bytes) throw fail('语音模型没有返回音频。');
      return { bytes: Buffer.concat(chunks), mime: 'audio/mpeg', model: selected.model };
    },
    async cover({ prompt, model, signal }) {
      if (tokenhub.available) return tokenhub.cover({ prompt, model, signal });
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw fail('封面提示无效。', 400);
      const selected = await route('image', model || (await catalog()).defaultImage);
      if (selected.dedicated) {
        const response = await fetchImpl(`${selected.provider.base}/images`, { method: 'POST', headers: { Authorization: `Bearer ${selected.provider.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: selected.model, prompt, n: 1, resolution: '1K', aspect_ratio: '1:1' }), signal: signal ?? AbortSignal.timeout(150000) });
        if (!response.ok) { await response.body?.cancel(); throw fail(response.status === 402 ? '服务器图像服务余额不足，请联系管理员充值。' : '封面模型暂时不可用，请更换模型。', response.status === 402 ? 402 : 502); }
        const image = (await response.json()).data?.[0];
        if (!image?.b64_json) throw fail('模型没有返回图片。');
        const bytes = Buffer.from(image.b64_json, 'base64'); if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw fail('图片大小无效。');
        return { bytes, mime: image.media_type || 'image/png', model: selected.model };
      }
      const response = await request(selected, { messages: [{ role: 'user', content: prompt }], modalities: ['image', 'text'], image_config: { aspect_ratio: '1:1', image_size: '1K' }, stream: false }, signal ?? AbortSignal.timeout(150000));
      const result = await response.json(); const url = result.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url ?? '');
      if (!match) throw fail('封面模型没有返回图片。');
      const bytes = Buffer.from(match[2], 'base64'); if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw fail('封面图片大小无效。');
      return { bytes, mime: match[1], model: selected.model };
    },
    async vision({ image, model, signal }) {
      if (typeof image !== 'string' || image.length > 12000000 || !/^data:image\/(png|jpeg|webp);base64,/.test(image)) throw fail('PDF 页面图像无效。', 400);
      const selected = await route('vision', model);
      const response = await request(selected, { messages: [{ role: 'user', content: [{ type: 'text', text: '逐字转录这一页为 Markdown。保留段落、标题、表格、公式和阅读顺序；不要解释或添加内容。' }, { type: 'image_url', image_url: { url: image } }] }], max_tokens: 6000, stream: false }, signal ?? AbortSignal.timeout(90000));
      const result = await response.json(); const text = result.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw fail('页面识别没有返回文字。');
      return text;
    },
  };
}
