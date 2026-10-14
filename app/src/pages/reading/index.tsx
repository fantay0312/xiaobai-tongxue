import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, FileUp, Link, Plus, Settings2, Upload, X } from 'lucide-react';
import { Button, Dialog, IconButton, Input, Textarea } from '../../components/ui';
import { saveBlob } from '../../lib/notebookMedia';
import { listLibrary, downloadLibraryFile, type LibraryEntry } from '../../lib/fileLibrary';
import { SideAction, SideNavItem, SidePanel, SidebarPortal } from '../learn/shell/sidebarSlot';
import type { TerminalViewProps } from '../learn/views/types';
import { ReadingSettings } from './Settings';
import { Connect } from './Connect';
import { Shelf } from './Shelf';
import { Reader } from './Reader';
import { useReaderLibrary } from './useLibrary';
import { readPrefs, writePrefs, loadPdf, savePdf } from './storage';
import { readerApi, readerError } from './api';
import { classify, parsePdf, preciseParse } from './parse';
import { exportNotes, makeDocument, reviewMark, textBlocks, type Block, type Mark, type ReaderDocument } from './types';
import s from './reading.module.css';

type ImportResult = { title?: string; author?: string; sourceUrl: string; blocks?: Block[]; text?: string; pdf?: string };
const CLASSIC_LINKS = [
  ['You and Your Research', 'https://www.cs.virginia.edu/~robins/YouAndYourResearch.html'],
  ['Cargo Cult Science', 'https://calteches.library.caltech.edu/51/2/CargoCult.htm'],
  ['Politics and the English Language', 'https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/politics-and-the-english-language/'],
  ['The Bitter Lesson', 'http://www.incompleteideas.net/IncIdeas/BitterLesson.html'],
  ['Software 2.0', 'https://karpathy.medium.com/software-2-0-a64152b37c35'],
  ['The Rise of Worse Is Better', 'https://www.dreamsongs.com/RiseOfWorseIsBetter.html'],
  ['Man-Computer Symbiosis', 'https://groups.csail.mit.edu/medg/people/psz/Licklider.html'],
  ["Do Things That Don’t Scale", 'https://paulgraham.com/ds.html'],
  ['1,000 True Fans', 'https://kk.org/thetechnium/1000-true-fans/'],
  ['How to Do Great Work', 'https://paulgraham.com/greatwork.html'],
  ['This Is Water', 'https://fs.blog/david-foster-wallace-this-is-water/'],
  ['The Tail End', 'https://waitbutwhy.com/2015/12/the-tail-end.html'],
];

