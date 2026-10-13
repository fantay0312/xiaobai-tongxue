/**
 * 各类型的预览渲染器。全部从已下载的 Blob 渲染；对象 URL 在卸载时回收。
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Download, FileX, ImageOff, Minus, Plus, RotateCw, ScanText, TriangleAlert } from 'lucide-react';
import { Badge, Button, Empty, IconButton, Segmented, Shimmer, Spinner } from '../ui';
import { CoachMarkdown } from '../coach/CoachMarkdown';
import { codeLanguage, extensionOf, type FileKind } from './fileKind';
import { useObjectUrl } from './useObjectUrl';
import s from './preview.module.css';

export function StageLoading({ label = '正在加载预览…' }: { label?: string }) {
  return (
    <div className={s.stageCenter} role="status">
      <Spinner size={18} />
      <Shimmer>{label}</Shimmer>
    </div>
  );
}

export function ViewerError({ title, description, onRetry, onDownload }: {
  title: string; description?: ReactNode; onRetry?: () => void; onDownload?: () => void;
}) {
  return (
    <div className={s.stageCenter}>
      <Empty
        icon={<TriangleAlert size={22} strokeWidth={1.75} />}
        title={title}
        description={description}
        action={(
          <>
            {onRetry && <Button variant="solid" icon={<RotateCw size={15} />} onClick={onRetry}>重试</Button>}
            {onDownload && <Button variant="outline" icon={<Download size={15} />} onClick={onDownload}>下载原件</Button>}
          </>
        )}
      />
    </div>
  );
}

/** 预览区顶部的细工具条：左侧说明（或控件，此时传 controls），右侧控件。 */
export function ViewBar({ note, controls, children }: { note?: ReactNode; controls?: boolean; children?: ReactNode }) {
  return (
    <div className={s.viewBar}>
      <div className={controls ? s.viewControls : s.viewNote}>{typeof note === 'string' ? <span>{note}</span> : note}</div>
      {children && <div className={s.viewTools}>{children}</div>}
    </div>
  );
}

/* ── 图片：适应 / 100% / 缩放 / 拖动 ── */
interface ImageViewState { fit: boolean; scale: number; x: number; y: number }
const clampScale = (value: number) => Math.min(8, Math.max(0.05, value));

export function ImageView({ blob, name, onDownload }: { blob: Blob; name: string; onDownload: () => void }) {
  const url = useObjectUrl(blob);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<ImageViewState>({ fit: true, scale: 1, x: 0, y: 0 });
  const [failed, setFailed] = useState(false);

  const fitScale = natural && box.w && box.h ? Math.min(1, (box.w - 48) / natural.w, (box.h - 48) / natural.h) : 1;
  const scale = view.fit ? Math.max(0.01, fitScale) : view.scale;
  const fitRef = useRef(scale);
  fitRef.current = scale;

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const measure = () => setBox({ w: element.clientWidth, h: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // 滚轮缩放需要阻止页面滚动，必须注册为非被动监听
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView((current) => ({ fit: false, scale: clampScale((current.fit ? fitRef.current : current.scale) * factor), x: current.fit ? 0 : current.x, y: current.fit ? 0 : current.y }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', onWheel); };
  }, [url]);

  const zoom = (factor: number) => setView((current) => ({ fit: false, scale: clampScale((current.fit ? scale : current.scale) * factor), x: current.fit ? 0 : current.x, y: current.fit ? 0 : current.y }));
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!dx && !dy) return;
    dragRef.current = { id: drag.id, x: event.clientX, y: event.clientY };
    setView((current) => ({ fit: false, scale: current.fit ? scale : current.scale, x: (current.fit ? 0 : current.x) + dx, y: (current.fit ? 0 : current.y) + dy }));
  };
  const endDrag = () => { dragRef.current = null; };

  if (!url) return <StageLoading />;
  if (failed) {
    return (
      <div className={s.stageCenter}>
        <Empty
          icon={<ImageOff size={22} strokeWidth={1.75} />}
          title="这张图片无法显示"
          description="浏览器不支持这种图片编码，可以下载后用本机软件查看。"
          action={<Button variant="outline" icon={<Download size={15} />} onClick={onDownload}>下载原件</Button>}
        />
      </div>
    );
  }
  return (
    <>
      <ViewBar note={natural ? `${natural.w} × ${natural.h} 像素 · 拖动平移，滚轮缩放` : '正在读取图片…'}>
        {/* 自由缩放时两项都不选中 */}
        <Segmented<'fit' | 'actual' | 'free'>
          size="sm"
          label="图片显示比例"
          value={view.fit ? 'fit' : view.scale === 1 ? 'actual' : 'free'}
          onChange={(next) => setView({ fit: next === 'fit', scale: 1, x: 0, y: 0 })}
          options={[{ value: 'fit', label: '适应' }, { value: 'actual', label: '100%' }]}
        />
        <IconButton label="缩小" size="sm" onClick={() => zoom(1 / 1.25)}><Minus size={15} /></IconButton>
        <span className={s.zoomText}>{Math.round(scale * 100)}%</span>
        <IconButton label="放大" size="sm" onClick={() => zoom(1.25)}><Plus size={15} /></IconButton>
      </ViewBar>
      <div
        ref={boxRef}
        className={s.imageStage}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setView((current) => ({ fit: !current.fit, scale: 1, x: 0, y: 0 }))}
      >
        <img
          src={url}
          alt={name}
          draggable={false}
          className={s.image}
          style={{
            ...(natural ? { width: natural.w, height: natural.h } : { visibility: 'hidden' as const }),
            transform: `translate(-50%, -50%) translate(${view.fit ? 0 : view.x}px, ${view.fit ? 0 : view.y}px) scale(${scale})`,
          }}
          onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth || 1, h: event.currentTarget.naturalHeight || 1 })}
          onError={() => setFailed(true)}
        />
      </div>
    </>
  );
}

