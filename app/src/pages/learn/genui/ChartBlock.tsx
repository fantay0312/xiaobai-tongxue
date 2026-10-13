import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ChartColumn, ChartLine, ChartPie, Table2 } from 'lucide-react';
import { IconButton } from '../../../components/ui';
import type { LearningUiBlockOf } from '../../../../../server/shared/learning-ui.mjs';
import { BlockCard, Md, ScrollX, useWidth } from './parts';
import styles from './genui.module.css';

type ChartItem = LearningUiBlockOf<'chart'>;

const PLOT_HEIGHT = 228;
const plain = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });
/** 系列颜色由样式里的 --series-n 给出，这里只指定用第几个。 */
const mark = (index: number) => ({ '--mark': `var(--series-${(index % 8) + 1})` }) as CSSProperties;

function niceTicks(min: number, max: number, count = 4) {
  const high = max === min ? min + 1 : max;
  const rough = (high - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const ratio = rough / magnitude;
  const step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * magnitude;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value < high + step * 0.999; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

/** 按像素宽度截断标签：中文约 12px 一个字，其余约 7px。 */
function fitLabel(label: string, room: number) {
  let used = 0, out = '';
  for (const char of label) {
    used += char.charCodeAt(0) > 255 ? 12 : 7;
    if (used > room) return out.length > 1 ? `${out.slice(0, -1)}…` : out;
    out += char;
  }
  return out;
}

/** 数据端圆角 4px，贴基线的一端保持平直。 */
function barPath(x: number, width: number, base: number, tip: number) {
  const radius = Math.min(4, width / 2, Math.abs(base - tip));
  const inward = tip <= base ? radius : -radius;
  return `M${x},${base}V${tip + inward}Q${x},${tip} ${x + radius},${tip}H${x + width - radius}Q${x + width},${tip} ${x + width},${tip + inward}V${base}Z`;
}

/** 悬停、聚焦后用方向键切换，读数与指针一致。 */
function useActiveIndex(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    setActive((current) => (current === null ? 0 : (current + (forward ? 1 : count - 1)) % count));
  };
  return { active, setActive, onKeyDown, onFocus: () => setActive((current) => current ?? 0), onBlur: () => setActive(null) };
}

function Cartesian({ item, width }: { item: ChartItem; width: number }) {
  const count = item.labels.length;
  const { active, setActive, onKeyDown, onFocus, onBlur } = useActiveIndex(count);
  const bar = item.kind === 'bar';
  const all = item.series.flatMap((series) => series.values);
  const low = Math.min(...all), high = Math.max(...all);
  // 柱状图必须从 0 起；折线只有在数值离 0 很远时才不从 0 起
  const fromZero = bar || low < 0 || low <= high * 0.4;
  const ticks = niceTicks(fromZero ? Math.min(0, low) : low, fromZero ? Math.max(0, high) : high);
  const floor = ticks[0], ceiling = ticks[ticks.length - 1];
  const left = Math.max(...ticks.map((tick) => compact.format(tick).length)) * 7 + 14;
  const margin = { top: 14, right: 12, bottom: 30, left };
  const innerWidth = Math.max(60, width - margin.left - margin.right);
  const innerHeight = PLOT_HEIGHT - margin.top - margin.bottom;
  const y = (value: number) => margin.top + innerHeight * (1 - (value - floor) / (ceiling - floor));
  const band = innerWidth / count;
  const center = (index: number) => margin.left + band * (index + 0.5);
  const baseline = y(Math.min(Math.max(0, floor), ceiling));
  const barWidth = Math.max(3, Math.min(24, (band * 0.72 - (item.series.length - 1) * 2) / item.series.length));
  const groupWidth = barWidth * item.series.length + (item.series.length - 1) * 2;
  const stride = Math.max(1, Math.ceil(30 / band));
  const tipLeft = active === null ? 0 : Math.min(Math.max(center(active), 84), width - 84);

  return (
    <div className={styles.plot} tabIndex={0} role="group" aria-label={`${item.title}，可用方向键逐项查看数值`} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur} onPointerLeave={() => setActive(null)}>
      <svg width={width} height={PLOT_HEIGHT} role="img" aria-label={`${bar ? '柱状图' : '折线图'}：${item.labels.join('、')}`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className={styles.grid} x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} data-zero={tick === 0} />
            <text className={styles.axisText} x={margin.left - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle">{compact.format(tick)}</text>
          </g>
        ))}
        {active !== null && (bar
          ? <rect className={styles.bandHover} x={margin.left + band * active + 2} y={margin.top} width={Math.max(0, band - 4)} height={innerHeight} rx={6} />
          : <line className={styles.crosshair} x1={center(active)} x2={center(active)} y1={margin.top} y2={margin.top + innerHeight} />)}
        {bar
          ? item.series.map((series, seriesIndex) => series.values.map((value, index) => (
            <path
              key={`${seriesIndex}-${index}`}
              className={styles.bar}
              style={mark(seriesIndex)}
              data-dim={active !== null && active !== index}
              d={barPath(center(index) - groupWidth / 2 + seriesIndex * (barWidth + 2), barWidth, baseline, y(value))}
            />
          )))
          : item.series.map((series, seriesIndex) => (
            <g key={seriesIndex} style={mark(seriesIndex)}>
              <path className={styles.line} d={series.values.map((value, index) => `${index ? 'L' : 'M'}${center(index)},${y(value)}`).join('')} />
              {series.values.map((value, index) => <circle key={index} className={styles.dot} cx={center(index)} cy={y(value)} r={active === index ? 5 : 4} />)}
            </g>
          ))}
        {item.labels.map((label, index) => (index % stride === 0 ? (
          <text key={index} className={styles.axisText} x={center(index)} y={PLOT_HEIGHT - 10} textAnchor="middle" data-active={active === index}>
            {fitLabel(label, band * stride - 6)}
          </text>
        ) : null))}
        {item.labels.map((_, index) => (
          <rect key={index} className={styles.hit} x={margin.left + band * index} y={margin.top} width={band} height={innerHeight + margin.bottom} onPointerEnter={() => setActive(index)} onPointerDown={() => setActive(index)} />
        ))}
      </svg>
      {active !== null && (
        <div className={styles.tooltip} style={{ left: tipLeft }} role="status">
          <span className={styles.tooltipLabel}>{item.labels[active]}</span>
          {item.series.map((series, index) => (
            <span key={index} className={styles.tooltipRow}>
              <i className={styles.lineKey} style={mark(index)} />
              <span>{series.name}</span>
              <strong>{plain.format(series.values[active])}{item.unit ? ` ${item.unit}` : ''}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Pie({ item }: { item: ChartItem }) {
  const slices = useMemo(() => {
    const raw = item.labels.map((label, index) => ({ label, value: item.series[0].values[index] })).filter((slice) => slice.value > 0);
    if (raw.length <= 7) return raw;
    // 第 8 类起并成「其他」，不再生成新的颜色
    const sorted = [...raw].sort((a, b) => b.value - a.value);
    return [...sorted.slice(0, 6), { label: '其他', value: sorted.slice(6).reduce((sum, slice) => sum + slice.value, 0) }];
  }, [item]);
  const { active, setActive, onKeyDown, onFocus, onBlur } = useActiveIndex(slices.length);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const size = 184, middle = size / 2, outer = 86, inner = 54;
  const point = (radius: number, angle: number) => `${middle + radius * Math.cos(angle)},${middle + radius * Math.sin(angle)}`;
  let cursor = -Math.PI / 2;
  const arcs = slices.map((slice) => {
    const start = cursor;
    const end = start + Math.min((slice.value / total) * Math.PI * 2, Math.PI * 2 - 0.0005);
    cursor = start + (slice.value / total) * Math.PI * 2;
    const large = end - start > Math.PI ? 1 : 0;
    return `M${point(outer, start)}A${outer},${outer} 0 ${large} 1 ${point(outer, end)}L${point(inner, end)}A${inner},${inner} 0 ${large} 0 ${point(inner, start)}Z`;
  });
  const focus = active === null ? null : slices[active];
  return (
    <div className={styles.pie} tabIndex={0} role="group" aria-label={`${item.title}，可用方向键逐项查看占比`} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur} onPointerLeave={() => setActive(null)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`环形图：${slices.map((slice) => `${slice.label} ${percent.format(slice.value / total)}`).join('，')}`}>
        {arcs.map((d, index) => (
          <path key={index} className={styles.slice} style={mark(index)} d={d} data-dim={active !== null && active !== index} onPointerEnter={() => setActive(index)} onPointerDown={() => setActive(index)} />
        ))}
        <text className={styles.pieValue} x={middle} y={middle - 4} textAnchor="middle">{focus ? percent.format(focus.value / total) : plain.format(total)}</text>
        <text className={styles.pieCaption} x={middle} y={middle + 16} textAnchor="middle">{focus ? fitLabel(focus.label, 92) : `合计${item.unit ? ` ${item.unit}` : ''}`}</text>
      </svg>
      <ul className={styles.pieLegend}>
        {slices.map((slice, index) => (
          <li key={index} data-active={active === index} onPointerEnter={() => setActive(index)}>
            <i className={styles.swatch} style={mark(index)} />
            <span className={styles.pieLabel}>{slice.label}</span>
            <span className={styles.pieNumber}>{plain.format(slice.value)}</span>
            <strong className={styles.pieNumber}>{percent.format(slice.value / total)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

const KIND = {
  bar: { label: '柱状图', icon: <ChartColumn size={16} strokeWidth={1.75} /> },
  line: { label: '折线图', icon: <ChartLine size={16} strokeWidth={1.75} /> },
  pie: { label: '占比', icon: <ChartPie size={16} strokeWidth={1.75} /> },
} as const;

export function ChartBlock({ item }: { item: ChartItem }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [table, setTable] = useState(false);
  const pie = item.kind === 'pie';
  const total = pie ? item.series[0].values.reduce((sum, value) => sum + value, 0) : 0;
  return (
    <BlockCard
      item={item}
      icon={KIND[item.kind].icon}
      meta={item.unit && !pie ? `单位：${item.unit}` : KIND[item.kind].label}
      actions={
        <IconButton label={table ? '收起数据表' : '查看数据表'} tip size="sm" active={table} aria-pressed={table} onClick={() => setTable(!table)}>
          <Table2 size={15} strokeWidth={1.75} />
        </IconButton>
      }
    >
      <div ref={ref} className={styles.chart}>
        {pie ? <Pie item={item} /> : <Cartesian item={item} width={width} />}
        {!pie && item.series.length > 1 && (
          <ul className={styles.chartLegend} aria-label="图例">
            {item.series.map((series, index) => (
              <li key={index}>
                <i className={item.kind === 'line' ? styles.lineKey : styles.swatch} style={mark(index)} />
                {series.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      {table && (
        <ScrollX label={`${item.title}数据表`} className={styles.tableWrap}>
          <table className={styles.table} data-kind="data">
            <thead>
              <tr>
                <th scope="col">项目</th>
                {item.series.map((series, index) => <th scope="col" key={index} data-numeric="true">{series.name}{item.unit ? `（${item.unit}）` : ''}</th>)}
                {pie && <th scope="col" data-numeric="true">占比</th>}
              </tr>
            </thead>
            <tbody>
              {item.labels.map((label, index) => (
                <tr key={index}>
                  <th scope="row">{label}</th>
                  {item.series.map((series, seriesIndex) => <td key={seriesIndex} data-numeric="true">{plain.format(series.values[index])}</td>)}
                  {pie && <td data-numeric="true">{total > 0 ? percent.format(item.series[0].values[index] / total) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      )}
      {item.note ? <Md text={item.note} tight className={styles.caption} /> : null}
    </BlockCard>
  );
}
