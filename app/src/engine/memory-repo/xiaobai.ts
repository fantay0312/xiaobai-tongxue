/**
 * 小白的记忆库 ← 课堂数据。
 * 课堂上发生的事（讲明白的要点、打过的比方、清掉和还没清掉的误区、小白记下的先生）一直在 appStore 里，这里只读不写，
 * 把它们对账成记忆库里的条目：lessons/<topicId>.md、teacher.md、MEMORY.md。条目 id 是固定的，课堂数据变了就改同一条。
 * 我亲手改过或删掉的条目，对账时不再覆盖、不再记回来。
 */
import { getTopic } from '../../data';
import { useAppStore } from '../../store/appStore';
import type { LearnEvent } from '../../types';
import { cleanText, commitRepo, isProtectedEntry, isSensitiveMemoryText, lessonPath, nowIso } from '../memoryRepo';
import type { EntrySource, RepoEntry } from '../memoryRepo';
import { demonName } from '../story';

const REPO = 'xiaobai' as const;
export const classroomReadyFor = (owner: string | null) => useAppStore.getState().historyOwner === owner;
interface Wanted { path: string; id: string; text: string; section?: string; source: EntrySource; pinned?: boolean; fileTitle?: string }

/** 课堂数据此刻应该对应哪些条目 */
function wantedEntries(): Wanted[] {
  const { events, topicStates, memory, global } = useAppStore.getState();
  const wanted: Wanted[] = [];
  const taught = new Map<string, LearnEvent[]>();
  for (const event of events) if (event.sessionId) taught.set(event.topicId, [...(taught.get(event.topicId) ?? []), event]);

  let mastered = 0;
  for (const [topicId, own] of taught) {
    const topic = getTopic(topicId);
    if (!topic) continue;
    const state = topicStates[topicId];
    if (state?.knowledgeState === '出师') mastered += 1;
    const path = lessonPath(topicId);
    const source: EntrySource = { type: 'teach', label: `给小白上课 · ${topic.title}`, topicId, ref: { kind: 'topic', id: topicId, title: topic.title } };
    const base = { path, source, fileTitle: topic.title };
    const hit = new Set<string>(state?.hitChecklist ?? []);
    for (const event of own) if (event.type === 'checklist_hit') hit.add(String(event.payload.checklistId ?? ''));
    for (const item of topic.checklist) {
      if (hit.has(item.id)) wanted.push({ ...base, id: `xb:${topicId}:pt:${item.id}`, section: 'taught', text: item.point });
    }
    for (const mc of topic.misconceptions) {
      const status = state?.mcStates?.[mc.mcId];
      if (status === '已纠正') wanted.push({ ...base, id: `xb:${topicId}:mc:${mc.mcId}`, section: 'cleared', text: `${demonName(mc)}：先生讲明白了` });
      else if (status === '已注入' || status === '被带偏') {
        wanted.push({ ...base, id: `xb:${topicId}:mc:${mc.mcId}`, section: 'open', text: `我在课上说过「${mc.triggerLine.replace(/[。？！?!\s]+$/, '').slice(0, 60)}」，还没想通` });
      }
    }
  }
  for (const quote of global.goldenAnalogies) {
    const topic = getTopic(quote.topicId);
    if (!topic) continue;
    wanted.push({
      path: lessonPath(quote.topicId), fileTitle: topic.title, id: `xb:${quote.topicId}:q:${quote.id}`, section: 'analogy', text: `「${quote.text}」`,
      source: { type: 'teach', label: `给小白上课 · ${topic.title}`, topicId: quote.topicId, ref: { kind: 'topic', id: quote.topicId, title: topic.title } },
    });
  }

  // 小白在课上记下的先生（情分不单列，它在画像里）
  for (const item of memory.items) {
    if (item.kind === 'bond' || item.muted) continue;
    const title = item.scope.topicId ? getTopic(item.scope.topicId)?.title : undefined;
    wanted.push({
      path: 'teacher.md', id: `xb:mem:${item.id}`, section: item.kind, text: item.text, pinned: item.pinned,
      source: {
        type: item.source === 'explicit' ? 'user' : 'teach',
        label: item.source === 'explicit' ? '先生亲笔' : title ? `给小白上课 · ${title}` : '给小白上课',
        ...(item.scope.topicId ? { topicId: item.scope.topicId, ref: { kind: 'topic', id: item.scope.topicId, ...(title ? { title } : {}) } } : {}),
      },
    });
  }

  const classroom: EntrySource = { type: 'teach', label: '课堂记录' };
  if (taught.size > 0) {
    wanted.push({ path: 'MEMORY.md', id: 'xb:overall', source: classroom, text: `先生教过我 ${taught.size} 门课${mastered ? `，其中 ${mastered} 门我已经出师` : ''}` });
  }
  if (memory.profile?.summary) wanted.push({ path: 'MEMORY.md', id: 'xb:profile', source: classroom, text: memory.profile.summary });
  return wanted;
}

/** 把课堂数据对账进小白的记忆库。课堂记忆暂停时不动。返回这次有没有改动。 */
export function syncXiaobaiRepo(owner: string | null): boolean {
  try {
    if (!classroomReadyFor(owner) || useAppStore.getState().memory.paused) return false;
    const wanted = wantedEntries();
    const wantedIds = new Set(wanted.map((entry) => entry.id));
    let added = 0;
    let updated = 0;
    let removed = 0;
    const message = () => `课堂记录对账：${[added ? `新增 ${added}` : '', updated ? `更新 ${updated}` : '', removed ? `移除 ${removed}` : ''].filter(Boolean).join('，')}`;
    const commit = commitRepo(owner, REPO, 'auto', message, (draft, state) => {
      const at = nowIso();
      const dropped = new Set(state.forgotten);
      for (const want of wanted) {
        const text = cleanText(want.text);
        if (text.length < 2 || isSensitiveMemoryText(text)) continue;
        if (want.fileTitle) draft.setTitle(want.path, want.fileTitle);
        const hit = draft.find(want.id);
        if (!hit) {
          if (dropped.has(`id:${want.id}`)) continue;
          const entry: RepoEntry = { id: want.id, text, source: want.source, addedAt: at, updatedAt: at, author: 'auto' };
          if (want.section) entry.section = want.section;
          if (want.pinned) entry.pinned = true;
          draft.add(want.path, entry);
          added += 1;
          continue;
        }
        // 我改过的保持原样；其余跟着课堂数据走（比如一处误区从「还没想通」变成「想通了」）
        if (hit.entry.edited) continue;
        const pinned = Boolean(want.pinned) || (!want.id.startsWith('xb:mem:') && Boolean(hit.entry.pinned));
        if (hit.entry.text === text && hit.entry.section === want.section && Boolean(hit.entry.pinned) === pinned) continue;
        const { pinned: _old, ...rest } = hit.entry;
        draft.update(want.id, { ...rest, text, ...(want.section ? { section: want.section } : {}), ...(pinned ? { pinned: true } : {}), updatedAt: at });
        updated += 1;
      }
      // 课堂数据里已经没有的自动条目（比如在成长册里删掉的）跟着拿掉；梦里写下的不在此列
      for (const [, entries] of Object.entries(state.files)) {
        for (const entry of entries) {
          if (!entry.id.startsWith('xb:') || entry.id.endsWith(':fading') || wantedIds.has(entry.id) || isProtectedEntry(entry) || entry.author !== 'auto') continue;
          draft.remove(entry.id);
          removed += 1;
        }
      }
    });
    return !!commit && added + updated + removed > 0;
  } catch {
    return false;
  }
}
