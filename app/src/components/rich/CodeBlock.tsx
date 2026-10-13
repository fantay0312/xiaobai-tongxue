import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, WrapText } from 'lucide-react';
import { Button, IconButton, cx } from '../ui';
import { highlightCode, languageLabel } from './highlight';
import s from './CodeBlock.module.css';

export interface CodeBlockProps {
  code: string;
  language?: string;
  /** 流式输出中、尚未写完的代码块 */
  open?: boolean;
  /** 标题栏右侧追加的操作（复制按钮之前） */
  actions?: ReactNode;
  className?: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非安全上下文或权限被拒时退回选区复制
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** 复制按钮：点击后短暂显示“已复制”。 */
export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const onCopy = async () => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 1800);
  };
  const copied = state === 'copied';
  return (
    <Button
      variant="ghost"
      size="sm"
      className={s.copy}
      data-state={state}
      icon={copied ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.75} />}
      onClick={onCopy}
    >
      <span aria-live="polite">{copied ? '已复制' : state === 'failed' ? '复制失败' : label}</span>
    </Button>
  );
}

/** 代码块：语言标签、复制、自动换行开关，超宽时横向滚动。 */
export const CodeBlock = memo(function CodeBlock({ code, language = '', open, actions, className }: CodeBlockProps) {
  const [wrap, setWrap] = useState(false);
  const html = useMemo(() => highlightCode(code, language, !open), [code, language, open]);
  const label = languageLabel(language);
  return (
    <div className={cx(s.block, className)} data-wrap={wrap || undefined}>
      <div className={s.bar}>
        <span className={s.lang}>{label}</span>
        <div className={s.tools}>
          {actions}
          <IconButton
            size="sm"
            tip={false}
            label={wrap ? '取消自动换行' : '自动换行'}
            title={wrap ? '取消自动换行' : '自动换行'}
            aria-pressed={wrap}
            onClick={() => setWrap((value) => !value)}
          >
            <WrapText size={15} strokeWidth={1.75} />
          </IconButton>
          <CopyButton text={code} />
        </div>
      </div>
      <pre className={s.pre} tabIndex={0} aria-label={language ? `${label} 代码` : '代码'}>
        {html === null
          ? <code className={s.code}>{code}</code>
          : <code className={s.code} dangerouslySetInnerHTML={{ __html: html }} />}
      </pre>
    </div>
  );
});
