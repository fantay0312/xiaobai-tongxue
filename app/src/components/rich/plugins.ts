/**
 * remark 语法树上的小修整（纯函数，不依赖 DOM）：
 * - 段落内的单个换行保留为换行（讲义和模型输出都按“一行一句”写）
 * - 表格单元格里的 <br> 变成真正的换行
 * - 正文里的 [1] [2] 引用标记变成角标
 * 另含链接与图片地址的白名单。
 */

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: object;
}

/** 这些节点里的文字保持原样，不拆引用标记。 */
const OPAQUE = new Set(['link', 'linkReference', 'inlineCode', 'code', 'math', 'inlineMath', 'definition']);

/** 前面不能紧挨标识符或括号：`a[1]`、`dp[i][1]`、`f(x)[1]` 是下标，不是引用。 */
const CITE_RUN_RE = /(?<![\w\])}])((?:\[\d{1,3}(?:[-–]\d{1,3})?\])+)/g;
const BR_RE = /^<br\s*\/?>$/i;
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);

function citation(label: string): MdNode {
  return {
    type: 'richCitation',
    data: { hName: 'sup', hProperties: { dataCite: label } },
    children: [{ type: 'text', value: label }],
  };
}

/** 把一段文字拆成 文字 / 换行 / 引用角标。没有可拆的内容时返回 null。 */
export function splitRichText(value: string): MdNode[] | null {
  if (!value.includes('\n') && !value.includes('[')) return null;
  const nodes: MdNode[] = [];
  const pushText = (text: string) => {
    text.split('\n').forEach((line, index) => {
      if (index > 0) nodes.push({ type: 'break' });
      if (line) nodes.push({ type: 'text', value: line });
    });
  };
  let cursor = 0;
  for (const match of value.matchAll(CITE_RUN_RE)) {
    const start = match.index;
    pushText(value.slice(cursor, start));
    for (const label of match[1].slice(1, -1).split('][')) nodes.push(citation(label));
    cursor = start + match[0].length;
  }
  if (cursor === 0 && !value.includes('\n')) return null;
  pushText(value.slice(cursor));
  return nodes;
}

function transform(node: MdNode): void {
  if (!node.children || OPAQUE.has(node.type)) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const parts = splitRichText(child.value);
      if (parts) next.push(...parts);
      else next.push(child);
    } else if (child.type === 'html' && typeof child.value === 'string') {
      // 原始 HTML 不执行：<br> 当换行，其余按字面显示（块级的包成段落，保持正常间距）
      if (BR_RE.test(child.value.trim())) next.push({ type: 'break' });
      else if (FLOW_PARENTS.has(node.type)) next.push({ type: 'paragraph', children: [{ type: 'text', value: child.value }] });
      else next.push({ type: 'text', value: child.value });
    } else {
      transform(child);
      next.push(child);
    }
  }
  node.children = next;
}

/** remark 插件：见文件头说明。 */
export function remarkRichText() {
  return (tree: MdNode): void => transform(tree);
}

/* ───────────────────────── 地址白名单 ───────────────────────── */

/** 链接只放行 http / https。 */
export function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** 图片只放行 https 与内嵌的 data:image。 */
export function safeImageSrc(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const src = value.trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml)[;,]/i.test(src)) return src;
  try {
    const url = new URL(src);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
