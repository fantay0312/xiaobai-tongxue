/**
 * 备课桌的学法与备课夹。
 * 只存在本机(localStorage)，不进学习事件、不进掌握度、不进小白台词。
 * 跟读时未翻开的讲义段不要交给小砚；groundTruth / lookupCard 永不经过这里。
 */
const KEY = 'xiaobai-prep-desk:';

export const PREP_METHODS = [
  { id: 'read', label: '通读', hint: '五步照旧。材料随你翻，备完可以合上。' },
  { id: 'retell', label: '跟读复述', hint: '微课一段一段来。先用自己的话写一句，才打开下一段。' },
  { id: 'examples', label: '例题先行', hint: '先看题目和代码。写下判断，或点「先看讲解」，走查才打开。和错题相关的排在前面。' },
  { id: 'gaps', label: '只补不会的', hint: '在路线图上标会、模糊、不会。材料只摊开模糊、不会，以及摸底栽过的地方。' },
] as const;

export type PrepMethod = (typeof PREP_METHODS)[number]['id'];
export type PointMark = 'know' | 'fuzzy' | 'gap';

export interface PrepFolder {
  note: string;
  example: string;
  link: string;
}

export interface PrepDesk {
  method: PrepMethod;
  marks: Record<string, PointMark>;
  /** 跟读：写下第 i 段的一句，才打开第 i+1 段。 */
  retells: string[];
  exampleNotes: Record<string, string>;
  exampleRevealed: Record<string, true>;
  folder: PrepFolder;
  /** 只补不会的：全标会之后仍要翻开材料。 */
  peek: boolean;
}

export const EMPTY_DESK: PrepDesk = {
  method: 'read',
  marks: {},
  retells: [],
  exampleNotes: {},
  exampleRevealed: {},
  folder: { note: '', example: '', link: '' },
  peek: false,
};

const METHOD_SET = new Set<string>(PREP_METHODS.map((item) => item.id));
const MARK_SET = new Set<string>(['know', 'fuzzy', 'gap']);

const clip = (value: string, max: number) => value.slice(0, max);

function cleanMap(raw: unknown, max: number, per: number): Record<string, string> {
  if (raw === null || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw).slice(0, max)) {
    if (typeof value !== 'string') continue;
    const name = clip(key, 80);
    if (!name) continue;
    out[name] = clip(value, per);
  }
  return out;
}

export function normalizeDesk(raw: unknown): PrepDesk {
  const source = raw !== null && typeof raw === 'object' ? raw as Partial<PrepDesk> : {};
  const method = typeof source.method === 'string' && METHOD_SET.has(source.method)
    ? source.method as PrepMethod
    : 'read';
  const marks: Record<string, PointMark> = {};
  if (source.marks !== null && typeof source.marks === 'object') {
    for (const [key, value] of Object.entries(source.marks).slice(0, 40)) {
      if (typeof value === 'string' && MARK_SET.has(value)) marks[clip(key, 80)] = value as PointMark;
    }
  }
  const retells = Array.isArray(source.retells)
    ? source.retells.filter((item): item is string => typeof item === 'string').slice(0, 40).map((item) => clip(item, 400))
    : [];
  const revealed: Record<string, true> = {};
  if (source.exampleRevealed !== null && typeof source.exampleRevealed === 'object') {
    for (const key of Object.keys(source.exampleRevealed).slice(0, 40)) {
      if (key) revealed[clip(key, 80)] = true;
    }
  }
  const folderRaw = source.folder !== null && typeof source.folder === 'object'
    ? source.folder as Partial<PrepFolder>
    : {};
  return {
    method,
    marks,
    retells,
    exampleNotes: cleanMap(source.exampleNotes, 40, 800),
    exampleRevealed: revealed,
    folder: {
      note: typeof folderRaw.note === 'string' ? clip(folderRaw.note, 2000) : '',
      example: typeof folderRaw.example === 'string' ? clip(folderRaw.example, 800) : '',
      link: typeof folderRaw.link === 'string' ? clip(folderRaw.link, 300) : '',
    },
    peek: source.peek === true,
  };
}

export function loadDesk(topicId: string): PrepDesk {
  try {
    const raw = localStorage.getItem(KEY + topicId);
    if (!raw) return { ...EMPTY_DESK, folder: { ...EMPTY_DESK.folder }, marks: {}, exampleNotes: {}, exampleRevealed: {}, retells: [] };
    return normalizeDesk(JSON.parse(raw));
  } catch {
    return { ...EMPTY_DESK, folder: { ...EMPTY_DESK.folder }, marks: {}, exampleNotes: {}, exampleRevealed: {}, retells: [] };
  }
}

