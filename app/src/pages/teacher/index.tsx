/**
 * 教师看板 /teacher —— 一屏教务报表,克制、数据密度高。
 * 演示数据 = 模拟班级 32 人静态样例 + 当前用户真实数据并入(Top5 计入盲区、学情表加「你」一行)。
 * 泄漏率实测卡读 src/data/leakageReport.json(import.meta.glob,缺文件优雅降级)。
 */
import type { SessionReport } from '../../types';
import { useAppStore } from '../../store/appStore';
import { TOPICS } from '../../data';
import s from './teacher.module.css';

// ── 班级样例数据(与真实课程知识点同名,便于用户盲区并入) ──

interface BarRow {
  point: string;
  topicTitle: string;
  count: number;
  mine: number; // 当前用户贡献的人次
}

const CLASS_BARS: Omit<BarRow, 'mine'>[] = [
  { point: '嵌套对象的引用共享', topicTitle: '浅拷贝与深拷贝', count: 17 },
  { point: '默认值只求值一次', topicTitle: '可变默认参数', count: 14 },
  { point: '浅拷贝的层级范围', topicTitle: '浅拷贝与深拷贝', count: 11 },
  { point: '深拷贝的行为', topicTitle: '浅拷贝与深拷贝', count: 8 },
  { point: '赋值与拷贝的区别', topicTitle: '浅拷贝与深拷贝', count: 6 },
  { point: '何时需要深拷贝', topicTitle: '浅拷贝与深拷贝', count: 5 },
];

/** 高危盲区(误区被带偏)并入 Top5 时映射到对应的讲不清知识点 */
const MC_TO_POINT: Record<string, string> = {
  shallow_copy_M1: '嵌套对象的引用共享',
  shallow_copy_M2: '赋值与拷贝的区别',
  shallow_copy_M3: '何时需要深拷贝',
};

const SAMPLE_STUDENTS = [
  { name: '林晓阳', mastered: 2, avg: 78, blind: 1, golden: 2 },
  { name: '陈舟', mastered: 1, avg: 62, blind: 3, golden: 1 },
  { name: '何雨桐', mastered: 2, avg: 81, blind: 1, golden: 3 },
  { name: '苏牧', mastered: 0, avg: 35, blind: 5, golden: 0 },
  { name: '张之澜', mastered: 1, avg: 58, blind: 2, golden: 1 },
  { name: '顾一帆', mastered: 1, avg: 66, blind: 2, golden: 0 },
];

// ── 泄漏率实测(文件由离线模拟脚本生成;缺失时优雅降级) ──

const leakModules = import.meta.glob('../../data/leakageReport.json', { eager: true }) as
  Record<string, { default: unknown }>;
const leakRaw = Object.values(leakModules)[0]?.default;

function pickRate(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['rate', 'leakRate', 'leakage', 'percent', 'value']) {
      if (typeof o[k] === 'number') return o[k] as number;
    }
  }
  return null;
}

function readLeakage(raw: unknown): { naive: number | null; guarded: number | null; method: string | null; sessions: number | null } {
  if (!raw || typeof raw !== 'object') return { naive: null, guarded: null, method: null, sessions: null };
  const o = raw as Record<string, unknown>;
  const naive = pickRate(o.naiveLeakRate ?? o.naive ?? o.naiveRate ?? o.baseline ?? o.bare);
  const guarded = pickRate(o.guardedLeakRate ?? o.guarded ?? o.guardedRate ?? o.protected ?? o.pipeline);
  const method = typeof o.method === 'string' ? o.method : null;
  const sessionsRaw = o.totalSamples ?? o.sessions ?? o.samples ?? o.runs;
  const sessions = typeof sessionsRaw === 'number' ? sessionsRaw : null;
  return { naive, guarded, method, sessions };
}

const fmtRate = (v: number | null) => {
  if (v === null) return '待测';
  const p = v <= 1 ? v * 100 : v;
  return `${Math.round(p * 10) / 10}%`;
};

// ── 图表几何 ──

const CHART_W = 720;
const ROW_H = 58;
const BAR_MAX = 560;

const rise = (i: number) => ({ animationDelay: `${i * 75}ms` });

