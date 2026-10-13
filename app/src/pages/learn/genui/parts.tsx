import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import katex from 'katex';
import { CoachMarkdown } from '../../../components/coach/CoachMarkdown';
import { cx } from '../../../components/ui';
import type { LearningUiBlock } from '../../../../../server/shared/learning-ui.mjs';
import { useAnswer } from './context';
import styles from './genui.module.css';

/** 模型文本：Markdown + 公式。tight 用在表格单元格、选项这类单行位置。 */
export function Md({ text, tight, className }: { text: string; tight?: boolean; className?: string }) {
  // 样式类直接交给正文渲染器的根节点，字号、颜色才压得过它自己的默认值
  return <CoachMarkdown text={text} className={cx(styles.md, tight && styles.mdTight, className)} />;
}

/** 纯 LaTeX 字段。渲染失败时原样显示源码，不让整张卡片消失。 */
export function Tex({ latex, display }: { latex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(latex, { displayMode: Boolean(display), throwOnError: false, strict: 'ignore', trust: false });
    } catch {
      return null;
    }
  }, [latex, display]);
  if (html === null) return <code className={styles.texSource}>{latex}</code>;
  // KaTeX 的输出只含它自己生成的标记（trust 关闭，\href 等命令不生效）
  return <span className={display ? styles.texDisplay : styles.texInline} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function SourceLinks({ ids }: { ids: string[] }) {
  const { sources, onSource } = useAnswer();
  const linked = ids.flatMap((id) => {
    const index = sources.findIndex((source) => source.id === id);
    return index >= 0 ? [{ index, source: sources[index] }] : [];
  });
  if (!linked.length) return null;
  return (
    <div className={styles.sources} aria-label="这张卡片的依据">
      {linked.map(({ index, source }) => (
        <button key={source.id} type="button" className={styles.sourceChip} onClick={() => onSource(source)} title={source.title}>
          <span className={styles.sourceIndex}>{index + 1}</span>
          <span className={styles.sourceTitle}>{source.title}</span>
        </button>
      ))}
    </div>
  );
}

/** 所有卡片共用的外框：图标 + 标题 + 右侧状态，底部是来源。 */
export function BlockCard({ item, icon, meta, actions, variant = 'card', tone, children }: {
  item: LearningUiBlock;
  icon: ReactNode;
  /** 标题右侧的简短状态，如「2/5 完成」 */
  meta?: ReactNode;
  actions?: ReactNode;
  /** card 有底面；flat 只有标题和正文；tint 是带色底的提醒 */
  variant?: 'card' | 'flat' | 'tint';
  tone?: 'accent' | 'warn' | 'bad';
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className={cx(styles.block, styles[variant])} data-type={item.type} data-tone={tone} aria-labelledby={headingId}>
      <header className={styles.head}>
        <span className={styles.headIcon} aria-hidden="true">{icon}</span>
        <h3 id={headingId} className={styles.title}>{item.title}</h3>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
        {actions ? <span className={styles.headActions}>{actions}</span> : null}
      </header>
      {children}
      <SourceLinks ids={item.sourceIds} />
    </section>
  );
}

/** 横向可滚动区：内容溢出时可用键盘聚焦滚动。 */
export function ScrollX({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx(styles.scrollX, className)} tabIndex={0} role="region" aria-label={label}>
      {children}
    </div>
  );
}

/** 容器的实际宽度，图表按真实像素绘制，字不会随缩放变小。 */
export function useWidth<T extends HTMLElement>(fallback = 560) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(Math.max(240, Math.floor(node.clientWidth)));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
