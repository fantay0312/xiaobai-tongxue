/**
 * 交接暂存 —— 一段内容要带去另一个板块（交给助理、生成 AI 课）时，正文不塞进地址栏：
 * 先存到这里换一个短号，地址里只带短号，目标板块凭号取回。
 * 存在内存里，并在 sessionStorage 留一份，刷新页面后仍能取到。
 */
import type { ArtifactOrigin } from '../../lib/artifacts';

export interface Handoff {
  title: string;
  /** Markdown 正文 */
  text: string;
  origin?: ArtifactOrigin;
}

const KEY = 'xiaobai-handoff-v1';
const CAP = 6;
const MAX_TEXT = 16_000;
const memory = new Map<string, Handoff>();

function readStored(): Record<string, Handoff> {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, Handoff>) : {};
  } catch {
    return {};
  }
}

/** 存一段内容，返回取回它用的短号 */
export function stashHandoff(input: Handoff): string {
  const id = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const entry: Handoff = { title: input.title.trim().slice(0, 80) || '一段内容', text: input.text.slice(0, MAX_TEXT), ...(input.origin ? { origin: input.origin } : {}) };
  memory.set(id, entry);
  try {
    const stored = Object.entries({ ...readStored(), [id]: entry }).slice(-CAP);
    sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(stored)));
  } catch {
    /* 存不下就只留在内存里 */
  }
  return id;
}

/** 凭短号取回内容；找不到返回 null */
export function readHandoff(id: string | null | undefined): Handoff | null {
  if (!id) return null;
  const found = memory.get(id) ?? readStored()[id];
  return found && typeof found.text === 'string' && typeof found.title === 'string' ? found : null;
}