/* ── 文本类：Markdown / 纯文本 / 代码 / JSON / CSV ── */
const TEXT_LIMIT = 400_000;
const CSV_ROWS = 200;

async function readText(blob: Blob): Promise<{ text: string; truncated: boolean }> {
  const truncated = blob.size > TEXT_LIMIT;
  const bytes = new Uint8Array(await blob.slice(0, TEXT_LIMIT).arrayBuffer());
  // 截断可能切在多字节字符中间：最多回退 3 个字节再按 UTF-8 解
  for (let trim = 0; trim <= (truncated ? 3 : 0); trim += 1) {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.length - trim)), truncated };
    } catch { /* 试下一种 */ }
  }
  try {
    return { text: new TextDecoder('gb18030').decode(bytes), truncated };
  } catch {
    return { text: new TextDecoder().decode(bytes), truncated };
  }
}

/** 包成围栏代码块；正文里的围栏行加零宽字符，避免提前闭合。 */
const fenced = (code: string, language: string) => `\`\`\`${language}\n${code.replace(/^(\s*)```/gm, '$1​```')}\n\`\`\``;

function parseCsv(source: string, delimiter: string): string[][] {
  const text = source.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = false;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((cells) => cells.length > 1 || cells[0] !== '');
}

function csvDelimiter(name: string, text: string): string {
  if (extensionOf(name) === 'tsv') return '\t';
  const head = text.slice(0, text.indexOf('\n') === -1 ? 2000 : text.indexOf('\n'));
  const count = (char: string) => head.split(char).length - 1;
  return [',', ';', '\t'].reduce((best, char) => (count(char) > count(best) ? char : best), ',');
}

