export type Block = { id: string; kind: 'paragraph' | 'heading' | 'code' | 'table' | 'image'; text: string; src?: string; page?: number };
export type Anchor = { block: string; start: number; end: number };
export type Mark = { id: string; anchors: Anchor[]; quote: string; color: string; note: string; createdAt: number; due?: number; level?: number; retired?: boolean };
export type Turn = { role: 'user' | 'assistant'; text: string; model?: string; tokens?: number };
export type Thread = { id: string; anchors: Anchor[]; quote: string; turns: Turn[]; sources?: { title: string; url: string; text: string }[]; createdAt: number };
export type ReaderDocument = {
  id: string; title: string; author: string; sourceUrl: string; blocks: Block[]; marks: Mark[]; threads: Thread[];
  topic: string; tags: string[]; createdAt: number; updatedAt: number; progress: number; favorite: boolean; deleted: boolean;
  brief: string; cover: string; pdfFileId: string; agent?: boolean; revision?: number; localDirty?: boolean; wordCount?: number;
};
export type ReaderSummary = Omit<ReaderDocument, 'blocks' | 'marks' | 'threads'>;
export type ReaderPrefs = {
  theme: 'auto' | 'paper' | 'sepia' | 'snow' | 'night' | 'ink'; pen: string; marker: string;
  face: 'serif' | 'book' | 'sans' | 'legible'; size: number; leading: string; width: string; align: string; paras: string;
  length: string; search: boolean; numbers: boolean; rail: boolean; listen: boolean; rate: number; painted: boolean;
};
export const DEFAULT_PREFS: ReaderPrefs = { theme: 'auto', pen: 'vermilion', marker: 'yellow', face: 'serif', size: 20, leading: 'normal', width: 'normal', align: 'left', paras: 'spaced', length: 'normal', search: true, numbers: false, rail: true, listen: false, rate: 1, painted: false };
export const TOPICS: Record<string, string> = { unsorted: '未分类', philosophy: '哲学', mind: '心理', science: '科学', ai: '人工智能', programming: '编程', tech: '科技', data: '数据', design: '设计', product: '产品', writing: '写作', learning: '学习', history: '历史', culture: '文化', politics: '政治', economics: '经济', money: '理财', business: '商业', startups: '创业', work: '工作', health: '健康', living: '生活', climate: '气候', security: '安全', infra: '基础设施' };
export const uid = () => crypto.randomUUID();
export function makeDocument(title: string, blocks: Block[], sourceUrl = ''): ReaderDocument {
  return { id: uid(), title: title.trim() || '未命名文章', author: '', sourceUrl, blocks, marks: [], threads: [], topic: 'unsorted', tags: [], createdAt: Date.now(), updatedAt: Date.now(), progress: 0, favorite: false, deleted: false, brief: '', cover: '', pdfFileId: '', wordCount: blocks.reduce((sum, block) => sum + block.text.length, 0) };
}
export function textBlocks(text: string): Block[] {
  const sections = text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  return sections.filter(Boolean).map((part, index) => ({ id: `p${index + 1}`, kind: /^#{1,6} /.test(part) ? 'heading' : /^```/.test(part) ? 'code' : /^\|/.test(part) ? 'table' : 'paragraph', text: part.replace(/^#{1,6} /, '') }));
}
export function plainText(doc: ReaderDocument) { return doc.blocks.map((block, index) => `[¶${index + 1}] ${block.text}`).join('\n\n'); }
export function exportNotes(doc: ReaderDocument) {
  const lines = [`---`, `title: ${JSON.stringify(doc.title)}`, `source: ${JSON.stringify(doc.sourceUrl)}`, `tags: ${JSON.stringify(doc.tags)}`, '---', '', `# ${doc.title}`, ''];
  if (doc.brief) lines.push('## 全文导读', doc.brief, '');
  const entries = [
    ...doc.marks.map((mark) => ({ anchors: mark.anchors, text: `> ${mark.quote.replace(/\n/g, '\n> ')}\n\n${mark.note}` })),
    ...doc.threads.map((thread) => ({ anchors: thread.anchors, text: `> ${thread.quote.replace(/\n/g, '\n> ')}\n\n${thread.turns.map((turn) => `**${turn.role === 'user' ? '问' : '答'}**：${turn.text}`).join('\n\n')}\n\n${thread.sources?.map((source, i) => `[${i + 1}]: ${source.url} ${JSON.stringify(source.title)}`).join('\n') || ''}` })),
  ].sort((a, b) => doc.blocks.findIndex((x) => x.id === a.anchors[0]?.block) - doc.blocks.findIndex((x) => x.id === b.anchors[0]?.block));
  for (const entry of entries) lines.push(`## ¶${doc.blocks.findIndex((x) => x.id === entry.anchors[0]?.block) + 1}`, entry.text, '');
  return lines.join('\n');
}
export function reviewMark(mark: Mark, known: boolean, now = Date.now()): Mark {
  const steps = [3, 7, 16, 35, 75, 160]; const level = known ? Math.min(5, (mark.level ?? -1) + 1) : 0;
  return { ...mark, level, due: now + (known ? steps[level] : 1) * 86400000 };
}
/** Clamps and splits overlapping marks into non-overlapping render segments. */
export function highlightSegments(text: string, block: string, marks: Mark[]) {
  const anchors = marks.flatMap((mark) => mark.anchors.filter((anchor) => anchor.block === block).map((anchor) => ({ ...anchor, mark })));
  const cuts = [...new Set([0, text.length, ...anchors.flatMap((a) => [Math.max(0, Math.min(text.length, a.start)), Math.max(0, Math.min(text.length, a.end))])])].sort((a, b) => a - b);
  return cuts.slice(0, -1).map((start, index) => ({ text: text.slice(start, cuts[index + 1]), mark: anchors.find((a) => a.start <= start && a.end >= cuts[index + 1])?.mark }));
}