export default function ReadingView({ owner }: TerminalViewProps) {
  if (!owner) return <p>请登录后使用阅读。</p>;
  return <ReadingWorkspace key={owner} owner={owner} />;
}
function ReadingWorkspace({ owner }: { owner: string }) {
  const library = useReaderLibrary(owner); const [prefs, setPrefs] = useState(() => readPrefs(owner));
  const [current, setCurrent] = useState<ReaderDocument | null>(null); const [settings, setSettings] = useState(false);
  const [add, setAdd] = useState(false); const [tab, setTab] = useState('link'); const [title, setTitle] = useState(''); const [text, setText] = useState('');
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [batchLog, setBatchLog] = useState<string[]>([]);
  const [connect, setConnect] = useState(false); const [samples, setSamples] = useState(false); const [review, setReview] = useState(false);
  const [reviewItems, setReviewItems] = useState<{ doc: ReaderDocument; mark: Mark }[]>([]); const [reviewAnswer, setReviewAnswer] = useState(false);
  const [files, setFiles] = useState<LibraryEntry[]>([]); const [reparse, setReparse] = useState<ReaderDocument | null>(null);
  const controller = useRef<AbortController | null>(null); const alive = useRef(true); const fileInput = useRef<HTMLInputElement>(null);
  const currentRef = useRef(current); currentRef.current = current;
  const documentsRef = useRef(library.documents); documentsRef.current = library.documents;
  const update = (doc: ReaderDocument) => { if (!alive.current) return; setCurrent(doc); void library.save(doc).catch((e) => setError(readerError(e))); };
  const onPrefs = (next: typeof prefs) => { setPrefs(next); writePrefs(owner, next); };
  const open = async (id: string) => {
    setBusy('正在打开文章…'); setError('');
    try { const doc = await library.open(id); if (alive.current && doc) setCurrent(doc); }
    catch (e) { if (alive.current) setError(readerError(e)); }
    finally { if (alive.current) setBusy(''); }
  };
  async function store(doc: ReaderDocument, blob?: Blob, openAfter = true) {
    if (!alive.current || controller.current?.signal.aborted) return;
    if (blob) await savePdf(owner, doc.id, blob);
    setBusy('正在整理主题…');
    try { Object.assign(doc, await classify(doc, controller.current?.signal ?? new AbortController().signal)); }
    catch { /* Reading remains available when categorization is offline. */ }
    if (!alive.current || controller.current?.signal.aborted) return;
    await library.save(doc);
    if (openAfter) setCurrent(doc);
    if (prefs.painted) {
      try { const { cover } = await readerApi<{ cover: string }>('/cover', { title: doc.title, topic: doc.topic }); const latest = await library.open(doc.id); if (!alive.current || !latest) return; const next = { ...latest, cover }; await library.save(next); if (openAfter && currentRef.current?.id === doc.id) setCurrent(next); }
      catch { if (alive.current) setError('文章已保存。绘图服务未连接，暂时使用文字封面。'); }
    }
  }
  async function importFile(file: File, fileId = '', openAfter = true, sourceUrl = '') {
    if (file.size > 80 * 1024 * 1024) throw new Error('文件超过 80 MB，请压缩或拆分后导入。');
    const signal = controller.current?.signal ?? new AbortController().signal;
    const progress = (value: string) => { if (alive.current) setBusy(value); };
    let doc: ReaderDocument;
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      const parsed = await parsePdf(file, signal, progress);
      doc = makeDocument(file.name.replace(/\.pdf$/i, ''), parsed.blocks, sourceUrl);
      if (parsed.needsOcr) {
        const precise = await preciseParse(file, file.name, fileId, signal, progress); doc.blocks = precise.blocks; doc.pdfFileId = precise.fileId;
      } else doc.pdfFileId = fileId;
      await store(doc, file, openAfter);
    } else if (/\.(txt|md|markdown|text)$/i.test(file.name)) {
      doc = makeDocument(file.name.replace(/\.[^.]+$/, ''), textBlocks(await file.text())); doc.pdfFileId = '';
      if (!doc.blocks.length) throw new Error('文件中没有可阅读的文字。');
      await store(doc, undefined, openAfter);
    } else if (/\.(html?|csv)$/i.test(file.name)) { setText(await file.text()); setTab('batch'); }
    else throw new Error('请导入 PDF、TXT、Markdown，或书签导出文件。');
  }
  async function importUrl(url: string, openAfter = true) {
    const cleanUrl = new URL(url.trim()).href;
    const existing = documentsRef.current.find((doc) => !doc.deleted && doc.sourceUrl === cleanUrl);
    if (existing) { if (openAfter) await open(existing.id); return '已在书架'; }
    setBusy('正在提取网页正文…');
    const result = await readerApi<ImportResult>('/import', { url: cleanUrl }, 'POST', controller.current?.signal);
    if (result.pdf) {
      const blob = new Blob([Uint8Array.from(atob(result.pdf), (c) => c.charCodeAt(0))], { type: 'application/pdf' });
      await importFile(new File([blob], `${result.title || new URL(cleanUrl).pathname.split('/').pop() || '文章'}.pdf`, { type: blob.type }), '', openAfter, result.sourceUrl);
    } else {
      const doc = makeDocument(result.title || title || new URL(cleanUrl).hostname, result.blocks || textBlocks(result.text || ''), result.sourceUrl);
      doc.author = result.author || ''; doc.cover = doc.blocks.find((block) => block.kind === 'image')?.src || ''; await store(doc, undefined, openAfter);
    }
    return '已收藏';
  }
  async function runImport(work: () => Promise<unknown>, close = true) {
    if (busy) return; setError(''); setBusy('准备导入…'); controller.current = new AbortController();
    try { await work(); if (alive.current && close && !controller.current.signal.aborted) { setAdd(false); setText(''); setTitle(''); } }
    catch (e) { if (alive.current && !controller.current.signal.aborted) setError(readerError(e)); }
    finally { if (alive.current) setBusy(''); }
  }
  async function batch() {
    const markup = new DOMParser().parseFromString(text, 'text/html');
    const urls = [...new Set([...Array.from(markup.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || ''), ...(text.match(/https?:\/\/[^\s<>"']+/g) || [])])].filter((url) => /^https?:\/\//.test(url)).slice(0, 100);
    if (!urls.length) throw new Error('未找到网址。可粘贴多个链接，或导入 Pocket、Instapaper、Raindrop 的书签导出文件。');
    setBatchLog([]);
    for (const [i, url] of urls.entries()) {
      if (controller.current?.signal.aborted) break;
      setBusy(`收藏中 · ${i + 1}/${urls.length}`);
      try { const result = await importUrl(url, false); setBatchLog((lines) => [...lines, `${result} · ${url}`]); }
      catch (e) { setBatchLog((lines) => [...lines, `失败 · ${url} · ${readerError(e)}`]); }
    }
  }
  async function exportAll() {
    setBusy('正在打包笔记…');
    try {
      const { default: JSZip } = await import('jszip'); const zip = new JSZip();
      for (const item of library.documents.filter((doc) => !doc.deleted)) {
        const doc = await library.open(item.id); if (doc) zip.file(`阅读/${doc.title.replace(/[\\/:*?"<>|]/g, '_')}-${doc.id.slice(0, 6)}.md`, exportNotes(doc));
      }
      saveBlob('阅读笔记.zip', await zip.generateAsync({ type: 'blob' }));
    } catch (e) { setError(readerError(e)); } finally { if (alive.current) setBusy(''); }
  }
  async function startReview() {
    setReview(true); setReviewAnswer(false); const items: typeof reviewItems = [];
    try {
      for (const item of library.documents.filter((doc) => !doc.deleted)) {
        const doc = await library.open(item.id); if (!doc) continue;
        for (const mark of doc.marks) if (!mark.retired && (mark.due || mark.createdAt + 3 * 86400000) <= Date.now()) items.push({ doc, mark });
      }
      if (alive.current) setReviewItems(items.sort((a, b) => (a.mark.due || 0) - (b.mark.due || 0)).slice(0, 5));
    } catch (e) { setError(readerError(e)); }
  }
  async function finishReview(known: boolean | 'retire') {
    const item = reviewItems[0]; if (!item) return;
    const fresh = await library.open(item.doc.id) || item.doc;
    await library.save({ ...fresh, marks: fresh.marks.map((mark) => mark.id === item.mark.id ? known === 'retire' ? { ...mark, retired: true } : reviewMark(mark, known) : mark) });
    setReviewItems((items) => items.slice(1)); setReviewAnswer(false);
  }
  useEffect(() => {
    alive.current = true;
    const pasted = (event: ClipboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,[contenteditable]') || currentRef.current) return;
      const value = event.clipboardData?.getData('text') || '';
      if (/^https?:\/\/\S+$/.test(value.trim()) || value.length >= 80) { event.preventDefault(); setText(value); setTab(/^https?:/.test(value.trim()) ? 'link' : 'text'); setAdd(true); }
    };
    window.addEventListener('paste', pasted);
    const params = new URLSearchParams(location.hash.split('?')[1] || ''); const incoming = params.get('url') || params.get('save');
    if (incoming) { setText(incoming); setAdd(true); }
    return () => { alive.current = false; controller.current?.abort(); window.removeEventListener('paste', pasted); };
  }, []);
  const scheme = prefs.theme === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'paper') : prefs.theme;
  const style = { '--reader-size': `${prefs.size}px`, '--reader-leading': ({ tight: 1.5, normal: 1.75, loose: 2 })[prefs.leading] || 1.75, '--reader-width': ({ narrow: '30rem', normal: '38rem', wide: '46rem' })[prefs.width] || '38rem' } as CSSProperties;
  const nav = <SidePanel title="阅读" hint="文章与书，留在自己的书架。" action={<SideAction icon={<Plus size={16} />} onClick={() => setAdd(true)}>添加阅读</SideAction>} footer={<span>{library.status}</span>}>
    <SideNavItem icon={<BookOpen size={16} />} label="全部阅读" active={!current} onClick={() => setCurrent(null)} /><SideNavItem label="每日回顾" onClick={() => void startReview()} /><SideNavItem label="连接 Agent" onClick={() => setConnect(true)} />
    {library.documents.filter((doc) => !doc.deleted).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30).map((doc) => <SideNavItem key={doc.id} label={doc.title} active={current?.id === doc.id} sub={`${Math.round(doc.progress * 100)}% · ${doc.author || '阅读中'}`} onClick={() => void open(doc.id)} />)}
  </SidePanel>;
  return <div className={s.root} style={style} data-paper={scheme} data-pen={prefs.pen} data-face={prefs.face} data-align={prefs.align} data-paras={prefs.paras} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void runImport(() => importFile(file)); }}>
    <SidebarPortal>{nav}</SidebarPortal>
    {!current && <div className={s.topbar}><span><BookOpen size={16} />阅读</span><span className={s.syncStatus}>{library.status}</span><IconButton label="阅读设置" onClick={() => setSettings(true)}><Settings2 size={17} /></IconButton></div>}
    {busy && <div className={s.busy} role="status">{busy}<Button variant="ghost" size="sm" onClick={() => controller.current?.abort()}>取消</Button></div>}
    {error && <div className={s.error} role="alert">{error}<IconButton label="关闭提示" size="sm" onClick={() => setError('')}><X size={14} /></IconButton></div>}
    {library.status.includes('另一台设备') && <div className={s.error} role="alert">存在云端更新冲突。<Button size="sm" disabled={!current} onClick={async () => { if (!current) return; const copy = { ...current, id: crypto.randomUUID(), title: `${current.title} · 本机副本`, revision: 0 }; await library.save(copy); const cloud = await library.open(current.id, true); if (cloud) setCurrent(cloud); }}>保留本机副本并载入云端</Button><Button size="sm" onClick={() => void exportAll()}>导出笔记</Button></div>}
    {current ? <Reader key={current.id} doc={current} owner={owner} prefs={prefs} onPrefs={onPrefs} onChange={update} onBack={() => setCurrent(null)} onSettings={() => setSettings(true)} onReparse={setReparse} /> : <Shelf documents={library.documents} onOpen={(id) => void open(id)} onAdd={() => setAdd(true)} onExport={() => void exportAll()} onReview={() => void startReview()} onConnect={() => setConnect(true)} onSample={() => setSamples(true)} onRestore={async (id) => { const doc = await library.open(id); if (doc) await library.save({ ...doc, deleted: false }); }} />}
    <ReadingSettings open={settings} onClose={() => setSettings(false)} prefs={prefs} onChange={onPrefs} /><Connect open={connect} onClose={() => setConnect(false)} />
    <Dialog open={add} onOpenChange={(value) => { if (!busy) setAdd(value); }} title="添加阅读" size="lg">
      <div className={s.importTabs}>{[['link', '网页链接'], ['text', '粘贴文字'], ['file', '上传文件'], ['batch', '批量收藏'], ['library', '资料库']].map(([key, label]) => <Button size="sm" variant={tab === key ? 'solid' : 'ghost'} key={key} onClick={() => { setTab(key); if (key === 'library') void listLibrary().then((result) => setFiles(result.entries.filter((entry) => entry.kind === 'file' && !entry.deletedAt))).catch((e) => setError(readerError(e))); }}>{label}</Button>)}</div>
      {(tab === 'link' || tab === 'text' || tab === 'batch') && <form className={s.importForm} onSubmit={(event) => { event.preventDefault(); void runImport(() => tab === 'link' ? importUrl(text) : tab === 'batch' ? batch() : store(makeDocument(title, textBlocks(text))), tab !== 'batch'); }}>
        {tab === 'text' && <Input aria-label="文章标题" placeholder="文章标题" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} />}
        {tab === 'link' ? <Input aria-label="文章网址" type="url" placeholder="粘贴文章或 PDF 的网址" value={text} onChange={(e) => setText(e.target.value)} required /> : <Textarea aria-label={tab === 'text' ? '文章正文' : '批量收藏链接'} rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={tab === 'text' ? '把你想读的正文粘贴到这里，支持 Markdown。' : '每行一个网址，或粘贴 Pocket、Instapaper、Raindrop 的导出内容。每批最多 100 篇。'} maxLength={1500000} required />}
        <Button type="submit" variant="solid" disabled={!!busy || !text.trim()} icon={<Link size={15} />}>{tab === 'batch' ? '开始收藏' : '开始阅读'}</Button>
        {tab === 'batch' && <><Button variant="ghost" icon={<Upload size={15} />} onClick={() => fileInput.current?.click()}>导入书签文件</Button><div className={s.batchLog}>{batchLog.map((line, index) => <p key={index}>{line}</p>)}</div><details><summary>浏览器书签工具</summary><p>把下方链接拖到书签栏。在任意网页点击它即可在这里打开或收藏。</p><a href={`javascript:location.href=${JSON.stringify(location.origin + location.pathname + '#/learn?view=reading&url=')}+encodeURIComponent(location.href)`}>用小白阅读</a><br /><a href={`javascript:location.href=${JSON.stringify(location.origin + location.pathname + '#/learn?view=reading&save=')}+encodeURIComponent(location.href)`}>收进小白书架</a></details></>}
      </form>}
      {tab === 'file' && <div className={s.dropzone}><FileUp size={30} /><p>拖入 PDF、TXT 或 Markdown</p><Button variant="solid" onClick={() => fileInput.current?.click()} disabled={!!busy}>选择文件</Button><p className={s.hint}>文件上限 80 MB，PDF 最多 400 页。扫描件会使用现有文档解析服务。</p></div>}
      {tab === 'library' && <div className={s.libraryList}>{files.map((file) => <Button key={file.id} variant="ghost" disabled={!!busy} onClick={() => void runImport(async () => { const blob = await downloadLibraryFile(file.id); await importFile(new File([blob], file.name, { type: file.contentType }), file.id); })}>{file.name}</Button>)}{!files.length && <p>资料库暂无文件。</p>}</div>}
      <input ref={fileInput} type="file" accept=".pdf,.txt,.md,.markdown,.text,.html,.htm,.csv" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void runImport(() => importFile(file), !/\.(html?|csv)$/i.test(file.name)); event.target.value = ''; }} />
    </Dialog>
    <Dialog open={samples} onOpenChange={setSamples} title="经典阅读" size="lg"><p className={s.hint}>三篇公版经典可直接阅读；其他文章从原始站点导入，保留来源。</p><div className={s.libraryList}>
      <Button onClick={() => void runImport(async () => { const { default: items } = await import('./samples/classics.json'); for (const item of items) { const existing = library.documents.find((d) => !d.deleted && d.sourceUrl === item.sourceUrl); if (existing) continue; const doc = { ...makeDocument(item.title, item.blocks as Block[], item.sourceUrl), author: item.author, topic: item.topic }; await library.save(doc); } setSamples(false); })}>加入三篇公版经典</Button>
      {CLASSIC_LINKS.map(([name, url]) => <Button variant="ghost" disabled={!!busy} key={url} onClick={() => void runImport(async () => { await importUrl(url); setSamples(false); })}>{name}</Button>)}<Button disabled={!!busy} variant="ghost" onClick={() => void runImport(async () => { setText(CLASSIC_LINKS.map(([, url]) => url).join('\n')); setTab('batch'); setSamples(false); setAdd(true); }, false)}>批量加入十二篇经典</Button>
    </div></Dialog>
    <Dialog open={review} onOpenChange={setReview} title="每日回顾">{reviewItems[0] ? <div className={s.reviewCard}><p>{reviewItems[0].doc.title} · 今天还剩 {reviewItems.length} 条</p><blockquote>{reviewItems[0].mark.quote}</blockquote>{reviewAnswer ? <p>{reviewItems[0].mark.note || '回到原文，再想一想这句话与你已有知识的联系。'}</p> : <Button onClick={() => setReviewAnswer(true)}>显示笔记</Button>}<div><Button onClick={() => void finishReview(false)}>再想一想</Button><Button variant="solid" onClick={() => void finishReview(true)}>已经记住</Button><Button variant="ghost" onClick={() => void finishReview('retire')}>不再复习</Button></div></div> : <p>今天没有到期的高亮。新高亮会在三天后进入回顾。</p>}</Dialog>
    <Dialog open={!!reparse} onOpenChange={(value) => !value && setReparse(null)} title="更仔细地阅读" description="使用文档解析服务重新识别扫描文字、双栏、公式与表格。已有批注的文章会另存新版本，原文与批注保留。">
      <Button variant="solid" disabled={!!busy} onClick={() => void runImport(async () => {
        if (!reparse) return; const blob = await loadPdf(owner, reparse.id) || (reparse.pdfFileId ? await downloadLibraryFile(reparse.pdfFileId) : null);
        if (!blob) throw new Error('此设备没有原始 PDF，请在导入设备重试或重新导入原文件。');
        const result = await preciseParse(blob, `${reparse.title}.pdf`, reparse.pdfFileId, controller.current!.signal, setBusy);
        const hasNotes = reparse.marks.length > 0 || reparse.threads.length > 0 || !!reparse.brief;
        const doc = hasNotes ? { ...makeDocument(`${reparse.title} · 精读版`, result.blocks, reparse.sourceUrl), pdfFileId: result.fileId } : { ...reparse, blocks: result.blocks, pdfFileId: result.fileId };
        await store(doc, blob); setReparse(null);
      }, false)}>开始重新解析</Button>
    </Dialog>
  </div>;
}
