import { memo, useEffect, useRef, useState } from 'react';
import { Code2, Workflow } from 'lucide-react';
import { IconButton } from '../ui';
import { CodeBlock, CopyButton } from './CodeBlock';
import { renderMermaid } from './mermaidRender';
import s from './CodeBlock.module.css';

function readSkinKey(): string {
  if (typeof document === 'undefined') return '';
  const root = document.documentElement;
  return `${root.dataset.skin ?? ''}|${root.className}|${root.getAttribute('style') ?? ''}`;
}

/** 皮肤切换时变化的签名，用来让图表按新配色重画。 */
function useSkinKey(): string {
  const [key, setKey] = useState(readSkinKey);
  useEffect(() => {
    const observer = new MutationObserver(() => setKey(readSkinKey()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-skin', 'class', 'style'],
    });
    return () => observer.disconnect();
  }, []);
  return key;
}

type Result = { code: string; svg: string } | { code: string; failed: true };

/**
 * ```mermaid 代码块。写完之后才渲染成图；语法有误或加载失败时保持代码块。
 * 图画出来之前先显示源码，避免空白闪烁。
 */
export const MermaidBlock = memo(function MermaidBlock({ code, open }: { code: string; open?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const skinKey = useSkinKey();
  const [result, setResult] = useState<Result | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (open || !code.trim()) return undefined;
    let alive = true;
    renderMermaid(code, host.current).then(
      (svg) => {
        if (!alive) return;
        // 配色没变时拿到的是同一份 SVG，不必触发重绘
        setResult((previous) => (
          previous && previous.code === code && 'svg' in previous && previous.svg === svg ? previous : { code, svg }
        ));
      },
      () => { if (alive) setResult({ code, failed: true }); },
    );
    return () => { alive = false; };
  }, [code, open, skinKey]);

  const svg = !open && result && result.code === code && 'svg' in result ? result.svg : null;

  return (
    <div ref={host} className={s.host}>
      {svg === null || showSource ? (
        <CodeBlock
          code={code}
          language="mermaid"
          open={open}
          actions={svg !== null && (
            <IconButton size="sm" tip={false} label="查看图表" title="查看图表" onClick={() => setShowSource(false)}>
              <Workflow size={15} strokeWidth={1.75} />
            </IconButton>
          )}
        />
      ) : (
        <div className={s.block}>
          <div className={s.bar}>
            <span className={s.lang}>图表</span>
            <div className={s.tools}>
              <IconButton size="sm" tip={false} label="查看源码" title="查看源码" onClick={() => setShowSource(true)}>
                <Code2 size={15} strokeWidth={1.75} />
              </IconButton>
              <CopyButton text={code} label="复制源码" />
            </div>
          </div>
          <div
            className={s.diagram}
            role="img"
            aria-label="图表"
            tabIndex={0}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      )}
    </div>
  );
});
