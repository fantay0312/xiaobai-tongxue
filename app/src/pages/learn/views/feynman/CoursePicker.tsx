/**
 * 选课：待重讲 / 已教过 / 还没教 三组，每门课带掌握度。选中的课驱动上面的四站。
 */
import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Badge, Input, Segmented, type SegmentOption } from '../../../../components/ui';
import { GROUP_LABELS, type CourseGroup, type CourseRow } from './data';
import s from './feynman.module.css';

type Filter = 'all' | CourseGroup;

const GROUP_ORDER: CourseGroup[] = ['reteach', 'taught', 'fresh'];
const SEARCH_THRESHOLD = 8;

interface Props {
  rows: CourseRow[];
  selectedId: string | null;
  onSelect: (topicId: string) => void;
}

export function CoursePicker({ rows, selectedId, onSelect }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const result: Record<CourseGroup, number> = { reteach: 0, taught: 0, fresh: 0 };
    for (const row of rows) result[row.group] += 1;
    return result;
  }, [rows]);

  const options: SegmentOption<Filter>[] = [
    { value: 'all', label: `全部 ${rows.length}` },
    ...GROUP_ORDER.map((group) => ({
      value: group,
      label: `${GROUP_LABELS[group]} ${counts[group]}`,
      disabled: counts[group] === 0,
    })),
  ];

  const keyword = query.trim().toLowerCase();
  const visible = rows.filter((row) => (
    (filter === 'all' || row.group === filter)
    && (!keyword || `${row.topic.title} ${row.topic.course}`.toLowerCase().includes(keyword))
  ));
  const groups = GROUP_ORDER
    .map((group) => ({ group, items: visible.filter((row) => row.group === group) }))
    .filter((entry) => entry.items.length > 0);

  return (
    <section className={s.section} aria-labelledby="feynman-courses-title">
      <header className={s.sectionHead}>
        <div>
          <h2 id="feynman-courses-title" className={s.sectionTitle}>选一门课教给小白</h2>
          <p className={s.sectionNote}>掌握度按小白真正听懂的要点计算，久不复习会回落。</p>
        </div>
      </header>

      <div className={s.panel}>
        <div className={s.pickerTools}>
          <Segmented value={filter} onChange={setFilter} options={options} size="sm" label="按教学进度筛选" />
          {rows.length > SEARCH_THRESHOLD && (
            <Input
              size="sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索课程"
              aria-label="搜索课程"
              leading={<Search size={14} strokeWidth={1.75} />}
              wrapClassName={s.pickerSearch}
            />
          )}
        </div>

        {groups.length === 0 ? (
          <p className={s.pickerEmpty}>{rows.length === 0 ? '书架上还没有课。' : '没有符合条件的课。'}</p>
        ) : (
          <div className={s.pickerList} role="radiogroup" aria-label="课程">
            {groups.map(({ group, items }) => (
              <div key={group} className={s.pickerGroup}>
                <p className={s.groupLabel}>{GROUP_LABELS[group]} · {items.length}</p>
                {items.map((row) => {
                  const selected = row.topic.topicId === selectedId;
                  return (
                    <button
                      key={row.topic.topicId}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={s.courseRow}
                      onClick={() => onSelect(row.topic.topicId)}
                    >
                      <span className={s.courseMark} aria-hidden="true">
                        {selected && <Check size={13} strokeWidth={2.5} />}
                      </span>
                      <span className={s.courseText}>
                        <b>{row.topic.title}</b>
                        <span>{row.topic.course}</span>
                      </span>
                      <span className={s.courseMastery}>
                        <span
                          className={s.masteryTrack}
                          role="progressbar"
                          aria-label={`「${row.topic.title}」掌握度`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={row.mastery}
                          data-tone={row.group === 'reteach' ? 'warn' : row.tone === 'ok' ? 'ok' : undefined}
                        >
                          <i style={{ width: `${row.mastery}%` }} />
                        </span>
                        <span className={s.masteryValue}>{row.mastery}%</span>
                      </span>
                      <Badge tone={row.tone} className={s.courseBadge}>{row.label}</Badge>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
