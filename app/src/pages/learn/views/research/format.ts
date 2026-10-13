import type { FileMeta, SessionStatus } from '../../../../engine/research';

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} 秒`;
  return `${Math.floor(ms / 60_000)} 分 ${Math.round((ms % 60_000) / 1000)} 秒`;
}

export const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: '就绪', running: '运行中', waiting: '等你决定', paused: '已暂停', error: '出错',
};

export interface TreeNode {
  name: string;
  path: string;
  file?: FileMeta;
  children: TreeNode[];
}

/** 把扁平的路径列表拼成目录树：目录在前，同级按名字排 */
export function buildTree(files: FileMeta[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let child = node.children.find((item) => item.name === part);
      if (!child) {
        child = { name: part, path, children: [] };
        node.children.push(child);
      }
      if (index === parts.length - 1) child.file = file;
      node = child;
    });
  }
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
    node.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

export function prettyJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

/** 简单的逐行差异：只标出首尾相同之外的改动段，够看清「改了哪里」 */
export function lineDiff(before: string, after: string): { kind: 'same' | 'del' | 'add' | 'gap'; text: string }[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const rows: { kind: 'same' | 'del' | 'add' | 'gap'; text: string }[] = [];
  const context = 2;
  if (head > context) rows.push({ kind: 'gap', text: `… 前 ${head - context} 行相同` });
  a.slice(Math.max(0, head - context), head).forEach((text) => rows.push({ kind: 'same', text }));
  a.slice(head, a.length - tail).forEach((text) => rows.push({ kind: 'del', text }));
  b.slice(head, b.length - tail).forEach((text) => rows.push({ kind: 'add', text }));
  a.slice(a.length - tail, a.length - tail + context).forEach((text) => rows.push({ kind: 'same', text }));
  if (tail > context) rows.push({ kind: 'gap', text: `… 后 ${tail - context} 行相同` });
  return rows.slice(0, 160);
}

/** 解析 CSV（支持引号里的逗号与换行）；只取前 maxRows 行 */
export function parseCsv(text: string, delimiter = ',', maxRows = 200): { rows: string[][]; total: number } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let total = 0;
  const pushRow = () => {
    row.push(cell);
    cell = '';
    if (row.length > 1 || row[0] !== '') {
      total += 1;
      if (rows.length < maxRows) rows.push(row);
    }
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n') pushRow();
    else if (char !== '\r') cell += char;
  }
  if (cell || row.length) pushRow();
  return { rows, total };
}

export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
}

/** 够用的 BibTeX 解析：取条目类型、键和 name = {value} 字段 */
export function parseBib(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const pattern = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && entries.length < 300) {
    const fields: Record<string, string> = {};
    const fieldPattern = /(\w+)\s*=\s*(?:\{([\s\S]*?)\}|"([\s\S]*?)"|(\d+))\s*(?:,|$)/gm;
    let field: RegExpExecArray | null;
    while ((field = fieldPattern.exec(match[3]))) {
      fields[field[1].toLowerCase()] = (field[2] ?? field[3] ?? field[4] ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
    }
    entries.push({ type: match[1].toLowerCase(), key: match[2], fields });
  }
  return entries;
}
