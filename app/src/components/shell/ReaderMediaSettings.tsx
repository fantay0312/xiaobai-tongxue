import { useEffect, useState } from 'react';
import { API_BASE, gatewayFetch } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

export function ReaderMediaSettings() {
  const owner = useAuthStore((s) => s.user);
  const key = `xiaobai-gloss:${encodeURIComponent(import.meta.env.BASE_URL)}:${encodeURIComponent(owner || '')}:media-prefs`;
  const [prefs, setPrefs] = useState<{ speechModel?: string; imageModel?: string }>({});
  const [catalog, setCatalog] = useState<{ speech?: { id: string; label: string }[]; images?: { id: string; label: string }[] }>({});
  useEffect(() => {
    if (!owner) return;
    try { setPrefs(JSON.parse(localStorage.getItem(key) || '{}')); } catch { setPrefs({}); }
    const signal = new AbortController();
    void gatewayFetch(`${API_BASE}/reader/gloss/media/catalog`, { signal: signal.signal }).then((r) => r.ok ? r.json() : {}).then((value) => { if (!signal.signal.aborted) setCatalog(value); }).catch(() => {});
    return () => signal.abort();
  }, [key]);
  const update = (patch: Partial<typeof prefs>) => {
    const next = { ...prefs, ...patch }; setPrefs(next);
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) || '{}'), ...next }));
  };
  return <div style={{ display: 'grid', gap: 14 }}>
    <label style={{ display: 'grid', gap: 6 }}>自然语音<select aria-label="阅读自然语音模型" value={prefs.speechModel || ''} onChange={(e) => update({ speechModel: e.target.value })}><option value="">使用服务器推荐模型</option>{catalog.speech?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <label style={{ display: 'grid', gap: 6 }}>AI 封面<select aria-label="阅读封面生成模型" value={prefs.imageModel || ''} onChange={(e) => update({ imageModel: e.target.value })}><option value="">使用服务器推荐模型</option>{catalog.images?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>读取和使用服务器现有线路，不需要填写额外密钥。</p>
  </div>;
}
