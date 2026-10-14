import { useEffect, useState } from 'react';
import { defaultEffort, hostFetch, mediaPrefs, saveDefaultModel, saveMediaPrefs } from './bridge';
import { useStore } from '../lib/store';
export function MediaSettings() {
  const settings = useStore((s) => s.settings);
  const [catalog, setCatalog] = useState<{ speech?: { id: string; label: string; voices?: { id: string; label: string }[]; defaultVoice?: string }[]; images?: { id: string; label: string }[]; defaultSpeech?: string; defaultImage?: string }>({});
  const [effort, setEffort] = useState(defaultEffort); const [speech, setSpeech] = useState(mediaPrefs.speechModel); const [image, setImage] = useState(mediaPrefs.imageModel); const [voice, setVoice] = useState(mediaPrefs.voice);
  useEffect(() => { void hostFetch('reader/gloss/media/catalog').then((r) => r.json()).then(setCatalog).catch(() => {}); }, []);
  useEffect(() => {
    const onChange = () => { setSpeech(mediaPrefs.speechModel); setVoice(mediaPrefs.voice); setImage(mediaPrefs.imageModel); };
    window.addEventListener('gloss:media-prefs-change', onChange);
    return () => window.removeEventListener('gloss:media-prefs-change', onChange);
  }, []);
  const selectedModel = speech.startsWith('tencent-tts:') ? 'tencent-tts' : speech || catalog.defaultSpeech || '';
  const service = catalog.speech?.find((m) => m.id === selectedModel);
  const storedVoice = speech.startsWith('tencent-tts:') ? speech.split(':')[1] : voice;
  const selectedVoice = service?.voices?.some((v) => v.id === storedVoice) ? storedVoice : service?.defaultVoice || service?.voices?.[0]?.id || '';
  const selectedImage = catalog.images?.some((m) => m.id === image) ? image : catalog.defaultImage || '';
  const style = 'h-9 w-full rounded-lg border border-rule bg-bg px-2 text-[12px] text-ink';
  return <div className="space-y-3 border-t border-rule pt-3">
    <label className="block text-[12.5px] text-ink-3">思考强度<select className={style} value={effort} onChange={(e) => { setEffort(e.target.value); saveDefaultModel(settings.model, e.target.value); }}>{Object.entries({ none: '极速', low: '轻度', medium: '均衡', high: '深入', max: '最高' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="block text-[12.5px] text-ink-3">语音服务<select className={style} value={selectedModel} onChange={(e) => { const next = catalog.speech?.find((m) => m.id === e.target.value); const nextVoice = next?.defaultVoice || next?.voices?.[0]?.id || 'alloy'; setSpeech(e.target.value); setVoice(nextVoice); saveMediaPrefs({ speechModel: e.target.value, voice: nextVoice }); }}>{catalog.speech?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    {!!service?.voices?.length && <label className="block text-[12.5px] text-ink-3">朗读音色<select className={style} value={selectedVoice} onChange={(e) => { setVoice(e.target.value); setSpeech(selectedModel); saveMediaPrefs({ speechModel: selectedModel, voice: e.target.value }); }}>{service.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label>}
    <label className="block text-[12.5px] text-ink-3">AI 封面模型<select className={style} value={selectedImage} onChange={(e) => { setImage(e.target.value); saveMediaPrefs({ imageModel: e.target.value }); }}>{catalog.images?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <p className="text-[11.5px] leading-snug text-ink-3">统一使用服务器已配置的线路与密钥。</p>
  </div>;
}
