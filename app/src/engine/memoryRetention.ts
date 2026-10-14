import type { RepoEntry } from './memoryRepo';

export type MemoryLayer = 'recent' | 'short' | 'long';
const DAY = 86_400_000;
export const MEMORY_LAYERS: { id: MemoryLayer; label: string; hint: string }[] = [
  { id: 'recent', label: '最近记忆', hint: '最近 24 小时的上下文，不作为长期偏好。' },
  { id: 'short', label: '短期记忆', hint: '当前学习中的疑点和临时目标，7 天未再提及就淡出回答。' },
  { id: 'long', label: '长期记忆', hint: '你明确要求记住的内容，或跨天反复确认的信息；只在相关时使用。' },
];

/** 老记录按证据分层，不因升级删除原文。用户可以显式调整保留层级。 */
export function memoryRetention(entry: RepoEntry, path: string, now = Date.now()) {
  const updated = Date.parse(entry.updatedAt) || 0;
  const confirmedAcrossDays = (entry.seen ?? 1) >= 3 && updated - Date.parse(entry.addedAt) >= DAY;
  const layer: MemoryLayer = entry.retention ?? (
    entry.author === 'user' || entry.pinned || entry.edited || confirmedAcrossDays ? 'long'
      : entry.section === 'studied' || path === 'materials.md' ? 'recent' : 'short'
  );
  const expiresAt = layer === 'long' ? null : updated + (layer === 'recent' ? DAY : 7 * DAY);
  return { layer, expiresAt, active: expiresAt === null || expiresAt > now };
}

/** 字词重合只用来筛选相关性，不把近似句当作事实相同。 */
export function memoryRelevance(text: string, question: string): number {
  const clean = (value: string) => value.toLowerCase().replace(/请问|请|什么|怎么|如何|一下|帮我|这个|那个|我想|解释|关于/g, '').replace(/[\s\p{P}\p{S}]/gu, '');
  const terms = (value: string) => {
    const raw = clean(value);
    const set = new Set(raw.match(/[a-z0-9]{2,}/g) ?? []);
    const chinese = raw.match(/[\p{Script=Han}]+/gu) ?? [];
    for (const word of chinese) for (let i = 0; i < word.length - 1; i++) set.add(word.slice(i, i + 2));
    return set;
  };
  const left = terms(text), right = terms(question);
  if (!right.size) return 0;
  let count = 0;
  for (const term of right) if (left.has(term)) count++;
  return count / right.size;
}
