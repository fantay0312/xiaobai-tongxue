/** 文件类型判定：资料库列表与预览器共用。先看扩展名，再看 MIME。 */

export type FileKind =
  | 'pdf' | 'image' | 'video' | 'audio'
  | 'markdown' | 'text' | 'code' | 'json' | 'csv'
  | 'docx' | 'pptx'
  /** 旧版或暂不能在线渲染的办公文档（doc / ppt / xls…） */
  | 'office'
  | 'archive' | 'unknown';

/** 图标着色分组 */
export type FileTone = 'pdf' | 'doc' | 'slide' | 'sheet' | 'image' | 'video' | 'audio' | 'code' | 'text' | 'archive' | 'other';

const groups: [FileKind, string[]][] = [
  ['pdf', ['pdf']],
  ['image', ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico']],
  ['video', ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']],
  ['audio', ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus', 'weba']],
  ['markdown', ['md', 'markdown', 'mdx']],
  ['csv', ['csv', 'tsv']],
  ['json', ['json', 'jsonl', 'ipynb']],
  ['text', ['txt', 'log', 'text', 'srt', 'vtt']],
  ['code', [
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt',
    'sql', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'yaml', 'yml', 'toml', 'ini', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'vue', 'lua', 'r', 'tex',
  ]],
  ['docx', ['docx']],
  ['pptx', ['pptx']],
  ['office', ['doc', 'ppt', 'xls', 'xlsx', 'rtf', 'odt', 'odp', 'ods', 'wps', 'key', 'pages', 'numbers']],
  ['archive', ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2']],
];
const byExtension = new Map<string, FileKind>(groups.flatMap(([kind, list]) => list.map((ext) => [ext, kind] as [string, FileKind])));

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileKind(name: string, mimeType?: string): FileKind {
  const known = byExtension.get(extensionOf(name));
  if (known) return known;
  const mime = (mimeType ?? '').toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'text/markdown') return 'markdown';
  if (mime === 'text/csv') return 'csv';
  if (mime === 'application/json') return 'json';
  if (mime.startsWith('text/')) return 'text';
  return 'unknown';
}

export function fileTone(name: string, mimeType?: string): FileTone {
  const kind = fileKind(name, mimeType);
  const ext = extensionOf(name);
  if (kind === 'pdf') return 'pdf';
  if (kind === 'docx') return 'doc';
  if (kind === 'pptx') return 'slide';
  if (kind === 'csv') return 'sheet';
  if (kind === 'office') return /^(ppt|odp|key)$/.test(ext) ? 'slide' : /^(xls|xlsx|ods|numbers)$/.test(ext) ? 'sheet' : 'doc';
  if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'archive') return kind;
  if (kind === 'code' || kind === 'json') return 'code';
  if (kind === 'markdown' || kind === 'text') return 'text';
  return 'other';
}

const kindNames: Record<FileKind, string> = {
  pdf: 'PDF 文档', image: '图片', video: '视频', audio: '音频', markdown: 'Markdown', text: '文本', code: '代码', json: 'JSON',
  csv: '表格数据', docx: 'Word 文档', pptx: '演示文稿', office: '办公文档', archive: '压缩包', unknown: '文件',
};
/** 例：「PDF 文档」「PNG 图片」 */
export function kindLabel(name: string, mimeType?: string): string {
  const kind = fileKind(name, mimeType);
  const ext = extensionOf(name).toUpperCase();
  if (!ext || kind === 'pdf' || kind === 'markdown' || kind === 'json') return kindNames[kind];
  return `${ext} ${kindNames[kind]}`;
}

const mimeByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', opus: 'audio/ogg', weba: 'audio/webm',
};
/** 服务端可能回 application/octet-stream；浏览器内嵌查看器需要准确的 MIME。 */
export function withAccurateType(blob: Blob, name: string, mimeType?: string): Blob {
  const wanted = mimeByExtension[extensionOf(name)] ?? (mimeType && mimeType !== 'application/octet-stream' ? mimeType : '');
  return wanted && blob.type !== wanted ? blob.slice(0, blob.size, wanted) : blob;
}

const languageAlias: Record<string, string> = {
  mjs: 'javascript', cjs: 'javascript', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', rb: 'ruby', rs: 'rust',
  h: 'c', cc: 'cpp', hpp: 'cpp', cs: 'csharp', kt: 'kotlin', sh: 'bash', zsh: 'bash', bat: 'dos', ps1: 'powershell', yml: 'yaml',
  htm: 'xml', html: 'xml', vue: 'xml', tex: 'latex', jsonl: 'json', ipynb: 'json', tsv: 'csv', txt: 'text', log: 'text', srt: 'text', vtt: 'text',
};
export function codeLanguage(name: string): string {
  const ext = extensionOf(name);
  return languageAlias[ext] ?? (ext || 'text');
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** 秒 → 01:23 或 1:02:03 */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  return hours ? `${hours}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}` : `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