function CsvTable({ rows }: { rows: string[][] }) {
  const [header, ...body] = rows;
  const shown = body.slice(0, CSV_ROWS);
  const columns = Math.max(header.length, ...shown.map((cells) => cells.length));
  const indexes = Array.from({ length: columns }, (_, index) => index);
  return (
    <div className={s.tableScroll} tabIndex={0} role="region" aria-label="表格预览">
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col" className={s.rowNo}>#</th>
            {indexes.map((index) => <th key={index} scope="col">{header[index] ?? ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              <td className={s.rowNo}>{rowIndex + 1}</td>
              {indexes.map((index) => <td key={index}>{cells[index] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TextView({ blob, kind, name, onDownload }: { blob: Blob; kind: FileKind; name: string; onDownload: () => void }) {
  const [state, setState] = useState<{ text: string; truncated: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<'rich' | 'source'>('rich');
  useEffect(() => {
    let cancelled = false;
    setState(null); setFailed(false);
    readText(blob).then((next) => { if (!cancelled) setState(next); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [blob]);

  const csvRows = useMemo(() => (state && kind === 'csv' ? parseCsv(state.text, csvDelimiter(name, state.text)) : []), [state, kind, name]);
  const source = useMemo(() => {
    if (!state) return '';
    let code = state.text;
    if (kind === 'json' && !state.truncated && extensionOf(name) === 'json') {
      try { code = JSON.stringify(JSON.parse(code), null, 2); } catch { /* 保持原样 */ }
    }
    return fenced(code, kind === 'markdown' ? 'markdown' : codeLanguage(name));
  }, [state, kind, name]);

  if (failed) return <ViewerError title="读取文本失败" description="文件内容无法解码。" onDownload={onDownload} />;
  if (!state) return <StageLoading label="正在读取文本…" />;
  if (!state.text.trim()) {
    return <div className={s.stageCenter}><Empty icon={<FileX size={22} strokeWidth={1.75} />} title="文件是空的" description="这份文件里没有可显示的文字。" /></div>;
  }

  const switchable = kind === 'markdown' || (kind === 'csv' && csvRows.length > 0);
  const rich = switchable && mode === 'rich';
  const lines = state.text.split('\n').length;
  const note = kind === 'csv' && rich
    ? `${Math.max(0, csvRows.length - 1)} 行数据${csvRows.length - 1 > CSV_ROWS ? `，显示前 ${CSV_ROWS} 行` : ''}${state.truncated ? '（文件较大，只读取了开头部分）' : ''}`
    : `${lines} 行${state.truncated ? ' · 文件较大，只显示开头部分，完整内容请下载' : ''}`;
  return (
    <>
      <ViewBar note={note}>
        {switchable && (
          <Segmented
            size="sm"
            label="显示方式"
            value={mode}
            onChange={setMode}
            options={[{ value: 'rich', label: kind === 'csv' ? '表格' : '预览' }, { value: 'source', label: '源码' }]}
          />
        )}
      </ViewBar>
      {rich && kind === 'csv'
        ? <div className={s.sheetStage}><CsvTable rows={csvRows} /></div>
        : (
          <div className={s.docStage}>
            <article className={rich ? s.reading : s.codePane}>
              <CoachMarkdown text={rich ? state.text : source} />
            </article>
          </div>
        )}
    </>
  );
}

/* ── DOCX：docx-preview 按需加载 ── */
export function DocxView({ blob, onDownload }: { blob: Blob; onDownload: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    setPhase('loading');
    void (async () => {
      try {
        const { renderAsync } = await import('docx-preview');
        // 先渲染到游离节点，完成后再挂上，避免重复渲染叠在一起
        const sheet = document.createElement('div');
        await renderAsync(blob, sheet, undefined, { className: 'docx', inWrapper: true, ignoreHeight: true, breakPages: true, useBase64URL: true });
        if (cancelled) return;
        host.replaceChildren(sheet);
        setPhase('ready');
        // 窄屏时整体缩小到一页宽，不出现横向滚动
        const wrapper = sheet.querySelector<HTMLElement>('.docx-wrapper');
        const page = sheet.querySelector<HTMLElement>('section.docx');
        const pageWidth = page?.offsetWidth ?? 0;
        if (wrapper && pageWidth) {
          const fit = () => { wrapper.style.zoom = String(Math.min(1, Math.max(0.3, (host.clientWidth - 32) / pageWidth))); };
          fit();
          observer = new ResizeObserver(fit);
          observer.observe(host);
        }
      } catch {
        if (!cancelled) setPhase('error');
      }
    })();
    return () => { cancelled = true; observer?.disconnect(); host.replaceChildren(); };
  }, [blob, attempt]);

  return (
    <>
      {phase === 'ready' && <ViewBar note="版式为近似还原，字体与分页可能和 Word 中略有差别" />}
      {phase === 'loading' && <StageLoading label="正在排版文档…" />}
      {phase === 'error' && <ViewerError title="这份文档无法在线排版" description="文件可能已损坏或带有密码保护。" onRetry={() => setAttempt((value) => value + 1)} onDownload={onDownload} />}
      <div ref={hostRef} className={s.docxStage} hidden={phase !== 'ready'} />
    </>
  );
}

/* ── PPTX：只提取每页文字 ── */
interface SlideBlock { text: string; level: number }
interface SlideText { title: string; blocks: SlideBlock[]; tables: string[][][]; images: number }

const tags = (root: Document | Element, name: string) => Array.from(root.getElementsByTagName(name));

function paragraphText(paragraph: Element): string {
  let text = '';
  for (const node of Array.from(paragraph.childNodes)) {
    if (node.nodeName === 'a:br') text += '\n';
    else if (node.nodeName === 'a:r' || node.nodeName === 'a:fld') text += tags(node as Element, 'a:t').map((item) => item.textContent ?? '').join('');
  }
  return text.trim();
}

function readSlide(doc: Document): SlideText {
  const titleParts: string[] = [];
  const blocks: SlideBlock[] = [];
  for (const shape of tags(doc, 'p:sp')) {
    const type = tags(shape, 'p:ph')[0]?.getAttribute('type') ?? '';
    if (type === 'sldNum' || type === 'dt' || type === 'ftr') continue;
    for (const paragraph of tags(shape, 'a:p')) {
      const text = paragraphText(paragraph);
      if (!text) continue;
      if (type === 'title' || type === 'ctrTitle') titleParts.push(text);
      else blocks.push({ text, level: Math.min(4, Number(tags(paragraph, 'a:pPr')[0]?.getAttribute('lvl') ?? 0) || 0) });
    }
  }
  const tables = tags(doc, 'a:tbl').map((table) => tags(table, 'a:tr').map((row) => tags(row, 'a:tc').map((cell) => tags(cell, 'a:p').map(paragraphText).filter(Boolean).join(' '))));
  return { title: titleParts.join(' '), blocks, tables, images: tags(doc, 'p:pic').length };
}

async function readPptx(blob: Blob): Promise<SlideText[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(blob);
  const parser = new DOMParser();
  const xml = async (path: string) => {
    const file = zip.file(path);
    return file ? parser.parseFromString(await file.async('string'), 'application/xml') : null;
  };
  // 页序以 presentation.xml 为准；读不到时退回按文件名编号
  let order: string[] = [];
  const [presentation, relations] = await Promise.all([xml('ppt/presentation.xml'), xml('ppt/_rels/presentation.xml.rels')]);
  if (presentation && relations) {
    const targets = new Map(tags(relations, 'Relationship').map((item) => [item.getAttribute('Id') ?? '', item.getAttribute('Target') ?? ''] as [string, string]));
    order = tags(presentation, 'p:sldId')
      .map((item) => targets.get(item.getAttribute('r:id') ?? '') ?? '')
      .filter(Boolean)
      .map((target) => (target.startsWith('/') ? target.slice(1) : `ppt/${target.replace(/^\.\//, '')}`))
      .filter((path) => zip.file(path));
  }
  if (!order.length) {
    const number = (path: string) => Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
    order = Object.keys(zip.files).filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path)).sort((a, b) => number(a) - number(b));
  }
  if (!order.length) throw new Error('no-slides');
  const slides: SlideText[] = [];
  for (const path of order) {
    const doc = await xml(path);
    if (doc) slides.push(readSlide(doc));
  }
  return slides;
}

export function PptxView({ blob, onDownload }: { blob: Blob; onDownload: () => void }) {
  const [slides, setSlides] = useState<SlideText[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSlides(null); setFailed(false);
    readPptx(blob).then((next) => { if (!cancelled) setSlides(next); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [blob, attempt]);

  if (failed) return <ViewerError title="读不出这份演示文稿" description="文件可能已损坏，或不是标准的 PPTX 格式。" onRetry={() => setAttempt((value) => value + 1)} onDownload={onDownload} />;
  if (!slides) return <StageLoading label="正在读取幻灯片文字…" />;
  return (
    <>
      <ViewBar note={<><Badge tone="accent">文字预览</Badge><span>共 {slides.length} 页 · 只提取每页文字，不还原版式、图片和动画</span></>}>
        <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={onDownload}>下载看原版</Button>
      </ViewBar>
      <div className={s.docStage}>
        <ol className={s.slides}>
          {slides.map((slide, index) => (
            <li key={index} className={s.slide}>
              <span className={s.slideNo}>{index + 1}</span>
              <div className={s.slideBody}>
                <h3>{slide.title || `第 ${index + 1} 页`}</h3>
                {slide.blocks.map((block, blockIndex) => (
                  <p key={blockIndex} style={{ paddingLeft: block.level * 18 }} data-level={block.level || undefined}>{block.text}</p>
                ))}
                {slide.tables.map((table, tableIndex) => (
                  <div key={tableIndex} className={s.tableScroll}>
                    <table className={s.table}>
                      <tbody>
                        {table.map((cells, rowIndex) => (
                          <tr key={rowIndex}>{cells.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {!slide.blocks.length && !slide.tables.length && <p className={s.slideMuted}>这一页没有可提取的文字。</p>}
                {slide.images > 0 && <p className={s.slideMuted}>含 {slide.images} 张图片，文字预览中不显示。</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

/* ── 解析文本：读取资料解析后的正文 ── */
const PARSED_LIMIT = 150_000;

export function ParsedTextView({ load }: { load: () => Promise<string> }) {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setText(null); setError('');
    loadRef.current()
      .then((next) => { if (!cancelled) setText(next); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '读取解析文本失败。'); });
    return () => { cancelled = true; };
  }, [attempt]);

  if (error) return <ViewerError title="读取解析文本失败" description={error} onRetry={() => setAttempt((value) => value + 1)} />;
  if (text === null) return <StageLoading label="正在读取解析文本…" />;
  if (!text.trim()) {
    return <div className={s.stageCenter}><Empty icon={<ScanText size={22} strokeWidth={1.75} />} title="没有解析出文字" description="这份文件可能是扫描件或纯图片。" /></div>;
  }
  const clipped = text.length > PARSED_LIMIT;
  return (
    <>
      <ViewBar note={`解析后的正文，约 ${text.length.toLocaleString('zh-CN')} 字${clipped ? ' · 内容较长，只显示开头部分' : ''}`} />
      <div className={s.docStage}>
        <article className={s.reading}>
          <CoachMarkdown text={clipped ? text.slice(0, PARSED_LIMIT) : text} />
        </article>
      </div>
    </>
  );
}
