import { useEffect, useState } from 'react';
import { API_BASE, gatewayFetch } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';
import s from './ReaderMediaSettings.module.css';

export function ReaderMediaSettings() {
  const owner = useAuthStore((s) => s.user);
  const key = `xiaobai-gloss:${encodeURIComponent(import.meta.env.BASE_URL)}:${encodeURIComponent(owner || '')}:media-prefs`;
  const [prefs, setPrefs] = useState<{ speechModel?: string; imageModel?: string; voice?: string }>({});
  const [catalog, setCatalog] = useState<{ speech?: { id: string; label: string; voices?: { id: string; label: string }[]; defaultVoice?: string }[]; images?: { id: string; label: string }[]; defaultSpeech?: string }>({});
  useEffect(() => {
    if (!owner) return;
    try { setPrefs(JSON.parse(localStorage.getItem(key) || '{}')); } catch { setPrefs({}); }
    const signal = new AbortController();
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) { try { setPrefs(JSON.parse(event.newValue || '{}')); } catch { /* Keep current valid preferences. */ } }
    };
    window.addEventListener('storage', onStorage);
    void gatewayFetch(`${API_BASE}/reader/gloss/media/catalog`, { signal: signal.signal }).then((r) => r.ok ? r.json() : {}).then((value) => { if (!signal.signal.aborted) setCatalog(value); }).catch(() => {});
    return () => { signal.abort(); window.removeEventListener('storage', onStorage); };
  }, [key]);
  const update = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch }; setPrefs(next);
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) || '{}'), ...next }));
  };
  const selectedModel = prefs.speechModel?.startsWith('tencent-tts:') ? 'tencent-tts' : prefs.speechModel || catalog.defaultSpeech || '';
  const service = catalog.speech?.find((m) => m.id === selectedModel);
  const storedVoice = prefs.speechModel?.startsWith('tencent-tts:') ? prefs.speechModel.split(':')[1] : prefs.voice;
  const selectedVoice = service?.voices?.some((v) => v.id === storedVoice) ? storedVoice : service?.defaultVoice || service?.voices?.[0]?.id || '';
  return <div className={s.fields}>
    <label style={{ display: 'grid', gap: 6 }}>语音服务<select aria-label="阅读语音服务" value={prefs.speechModel?.startsWith('tencent-tts:') ? 'tencent-tts' : prefs.speechModel || ''} onChange={(e) => { const next = catalog.speech?.find((m) => m.id === (e.target.value || catalog.defaultSpeech)); update({ speechModel: e.target.value, voice: next?.defaultVoice || next?.voices?.[0]?.id || 'alloy' }); }}><option value="">使用服务器推荐服务</option>{catalog.speech?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    {!!service?.voices?.length && <label style={{ display: 'grid', gap: 6 }}>朗读音色<select aria-label="阅读朗读音色" value={selectedVoice} onChange={(e) => update({ speechModel: selectedModel, voice: e.target.value })}>{service.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>}
    <label style={{ display: 'grid', gap: 6 }}>AI 封面<select aria-label="阅读封面生成模型" value={prefs.imageModel || ''} onChange={(e) => update({ imageModel: e.target.value })}><option value="">使用服务器推荐模型</option>{catalog.images?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>读取和使用服务器现有线路，不需要填写额外密钥。</p>
  </div>;
}
