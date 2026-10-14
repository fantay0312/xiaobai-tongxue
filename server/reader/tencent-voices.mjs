// https://cloud.tencent.com/document/product/1073/92668
// Keep IDs server controlled; readers choose labels, never credentials.
export const TENCENT_VOICES = [
  { id: '501002', label: '智菊 · 阅读女声（大模型）' },
  { id: '501000', label: '智斌 · 阅读男声（大模型）' },
  { id: '101001', label: '智瑜 · 女声' },
  { id: '101004', label: '智云 · 男声' },
];
export const TENCENT_DEFAULT_VOICE = '501002';
export const tencentEnabled = (env) => env.READER_TENCENT_TTS_ENABLED === '1' && Boolean(env.TENCENT_ASR_SECRET_ID && env.TENCENT_ASR_SECRET_KEY);

/** Old builds encoded the voice in the model ID; keep those preferences usable. */
export function resolveTencentVoice(model, voice) {
  const legacyVoice = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(voice);
  const id = model?.startsWith('tencent-tts:') ? model.slice('tencent-tts:'.length) : voice && !legacyVoice ? String(voice) : TENCENT_DEFAULT_VOICE;
  return TENCENT_VOICES.find((entry) => entry.id === id)?.id ?? null;
}
