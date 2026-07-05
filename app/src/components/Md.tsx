/**
 * 极简 Markdown 渲染(FROZEN 公共件)。
 * 支持:``` 代码块 / `行内代码` / **加粗** / 段落与换行。数据层内容仅用到这些语法。
 */
import { Fragment, type ReactNode } from 'react';

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach((p, i) => {
    const key = `${keyBase}-${i}`;
    if (p.startsWith('**') && p.endsWith('**')) out.push(<strong key={key}>{p.slice(2, -2)}</strong>);
    else if (p.startsWith('`') && p.endsWith('`')) out.push(<code key={key}>{p.slice(1, -1)}</code>);
    else if (p) out.push(<Fragment key={key}>{p}</Fragment>);
  });
  return out;
}

export function Md({ text, className }: { text: string; className?: string }) {
  const blocks = text.split(/```(?:\w*)\n?/);
  return (
    <div className={className}>
      {blocks.map((block, bi) =>
        bi % 2 === 1 ? (
          <pre key={bi}><code>{block.replace(/\n$/, '')}</code></pre>
        ) : (
          block.split(/\n{2,}/).filter((s) => s.trim()).map((para, pi) => (
            <p key={`${bi}-${pi}`}>
              {para.split('\n').map((line, li, arr) => (
                <Fragment key={li}>
                  {inline(line, `${bi}-${pi}-${li}`)}
                  {li < arr.length - 1 && <br />}
                </Fragment>
              ))}
            </p>
          ))
        ),
      )}
    </div>
  );
}
