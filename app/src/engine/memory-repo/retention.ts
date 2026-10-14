import type { MemoryItem } from '../../types';
import { allEntries, loadRepo, type RepoEntry } from '../memoryRepo';
import { memoryRetention } from '../memoryRetention';

/** 课堂仍走原有防泄漏话术，只增加保留期限过滤，绝不直接注入用户记忆原文。 */
export function retainedClassroomMemories(owner: string | null, items: MemoryItem[]): MemoryItem[] {
  const projected = new Map(allEntries(loadRepo(owner, 'xiaobai')).map(item => [item.entry.id, item]));
  return items.filter(item => {
    const located = projected.get(`xb:mem:${item.id}`);
    if (located?.path === 'archive.md') return false;
    const projection = located?.entry;
    const entry: RepoEntry = { ...(projection ?? {
      id: item.id, text: item.text, source: {type:item.source,label:'课堂'},
      author: item.source === 'explicit' ? 'user' : 'auto',
      addedAt:item.createdAt,updatedAt:item.lastSeenAt || item.updatedAt,pinned:item.pinned,
    }), addedAt:item.createdAt, updatedAt:projection?.retention ? projection.updatedAt : item.lastSeenAt || item.updatedAt, seen:item.seenCount };
    const retention=memoryRetention(entry,'teacher.md');
    return retention.active && retention.layer !== 'recent';
  });
}
