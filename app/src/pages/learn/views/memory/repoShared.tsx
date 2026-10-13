/** 记忆库界面共用的小件：时间写法、出处的中文名、差异行。 */
import { ACTIVITY_LABELS } from '../../../../engine/activityLog';
import type { ActivitySource } from '../../../../engine/activityLog';
import type { RepoChange } from '../../../../engine/memoryRepo';
import { entryLine } from '../../../../engine/memoryRepo';
import r from './repo.module.css';

/** 今天 14:05 / 昨天 21:30 / 明天 09:10 / 10月12日 21:30 */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const dayGap = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const day = dayGap === 0 ? '今天' : dayGap === -1 ? '昨天' : dayGap === 1 ? '明天' : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${day} ${clock}`;
}

const OTHER_SOURCES: Record<string, string> = { user: '我写的', dream: '做梦整理', legacy: '较早的记录', classroom: '课堂记录' };
/** 出处类型的中文名：学习行为用行为日志的叫法 */
export function sourceTypeLabel(type: string): string {
  return ACTIVITY_LABELS[type as ActivitySource] ?? OTHER_SOURCES[type] ?? '其他';
}

/** 一组改动的差异：去掉的行标「−」，新写的行标「+」 */
export function DiffLines({ changes }: { changes: Pick<RepoChange, 'before' | 'after'>[] }) {
  return (
    <ul className={r.diffLines}>
      {changes.flatMap((change, index) => [
        change.before ? <li key={`${index}-`} className={r.diffLine} data-sign="-"><b aria-label="去掉">−</b><span>{entryLine(change.before).slice(2)}</span></li> : null,
        change.after ? <li key={`${index}+`} className={r.diffLine} data-sign="+"><b aria-label="新写">+</b><span>{entryLine(change.after).slice(2)}</span></li> : null,
      ])}
    </ul>
  );
}
