import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, BookmarkPlus, BookOpen, Copy, Download, ExternalLink, Focus, Globe, Highlighter, Image, NotebookPen, Pause, Play, RefreshCw, Settings2, Square, Star, Trash2, X } from 'lucide-react';
import { Button, Dialog, IconButton, ModelPicker, Textarea } from '../../components/ui';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { PdfViewer } from '../../components/preview/PdfViewer';
import { saveBlob } from '../../lib/notebookMedia';
import { useModelPrefs } from '../../store/modelPrefs';
import { useModelCatalog } from '../learn/chat/useModelCatalog';
import { loadPdf, savePdf } from './storage';
import { downloadLibraryFile } from '../../lib/fileLibrary';
import { readerApi, readerError } from './api';
import { ACTIONS, answerReading, readerContext, type Action } from './ai';
import { exportNotes, highlightSegments, TOPICS, uid, type Anchor, type Mark, type ReaderDocument, type ReaderPrefs, type Thread } from './types';
import { useListen } from './useListen';
import s from './reading.module.css';

type Selection = { quote: string; anchors: Anchor[] };
export function Reader({ doc, owner, prefs, onPrefs, onChange, onBack, onSettings, onReparse }: {
  doc: ReaderDocument; owner: string; prefs: ReaderPrefs; onPrefs: (prefs: ReaderPrefs) => void; onChange: (doc: ReaderDocument) => void;
  onBack: () => void; onSettings: () => void; onReparse: (doc: ReaderDocument) => void;
}) {
  const [selection, setSelection] = useState<Selection | null>(null); const [question, setQuestion] = useState('');
  const [active, setActive] = useState(Math.floor(doc.progress * Math.max(0, doc.blocks.length - 1)));
  const [focus, setFocus] = useState(false); const [notebook, setNotebook] = useState(false); const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); const [stream, setStream] = useState(''); const [error, setError] = useState('');
  const [sourceWarning, setSourceWarning] = useState(''); const [mobileNote, setMobileNote] = useState<string | null>(null);
  const [pendingThread, setPendingThread] = useState<Thread | null>(null);
  const [followupId, setFollowupId] = useState<string | null>(null);
  const [pdf, setPdf] = useState<Blob>(); const [original, setOriginal] = useState(false); const [rename, setRename] = useState(false);
  const [natural, setNatural] = useState(false); const [noteFilter, setNoteFilter] = useState('all');
  const body = useRef<HTMLDivElement>(null); const composer = useRef<HTMLTextAreaElement>(null); const abort = useRef<AbortController | null>(null);
  const live = useRef(doc); live.current = doc; const mounted = useRef(true);
  const catalog = useModelCatalog(true); const model = useModelPrefs();
  const update = (patch: Partial<ReaderDocument>) => onChange({ ...live.current, ...patch });
  function go(index: number) {
    const target = Math.max(0, Math.min(doc.blocks.length - 1, index)); setActive(target);
    body.current?.querySelector(`[data-reader-block="${CSS.escape(doc.blocks[target]?.id || '')}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const speech = useListen(doc.blocks, prefs.rate, go, setError);
  useEffect(() => {
    mounted.current = true;
    void loadPdf(owner, doc.id).then((blob) => { if (mounted.current) setPdf(blob); });
    const timer = setTimeout(() => {
      const index = Math.floor(doc.progress * Math.max(0, doc.blocks.length - 1));
      body.current?.querySelector(`[data-reader-block="${CSS.escape(doc.blocks[index]?.id || '')}"]`)?.scrollIntoView({ block: 'start' });
    }, 100);
    return () => { mounted.current = false; clearTimeout(timer); abort.current?.abort(); };
  }, [doc.id, owner]);
  function selectBlock(index: number) {
    const block = doc.blocks[index]; if (!block) return;
    setFollowupId(null);
    setSelection({ quote: block.text.slice(0, 12000), anchors: [{ block: block.id, start: 0, end: Math.min(12000, block.text.length) }] });
    setActive(index);
  }
  function readSelection() {
    const picked = window.getSelection(); if (!picked || picked.isCollapsed || !picked.rangeCount || !body.current) return;
    const range = picked.getRangeAt(0); const quote = picked.toString().trim(); if (!quote || !body.current.contains(range.commonAncestorContainer)) return;
    const anchors: Anchor[] = [];
    body.current.querySelectorAll('[data-reader-text]').forEach((node) => {
      if (!range.intersectsNode(node)) return;
      const prefix = range.cloneRange(); prefix.selectNodeContents(node);
      if (node.contains(range.startContainer)) prefix.setEnd(range.startContainer, range.startOffset);
      else prefix.setEnd(node, 0);
      const suffix = range.cloneRange(); suffix.selectNodeContents(node);
      if (node.contains(range.endContainer)) suffix.setEnd(range.endContainer, range.endOffset);
      const text = node.textContent || '';
      anchors.push({ block: node.getAttribute('data-reader-text')!, start: prefix.toString().length, end: Math.min(text.length, suffix.toString().length) });
    });
    if (anchors.length) { setFollowupId(null); setSelection({ quote: quote.slice(0, 12000), anchors }); setActive(Math.max(0, doc.blocks.findIndex((block) => block.id === anchors[0].block))); }
  }
  function addMark() {
    if (!selection) return;
    const mark: Mark = { id: uid(), anchors: selection.anchors, quote: selection.quote, color: prefs.marker, note: '', createdAt: Date.now(), due: Date.now() + 3 * 86400000 };
    update({ marks: [...live.current.marks, mark] }); setSelection(null); window.getSelection()?.removeAllRanges(); setMobileNote(mark.id);
  }
  async function ask(action: Action | 'brief' = 'ask', followup?: Thread) {
    if (busy || (action === 'ask' && !question.trim())) return;
    const current = live.current;
    const picked = selection || { quote: '', anchors: [{ block: current.blocks[active]?.id || current.blocks[0]?.id, start: 0, end: 0 }] };
    const thread: Thread = followup || { id: uid(), ...picked, turns: [], createdAt: Date.now() };
    const prompt = question.trim() || (action === 'brief' ? '为这篇文章写一份全文导读。' : ACTIONS[action]);
    const controller = new AbortController(); abort.current = controller; setBusy(action === 'brief' ? 'brief' : thread.id); setMobileNote(thread.id); setStream(''); setError(''); setSourceWarning('');
    setPendingThread(thread);
    let answer = ''; let sources = thread.sources;
    setSelection(null); setQuestion(''); setFollowupId(null);
    try {
      const result = await answerReading({ doc: current, thread, question: prompt, action, prefs, signal: controller.signal,
        onText: (text) => { answer = text; if (mounted.current) setStream(text); },
        onSources: (value, warning) => { sources = value; if (mounted.current) setSourceWarning(warning || ''); },
      });
      if (!mounted.current) return;
      if (action === 'brief') update({ brief: result.text });
      else {
        const next = { ...thread, sources, turns: [...thread.turns, { role: 'user' as const, text: prompt }, { role: 'assistant' as const, text: result.text, model: result.model, tokens: result.usage?.completionTokens }] };
        update({ threads: [...live.current.threads.filter((item) => item.id !== next.id), next] });
      }
    } catch (reason) {
      if (mounted.current) {
        if (controller.signal.aborted && answer) {
          if (action === 'brief') update({ brief: `${answer}\n\n（生成已停止）` });
          else update({ threads: [...live.current.threads.filter((item) => item.id !== thread.id), { ...thread, sources, turns: [...thread.turns, { role: 'user', text: prompt }, { role: 'assistant', text: `${answer}\n\n（生成已停止）` }] }] });
        } else if (!controller.signal.aborted) { setError(readerError(reason)); setQuestion(prompt); }
      }
    } finally { if (mounted.current) { setBusy(null); setStream(''); setPendingThread(null); } }
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const editing = (event.target as HTMLElement).closest('input,textarea,select,[contenteditable]');
      if (event.key === 'Escape') { setSelection(null); setMobileNote(null); setNotebook(false); setHelp(false); setFocus(false); return; }
      if (editing || event.altKey) return;
      if (selection && event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        event.preventDefault(); setQuestion((value) => value + event.key); composer.current?.focus(); return;
      }
      const key = event.key.toLowerCase();
      if (key === 'j') go(active + 1); else if (key === 'k' && !event.metaKey && !event.ctrlKey) go(active - 1);
      else if (key === 'enter') selectBlock(active);
      else if (key === '/' || key === 'k' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); composer.current?.focus(); }
      else if (key === 'b') void ask('brief'); else if (key === 'f') setFocus((value) => !value);
      else if (key === 'n') setNotebook((value) => !value); else if (key === 's') onBack(); else if (key === '?') setHelp(true);
      else if (key === '[' || key === ']') {
        const items = doc.threads; const index = items.findIndex((thread) => thread.id === mobileNote);
        const thread = items[Math.max(0, Math.min(items.length - 1, index + (key === ']' ? 1 : -1)))];
        if (thread) { setMobileNote(thread.id); go(doc.blocks.findIndex((block) => block.id === thread.anchors[0]?.block)); }
      }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(scrollTimer.current), []);
  function trackPosition() {
    clearTimeout(scrollTimer.current); scrollTimer.current = setTimeout(() => {
      const container = body.current; if (!container) return;
      const top = container.getBoundingClientRect().top + 100;
      const blocks = [...container.querySelectorAll('[data-reader-block]')];
      let index = 0; blocks.forEach((node, i) => { if (node.getBoundingClientRect().top < top) index = i; });
      setActive(index); const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
      const progress = atBottom ? 1 : index / Math.max(1, doc.blocks.length - 1);
      if (Math.abs(progress - live.current.progress) > 0.005) update({ progress });
    }, 350);
  }
  async function originalPdf() {
    if (pdf) { setOriginal(!original); return; }
    if (!doc.pdfFileId) { setError('此设备没有原始 PDF。请在导入设备打开，或重新选择原文件。'); return; }
    try { const blob = await downloadLibraryFile(doc.pdfFileId); await savePdf(owner, doc.id, blob); setPdf(blob); setOriginal(true); }
    catch (reason) { setError(readerError(reason)); }
  }
  const copy = (text: string) => navigator.clipboard.writeText(text).catch(() => setError('剪贴板不可用，请手动选择复制。'));
  const citations = (text: string) => [...new Set([...text.matchAll(/\[¶(\d+)\]/g)].map((match) => Number(match[1])))].filter((n) => n > 0 && n <= doc.blocks.length);
  function renderThread(thread: Thread) {
    return <section className={s.marginNote} key={thread.id} data-note-id={thread.id}>
      <header><span>¶{doc.blocks.findIndex((b) => b.id === thread.anchors[0]?.block) + 1}</span><IconButton label="删除问答" size="sm" onClick={() => update({ threads: live.current.threads.filter((item) => item.id !== thread.id) })}><Trash2 size={13} /></IconButton></header>
      {thread.quote && <blockquote>{thread.quote.slice(0, 240)}</blockquote>}
      {thread.turns.map((turn, i) => <div className={turn.role === 'user' ? s.marginQuestion : s.marginAnswer} key={i}><CoachMarkdown text={turn.text} compact />{turn.role === 'assistant' && <>
        <div className={s.citations}>{citations(turn.text).map((n) => <button type="button" title={doc.blocks[n - 1].text.slice(0, 400)} key={n} onClick={() => go(n - 1)}>¶{n}</button>)}</div>
        <small>{turn.model}{turn.tokens ? ` · ${turn.tokens} tokens` : ''}</small>
      </>}</div>)}
      {!!thread.sources?.length && <details><summary>联网来源</summary>{thread.sources.map((source, index) => <a key={index} href={/^https?:\/\//.test(source.url) ? source.url : undefined} target="_blank" rel="noreferrer">[{index + 1}] {source.title}</a>)}</details>}
      <div className={s.noteActions}><Button size="sm" variant="ghost" onClick={() => { setFollowupId(thread.id); setSelection({ quote: thread.quote, anchors: thread.anchors }); setMobileNote(thread.id); composer.current?.focus(); }}>追问</Button><IconButton label="复制问答" size="sm" onClick={() => void copy(thread.turns.map((turn) => turn.text).join('\n\n'))}><Copy size={13} /></IconButton><IconButton label="重新回答" size="sm" disabled={!!busy} onClick={() => { const turns = thread.turns.slice(0, -2); void ask('explain', { ...thread, turns }); }}><RefreshCw size={13} /></IconButton></div>
    </section>;
  }
  function renderMark(mark: Mark) {
    return <section className={s.marginNote} key={mark.id} data-note-id={mark.id}><header><span>我的笔记 · ¶{doc.blocks.findIndex((block) => block.id === mark.anchors[0]?.block) + 1}</span><IconButton label="删除高亮" size="sm" onClick={() => update({ marks: live.current.marks.filter((item) => item.id !== mark.id) })}><Trash2 size={13} /></IconButton></header>
      <blockquote>{mark.quote.slice(0, 400)}</blockquote><textarea aria-label="我的阅读笔记" defaultValue={mark.note} placeholder="写下自己的想法…" onBlur={(event) => update({ marks: live.current.marks.map((item) => item.id === mark.id ? { ...item, note: event.target.value } : item) })} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); } }} />
      <div className={s.noteActions}>{['yellow', 'green', 'blue', 'pink'].map((color) => <button type="button" aria-label={`改为${({ yellow: '黄色', green: '绿色', blue: '蓝色', pink: '粉色' })[color]}高亮`} key={color} data-marker={color} className={s.swatch} onClick={() => update({ marks: live.current.marks.map((item) => item.id === mark.id ? { ...item, color } : item) })} />)}<IconButton label="复制选区" size="sm" onClick={() => void copy(`${mark.quote}\n— ${doc.title}`)}><Copy size={13} /></IconButton></div>
    </section>;
  }
  const activeThread = doc.threads.find((thread) => thread.id === mobileNote);
  const activeMark = doc.marks.find((mark) => mark.id === mobileNote);
  return <div className={s.reader} data-focus={focus || undefined}>
    <header className={s.readerHeader}><IconButton label="返回书架" onClick={onBack}><ArrowLeft size={18} /></IconButton><button type="button" className={s.titleButton} onClick={() => setRename(true)}>{doc.title}</button><div className={s.readerTools}>
      <IconButton label={doc.favorite ? '取消收藏' : '收藏文章'} active={doc.favorite} onClick={() => update({ favorite: !doc.favorite })}><Star size={17} fill={doc.favorite ? 'currentColor' : 'none'} /></IconButton>
      <IconButton label="专注模式" active={focus} onClick={() => setFocus(!focus)}><Focus size={17} /></IconButton>
      <IconButton label="阅读笔记" active={notebook} onClick={() => setNotebook(!notebook)}><NotebookPen size={17} /></IconButton>
      <IconButton label="阅读设置" onClick={onSettings}><Settings2 size={17} /></IconButton><Button variant="ghost" size="sm" onClick={() => setHelp(true)}>?</Button>
    </div></header>
    <div className={s.readProgress} role="progressbar" aria-label="阅读进度" aria-valuenow={Math.round(doc.progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${doc.progress * 100}%` }} /></div>
    {prefs.listen && <div className={s.listen}><Button size="sm" variant="ghost" onClick={() => speech.state === 'stopped' ? speech.play(active, natural) : speech.toggle()} icon={speech.state === 'playing' ? <Pause size={15} /> : <Play size={15} />}>{speech.state === 'playing' ? '暂停朗读' : speech.state === 'paused' ? '继续朗读' : '从这里朗读'}</Button><IconButton label="停止朗读" size="sm" onClick={speech.stop}><Square size={13} /></IconButton><select aria-label="朗读速度" value={prefs.rate} onChange={(e) => onPrefs({ ...prefs, rate: Number(e.target.value) })}>{[0.8, 1, 1.2, 1.4, 1.7, 2].map((rate) => <option value={rate} key={rate}>{rate}×</option>)}</select><select aria-label="朗读声音" value={natural ? 'natural' : 'device'} onChange={(e) => setNatural(e.target.value === 'natural')}><option value="device">设备语音</option><option value="natural">自然语音（需配置）</option></select></div>}
    {error && <div className={s.error} role="alert">{error}<Button size="sm" variant="ghost" onClick={() => setError('')}>关闭</Button></div>}
    {sourceWarning && <div className={s.notice} role="status">{sourceWarning}</div>}
    {original && pdf ? <div className={s.pdfOriginal}><Button size="sm" onClick={() => setOriginal(false)}>返回文字阅读</Button><PdfViewer blob={pdf} name={doc.title} onDownload={() => saveBlob(`${doc.title}.pdf`, pdf)} /></div> : <div ref={body} className={s.readScroll} onScroll={trackPosition} onMouseUp={readSelection} onTouchEnd={() => setTimeout(readSelection, 50)}>
      <div className={s.readGrid}>
        <div className={s.articleHead}><p>{TOPICS[doc.topic]}{doc.author ? ` · ${doc.author}` : ''}</p><h1>{doc.title}</h1><p>{doc.blocks.length} 段 · 约 {Math.max(1, Math.ceil(doc.blocks.reduce((sum, block) => sum + block.text.length, 0) / 450))} 分钟{doc.sourceUrl && <a href={doc.sourceUrl} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={12} /></a>}</p>
          <Button variant="ghost" icon={<BookOpen size={18} />} disabled={!!busy} onClick={() => void ask('brief')}>{doc.brief ? '重新生成导读' : '读前导读'}<kbd>B</kbd></Button>
          <div className={s.starters}>{['这篇文章的核心论点是什么？', '哪些结论值得进一步核实？', '用一个例子解释最关键的概念。'].map((question) => <button type="button" key={question} onClick={() => { setQuestion(question); composer.current?.focus(); }}>{question}</button>)}</div>
          {(pdf || doc.pdfFileId) && <><Button variant="ghost" size="sm" onClick={() => void originalPdf()}>查看原始 PDF</Button><Button variant="ghost" size="sm" onClick={() => onReparse(doc)}>更仔细地阅读</Button></>}
          {doc.brief && <details open className={s.brief}><summary>全文导读</summary><CoachMarkdown text={doc.brief} /><div className={s.citations}>{citations(doc.brief).map((n) => <button type="button" key={n} title={doc.blocks[n - 1].text.slice(0, 400)} onClick={() => go(n - 1)}>¶{n}</button>)}</div></details>}
          {busy === 'brief' && <div aria-live="polite" className={s.brief}><CoachMarkdown text={stream || '正在通读文章…'} /></div>}
        </div>
        {doc.blocks.map((block, index) => <div className={s.paragraphRow} key={block.id} data-reader-block={block.id} data-active={active === index || undefined}>
          <div className={s.paragraph} data-kind={block.kind}>
            {prefs.numbers && <button type="button" className={s.paragraphNumber} onClick={() => selectBlock(index)} aria-label={`选择第 ${index + 1} 段`}>{index + 1}</button>}
            {block.kind === 'image' ? <figure><img src={block.src} alt={block.text} loading="lazy" referrerPolicy="no-referrer" /><figcaption>{block.text}</figcaption></figure> : <div data-reader-text={block.id} onDoubleClick={() => setActive(index)}>{block.kind === 'table' || block.kind === 'code' ? <CoachMarkdown text={block.kind === 'code' && !block.text.startsWith('```') ? `\`\`\`\n${block.text}\n\`\`\`` : block.text} /> : block.kind === 'heading' ? <h2>{block.text}</h2> : <p>{highlightSegments(block.text, block.id, doc.marks).map((segment, i) => segment.mark ? <mark key={i} data-marker={segment.mark.color} onClick={() => setMobileNote(segment.mark!.id)}>{segment.text}</mark> : <span key={i}>{segment.text}</span>)}</p>}</div>}
            {block.page && <span className={s.pageLabel}>PDF 第 {block.page} 页</span>}
            <button type="button" className={s.selectParagraph} aria-label={`为第 ${index + 1} 段提问或做笔记`} onClick={() => { selectBlock(index); composer.current?.focus(); }}><BookmarkPlus size={15} /></button>
          </div>
          <aside className={s.margin}>{doc.threads.filter((thread) => thread.anchors[0]?.block === block.id).map(renderThread)}{doc.marks.filter((mark) => mark.anchors[0]?.block === block.id && (mark.note || mark.id === mobileNote)).map(renderMark)}{busy && busy !== 'brief' && pendingThread?.anchors[0]?.block === block.id && <section className={s.marginNote}><CoachMarkdown text={stream || '正在写下批注…'} compact /></section>}</aside>
        </div>)}
        <footer className={s.articleFooter}><Button variant="ghost" icon={<Download size={15} />} onClick={() => saveBlob(`${doc.title}.md`, new Blob([exportNotes(doc)], { type: 'text/markdown;charset=utf-8' }))}>导出笔记</Button><Button variant="ghost" icon={<Image size={15} />} onClick={async () => { try { const { cover } = await readerApi<{ cover: string }>('/cover', { title: doc.title, topic: doc.topic }); update({ cover }); } catch (reason) { setError(readerError(reason)); } }}>绘制封面</Button><Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => { update({ deleted: true }); onBack(); }}>移到回收站</Button></footer>
      </div>
    </div>}
    {prefs.rail && !notebook && <nav className={s.paragraphRail} aria-label="段落导航">{doc.blocks.filter((block, index) => block.kind === 'heading' || index % Math.max(1, Math.ceil(doc.blocks.length / 30)) === 0).map((block) => <button type="button" key={block.id} title={block.text.slice(0, 180)} aria-label={`跳到第 ${doc.blocks.indexOf(block) + 1} 段`} data-active={doc.blocks.indexOf(block) === active || undefined} onClick={() => go(doc.blocks.indexOf(block))} />)}</nav>}
    <form className={s.composer} onSubmit={(event) => { event.preventDefault(); void ask('ask', followupId && activeThread ? activeThread : undefined); }}>
      {selection && <div className={s.selection}><blockquote>{selection.quote.slice(0, 200)}</blockquote><IconButton size="sm" label="取消选区" onClick={() => setSelection(null)}><X size={15} /></IconButton><div className={s.selectionActions}><Button size="sm" variant="ghost" icon={<Highlighter size={15} />} onClick={addMark}>高亮 / 笔记</Button>{(['explain', selection.quote.split(/\s+/).length <= 4 && selection.quote.length < 24 ? 'define' : 'simplify', 'check', 'connect', 'counter'] as Action[]).map((action) => <Button size="sm" variant="ghost" key={action} disabled={!!busy} onClick={() => void ask(action)}>{ACTIONS[action]}</Button>)}</div></div>}
      {busy && <div className={s.liveAnswer} aria-live="polite"><CoachMarkdown text={stream || '正在思考…'} compact /></div>}
      <div className={s.composerLine}><Textarea ref={composer} aria-label={selection ? '向选中文字提问' : '向整篇文章提问'} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={selection ? '问问选中的这一段…' : '问问这篇文章…'} rows={1} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask('ask', followupId && activeThread ? activeThread : undefined); } }} /><IconButton label={busy ? '停止回答' : '发送阅读问题'} variant="solid" disabled={!busy && !question.trim()} onClick={() => busy ? abort.current?.abort() : void ask('ask', followupId && activeThread ? activeThread : undefined)}>{busy ? <Square size={16} /> : <ArrowUp size={17} />}</IconButton></div>
      <div className={s.composerMeta}><button type="button" aria-pressed={prefs.search} onClick={() => onPrefs({ ...prefs, search: !prefs.search })}><Globe size={14} />联网{prefs.search ? '开启' : '关闭'}</button><ModelPicker models={catalog?.models || []} model={model.model || catalog?.defaultModel || null} effort={model.effort} onModel={model.setModel} onEffort={model.setEffort} emptyLabel="请在设置中连接模型" />{readerContext(doc, selection?.anchors[0]?.block).partial && <span>本次使用附近片段</span>}</div>
    </form>
    {(notebook || activeThread || activeMark) && <div className={s.notebook} data-full={notebook || undefined}><header><strong>{notebook ? '阅读笔记' : '页边批注'}</strong><IconButton label="关闭笔记" size="sm" onClick={() => { setNotebook(false); setMobileNote(null); }}><X size={16} /></IconButton></header>{notebook ? <><select aria-label="笔记筛选" value={noteFilter} onChange={(e) => setNoteFilter(e.target.value)}><option value="all">全部</option><option value="questions">问答</option><option value="highlights">高亮与笔记</option></select>{noteFilter !== 'highlights' && doc.threads.map(renderThread)}{noteFilter !== 'questions' && doc.marks.map(renderMark)}{!doc.threads.length && !doc.marks.length && <p className={s.hint}>选中一段文字，开始提问或做笔记。</p>}<Button onClick={() => saveBlob(`${doc.title}.md`, new Blob([exportNotes(doc)]))}>导出 Markdown</Button></> : <>{activeThread && renderThread(activeThread)}{activeMark && renderMark(activeMark)}</>}</div>}
    <Dialog open={help} onOpenChange={setHelp} title="阅读快捷键"><dl className={s.shortcuts}>{[['J / K', '下一段 / 上一段'], ['Enter', '选择当前段'], ['/ 或 ⌘K', '向文章提问'], ['B', '生成全文导读'], ['N', '阅读笔记'], ['F', '专注模式'], ['[ / ]', '上一条 / 下一条批注'], ['S', '返回书架'], ['Esc', '收起选区和面板']].map(([key, text]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{text}</dd></div>)}</dl></Dialog>
    <Dialog open={rename} onOpenChange={setRename} title="编辑文章信息"><form className={s.settings} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); update({ title: String(data.get('title')).trim() || doc.title, topic: String(data.get('topic')) }); setRename(false); }}><label>标题<input className={s.textInput} name="title" defaultValue={doc.title} maxLength={500} required /></label><label>主题<select name="topic" defaultValue={doc.topic}>{Object.entries(TOPICS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><Button type="submit" variant="solid">保存</Button></form></Dialog>
  </div>;
}
