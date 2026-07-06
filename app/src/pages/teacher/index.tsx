/**
 * 教师看板 /teacher —— 单学生真实教务档案,零模拟数据。
 * 每一个数字都从本机事件流(events)/复盘报告(reports)/重放态(topicStates)实时派生,
 * 页面自身不写任何状态:总览带数事件、盲区榜聚合全部报告、学情表逐主题重放、
 * 误区台账数 misconception_* 事件(不用快照,快照会吃掉历史次数)。
 * 泄漏率实测卡读 src/data/leakageReport.json(import.meta.glob,缺文件优雅降级)——本就是真实测得数据。
 * 语言纪律:盲区永远说「小白还没懂」,不说「你错了」;朱砂只落在盲区/被带偏。
 */
import { Link } from 'react-router-dom';
import type {
  BlindSpot, KnowledgeState, McState, SessionMode, SessionReport, TopicState,
} from '../../types';
import { useAppStore } from '../../store/appStore';
import { getTopic, TOPICS } from '../../data';
import { Radar } from '../review/Radar';
import s from './teacher.module.css';

// ── 展示词表(与复盘页同一套口径,评价语言不允许分叉) ──

const MODE_LABEL: Record<SessionMode, string> = {
  teach: '常规讲解', reteach: '重讲验证', review: '复习课',
};

type Severity = BlindSpot['severity'];
const SEV_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };
const SEV_LABEL: Record<Severity, string> = { high: '被带偏', medium: '还没讲到', low: '小测暴露' };

const KS_CHIP: Record<KnowledgeState, string> = { 没懂: 'chipDust', 半懂: 'chipAmber', 出师: 'chipJade' };
const MC_CHIP: Record<McState, string> = {
  待注入: 'chipDust', 已注入: 'chipAmber', 已纠正: 'chipJade', 被带偏: 'chipCinnabar',
};
const MC_EDGE: Record<McState, string> = {
  待注入: 'mcEdgeDust', 已注入: 'mcEdgeAmber', 已纠正: 'mcEdgeJade', 被带偏: 'mcEdgeCinnabar',
};

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

// ── 小工具 ──

/** 事件 payload 是 Record<string, unknown>,数字一律经此闸口 */
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

// ── 盲区榜图表几何(条数随真实数据自适应) ──

const CHART_W = 720;
const ROW_H = 58;
const BAR_MAX = 520;

const rise = (i: number) => ({ animationDelay: `${i * 75}ms` });