export function saveDesk(topicId: string, desk: PrepDesk): void {
  try {
    localStorage.setItem(KEY + topicId, JSON.stringify(normalizeDesk(desk)));
  } catch {
    /* 隐私模式写不进：这一课的学法只留在本次打开里 */
  }
}

export function clearAllDesks(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(KEY)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* 无 localStorage */
  }
}

/** 只允许 http(s) 成为可点的链接。 */
export function safeHttpUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export interface LectureSegment {
  text: string;
}

/** 按空行分段。单独成段的标题并进下一段，避免跟读被空标题卡住。 */
export function splitLecture(body: string): LectureSegment[] {
  const parts = body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const segments: string[] = [];
  let pending = '';
  for (const part of parts) {
    const headingOnly = /^\*\*[^*\n]+\*\*$/.test(part) || /^#{1,3}\s+\S/.test(part);
    if (headingOnly) {
      pending = pending ? `${pending}\n\n${part}` : part;
      continue;
    }
    segments.push(pending ? `${pending}\n\n${part}` : part);
    pending = '';
  }
  if (pending) segments.push(pending);
  return segments.map((text) => ({ text }));
}

const RETELL_MIN = 4;

export function visibleSegmentCount(method: PrepMethod, total: number, retells: readonly string[]): number {
  if (method !== 'retell' || total <= 0) return total;
  let count = 1;
  for (let i = 0; i < total - 1; i += 1) {
    if ((retells[i] ?? '').trim().length < RETELL_MIN) break;
    count += 1;
  }
  return count;
}

export function revealedLecture(segments: readonly LectureSegment[], count: number): string {
  return segments.slice(0, Math.max(0, count)).map((segment) => segment.text).join('\n\n');
}

export function walkthroughLocked(method: PrepMethod, note: string, revealed: boolean): boolean {
  if (method !== 'examples' || revealed) return false;
  return note.trim().length < RETELL_MIN;
}

export function orderExamples<T extends { title: string }>(
  examples: readonly T[],
  related: readonly boolean[],
  method: PrepMethod,
): { item: T; related: boolean; index: number }[] {
  const rows = examples.map((item, index) => ({ item, related: related[index] === true, index }));
  if (method === 'examples' || method === 'gaps') {
    rows.sort((a, b) => Number(b.related) - Number(a.related) || a.index - b.index);
  }
  return rows;
}

export interface GapsView {
  waiting: boolean;
  held: boolean;
  showCore: boolean;
}

export function gapsView(input: {
  method: PrepMethod;
  checklistIds: readonly string[];
  marks: Readonly<Record<string, PointMark | undefined>>;
  wrongCount: number;
  peek: boolean;
}): GapsView {
  if (input.method !== 'gaps' || input.peek) {
    return { waiting: false, held: false, showCore: true };
  }
  const anyMark = input.checklistIds.some((id) => input.marks[id] != null);
  const anyWeak = input.checklistIds.some((id) => input.marks[id] === 'fuzzy' || input.marks[id] === 'gap');
  const allKnown = input.checklistIds.length > 0
    && input.checklistIds.every((id) => input.marks[id] === 'know');
  if (!anyMark && input.wrongCount === 0) return { waiting: true, held: false, showCore: false };
  if (allKnown && input.wrongCount === 0) return { waiting: false, held: true, showCore: false };
  return { waiting: false, held: false, showCore: anyWeak || input.wrongCount > 0 };
}

/** 开讲时小白先问的要点。只看「不会」，没有再看「模糊」。导演阶梯本身不改。 */
export function focusChecklistId(
  checklist: readonly { id: string }[],
  desk: Pick<PrepDesk, 'method' | 'marks'>,
): string | null {
  if (desk.method !== 'gaps') return null;
  return checklist.find((item) => desk.marks[item.id] === 'gap')?.id
    ?? checklist.find((item) => desk.marks[item.id] === 'fuzzy')?.id
    ?? null;
}

export function openingFocusId(topic: { checklist: readonly { id: string }[] }, topicId: string): string | null {
  return focusChecklistId(topic.checklist, loadDesk(topicId));
}

export function weakPointNames(
  checklist: readonly { id: string; point: string }[],
  marks: Readonly<Record<string, PointMark | undefined>>,
): string[] {
  return checklist
    .filter((item) => marks[item.id] === 'gap' || marks[item.id] === 'fuzzy')
    .map((item) => item.point);
}
