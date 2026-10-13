/**
 * 选课（主区版）：该回讲了 / 讲过的 / 还没讲的 三组，每门课带掌握度。
 * 只在没有侧栏挂载位（手机、侧栏收起）时出现；有侧栏时选课在 SideNav 里。
 */
import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Badge, Input, Segmented, type SegmentOption } from '../../../../components/ui';
import { GROUP_LABELS, GROUP_SHORT, type CourseGroup, type CourseRow } from './data';
import s from './feynman.module.css';

type Filter = 'all' | CourseGroup;

const GROUP_ORDER: CourseGroup[] = ['reteach', 'taught', 'fresh'];
const SEARCH_THRESHOLD = 8;

interface Props {
  rows: CourseRow[];
  selectedId: string | null;
  onSelect: (topicId: string) => void;
  /** 放进底部抽屉：不带分区标题和外框，列表跟着抽屉滚动 */
  sheet?: boolean;
}

export function CoursePicker({ rows, selectedId, onSelect, sheet = false }: Props) {
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
      label: `${GROUP_SHORT[group]} ${counts[group]}`,
      title: GROUP_LABELS[group],
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

  const body = (
    <>
        <div className={s.pickerTools}>
          <Segmented value={filter} onChange={setFilter} options={options} size={sheet ? 'md' : 'sm'} block={sheet} label="按教学进度筛选" />
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
                      data-group={row.group}
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
    </>
  );

  if (sheet) return <div className={s.pickerSheet}>{body}</div>;

  return (
    <section className={s.section} aria-labelledby="feynman-courses-title">
      <header className={s.sectionHead}>
        <div>
          <h2 id="feynman-courses-title" className={s.sectionTitle}>选一门课教给小白</h2>
          <p className={s.sectionNote}>掌握度按小白真正听懂的要点计算，久不复习会回落。</p>
        </div>
      </header>

      <div className={s.panel}>{body}</div>
    </section>
  );
}
