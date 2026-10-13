import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, Check, Columns3, Ghost, History, Lightbulb, Table2, TriangleAlert, X } from 'lucide-react';
import type { LearningUiBlockOf } from '../../../../../server/shared/learning-ui.mjs';
import { BlockCard, Md, ScrollX } from './parts';
import styles from './genui.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export function ConceptBlock({ item }: { item: LearningUiBlockOf<'concept'> }) {
  return (
    <BlockCard item={item} icon={<BookOpen {...ICON} />} variant="flat">
      <Md text={item.body} />
    </BlockCard>
  );
}

export function ComparisonBlock({ item }: { item: LearningUiBlockOf<'comparison'> }) {
  return (
    <BlockCard item={item} icon={<Columns3 {...ICON} />} meta={`${item.columns.length} 项对比`}>
      <ScrollX label={`${item.title}对比表`} className={styles.tableWrap}>
        <table className={styles.table} data-kind="comparison">
          <thead>
            <tr>
              <th scope="col"><span className={styles.srOnly}>比较维度</span></th>
              {item.columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}
            </tr>
          </thead>
          <tbody>
            {item.rows.map((row, index) => (
              <tr key={index}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, cell) => <td key={cell}><Md text={value} tight /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
    </BlockCard>
  );
}

const numeric = (value: string) => {
  const parsed = Number(value.replace(/[,，%\s]/g, ''));
  return value.trim() !== '' && Number.isFinite(parsed) ? parsed : null;
};

export function DataTableBlock({ item }: { item: LearningUiBlockOf<'table'> }) {
  const [sort, setSort] = useState<{ column: number; direction: 'asc' | 'desc' } | null>(null);
  const numericColumns = useMemo(() => item.columns.map((_, column) => item.rows.every((row) => numeric(row[column]) !== null)), [item]);
  const rows = useMemo(() => {
    if (!sort) return item.rows;
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...item.rows].sort((a, b) => {
      const left = numeric(a[sort.column]), right = numeric(b[sort.column]);
      if (left !== null && right !== null) return (left - right) * sign;
      return a[sort.column].localeCompare(b[sort.column], 'zh-CN', { numeric: true }) * sign;
    });
  }, [item.rows, sort]);
  // 点表头：升序 → 降序 → 恢复原顺序
  const cycle = (column: number) => setSort((current) => (current?.column !== column ? { column, direction: 'asc' } : current.direction === 'asc' ? { column, direction: 'desc' } : null));
  return (
    <BlockCard item={item} icon={<Table2 {...ICON} />} meta={`${item.rows.length} 行`}>
      <ScrollX label={item.title} className={styles.tableWrap}>
        <table className={styles.table} data-kind="data">
          <thead>
            <tr>
              {item.columns.map((column, index) => {
                const active = sort?.column === index ? sort.direction : null;
                return (
                  <th scope="col" key={index} aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'} data-numeric={numericColumns[index]}>
                    <button type="button" className={styles.sortButton} data-active={Boolean(active)} onClick={() => cycle(index)} title="点击排序">
                      <span>{column}</span>
                      {active === 'asc' ? <ArrowUp size={13} strokeWidth={2} /> : active === 'desc' ? <ArrowDown size={13} strokeWidth={2} /> : <ArrowUpDown size={13} strokeWidth={1.75} />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((value, cell) => <td key={cell} data-numeric={numericColumns[cell]}><Md text={value} tight /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      {item.caption ? <p className={styles.caption}>{item.caption}</p> : null}
    </BlockCard>
  );
}

export function TimelineBlock({ item }: { item: LearningUiBlockOf<'timeline'> }) {
  return (
    <BlockCard item={item} icon={<History {...ICON} />} meta={`${item.events.length} 个节点`}>
      <ol className={styles.timeline}>
        {item.events.map((event, index) => (
          <li key={index} className={styles.event}>
            <span className={styles.eventTime}>{event.time}</span>
            <span className={styles.eventDot} aria-hidden="true" />
            <div className={styles.eventBody}>
              <strong>{event.title}</strong>
              {event.detail ? <Md text={event.detail} tight /> : null}
            </div>
          </li>
        ))}
      </ol>
    </BlockCard>
  );
}

const CALLOUT = {
  tip: { label: '小窍门', tone: 'accent', icon: <Lightbulb {...ICON} />, fixLabel: '怎么用' },
  warning: { label: '注意', tone: 'warn', icon: <TriangleAlert {...ICON} />, fixLabel: '怎么做' },
  // 误解对应产品里的「心魔」：学的人自己没发现的错误想法
  misconception: { label: '心魔 · 易错点', tone: 'bad', icon: <Ghost {...ICON} />, fixLabel: '其实是' },
} as const;

export function CalloutBlock({ item }: { item: LearningUiBlockOf<'callout'> }) {
  const config = CALLOUT[item.tone];
  const misconception = item.tone === 'misconception';
  return (
    <BlockCard item={item} icon={config.icon} meta={config.label} variant="tint" tone={config.tone}>
      {misconception ? (
        <div className={styles.contrast}>
          <div className={styles.contrastRow} data-side="wrong">
            <span className={styles.contrastMark} aria-hidden="true"><X size={13} strokeWidth={2.5} /></span>
            <div>
              <span className={styles.contrastLabel}>容易这样想</span>
              <Md text={item.body} />
            </div>
          </div>
          {item.fix ? (
            <div className={styles.contrastRow} data-side="right">
              <span className={styles.contrastMark} aria-hidden="true"><Check size={13} strokeWidth={2.5} /></span>
              <div>
                <span className={styles.contrastLabel}>{config.fixLabel}</span>
                <Md text={item.fix} />
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <Md text={item.body} />
          {item.fix ? (
            <div className={styles.calloutFix}>
              <span className={styles.contrastLabel}>{config.fixLabel}</span>
              <Md text={item.fix} />
            </div>
          ) : null}
        </>
      )}
    </BlockCard>
  );
}