export default function TeacherPage() {
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const global = useAppStore((st) => st.global);
  const topicStates = useAppStore((st) => st.topicStates);
  const topicStateOf = useAppStore((st) => st.topicState);

  const openTopics = TOPICS.filter((t) => !t.locked);
  const stateOf = (topicId: string): TopicState => topicStates[topicId] ?? topicStateOf(topicId);

  // ── ① 档案总览带:纯事件流计数 ──
  const sessionCount = events.filter((e) => e.type === 'session_started').length;
  const totalTurns = events
    .filter((e) => e.type === 'session_ended')
    .reduce((n, e) => n + num(e.payload.turns), 0);
  const masteredCount = openTopics.filter((t) => stateOf(t.topicId).knowledgeState === '出师').length;
  const avgMastery = Math.round(
    (openTopics.reduce((sum, t) => sum + stateOf(t.topicId).mastery, 0) / Math.max(openTopics.length, 1)) * 100,
  );
  // 现存盲区口径:每个主题只认最近一份报告(reports 按时间追加,后写者胜)
  const latestByTopic = new Map<string, SessionReport>();
  for (const r of reports) latestByTopic.set(r.topicId, r);
  const blindCount = [...latestByTopic.values()].reduce((n, r) => n + r.blindSpots.length, 0);
  const hasArchive = events.length > 0;

  const stats: { label: string; value: string; unit?: string; tone?: string }[] = [
    { label: '累计会话', value: String(sessionCount), unit: '次' },
    { label: '累计讲解', value: String(totalTurns), unit: '轮' },
    { label: '已出师', value: `${masteredCount}/${openTopics.length}`, tone: masteredCount > 0 ? s.statJade : undefined },
    { label: '平均掌握度', value: String(avgMastery), unit: '%' },
    { label: '现存盲区', value: String(blindCount), unit: '处', tone: blindCount > 0 ? s.statCinnabar : undefined },
    { label: '金句收录', value: String(global.goldenAnalogies.length), unit: '句' },
  ];

  // ── ② 「讲不清」盲区榜:全部报告的 blindSpots 按知识点计频,severity 取最高档 ──
  const blindAgg = new Map<string, { count: number; severity: Severity; topics: Set<string> }>();
  for (const r of reports) {
    const title = getTopic(r.topicId)?.title ?? r.topicId;
    for (const b of r.blindSpots) {
      const cur = blindAgg.get(b.knowledgePoint) ?? { count: 0, severity: 'low' as Severity, topics: new Set<string>() };
      cur.count += 1;
      if (SEV_RANK[b.severity] > SEV_RANK[cur.severity]) cur.severity = b.severity;
      cur.topics.add(title);
      blindAgg.set(b.knowledgePoint, cur);
    }
  }
  const blindRows = [...blindAgg.entries()]
    .map(([point, v]) => ({ point, count: v.count, severity: v.severity, topics: [...v.topics] }))
    .sort((a, b) => b.count - a.count || SEV_RANK[b.severity] - SEV_RANK[a.severity])
    .slice(0, 8);
  const maxCount = Math.max(...blindRows.map((r) => r.count), 1);
  const unit = BAR_MAX / maxCount;
  const chartH = blindRows.length * ROW_H + 6;

  // ── ③ 知识点学情表:逐主题重放态 + 该主题事件流 ──
  const topicRows = openTopics.map((t) => {
    const st = stateOf(t.topicId);
    const tEvents = events.filter((e) => e.topicId === t.topicId);
    const sessions = tEvents.filter((e) => e.type === 'session_started').length;
    const lastQuizEvent = [...tEvents].reverse().find((e) => e.type === 'xiaobai_quiz_scored');
    const lastQuiz = lastQuizEvent ? num(lastQuizEvent.payload.score) : null;
    const lastActive = tEvents.length > 0 ? tEvents[tEvents.length - 1].t : null;
    const mcVals = Object.values(st.mcStates);
    const corrected = mcVals.filter((v) => v === '已纠正').length;
    const adopted = mcVals.filter((v) => v === '被带偏').length;
    const pending = t.misconceptions.length - corrected - adopted; // 待注入 + 已注入 = 还没分出胜负
    return { topic: t, st, sessions, lastQuiz, lastActive, corrected, adopted, pending };
  });

  // ── ④ 误区台账:注入/纠正/带偏次数一律数事件(快照只剩终态,数不出历史) ──
  const mcRows = openTopics
    .flatMap((t) => {
      const st = stateOf(t.topicId);
      return t.misconceptions.map((mc) => ({
        topicTitle: t.title,
        mc,
        injected: events.filter((e) => e.type === 'misconception_injected' && e.payload.mcId === mc.mcId).length,
        corrected: events.filter((e) => e.type === 'misconception_corrected' && e.payload.mcId === mc.mcId).length,
        adopted: events.filter((e) => e.type === 'misconception_adopted' && e.payload.mcId === mc.mcId).length,
        state: st.mcStates[mc.mcId] ?? ('待注入' as McState),
      }));
    })
    .filter((r) => r.injected > 0)
    .sort((a, b) => b.adopted - a.adopted || b.injected - a.injected);

  // ── ⑤ 近期会话:最近 4 份报告,雷达组件与复盘页共用同一份 SVG ──
  const recentReports = reports.slice(-4).reverse();

  const leak = readLeakage(leakRaw);
  const hasLeak = leak.naive !== null || leak.guarded !== null;

  return (
    <div className={s.page}>
      <header className={`${s.head} ${s.rise}`} style={rise(0)}>
        <div>
          <h1 className={s.title}>教务看板 · {[...new Set(TOPICS.map((t) => t.course))].join(' / ')}</h1>
          <p className={s.demoNote}>
            全部数据来自<strong>本机真实学习记录</strong>,由事件流实时派生,无一处模拟。
          </p>
        </div>
        <div className={s.seal}>教务实录</div>
      </header>

      {/* ① 档案总览带 */}
      {hasArchive ? (
        <section className={`${s.statBand} ${s.rise}`} style={rise(1)} aria-label="档案总览">
          {stats.map((it) => (
            <div key={it.label} className={s.statCard}>
              <div className={s.statValue}>
                <span className={`${s.statNum} ${it.tone ?? ''}`}>{it.value}</span>
                {it.unit && <span className={s.statUnit}>{it.unit}</span>}
              </div>
              <span className={s.statLabel}>{it.label}</span>
            </div>
          ))}
        </section>
      ) : (
        <section className={`${s.emptyHero} ${s.rise}`} style={rise(1)}>
          <span className={s.emptySeal}>档案待建</span>
          <p className={s.emptyLead}>
            教务档案从第一课开始记。去书斋给小白开讲,这里的每一个数字都会自己长出来。
          </p>
          <Link to="/study" className={s.btnGhost}>去书斋开讲 →</Link>
        </section>
      )}

      <div className={s.grid}>
        <div className={s.mainCol}>
          {/* ② 「讲不清」盲区榜 */}
          <section className={`${s.section} ${s.rise}`} style={rise(2)}>
            <h2 className={s.h2}>「讲不清」盲区榜<small>全部复盘档案里小白还没懂的地方,按次计频</small></h2>
            {blindRows.length === 0 ? (
              <p className={s.emptyNote}>尚无盲区记录——开讲之后,这里会记下小白没听懂的地方。</p>
            ) : (
              <>
                {/* 横滚壳 + min-width:窄屏滚动看全,不整图缩小(11px 标注缩到 8px 就废了);
                    aria-label 带上逐条数据,role=img 的 SVG 内文本进不了无障碍树 */}
                <div className={s.barWrap} tabIndex={0} role="group" aria-label="盲区榜横向滚动区">
                <svg
                  viewBox={`0 0 ${CHART_W} ${chartH}`}
                  className={s.barSvg}
                  role="img"
                  aria-label={`讲不清盲区计频:${blindRows.map((r) => `${r.point} ${r.count} 次,${SEV_LABEL[r.severity]}`).join(';')}`}
                >
                  <line x1={0} y1={0} x2={0} y2={chartH} className={s.barAxis} />
                  {blindRows.map((r, i) => {
                    const y = i * ROW_H;
                    const w = Math.max(r.count * unit, 6);
                    return (
                      <g key={r.point}>
                        <text x={2} y={y + 16} className={s.barLabel}>
                          {r.point}
                          <tspan dx={10} className={s.barTopic}>出自「{r.topics.join('」「')}」</tspan>
                        </text>
                        <rect
                          x={0} y={y + 26} width={w} height={14} rx={2}
                          className={r.severity === 'high' ? s.barHigh : s.barInk}
                        />
                        <text x={w + 8} y={y + 38} className={s.barCount}>
                          {r.count} 次
                          <tspan dx={6} className={r.severity === 'high' ? s.barSevHigh : s.barSev}>
                            {SEV_LABEL[r.severity]}
                          </tspan>
                        </text>
                      </g>
                    );
                  })}
                </svg>
                </div>
                <p className={s.chartFoot}>
                  按该盲区在复盘档案中出现的次数排序;<span className={s.youMark}>朱砂条 = 曾把你带偏的高危处</span>。
                  盲区只说明小白还没懂,证据链在各自的复盘档案里。
                </p>
              </>
            )}
          </section>

          {/* ③ 知识点学情表 */}
          <section className={`${s.section} ${s.rise}`} style={rise(3)}>
            <h2 className={s.h2}>知识点学情<small>每一行都由该主题的事件流重放得出</small></h2>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>课程</th>
                    <th>知识点</th>
                    <th>状态</th>
                    <th>掌握度</th>
                    <th>要点覆盖</th>
                    <th>误区</th>
                    <th>最近小测</th>
                    <th>会话</th>
                    <th>最近活动</th>
                  </tr>
                </thead>
                <tbody>
                  {topicRows.map((row) => (
                    <tr key={row.topic.topicId} className={row.adopted > 0 ? s.rowAdopted : undefined}>
                      <td className={s.courseCell}>{row.topic.course}</td>
                      <td className={s.titleCell}>{row.topic.title}</td>
                      <td>
                        <span className={`${s.chip} ${s[KS_CHIP[row.st.knowledgeState]]}`}>
                          {row.st.knowledgeState}
                        </span>
                      </td>
                      <td>
                        <span className={s.masteryCell}>
                          <span className={s.numInline}>{Math.round(row.st.mastery * 100)}</span>
                          <span className={s.masteryTrack}>
                            <span
                              className={s.masteryFill}
                              style={{ width: `${Math.round(row.st.mastery * 100)}%` }}
                            />
                          </span>
                        </span>
                      </td>
                      <td className={s.numCell}>{row.st.hitChecklist.length}/{row.topic.checklist.length}</td>
                      <td className={s.mcSummary}>
                        纠正 <span className={s.numInline}>{row.corrected}</span>
                        {' · '}
                        <span className={row.adopted > 0 ? s.mcAdopted : undefined}>
                          带偏 <span className={s.numInline}>{row.adopted}</span>
                        </span>
                        {' · '}
                        待试 <span className={s.numInline}>{row.pending}</span>
                      </td>
                      <td className={s.numCell}>{row.lastQuiz ?? '—'}</td>
                      <td className={s.numCell}>{row.sessions}</td>
                      <td className={s.numCell}>{row.lastActive ? fmtWhen(row.lastActive) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={s.tableFoot}>
              朱砂晕染的行还留着没纠正回来的被带偏误区——先补学,再回讲台重讲验证。
            </p>
          </section>

          {/* ④ 误区台账 —— 事后揭示面,可以引用 belief 与注入台词 */}
          <section className={`${s.section} ${s.rise}`} style={rise(4)}>
            <h2 className={s.h2}>误区台账<small>这些错话是系统故意让小白说的,考的是你的纠错力</small></h2>
            {mcRows.length === 0 ? (
              <p className={s.emptyNote}>台账还空着——要点讲到位后,小白才会开始拿错误说法试探你。</p>
            ) : (
              <ul className={s.mcList}>
                {mcRows.map((r) => (
                  <li key={r.mc.mcId} className={`${s.mcItem} ${s[MC_EDGE[r.state]]}`}>
                    <div className={s.mcHead}>
                      <span className={s.mcBelief}>「{r.mc.belief}」</span>
                      <span className={`${s.chip} ${s[MC_CHIP[r.state]]}`}>{r.state}</span>
                    </div>
                    <p className={s.mcTrigger}>注入台词:“{r.mc.triggerLine}”</p>
                    <p className={s.mcCounts}>
                      注入 <span className={s.numInline}>{r.injected}</span> 次
                      {' · '}纠正 <span className={s.numInline}>{r.corrected}</span> 次
                      {' · '}
                      <span className={r.adopted > 0 ? s.mcAdopted : undefined}>
                        被带偏 <span className={s.numInline}>{r.adopted}</span> 次
                      </span>
                      <span className={s.mcFrom}>出自「{r.topicTitle}」</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className={s.sideCol}>
          {/* ⑤ 近期会话 */}
          <section className={`${s.section} ${s.rise}`} style={rise(2)}>
            <h2 className={s.h2}>近期会话</h2>
            {recentReports.length === 0 ? (
              <p className={s.emptyNote}>还没有会话档案——第一课下课后,这里会替你收好每一份复盘。</p>
            ) : (
              <div className={s.sessionList}>
                {recentReports.map((r) => (
                  <article key={r.sessionId} className={s.sessionCard}>
                    <header className={s.sessionHead}>
                      <span className={s.sessionTopic}>{getTopic(r.topicId)?.title ?? r.topicId}</span>
                      <span className={`${s.chip} ${s.chipAzure}`}>{MODE_LABEL[r.mode]}</span>
                    </header>
                    <p className={s.sessionMeta}>
                      <span className={s.numInline}>{fmtWhen(r.startedAt)}</span> · 共{' '}
                      <span className={s.numInline}>{r.turnCount}</span> 轮
                      {r.masteredNow && <span className={`${s.chip} ${s.chipJade}`}>本次出师</span>}
                    </p>
                    <div className={s.miniRadar}>
                      <Radar radar={r.radar} delta={r.radarDelta} compact />
                    </div>
                    <Link to={`/review/${r.sessionId}`} className={s.sessionLink}>查看复盘 →</Link>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* ⑥ 泄漏率实测卡 —— 答辩收尾页 */}
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
        </aside>
      </div>
    </div>
  );
}
