import { externalUrl } from './importer.mjs';

const ORIGIN = 'https://tokenhub.tencentmaas.com';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const TOKENHUB_IMAGE_MODELS = [
  { id: 'tokenhub:seedream-image-v5.0-pro', model: 'seedream-image-v5.0-pro', label: 'Seedream 5.0 Pro', provider: 'TokenHub' },
  { id: 'tokenhub:hy-image-v3.5-preview', model: 'hy-image-v3.5-preview', label: 'HY-Image-3.5', provider: 'TokenHub' },
];
export const DEFAULT_TOKENHUB_IMAGE = TOKENHUB_IMAGE_MODELS[0].id;
const fail = (message, status = 502) => Object.assign(new Error(message), { status });

/** Only the two configured image models are accepted. Old OpenRouter preferences migrate to Seedream. */
export function tokenhubImageModel(value) {
  if (!value || (typeof value === 'string' && /^(image-api:)?openrouter\.ai:/.test(value))) return TOKENHUB_IMAGE_MODELS[0];
  return TOKENHUB_IMAGE_MODELS.find((item) => item.id === value || item.model === value) ?? null;
}

function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw fail('图像服务未返回有效的封面图片。');
}

async function readJson(response) {
  const chunks = []; let length = 0;
  if (!response.body) throw fail('图像服务没有返回内容。');
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 20 * 1024 * 1024) throw fail('图像服务响应超过大小限制。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw fail('图像服务返回格式异常。'); }
}

async function downloadImage(url, { signal, maxBytes }, fetchImpl) {
  // COS may resolve to a private Tencent address from a Tencent CVM. Only this documented
  // output bucket family is allowed; HTTPS verification stays on and redirects are refused.
  const response = await fetchImpl(url, { headers: { Accept: 'image/png,image/jpeg,image/webp' }, signal, redirect: 'error' });
  if (!response.ok || !response.body) throw fail('无法下载生成的封面，请重试。');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) throw fail('生成的封面超过大小限制。');
    chunks.push(chunk);
  }
  return { bytes: Buffer.concat(chunks) };
}

function responseError(status, body) {
  const raw = body?.error?.code ?? body?.code;
  const code = typeof raw === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(raw) ? `（${raw}）` : '';
  if (status === 401 || status === 403) return fail(`TokenHub 密钥或模型权限不可用${code}，请联系管理员检查。`, 503);
  if (status === 402) return fail('TokenHub 图像服务余额或额度不足，请联系管理员处理。', 402);
  if (status === 429) return fail('图像服务繁忙，请稍后重试。', 429);
  return fail(`封面生成失败${code}，请稍后重试。`);
}

export function createTokenhubImages({ env = process.env, fetchImpl = fetch, downloadImpl } = {}) {
  const key = env.READER_TOKENHUB_API_KEY?.trim();
  return {
    available: Boolean(key),
    models: key ? TOKENHUB_IMAGE_MODELS : [],
    async cover({ prompt, model, signal }) {
      if (!key) throw fail('服务器尚未配置 TokenHub 图像服务。', 503);
      const selected = tokenhubImageModel(model);
      if (!selected) throw fail('请选择 Seedream 5.0 Pro 或 HY-Image-3.5。', 400);
      if (typeof prompt !== 'string' || !prompt.trim() || Array.from(prompt).length > 600) throw fail('封面描述无效或过长。', 400);
      const seedream = selected.model === 'seedream-image-v5.0-pro';
      const path = seedream ? '/v1/wand/si-image/generation' : '/v1/wand/hunyuan-image/v35-generation';
      const body = seedream
        ? { model: selected.model, prompt, size: '1024x1024', output_format: 'png', response_format: 'b64_json', watermark: false }
        : { model: selected.model, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }], size: '1024x1024', use_search_tool: { value: false } };
      const deadline = AbortSignal.timeout(180000);
      const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      requestSignal.throwIfAborted();
      const response = await fetchImpl(ORIGIN + path, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: requestSignal, redirect: 'error' });
      const result = await readJson(response);
      if (!response.ok || result?.error) throw responseError(response.status, result);
      let bytes;
      const encoded = seedream ? result.data?.[0]?.b64_json : undefined;
      const url = seedream ? result.data?.[0]?.url : result.choices?.[0]?.delta?.image?.url;
      if (typeof encoded === 'string' && encoded.length) {
        if (encoded.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) throw fail('封面图片数据无效或过大。');
        bytes = Buffer.from(encoded, 'base64');
      } else if (typeof url === 'string') {
        const target = externalUrl(url);
        if (target.protocol !== 'https:' || !/^aigc-output-image(?:-file)?-[0-9]+\.cos\.ap-guangzhou\.myqcloud\.com$/.test(target.hostname)) throw fail('图像服务返回了不受支持的图片地址。');
        // Image URLs have short-lived signatures. Fetch pixels without forwarding the API key.
        bytes = (await (downloadImpl ?? ((url, options) => downloadImage(url, options, fetchImpl)))(target.href, { maxBytes: MAX_IMAGE_BYTES, signal: requestSignal })).bytes;
      } else throw fail('图像模型没有返回封面。');
      if (!bytes?.length || bytes.length > MAX_IMAGE_BYTES) throw fail('封面图片大小无效。');
      return { bytes, mime: imageMime(bytes), model: selected.id };
    },
  };
}