export default function TeacherPage() {
  const reports = useAppStore((st) => st.reports);
  const global = useAppStore((st) => st.global);
  const topicStates = useAppStore((st) => st.topicStates);
  const topicStateOf = useAppStore((st) => st.topicState);

  // 当前用户的现况盲区:每个知识点取最近一份报告
  const latestByTopic = new Map<string, SessionReport>();
  for (const r of reports) latestByTopic.set(r.topicId, r);
  const myPoints = new Set<string>();
  for (const r of latestByTopic.values()) {
    for (const b of r.blindSpots) {
      myPoints.add(b.mcId ? (MC_TO_POINT[b.mcId] ?? b.knowledgePoint) : b.knowledgePoint);
    }
  }

  // Top5:静态样例 + 用户盲区并入对应条目
  const rows: BarRow[] = CLASS_BARS.map((b) => ({ ...b, mine: 0 }));
  for (const p of myPoints) {
    const hit = rows.find((r) => r.point === p);
    if (hit) {
      hit.count += 1;
      hit.mine = 1;
    } else {
      rows.push({ point: p, topicTitle: '本班实测', count: 1, mine: 1 });
    }
  }
  const top5 = rows.sort((a, b) => b.count - a.count).slice(0, 5);
  const maxCount = Math.max(...top5.map((r) => r.count), 1);
  const unit = BAR_MAX / maxCount;
  const chartH = top5.length * ROW_H + 6;

  // 「你」的真实一行
  const openTopics = TOPICS.filter((t) => !t.locked);
  const masteries = openTopics.map((t) => (topicStates[t.topicId] ?? topicStateOf(t.topicId)).mastery);
  const myAvg = masteries.length
    ? Math.round((masteries.reduce((a, b) => a + b, 0) / masteries.length) * 100)
    : 0;
  const myBlind = [...latestByTopic.values()].reduce((n, r) => n + r.blindSpots.length, 0);

  const leak = readLeakage(leakRaw);
  const hasLeak = leak.naive !== null || leak.guarded !== null;

  return (
    <div className={s.page}>
      <header className={`${s.head} ${s.rise}`} style={rise(0)}>
        <div>
          <h1 className={s.title}>教务看板 · Python 程序设计</h1>
          <p className={s.demoNote}>
            演示数据:模拟班级 32 人 + <strong>你的真实数据已并入</strong>(Top5 计入你的盲区,学情表含「你」一行)
          </p>
        </div>
        <div className={s.seal}>教务实录</div>
      </header>

      <div className={s.grid}>
        <div>
          {/* 班级「讲不清 Top5」 */}
          <section className={`${s.section} ${s.rise}`} style={rise(1)}>
            <h2 className={s.h2}>本班「讲不清」Top5 知识点<small>按被小白暴露为盲区的人数排序</small></h2>
            <svg
              viewBox={`0 0 ${CHART_W} ${chartH}`}
              className={s.barSvg}
              role="img"
              aria-label="班级讲不清 Top5 知识点墨条横图"
            >
              <line x1={0} y1={0} x2={0} y2={chartH} className={s.barAxis} />
              {top5.map((r, i) => {
                const y = i * ROW_H;
                const baseW = (r.count - r.mine) * unit;
                const mineW = r.mine * unit;
                return (
                  <g key={r.point}>
                    <text x={2} y={y + 16} className={s.barLabel}>
                      {r.point}
                      <tspan dx={10} className={s.barTopic}>{r.topicTitle}</tspan>
                    </text>
                    <rect x={0} y={y + 26} width={baseW} height={14} rx={2} className={s.barInk} />
                    {r.mine > 0 && (
                      <rect x={baseW} y={y + 26} width={mineW} height={14} rx={2} className={s.barMine} />
                    )}
                    <text x={baseW + mineW + 8} y={y + 38} className={s.barCount}>
                      {r.count} 人
                      {r.mine > 0 && <tspan dx={6} className={s.barYou}>含你</tspan>}
                    </text>
                  </g>
                );
              })}
            </svg>
            <p className={s.chartFoot}>
              墨条 = 模拟样例;<span className={s.youMark}>朱砂段 = 你的最近盲区已计入</span>。
              盲区判定源自误区纠正失败与要点未覆盖,证据链见各自复盘档案。
            </p>
          </section>

          {/* 个体学情表 */}
          <section className={`${s.section} ${s.rise}`} style={rise(2)}>
            <h2 className={s.h2}>个体学情<small>「教过 = 学过」的过程性评价</small></h2>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>学生</th>
                    <th>已出师</th>
                    <th>平均掌握度</th>
                    <th>现存盲区</th>
                    <th>金句收录</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_STUDENTS.map((st) => (
                    <tr key={st.name}>
                      <td>{st.name}</td>
                      <td className={s.numCell}>{st.mastered}</td>
                      <td className={s.numCell}>{st.avg}%</td>
                      <td className={st.blind >= 3 ? s.blindCell : s.numCell}>{st.blind}</td>
                      <td className={s.numCell}>{st.golden}</td>
                    </tr>
                  ))}
                  <tr className={s.meRow}>
                    <td>你(真实数据)</td>
                    <td className={s.numCell}>{global.topicsMastered}</td>
                    <td className={s.numCell}>{myAvg}%</td>
                    <td className={myBlind >= 3 ? s.blindCell : s.numCell}>{myBlind}</td>
                    <td className={s.numCell}>{global.goldenAnalogies.length}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className={s.tableFoot}>其余 25 人从略——样例仅作版式演示,「你」一行来自本机事件流实时派生。</p>
          </section>
        </div>

        {/* 泄漏率实测卡 —— 答辩收尾页 */}
        <section className={`${s.section} ${s.rise}`} style={rise(3)}>
          <div className={s.leakCard}>
            <h2 className={s.leakTitle}>知识泄漏率实测</h2>
            <div className={s.leakRow}>
              <div>
                <span className={`${s.leakNum} ${s.leakNaive}`}>{fmtRate(leak.naive)}</span>
                <span className={s.leakLabel}>裸 prompt(只嘱咐「请假装不懂」)</span>
              </div>
              <span className={s.leakArrow}>→ 六层防线 →</span>
              <div>
                <span className={`${s.leakNum} ${s.leakGuarded}`}>{fmtRate(leak.guarded)}</span>
                <span className={s.leakLabel}>白名单 + 物理隔离 + 出口守门</span>
              </div>
            </div>
            <p className={s.leakMethod}>
              {leak.method ??
                '方法:同一批教学话术分别打向裸 prompt 与六层防线流水线,出口守门扫描白名单外的 checklist 术语,统计越权台词占比。'}
            </p>
            <p className={s.leakFoot}>
              {hasLeak
                ? `数据来源:data/leakageReport.json${leak.sessions ? ` · ${leak.sessions} 组模拟会话` : ''} · 小白的「不懂」是架构保证的,不是演出来的。`
                : '实测数据尚未生成:离线模拟脚本跑完后写入 src/data/leakageReport.json,本卡自动更新。'}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
