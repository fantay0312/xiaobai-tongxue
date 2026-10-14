import type { ReactNode } from 'react';
import { Button, Empty, Segmented } from '../../../../components/ui';
import { allEntries, fileInfo, isSensitiveMemoryText, normalizeText } from '../../../../engine/memoryRepo';
import type { RepoState } from '../../../../engine/memoryRepo';
import { MEMORY_LAYERS, memoryRetention, type MemoryLayer } from '../../../../engine/memoryRetention';
import { useActivities } from '../../../../engine/activityLog';
import { loadTutorTurnLog } from '../../../../engine/tutorMemory';
import { relDay } from '../../../../lib/relDay';
import s from './memory.module.css';
import r from './repo.module.css';

export function MemoryLayers({ owner, state, active, onLayer, onOpenFile, children }: {
  owner: string | null; state: RepoState; active: MemoryLayer | null;
  onLayer: (layer: MemoryLayer | null) => void; onOpenFile: (path: string) => void; children: ReactNode;
}) {
  const activities = useActivities(owner);
  const now = Date.now();
  const entries = allEntries(state).filter(({ path, entry }) => memoryRetention(entry, path, now).active && !['archive.md', 'ruled-out.md'].includes(path));
  const seen = new Set<string>();
  const recent = state.repo === 'xiaoyan' ? [
    ...loadTutorTurnLog(owner).map(turn => ({ text: turn.question, at: turn.at })),
    ...activities.map(activity => ({ text: activity.summary, at: activity.at })),
  ].sort((a,b) => b.at.localeCompare(a.at)).filter(item => {
    const key = normalizeText(item.text);
    if (now - Date.parse(item.at) > 86_400_000 || isSensitiveMemoryText(item.text) || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 12) : [];
  const filtered = entries.filter(({ path, entry }) => memoryRetention(entry, path, now).layer === active)
    .sort((a,b) => b.entry.updatedAt.localeCompare(a.entry.updatedAt));
  const hint = MEMORY_LAYERS.find(layer => layer.id === active)?.hint;
  return <>
    <Segmented block label="记忆保留层级" value={active ?? 'all'} onChange={value => onLayer(value === 'all' ? null : value as MemoryLayer)} options={[
      { value: 'all', label: '全部' }, ...MEMORY_LAYERS.map(layer => ({ value: layer.id, label: layer.label })),
    ]} />
    {!active && <p className={s.sliceNote}>当前问题优先。回答最多参考 3 条相关记忆；最近上下文不会变成长久偏好。</p>}
    {!active ? children : <section className={s.panel} aria-label={MEMORY_LAYERS.find(layer => layer.id === active)?.label}>
      {filtered.length === 0 && !(active === 'recent' && recent.length) && <Empty title="这里还没有记忆" description="只保留有依据、有用途的信息，不为填满列表而记录。" />}
      <ul className={r.layerList} aria-label={hint}>
        {active === 'recent' && recent.map(item => <li key={item.text}><p>{item.text}</p><small>{relDay(item.at)} · 临时上下文，不单独带入其他对话</small></li>)}
        {filtered.map(({ path, entry }) => <li key={entry.id}>
          <p>{entry.text}</p>
          <Button size="sm" variant="ghost" onClick={() => onOpenFile(path)}>查看与修改 · {fileInfo(state.repo, path, state.titles).title}</Button>
        </li>)}
      </ul>
      {active === 'short' && <p className={s.sliceNote}>到期后停止用于回答，原记录仍可在对应文件中查看。你可以把需要长期保留的条目改为长期记忆。</p>}
    </section>}
  </>;
}
