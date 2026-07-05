/**
 * 手绘风五维雷达 —— 纯 SVG,不装图表库。
 * 细墨线网格(带轻微手抖)、当前成绩墨青面、上次成绩虚线轮廓、增量标注在维度旁。
 */
import type { RadarScores } from '../../types';
import s from './review.module.css';

const DIMS: (keyof RadarScores)[] = ['覆盖度', '准确度', '逻辑结构', '深度', '纠错力'];
const CX = 280;
const CY = 225;
const R = 145;

/** 第 i 维、半径比例 v 处的坐标;wobble>0 时加一点确定性的手绘抖动 */
function pt(i: number, v: number, wobble = 0): [number, number] {
  const a = ((-90 + i * 72) * Math.PI) / 180;
  const w = wobble ? Math.sin(i * 12.9898 + wobble * 78.233) * 2.4 : 0;
  const r = R * v + w;
  return [CX + Math.cos(a) * r, CY + Math.sin(a) * r];
}

function poly(vals: number[], wobble = 0): string {
  return vals
    .map((v, i) => pt(i, v, wobble).map((n) => n.toFixed(1)).join(','))
    .join(' ');
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function Radar({ radar, delta }: { radar: RadarScores; delta: Partial<RadarScores> | null }) {
  const cur = DIMS.map((k) => clamp01(radar[k]));
  const hasPrev = !!delta && Object.keys(delta).length > 0;
  const prev = hasPrev ? DIMS.map((k) => clamp01(radar[k] - (delta?.[k] ?? 0))) : null;

  return (
    <svg viewBox="0 0 560 460" className={s.radarSvg} role="img" aria-label="五维讲解画像雷达图">
      {/* 墨线网格 */}
      {[0.25, 0.5, 0.75, 1].map((t, ri) => (
        <polygon
          key={t}
          points={poly(DIMS.map(() => t), ri + 1)}
          className={ri === 3 ? s.radarGridOuter : s.radarGrid}
        />
      ))}
      {DIMS.map((k, i) => {
        const [x, y] = pt(i, 1);
        return <line key={k} x1={CX} y1={CY} x2={x} y2={y} className={s.radarSpoke} />;
      })}

      {/* 上次成绩:虚线轮廓 */}
      {prev && <polygon points={poly(prev)} className={s.radarPrev} />}

      {/* 本次成绩:墨青面 */}
      <polygon points={poly(cur)} className={s.radarNow} />
      {cur.map((v, i) => {
        const [x, y] = pt(i, v);
        return <circle key={DIMS[i]} cx={x} cy={y} r={3.2} className={s.radarDot} />;
      })}

      {/* 维度标注 + 增量 */}
      {DIMS.map((k, i) => {
        const [x, y] = pt(i, 1.26);
        const cos = Math.cos(((-90 + i * 72) * Math.PI) / 180);
        const anchor = Math.abs(cos) < 0.35 ? 'middle' : cos > 0 ? 'start' : 'end';
        const d = delta?.[k];
        return (
          <text key={k} x={x} y={y} textAnchor={anchor} className={s.radarLabel}>
            <tspan x={x}>{k}</tspan>
            <tspan x={x} dy={17} className={s.radarValue}>
              {Math.round(radar[k] * 100)}
              {typeof d === 'number' && d !== 0 && (
                <tspan className={d > 0 ? s.radarDeltaUp : s.radarDeltaDown}>
                  {'  '}{d > 0 ? '+' : ''}{d.toFixed(2)}
                </tspan>
              )}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
