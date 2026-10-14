import { useEffect, useState } from 'react';
import { defaultEffort, hostFetch, mediaPrefs, saveDefaultModel, saveMediaPrefs } from './bridge';
import { useStore } from '../lib/store';
export function MediaSettings() {
  const settings = useStore((s) => s.settings);
  const [catalog, setCatalog] = useState<{ speech?: { id: string; label: string }[]; images?: { id: string; label: string }[]; defaultSpeech?: string; defaultImage?: string; voices?: string[] }>({});
  const [effort, setEffort] = useState(defaultEffort); const [speech, setSpeech] = useState(mediaPrefs.speechModel); const [image, setImage] = useState(mediaPrefs.imageModel); const [voice, setVoice] = useState(mediaPrefs.voice);
  useEffect(() => { void hostFetch('reader/gloss/media/catalog').then((r) => r.json()).then(setCatalog).catch(() => {}); }, []);
  const style = 'h-9 w-full rounded-lg border border-rule bg-bg px-2 text-[12px] text-ink';
  return <div className="space-y-3 border-t border-rule pt-3">
    <label className="block text-[12.5px] text-ink-3">思考强度<select className={style} value={effort} onChange={(e) => { setEffort(e.target.value); saveDefaultModel(settings.model, e.target.value); }}>{Object.entries({ none: '极速', low: '轻度', medium: '均衡', high: '深入', max: '最高' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="block text-[12.5px] text-ink-3">自然语音模型<select className={style} value={speech || catalog.defaultSpeech || ''} onChange={(e) => { setSpeech(e.target.value); saveMediaPrefs({ speechModel: e.target.value }); }}>{catalog.speech?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    {!/^(kokoro:|tencent-tts:)/.test(speech || catalog.defaultSpeech || '') && <label className="block text-[12.5px] text-ink-3">音色<select className={style} value={voice} onChange={(e) => { setVoice(e.target.value); saveMediaPrefs({ voice: e.target.value }); }}>{catalog.voices?.map((v) => <option key={v} value={v}>{v}</option>)}</select></label>}
    <label className="block text-[12.5px] text-ink-3">AI 封面模型<select className={style} value={image || catalog.defaultImage || ''} onChange={(e) => { setImage(e.target.value); saveMediaPrefs({ imageModel: e.target.value }); }}>{catalog.images?.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
    <p className="text-[11.5px] leading-snug text-ink-3">统一使用服务器已配置的线路与密钥。</p>
  </div>;
}
