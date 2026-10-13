/**
 * 课堂里的图示件：公式、mermaid 图、互动模拟的沙箱画框。
 * 公式与图在这里直接渲染，不依赖正文 Markdown 件，保证白板一笔一笔出现时稳定。
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { Code2, RotateCcw } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { INTERACTIVE_PALETTE, prepareInteractiveDoc } from '../../../../engine/lessonStudio';
import { useSkinStore } from '../../../../store/skinStore';
import s from './player.module.css';

/** 把当前皮肤的令牌解析成不透明的十六进制色，给 mermaid 和沙箱里的互动页用 */
export function resolveSkinPalette(): Record<string, string> {
  if (typeof document === 'undefined') return INTERACTIVE_PALETTE;
  try {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!context) return INTERACTIVE_PALETTE;
    const probe = document.createElement('span');
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const read = (name: string) => {
      probe.style.color = '';
      probe.style.color = `var(--${name})`;
      return getComputedStyle(probe).color;
    };
    // 半透明色叠在底色上取一个像素，得到实际看到的颜色
    const flatten = (color: string, under: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = under;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
    };
    const surface = flatten(read('surface'), '#ffffff');
    const palette: Record<string, string> = {};
    for (const name of Object.keys(INTERACTIVE_PALETTE)) palette[name] = flatten(read(name), surface);
    // 互动页直接铺在舞台上，底色跟舞台一致
    palette.bg = surface;
    probe.remove();
    return palette;
  } catch {
    return INTERACTIVE_PALETTE;
  }
}

/** 随皮肤、强调色变化重新解析的调色板 */
export function useSkinPalette(): Record<string, string> {
  const skin = useSkinStore((state) => state.skin);
  const accent = useSkinStore((state) => state.accent);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 皮肤一变就重算
  return useMemo(() => resolveSkinPalette(), [skin, accent]);
}

export function Formula({ tex, block = true }: { tex: string; block?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: block, throwOnError: false, strict: 'ignore' });
    } catch {
      return null;
    }
  }, [tex, block]);
  if (!html) return <code className={s.formulaRaw}>{tex}</code>;
  return <span className={block ? s.formulaBlock : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}

let mermaidSeq = 0;

/** 渲染一段 mermaid；语法不对时退回显示源码，不让整幕崩掉 */
export async function renderMermaid(code: string, palette: Record<string, string>): Promise<string | null> {
  const { default: mermaid } = await import('mermaid');
  // 用图内指令带主题，不动全局配置（正文 Markdown 也在用 mermaid）
  const init = `%%{init: ${JSON.stringify({
    theme: 'base',
    themeVariables: {
      background: palette.surface, primaryColor: palette['accent-soft'], primaryTextColor: palette.text,
      primaryBorderColor: palette.accent, lineColor: palette['text-3'], secondaryColor: palette.inset,
      tertiaryColor: palette.surface, textColor: palette.text, mainBkg: palette['accent-soft'],
      nodeBorder: palette.accent, clusterBkg: palette.inset, clusterBorder: palette['border-2'],
      edgeLabelBackground: palette.surface, fontSize: '15px', fontFamily: 'inherit',
    },
  })}}%%\n`;
  const source = /^\s*%%\{/.test(code) ? code : init + code;
  try {
    if (!(await mermaid.parse(source, { suppressErrors: true }))) return null;
    mermaidSeq += 1;
    const id = `lesson-mmd-${mermaidSeq}`;
    const { svg } = await mermaid.render(id, source);
    document.getElementById(`d${id}`)?.remove();
    return svg;
  } catch {
    return null;
  }
}

export function MermaidFigure({ code }: { code: string }) {
  const palette = useSkinPalette();
  const [state, setState] = useState<{ code: string; svg: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    renderMermaid(code, palette).then((svg) => {
      if (alive) setState({ code, svg });
    });
    return () => { alive = false; };
  }, [code, palette]);
  if (!state || state.code !== code) return <div className={s.figureLoading} aria-hidden="true" />;
  if (!state.svg) return <pre className={s.figureCode}>{code}</pre>;
  return <div className={s.mermaid} role="img" aria-label="结构图" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}

/** 互动模拟的隔离宿主页：网关给它单独下发内容安全策略（可内联脚本、不可联网） */
const SANDBOX_URL = `${import.meta.env.BASE_URL}sandbox.html`;

/**
 * 互动模拟：在 sandbox="allow-scripts"（无同源）的 iframe 里打开隔离宿主页，
 * 等它报到后用 postMessage 把自包含的 HTML 送进去执行。
 * 不用 srcDoc —— srcdoc 页面会继承本站的内容安全策略，内联脚本在线上跑不起来。
 */
export function InteractiveFrame({ html, title }: { html: string; title: string }) {
  const palette = useSkinPalette();
  const [round, setRound] = useState(0);
  const [showCode, setShowCode] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const doc = useMemo(() => prepareInteractiveDoc(html, palette), [html, palette]);
  // 文档一变（换幕、换皮肤）就重挂 iframe：宿主页只接收一次内容
  const docKey = useMemo(() => {
    let value = 0;
    for (let i = 0; i < doc.length; i += 1) value = (Math.imul(value, 31) + doc.charCodeAt(i)) | 0;
    return value;
  }, [doc]);
  const codeId = useId();

  useEffect(() => {
    if (showCode) return;
    const onMessage = (event: MessageEvent) => {
      const target = frameRef.current?.contentWindow;
      if (!target || event.source !== target) return;
      if ((event.data as { type?: unknown } | null)?.type !== 'xiaobai-sandbox-ready') return;
      // 沙箱页是不透明源，目标源只能写 '*'
      target.postMessage({ type: 'xiaobai-sandbox', html: doc }, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [doc, showCode]);

  return (
    <div className={s.frameWrap}>
      <div className={s.frameBar}>
        <span className={s.frameDots} aria-hidden="true"><i /><i /><i /></span>
        <span className={s.frameTitle}>{title}</span>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} />} disabled={showCode} onClick={() => setRound((value) => value + 1)}>重置</Button>
        <Button size="sm" variant={showCode ? 'soft' : 'ghost'} icon={<Code2 size={14} strokeWidth={1.75} />} aria-expanded={showCode} aria-controls={codeId} onClick={() => setShowCode((value) => !value)}>
          {showCode ? '看运行效果' : '看代码'}
        </Button>
      </div>
      {showCode
        ? <pre id={codeId} className={s.frameCode} tabIndex={0}>{html}</pre>
        : <iframe key={`${round}:${docKey}`} ref={frameRef} className={s.frame} title={title} src={SANDBOX_URL} sandbox="allow-scripts" referrerPolicy="no-referrer" />}
    </div>
  );
}
