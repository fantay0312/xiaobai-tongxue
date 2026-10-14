/**
 * PDF 阅读器：用 pdf.js 自己渲染，不依赖浏览器的 PDF 插件。
 * 连续纵向滚动，页面进入视野附近才画到 canvas，离远了释放。pdf.js 按需加载，不进主包。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ChevronDown, ChevronUp, ExternalLink, Minus, Plus } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { useObjectUrl } from './useObjectUrl';
import { StageLoading, ViewBar, ViewerError } from './viewers';
import s from './preview.module.css';

interface Size { w: number; h: number }
type LoadState = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; doc: PDFDocumentProxy; base: Size };

/** PDF 以 pt 计，CSS 以 px 计：这个比例下的缩放才是「100%」 */
const CSS_UNITS = 96 / 72;
const MIN_SCALE = 0.3;
const MAX_SCALE = 5;
/** 适应宽度时页面最宽到这里，大屏上不至于一页占满整个屏幕 */
const FIT_MAX_WIDTH = 1080;
/** 单页画布像素上限，放大很多时降低清晰度而不是撑爆内存 */
const MAX_PIXELS = 14_000_000;

const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
/** 扫描件常用的 JBIG2 / JPEG 2000 解码器，随应用一起打包 */
const wasmSrc: Record<string, string> = {
  'openjpeg.wasm': new URL('pdfjs-dist/wasm/openjpeg.wasm', import.meta.url).toString(),
  'jbig2.wasm': new URL('pdfjs-dist/wasm/jbig2.wasm', import.meta.url).toString(),
};
const assetBase = `${import.meta.env.BASE_URL}pdfjs/`;

let workerScript: Promise<string> | null = null;
/**
 * 取回 worker 脚本并包成 Blob URL 再启动。
 * 静态服务未必给 .mjs 回脚本类型，浏览器会拒绝直接把它当 Worker 加载；Blob 的类型由我们指定。
 */
function loadWorkerScript(): Promise<string> {
  // 开发服务会往脚本里注入站内地址的 import，在 Blob 里解析不了，而它的脚本类型本来就正确，直接加载
  if (import.meta.env.DEV) return Promise.resolve(workerSrc);
  if (!workerScript) {
    const pending = fetch(workerSrc).then(async (response) => {
      const text = response.ok ? await response.text() : '';
      if (!text || /^\s*</.test(text)) throw new Error('worker-unavailable');
      return URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    });
    pending.catch(() => { if (workerScript === pending) workerScript = null; });
    workerScript = pending;
  }
  return workerScript;
}

/** 字符映射、标准字体、解码器都由主线程取来交给 worker（Blob worker 里没有可用的相对地址） */
class AssetDataFactory {
  private readonly base: Record<string, string | null | undefined>;
  constructor({ cMapUrl, standardFontDataUrl }: { cMapUrl?: string | null; standardFontDataUrl?: string | null }) {
    this.base = { cMapUrl, standardFontDataUrl };
  }
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = kind === 'wasmUrl' ? wasmSrc[filename] : this.base[kind] ? `${this.base[kind]}${filename}` : undefined;
    if (!url) throw new Error(`Unable to load ${kind} data: ${filename}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load ${kind} data at: ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

/** Shared by the reader's text extraction; uses the same bundled worker and fonts. */
export async function openReaderPdf(blob: Blob) {
  const [pdfjs, script, buffer] = await Promise.all([import('pdfjs-dist'), loadWorkerScript(), blob.arrayBuffer()]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const thread = new Worker(script, { type: 'module' });
  const worker = new pdfjs.PDFWorker({ port: thread as unknown as null });
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), worker, cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${assetBase}standard_fonts/`, BinaryDataFactory: AssetDataFactory, useWorkerFetch: false });
  const destroy = () => { void task.destroy().catch(() => {}).finally(() => { worker.destroy(); thread.terminate(); }); };
  try { return { doc: await task.promise, destroy }; } catch (error) { destroy(); throw error; }
}

