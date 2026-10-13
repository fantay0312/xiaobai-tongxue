/**
 * 把「附加的东西」变成各板块都认的文本资料（NotebookSource）：
 * 资料库文件走解析后的正文，生成的成果走登记处的可携带内容。
 */
import type { NotebookSource } from '../../engine/notebookSources';
import { artifactContent, findArtifact } from '../../lib/artifacts';
import { prepareLibrarySources } from '../../lib/fileLibrary';
import { readHandoff } from './stash';

/** 一次附加的选择：资料库文件 id 与成果登记键 */
export interface AttachSelection {
  fileIds: string[];
  artifactKeys: string[];
}

export const EMPTY_SELECTION: AttachSelection = { fileIds: [], artifactKeys: [] };

const SOURCE_CAP = 16_000;
const PREFIX = 'text:art-';

function hash(text: string): string {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return (value >>> 0).toString(36);
}

/** 成果作为对话文本来源时的 id（text:… 形式，只含字母数字和连字符） */
export function artifactSourceId(key: string): string {
  const safe = key.replace(/[^\w-]/g, '-');
  return `${PREFIX}${safe.length <= 64 ? safe : `${safe.slice(0, 40)}-${hash(key)}`}`;
}

export const isArtifactSourceId = (id: string) => id.startsWith(PREFIX);

/** 取若干成果的正文，转成文本资料；取不到的跳过并计数 */
export async function artifactSources(owner: string | null, keys: string[], cap = SOURCE_CAP): Promise<{ sources: NotebookSource[]; missing: number }> {
  const sources: NotebookSource[] = [];
  let missing = 0;
  for (const key of [...new Set(keys)]) {
    const content = await artifactContent(owner, key).catch(() => null);
    const text = content?.text.trim();
    if (!text) { missing += 1; continue; }
    const title = (content?.title || findArtifact(owner, key)?.title || '我的内容').slice(0, 120);
    sources.push({ id: artifactSourceId(key), title, content: text.slice(0, cap), kind: 'text' });
  }
  return { sources, missing };
}

/** 交接暂存里的一段内容，转成文本资料 */
export function handoffSource(id: string | null | undefined): NotebookSource | null {
  const handoff = readHandoff(id);
  if (!handoff?.text.trim() || !id) return null;
  return { id: `text:handoff-${id.replace(/[^\w-]/g, '')}`, title: handoff.title, content: handoff.text.slice(0, SOURCE_CAP), kind: 'text' };
}

/**
 * 把一次附加的选择全部读成文本资料。资料库连不上时不让整件事失败：
 * 返回已读到的部分，并在 problems 里给出可以直接显示的说明。
 */
export async function resolveAttachments(owner: string | null, selection: AttachSelection, signal?: AbortSignal): Promise<{ sources: NotebookSource[]; problems: string[] }> {
  const problems: string[] = [];
  const { sources, missing } = await artifactSources(owner, selection.artifactKeys);
  if (missing) problems.push(`有 ${missing} 份内容已经找不到了，已跳过。`);
  if (selection.fileIds.length) {
    try {
      const result = await prepareLibrarySources(selection.fileIds, signal ?? new AbortController().signal);
      sources.push(...result.sources);
    } catch (reason) {
      if (signal?.aborted) throw reason;
      problems.push('资料库文件这次没读出来，已先用其余内容继续。');
    }
  }
  return { sources, problems };
}
