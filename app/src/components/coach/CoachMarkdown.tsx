import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { RichMarkdownProps } from '../rich/RichMarkdown';
import { retryModule } from '../../lib/moduleRecovery';
import s from './CoachMarkdown.module.css';

export type { RichMarkdownProps };
const MarkdownRenderer = lazy(() => retryModule(() => import('../rich/RichMarkdown')).then((module) => ({ default: module.RichMarkdown })));

export function RichMarkdown(props: RichMarkdownProps) {
  return <Suspense fallback={<div className={props.className} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{props.text}</div>}>
    <MarkdownRenderer {...props} />
  </Suspense>;
}

/**
 * 全站统一的 Markdown 渲染入口：GFM、LaTeX 公式、代码高亮、mermaid 图。
 * 实现在 components/rich，这里保留原有的导出名。
 */
export function CoachMarkdown(props: RichMarkdownProps) {
  return <RichMarkdown {...props} />;
}

/** 逐字落下的回复。排版与最终结果一致，落字过程中半截的公式、代码、表格也能正常显示。 */
export function CoachMarkdownMessage({ text, animate, onTick, onDone }: {
  text: string;
  animate: boolean;
  onTick?: () => void;
  onDone?: () => void;
}) {
  const [visibleLength, setVisibleLength] = useState(animate ? 0 : text.length);
  const callbacks = useRef({ onTick, onDone });
  callbacks.current = { onTick, onDone };
  useEffect(() => {
    if (!animate) { setVisibleLength(text.length); return; }
    setVisibleLength(0);
    let nextLength = 0;
    // 每拍落 3 字(≈125 字/秒):看得出在写,但一条 300 字的回复 3 秒内落完,不让老师干等
    const timer = window.setInterval(() => {
      nextLength = Math.min(text.length, nextLength + 3);
      setVisibleLength(nextLength);
      callbacks.current.onTick?.();
      if (nextLength >= text.length) {
        window.clearInterval(timer);
        callbacks.current.onDone?.();
      }
    }, 24);
    return () => window.clearInterval(timer);
  }, [animate, text]);
  const typing = animate && visibleLength < text.length;
  if (!typing) return <RichMarkdown text={text} />;
  return (
    <div className={s.typing} aria-hidden="true">
      <RichMarkdown text={text.slice(0, visibleLength)} />
    </div>
  );
}