function describeError(reason: unknown): string {
  const name = (reason as { name?: string } | null)?.name;
  if (name === 'PasswordException') return '这份 PDF 设了打开密码，暂不支持在线预览，可下载后用本机软件打开。';
  if (name === 'InvalidPDFException') return '文件已损坏，或不是有效的 PDF。';
  if (reason instanceof Error && reason.message === 'worker-unavailable') return 'PDF 渲染组件没有加载成功，请检查网络后重试。';
  return 'PDF 没有读取成功，可以重试或下载原件。';
}

function PdfPage({ doc, number, scale, size, active, onSize }: {
  doc: PDFDocumentProxy; number: number; scale: number; size: Size; active: boolean; onSize: (page: number, size: Size) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef(onSize);
  sizeRef.current = onSize;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !active) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void (async () => {
      try {
        const page = await doc.getPage(number);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        sizeRef.current(number, { w: viewport.width / scale, h: viewport.height / scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height)));
        // 先画到游离画布，完成后再换上，缩放时不闪白
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        await task.promise;
        if (cancelled) { canvas.width = 0; canvas.height = 0; return; }
        const previous = host.firstElementChild as HTMLCanvasElement | null;
        host.replaceChildren(canvas);
        if (previous) { previous.width = 0; previous.height = 0; }
        setFailed(false);
      } catch (reason) {
        if (!cancelled && (reason as { name?: string } | null)?.name !== 'RenderingCancelledException') setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      try { task?.cancel(); } catch { /* 文档已销毁 */ }
    };
  }, [doc, number, scale, active]);

  // 离视野远了就释放画布，长文档不占满内存
  useEffect(() => {
    if (active) return;
    const host = hostRef.current;
    const canvas = host?.firstElementChild as HTMLCanvasElement | null | undefined;
    if (host && canvas) { canvas.width = 0; canvas.height = 0; host.replaceChildren(); }
  }, [active]);

  return (
    <div className={s.pdfPage} data-page={number} style={{ width: Math.round(size.w * scale), height: Math.round(size.h * scale) }}>
      <div ref={hostRef} className={s.pdfCanvas} />
      {failed && <span className={s.pdfPageError}>第 {number} 页没有渲染成功</span>}
    </div>
  );
}

