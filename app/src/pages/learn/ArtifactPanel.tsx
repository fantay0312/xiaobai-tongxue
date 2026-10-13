import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { artifactMarkdown, artifactSlidesHtml, artifactSvg, STUDIO_LABELS, type StudyArtifact, type StudioKind } from '../../engine/studyStudio';
import { downloadStudyFile } from '../../engine/studyWorkspace';
import { exportCaptionVideo, saveBlob, videoExportSupported } from '../../lib/notebookMedia';
import n from './notebook.module.css';

export function ArtifactPanel({ artifact, onUpdate, onEnhance, onSource, busy, saveFailed = false }: {
  artifact: StudyArtifact; onUpdate: (artifact: StudyArtifact) => void; onEnhance: () => void;
  onSource: (source: { id: string; title: string; excerpt: string }) => void; busy: boolean; saveFailed?: boolean;
}) {
  const [page, setPage] = useState(0); const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(artifact);
  const download = () => {
    if (artifact.kind === 'slides' || artifact.kind === 'video') return downloadStudyFile(`${artifact.title}.html`, artifactSlidesHtml(artifact), 'text/html');
    if (artifact.kind === 'mindmap' || artifact.kind === 'infographic') return downloadStudyFile(`${artifact.title}.svg`, artifactSvg(artifact, artifact.kind === 'infographic'), 'image/svg+xml');
    if (artifact.kind === 'table') {
      const cell = (value: string) => `"${(/^\s*[=+\-@]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`;
      return downloadStudyFile(`${artifact.title}.csv`, '\uFEFF' + [['要点', '内容', '来源'], ...artifact.sections.map((section) => [section.title, section.text, section.sourceIds.map((id) => artifact.sources.find((source) => source.id === id)?.title ?? id).join('；')])].map((row) => row.map(cell).join(',')).join('\r\n'), 'text/csv');
    }
    downloadStudyFile(`${artifact.title}.md`, artifactMarkdown(artifact));
  };
  const section = artifact.sections[Math.min(page, artifact.sections.length - 1)];
  const svg = artifact.kind === 'mindmap' || artifact.kind === 'infographic' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artifactSvg(artifact, artifact.kind === 'infographic'))}` : '';
  return <article className={n.artifactViewer}>
    <div className={n.artifactHeading}><div><span>{STUDIO_LABELS[artifact.kind]} · {artifact.method === 'model' ? '小砚整理' : '资料摘编'}</span><h1>{artifact.title}</h1><p>依据保存时的 {artifact.sources.length} 份来源片段。当前选择改变后，已有内容和引用仍保留。</p></div></div>
    <div className={n.artifactTools}><button onClick={download}><Icon name="download" size={15} />{artifact.kind === 'slides' || artifact.kind === 'video' ? '导出 HTML 课件' : artifact.kind === 'table' ? '导出 CSV' : artifact.kind === 'mindmap' || artifact.kind === 'infographic' ? '导出 SVG' : '导出文稿'}</button><button disabled={busy} onClick={() => { setDraft(artifact); setEditing((value) => !value); }}><Icon name="pen" size={15} />{editing ? '收起编辑' : '编辑内容'}</button><button disabled={busy || editing} onClick={onEnhance}><Icon name="sparkles" size={15} />{busy ? '正在整理…' : '请小砚整理'}</button><label>查看形式<select aria-label="产物展示形式" value={artifact.kind} onChange={(event) => onUpdate({ ...artifact, kind: event.target.value as StudioKind })}>{Object.entries(STUDIO_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
    {editing ? <div className={n.artifactEditor}><input aria-label="产物标题" value={draft.title} maxLength={160} onChange={(event) => { const next = { ...draft, title: event.target.value }; setDraft(next); onUpdate(next); }} />{draft.sections.map((item, i) => <label key={i}>{item.title}<textarea aria-label={`编辑第 ${i + 1} 节`} value={item.text} maxLength={1600} rows={4} onChange={(event) => { const next = { ...draft, sections: draft.sections.map((s, index) => index === i ? { ...s, text: event.target.value } : s) }; setDraft(next); onUpdate(next); }} /></label>)}<p className={n.quiet}>{saveFailed ? '本机保存失败，当前修改仅保留在页面中，请先导出备份。' : '编辑会自动保存到当前浏览器。'}</p><button onClick={() => setEditing(false)}>完成编辑</button></div> : <>
      {(artifact.kind === 'mindmap' || artifact.kind === 'infographic') && <><img className={n.diagram} src={svg} alt={`${artifact.title}，${artifact.sections.length} 个章节`} /><details className={n.diagramText}><summary>查看文字大纲</summary>{artifact.sections.map((item, i) => <details key={i}><summary>{item.title}</summary><CoachMarkdown text={item.text} /></details>)}</details></>}
      {artifact.kind === 'table' && <div className={n.tableScroll}><table><thead><tr><th>要点</th><th>内容</th><th>来源</th></tr></thead><tbody>{artifact.sections.map((item, i) => <tr key={i}><th>{item.title}</th><td>{item.text}</td><td>{item.sourceIds.map((id) => { const source = artifact.sources.find((s) => s.id === id); return source && <button key={id} onClick={() => onSource(source)}>{source.title}</button>; })}</td></tr>)}</tbody></table></div>}
      {artifact.kind === 'slides' && section && <><div className={n.slidePage}><span>{page + 1} / {artifact.sections.length}</span><h2>{section.title}</h2><CoachMarkdown text={section.text} /></div><div className={n.pagination}><button disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="arrow-left" size={15} />上一页</button><button disabled={page >= artifact.sections.length - 1} onClick={() => setPage(page + 1)}>下一页<Icon name="arrow-right" size={15} /></button></div></>}
      {artifact.kind === 'audio' && <AudioOverview artifact={artifact} />}
      {artifact.kind === 'video' && <VideoOverview artifact={artifact} />}
      {['report', 'audio', 'video'].includes(artifact.kind) && <div className={n.reportContent}>{artifact.sections.map((item, i) => <section key={i}><h2>{item.title}</h2><CoachMarkdown text={item.text} /><div className={n.inlineSources}>{item.sourceIds.map((id) => { const source = artifact.sources.find((s) => s.id === id); return source && <button key={id} onClick={() => onSource(source)}><Icon name="file" size={12} />{source.title}</button>; })}</div></section>)}</div>}
    </>}
    <details className={n.sourceReceipts}><summary>{artifact.sources.length} 份来源与原文摘录</summary>{artifact.sources.map((source) => <button key={source.id} onClick={() => onSource(source)}><Icon name="file" size={15} /><span>{source.title}<small>{source.excerpt.slice(0, 110)}…</small></span></button>)}</details>
  </article>;
}

function AudioOverview({ artifact }: { artifact: StudyArtifact }) {
  const [state, setState] = useState<'idle' | 'starting' | 'playing' | 'paused'>('idle'); const [message, setMessage] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]); const [voice, setVoice] = useState(''); const [rate, setRate] = useState(1);
  const stopped = useRef(false);
  useEffect(() => {
    if (!('speechSynthesis' in window)) { setMessage('当前浏览器不支持语音合成，可导出文稿阅读。'); return; }
    const refresh = () => setVoices(speechSynthesis.getVoices()); refresh(); speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => { stopped.current = true; speechSynthesis.cancel(); speechSynthesis.removeEventListener('voiceschanged', refresh); };
  }, []);
  const stop = () => { stopped.current = true; speechSynthesis.cancel(); setState('idle'); };
  const play = () => {
    if (!('speechSynthesis' in window)) return;
    if (state === 'paused') { speechSynthesis.resume(); setState('playing'); return; }
    stop(); stopped.current = false; setMessage('');
    const paragraphs = artifact.sections.flatMap((section) => `${section.title}。${section.text}`.match(/.{1,180}(?:[。！？\n]|$)|.{1,180}/g) ?? []);
    let index = 0;
    const speak = () => {
      if (stopped.current || index >= paragraphs.length) { setState('idle'); return; }
      const utterance = new SpeechSynthesisUtterance(paragraphs[index++]); utterance.lang = 'zh-CN'; utterance.rate = rate;
      const selected = voices.find((item) => item.voiceURI === voice) ?? voices.find((item) => item.lang.startsWith('zh'));
      if (selected) utterance.voice = selected;
      utterance.onstart = () => setState('playing'); utterance.onend = speak; utterance.onerror = (event) => { if (!stopped.current && event.error !== 'canceled' && event.error !== 'interrupted') { setMessage('语音播放未完成，请重试或换一个声音。'); setState('idle'); } };
      speechSynthesis.speak(utterance);
    };
    setState('starting'); speak();
  };
  return <div className={n.mediaControls}><Icon name="mic" size={28} /><div><h2>听一遍这份导读</h2><p>由浏览器语音朗读下方文稿；可选择声音，不生成可下载音频文件。</p><div className={n.controlRow}><select aria-label="朗读声音" value={voice} onChange={(event) => setVoice(event.target.value)} disabled={state !== 'idle'}><option value="">中文默认声音</option>{voices.map((item) => <option key={item.voiceURI} value={item.voiceURI}>{item.name}</option>)}</select><select aria-label="朗读速度" value={rate} onChange={(event) => setRate(Number(event.target.value))} disabled={state !== 'idle'}><option value={0.85}>0.85×</option><option value={1}>1×</option><option value={1.15}>1.15×</option></select><button onClick={play} disabled={state === 'playing' || state === 'starting' || !('speechSynthesis' in window)}><Icon name="play" size={15} />{state === 'paused' ? '继续' : state === 'starting' ? '准备声音…' : '播放'}</button><button disabled={state !== 'playing'} onClick={() => { speechSynthesis.pause(); setState('paused'); }}>暂停</button><button disabled={state === 'idle'} onClick={stop}>停止</button></div><p role="status">{message || (state === 'playing' ? '正在朗读' : state === 'paused' ? '已暂停' : state === 'starting' ? '正在准备声音' : '')}</p></div></div>;
}

function VideoOverview({ artifact }: { artifact: StudyArtifact }) {
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0); const [message, setMessage] = useState(''); const [video, setVideo] = useState<{ url: string; blob: Blob } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => () => { if (video) URL.revokeObjectURL(video.url); }, [video]);
  const render = async () => {
    const current = new AbortController(); controller.current = current; setBusy(true); setMessage('');
    try { const blob = await exportCaptionVideo(artifact, current.signal, setProgress); if (!current.signal.aborted) setVideo({ blob, url: URL.createObjectURL(blob) }); }
    catch (error) { if (!current.signal.aborted) setMessage(error instanceof Error ? error.message : '视频导出失败。'); }
    finally { if (controller.current === current) setBusy(false); }
  };
  return <div className={n.videoOverview}><h2>字幕视频</h2><p>将全部 {artifact.sections.length} 节内容制成可播放的视频，每页约 3.5 秒。视频不含配音；文稿也可导出为 HTML 课件。</p>{video && <video src={video.url} controls aria-label="生成的字幕视频" />}<div className={n.controlRow}><button onClick={() => void render()} disabled={busy || !videoExportSupported()}><Icon name="play" size={15} />{busy ? `正在制作 ${Math.round(progress * 100)}%` : video ? '重新制作' : '制作字幕视频'}</button>{busy && <button onClick={() => controller.current?.abort()}>停止制作</button>}{video && <button onClick={() => saveBlob(`${artifact.title}.${video.blob.type.includes('mp4') ? 'mp4' : 'webm'}`, video.blob)}>下载视频</button>}</div>{!videoExportSupported() && <p>当前浏览器不支持视频录制，可使用上方的 HTML 课件导出。</p>}{message && <p role="status">{message}</p>}</div>;
}
