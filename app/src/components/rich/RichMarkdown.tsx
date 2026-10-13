import { Component, memo, useMemo, type ComponentProps, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform, type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { Element, ElementContent } from 'hast';
import { Check } from 'lucide-react';
import { cx } from '../ui';
import { CodeBlock } from './CodeBlock';
import { MermaidBlock } from './MermaidBlock';
import { renderMath } from './math';
import { OPEN_FENCE_FLAG, normalizeMarkdown } from './normalize';
import { remarkRichText, safeHref, safeImageSrc } from './plugins';
import s from './RichMarkdown.module.css';

export interface RichMarkdownProps {
  text: string;
  className?: string;
  /** 紧凑排版：用于卡片、反馈条等窄小位置 */
  compact?: boolean;
}

/* ───────────────────────── 语法树取值 ───────────────────────── */

function textOf(node: ElementContent | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

function classNames(node: Element | undefined): string[] {
  const value: unknown = node?.properties?.className;
  if (Array.isArray(value)) return value.map(String);
  return typeof value === 'string' ? value.split(/\s+/) : [];
}

interface CodeInfo {
  text: string;
  language: string;
  math: boolean;
  open: boolean;
}

/** 读出 <pre><code> 里的源码、语言和流式标记。 */
function readCode(pre: Element | undefined): CodeInfo | null {
  const code = pre?.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code');
  if (!code) return null;
  const classes = classNames(code);
  const meta = (code.data as { meta?: unknown } | undefined)?.meta;
  const language = classes.find((name) => name.startsWith('language-'))?.slice('language-'.length) ?? '';
  return {
    text: textOf(code).replace(/\n$/, ''),
    language: language === 'math' ? '' : language,
    math: classes.includes('math-display'),
    open: typeof meta === 'string' && meta.split(/\s+/).includes(OPEN_FENCE_FLAG),
  };
}

/* ───────────────────────── 元素映射 ───────────────────────── */

const MathInline = memo(function MathInline({ tex }: { tex: string }) {
  return <span className={s.mathInline} dangerouslySetInnerHTML={{ __html: renderMath(tex, false) }} />;
});

const MathBlock = memo(function MathBlock({ tex }: { tex: string }) {
  return <div className={s.mathBlock} dangerouslySetInnerHTML={{ __html: renderMath(tex, true) }} />;
});

function Pre({ node, children }: ComponentProps<'pre'> & ExtraProps) {
  const info = readCode(node);
  if (!info) return <pre>{children}</pre>;
  if (info.math) return <MathBlock tex={info.text} />;
  if (info.language.toLowerCase() === 'mermaid') return <MermaidBlock code={info.text} open={info.open} />;
  return <CodeBlock code={info.text} language={info.language} open={info.open} />;
}

function InlineCode({ node, children }: ComponentProps<'code'> & ExtraProps) {
  if (classNames(node).includes('math-inline')) return <MathInline tex={textOf(node)} />;
  return <code className={s.inlineCode}>{children}</code>;
}

function Link({ node, href, title, children }: ComponentProps<'a'> & ExtraProps) {
  const safe = safeHref(href);
  if (!safe) {
    // 脚注回跳等页内锚点在哈希路由下会改掉页面地址，一律不做成链接
    return node?.properties?.dataFootnoteBackref === undefined ? <>{children}</> : null;
  }
  return (
    <a className={s.link} href={safe} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Image({ src, alt, title }: ComponentProps<'img'> & ExtraProps) {
  const safe = safeImageSrc(src);
  if (!safe) return null;
  return (
    <img
      className={s.image}
      src={safe}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

function Table({ children }: ComponentProps<'table'> & ExtraProps) {
  return (
    <div className={s.tableWrap} tabIndex={0} role="region" aria-label="表格">
      <table>{children}</table>
    </div>
  );
}

/** 任务列表的勾选框：只读，自绘，不露出浏览器默认控件。 */
function TaskBox({ checked }: ComponentProps<'input'> & ExtraProps) {
  return (
    <span
      className={s.check}
      role="checkbox"
      aria-checked={Boolean(checked)}
      aria-disabled="true"
      data-checked={checked || undefined}
    >
      {checked ? <Check size={12} strokeWidth={3} /> : null}
    </span>
  );
}

/** 引用标记与脚注序号都显示成小角标。 */
function Sup({ node, children }: ComponentProps<'sup'> & ExtraProps) {
  const isCite = node?.properties?.dataCite !== undefined
    || node?.children.some((child) => child.type === 'element' && child.properties?.dataFootnoteRef !== undefined);
  return isCite ? <sup className={s.cite}>{children}</sup> : <sup>{children}</sup>;
}

/** 页面已有自己的标题层级，正文标题整体下移两级，样式按原级别走。 */
const COMPONENTS: Components = {
  h1: ({ children }) => <h3 className={s.h1}>{children}</h3>,
  h2: ({ children }) => <h4 className={s.h2}>{children}</h4>,
  h3: ({ children }) => <h5 className={s.h3}>{children}</h5>,
  h4: ({ children }) => <h6 className={s.h4}>{children}</h6>,
  h5: ({ children }) => <h6 className={s.h4}>{children}</h6>,
  h6: ({ children }) => <h6 className={s.h4}>{children}</h6>,
  pre: Pre,
  code: InlineCode,
  a: Link,
  img: Image,
  table: Table,
  input: TaskBox,
  sup: Sup,
};

const REMARK_PLUGINS: ComponentProps<typeof Markdown>['remarkPlugins'] = [
  [remarkGfm, { singleTilde: false }],
  remarkMath,
  remarkRichText,
];

const REHYPE_OPTIONS: ComponentProps<typeof Markdown>['remarkRehypeOptions'] = {
  footnoteLabel: '注释',
  footnoteBackLabel: '返回正文',
};

/** react-markdown 默认会去掉 data: 地址；图片另按白名单放行。 */
function urlTransform(url: string, key: string): string {
  if (key === 'src') return safeImageSrc(url) ?? '';
  return defaultUrlTransform(url);
}

/* ───────────────────────── 兜底 ───────────────────────── */

interface BoundaryProps { text: string; children: ReactNode }

/** 渲染器万一抛错，退回纯文本，不让整页白屏；内容变化后自动重试。 */
interface BoundaryState { failed: boolean; text: string }

class RenderBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, text: this.props.text };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): BoundaryState | null {
    return props.text === state.text ? null : { failed: false, text: props.text };
  }

  render(): ReactNode {
    if (this.state.failed) return <p className={s.plain}>{this.props.text}</p>;
    return this.props.children;
  }
}

/* ───────────────────────── 组件 ───────────────────────── */

/**
 * Markdown / 公式 / 代码 / 图表的统一渲染器。
 * 对流式输出安全：未闭合的围栏、公式、表格会先在预处理里补全。
 */
export const RichMarkdown = memo(function RichMarkdown({ text, className, compact }: RichMarkdownProps) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  const source = useMemo(() => normalizeMarkdown(raw), [raw]);
  const content = useMemo(() => (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      remarkRehypeOptions={REHYPE_OPTIONS}
      components={COMPONENTS}
      urlTransform={urlTransform}
    >
      {source}
    </Markdown>
  ), [source]);
  return (
    <div className={cx(s.markdown, className)} data-compact={compact || undefined}>
      <RenderBoundary text={raw}>{content}</RenderBoundary>
    </div>
  );
});