export function PdfViewer({ blob, name, onDownload }: { blob: Blob; name: string; onDownload: () => void }) {
  const url = useObjectUrl(blob);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(0);
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [sizes, setSizes] = useState<Record<number, Size>>({});
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  const [current, setCurrent] = useState(1);
  const [near, setNear] = useState<Set<number>>(() => new Set([1, 2]));
  const [draft, setDraft] = useState<string | null>(null);

  // 打开文档；卸载或换文件时取消渲染、销毁文档并结束 worker
  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    setState({ phase: 'loading' }); setSizes({}); setCurrent(1); setNear(new Set([1, 2]));
    void (async () => {
      try {
        const [pdfjs, script, buffer] = await Promise.all([import('pdfjs-dist'), loadWorkerScript(), blob.arrayBuffer()]);
        if (cancelled) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        const thread = new Worker(script, { type: 'module' });
        // 类型声明把 port 写成了 null；实际接受一个 Worker
        const worker = new pdfjs.PDFWorker({ port: thread as unknown as null });
        const task = pdfjs.getDocument({
          data: new Uint8Array(buffer),
          worker,
          cMapUrl: `${assetBase}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assetBase}standard_fonts/`,
          BinaryDataFactory: AssetDataFactory,
          useWorkerFetch: false,
        });
        dispose = () => { void task.destroy().catch(() => {}).finally(() => { worker.destroy(); thread.terminate(); }); };
        thread.addEventListener('error', () => { if (!cancelled) setState({ phase: 'error', message: describeError(new Error('worker-unavailable')) }); });
        const doc = await task.promise;
        const first = await doc.getPage(1);
        if (cancelled) return;
        const viewport = first.getViewport({ scale: 1 });
        setState({ phase: 'ready', doc, base: { w: viewport.width, h: viewport.height } });
      } catch (reason) {
        if (!cancelled) setState({ phase: 'error', message: describeError(reason) });
      }
    })();
    return () => { cancelled = true; dispose?.(); };
  }, [blob, attempt]);

  // 滚动区宽度：适应宽度时据此算缩放
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let timer = 0;
    setWidth(root.clientWidth);
    // 拖动窗口时等尺寸稳定再重排，免得每一帧都重画
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setWidth(root.clientWidth), 140);
    });
    observer.observe(root);
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, []);

  const ready = state.phase === 'ready' ? state : null;
  // 手机上滚动区两侧只留 8px，页面尽量贴近屏宽
  const gutter = width <= 640 ? 16 : 32;
  const fitScale = ready && width ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(width - gutter, FIT_MAX_WIDTH) / ready.base.w)) : 0;
  const scale = zoom === 'fit' ? fitScale : zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const laidOut = !!ready && scale > 0;
  const total = ready?.doc.numPages ?? 0;

  // 文档就绪、滚动区刚显示出来时立刻量一次，不等尺寸观察回调
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (ready && root && root.clientWidth) setWidth(root.clientWidth);
  }, [ready]);

  // 只画视野附近的页
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !laidOut) return;
    const observer = new IntersectionObserver((entries) => {
      setNear((previous) => {
        const next = new Set(previous);
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting) next.add(page); else next.delete(page);
        }
        return next;
      });
    }, { root, rootMargin: '120% 0px' });
    root.querySelectorAll('[data-page]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [ready?.doc, laidOut]);

  // 缩放或窗口变宽后，停在原来读到的位置
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (root && laidOut) root.scrollTop = ratioRef.current * root.scrollHeight;
  }, [scale, laidOut]);

  // 双指缩放：手势进行中只用变换跟手，松手后才按新比例重画，画布不会每一帧都重排
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    // x：双指中点在页面里的横向位置；at：它在滚动区里的横向位置。松手后据此把中点留在原处
    let pinch: { start: number; factor: number; x: number; at: number } | null = null;
    const spread = (touches: TouchList) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const sheet = () => root.firstElementChild as HTMLElement | null;
    const onStart = (event: TouchEvent) => {
      const pages = sheet();
      if (event.touches.length !== 2 || !pages || !scaleRef.current) { pinch = null; return; }
      const box = pages.getBoundingClientRect();
      const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      pages.style.transformOrigin = `${midX - box.left}px ${midY - box.top}px`;
      pinch = { start: Math.max(1, spread(event.touches)), factor: 1, x: midX - box.left, at: midX - root.getBoundingClientRect().left };
    };
    const onMove = (event: TouchEvent) => {
      const pages = sheet();
      if (!pinch || event.touches.length !== 2 || !pages) return;
      event.preventDefault();
      const current = scaleRef.current;
      pinch.factor = Math.min(MAX_SCALE / current, Math.max(MIN_SCALE / current, spread(event.touches) / pinch.start));
      pages.style.transform = `scale(${pinch.factor})`;
    };
    const onEnd = () => {
      if (!pinch) return;
      const { factor, x, at } = pinch;
      pinch = null;
      const pages = sheet();
      if (pages) { pages.style.transform = ''; pages.style.transformOrigin = ''; }
      if (Math.abs(factor - 1) <= 0.03) return;
      setZoom(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaleRef.current * factor)));
      // 重排之后再对横向位置（纵向由上面的阅读位置恢复负责）
      requestAnimationFrame(() => { root.scrollLeft = Math.max(0, (sheet()?.offsetLeft ?? 0) + x * factor - at); });
    };
    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', onEnd);
    root.addEventListener('touchcancel', onEnd);
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', onEnd);
      root.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const frameRef = useRef(0);
  const onScroll = () => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const root = scrollRef.current;
      if (!root) return;
      ratioRef.current = root.scrollTop / Math.max(1, root.scrollHeight);
      const probe = root.scrollTop + root.clientHeight * 0.35;
      // 与上面观察器同样的范围：视野上下各多留一屏多
      const from = root.scrollTop - root.clientHeight * 1.2;
      const to = root.scrollTop + root.clientHeight * 2.2;
      const pages = root.querySelectorAll<HTMLElement>('[data-page]');
      const around = new Set<number>();
      let page = 1;
      for (let index = 0; index < pages.length; index += 1) {
        const start = pages[index].offsetTop;
        if (start > to) break;
        if (start <= probe) page = index + 1;
        if (start + pages[index].offsetHeight >= from) around.add(index + 1);
      }
      setCurrent(page);
      // 快速拖动滚动条时观察器回调可能滞后，这里按滚动位置直接补上
      setNear((previous) => (previous.size === around.size && [...around].every((value) => previous.has(value)) ? previous : around));
    });
  };
  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  const goTo = (page: number) => {
    const root = scrollRef.current;
    const target = Math.min(total, Math.max(1, Math.round(page) || 1));
    const element = root?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (!root || !element) return;
    root.scrollTo({ top: Math.max(0, element.offsetTop - 12) });
    // 页码立即更新，不等滚动事件
    setCurrent(target);
    ratioRef.current = root.scrollTop / Math.max(1, root.scrollHeight);
  };
  const step = (factor: number) => setZoom(Math.min(MAX_SCALE, Math.max(MIN_SCALE, (scale || CSS_UNITS) * factor)));
  const rememberSize = (page: number, size: Size) => {
    if (!ready) return;
    setSizes((previous) => {
      const known = previous[page] ?? ready.base;
      return Math.abs(known.w - size.w) < 0.5 && Math.abs(known.h - size.h) < 0.5 ? previous : { ...previous, [page]: size };
    });
  };

  return (
    <>
      {ready && (
        <ViewBar
          controls
          note={(
            <>
              <IconButton label="上一页" size="sm" disabled={current <= 1} onClick={() => goTo(current - 1)}><ChevronUp size={15} /></IconButton>
              <input
                className={s.pageInput}
                inputMode="numeric"
                aria-label={`页码，共 ${total} 页`}
                value={draft ?? String(current)}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 5))}
                onBlur={() => setDraft(null)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  if (draft) goTo(Number(draft));
                  setDraft(null);
                  event.currentTarget.blur();
                }}
              />
              <span className={s.pageTotal}>/ {total}</span>
              <IconButton label="下一页" size="sm" disabled={current >= total} onClick={() => goTo(current + 1)}><ChevronDown size={15} /></IconButton>
            </>
          )}
        >
          <IconButton label="缩小" size="sm" disabled={scale <= MIN_SCALE} onClick={() => step(1 / 1.2)}><Minus size={15} /></IconButton>
          <span className={s.zoomText}>{Math.round((scale / CSS_UNITS) * 100)}%</span>
          <IconButton label="放大" size="sm" disabled={scale >= MAX_SCALE} onClick={() => step(1.2)}><Plus size={15} /></IconButton>
          <Button variant={zoom === 'fit' ? 'soft' : 'ghost'} size="sm" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>适应宽度</Button>
          {url && (
            <Button asChild variant="ghost" size="sm" className={s.barLink} icon={<ExternalLink size={14} />} aria-label="新标签页打开">
              <a href={url} target="_blank" rel="noreferrer"><span>新标签页打开</span></a>
            </Button>
          )}
        </ViewBar>
      )}
      {state.phase === 'loading' && <StageLoading label="正在打开 PDF…" />}
      {state.phase === 'error' && (
        <ViewerError title="PDF 预览失败" description={state.message} onRetry={() => setAttempt((value) => value + 1)} onDownload={onDownload} />
      )}
      <div ref={scrollRef} className={s.pdfScroll} hidden={!ready} tabIndex={0} role="document" aria-label={`${name}，共 ${total} 页`} onScroll={onScroll}>
        {ready && laidOut && (
          <div className={s.pdfPages}>
            {Array.from({ length: total }, (_, index) => (
              <PdfPage
                key={index + 1}
                doc={ready.doc}
                number={index + 1}
                scale={scale}
                size={sizes[index + 1] ?? ready.base}
                active={near.has(index + 1)}
                onSize={rememberSize}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
