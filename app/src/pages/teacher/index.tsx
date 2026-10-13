/**
 * 教师看板 /teacher —— 单学生真实教务档案,零模拟数据。
 * 每一个数字都从本机事件流(events)/复盘报告(reports)/重放态(topicStates)实时派生,
 * 页面自身不写任何状态:总览带数事件、盲区榜聚合全部报告、学情表逐主题重放、
 * 误区台账数 misconception_* 事件(不用快照,快照会吃掉历史次数)。
 * 语言纪律:盲区永远说「小白还没懂」,不说「你错了」;警示色只落在盲区/被带偏。
 * 版式:现代数据页——总览数字带、盲区横条榜、可排序学情表、误区台账、近期会话。
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowRight, ArrowUp, ChevronsUpDown, ClipboardList, GraduationCap, ListChecks, Radar as RadarIcon, ShieldAlert } from 'lucide-react';
import type {
  BlindSpot, KnowledgeState, McState, SessionMode, SessionReport, Topic, TopicState,
} from '../../types';
import { useAppStore } from '../../store/appStore';
import { useAuthStore } from '../../store/authStore';
import { getTopic } from '../../data';
import { deriveTeacherRank } from '../../engine/achievements';
import { getStageMeta } from '../../engine/evolution';
import { topicCourseKey } from '../../data/runtimeTopics';
import { demonName } from '../../engine/story';
import { Radar } from '../review/Radar';
import { Badge, Button, Empty, Segmented, cx, type Tone } from '../../components/ui';
import { useDocTitle } from '../../hooks/useDocTitle';
import { useAllTopics } from '../../hooks/useAllTopics';
import s from './teacher.module.css';

// ── 展示词表(与复盘页同一套口径,评价语言不允许分叉) ──

const MODE_LABEL: Record<SessionMode, string> = {
  teach: '常规讲解', reteach: '重讲验证', review: '复习课',
};

type Severity = BlindSpot['severity'];
const SEV_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };
const SEV_LABEL: Record<Severity, string> = { high: '被带偏', medium: '还没讲到', low: '小测暴露' };
const SEV_TONE: Record<Severity, Tone> = { high: 'bad', medium: 'warn', low: 'neutral' };

const KS_TONE: Record<KnowledgeState, Tone> = { 没懂: 'neutral', 半懂: 'warn', 出师: 'ok' };
const MC_TONE: Record<McState, Tone> = {
  待注入: 'neutral', 已注入: 'warn', 已纠正: 'ok', 被带偏: 'bad',
};

// ── 小工具 ──

/** 事件 payload 是 Record<string, unknown>,数字一律经此闸口 */
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });

/* 入场阶梯 60ms;同屏最长 delay 封顶 240ms,后排区块不许白屏等场 */
const rise = (i: number) => ({ animationDelay: `${Math.min(i * 60, 240)}ms` });

type TopicRow = {
  topic: Topic;
  st: TopicState;
  sessions: number;
  lastQuiz: number | null;
  lastActive: string | null;
  corrected: number;
  adopted: number;
  pending: number;
};

// ── 学情表排序:纯界面态,不写入学习档案 ──

type SortKey = 'mastery' | 'coverage' | 'quiz' | 'sessions' | 'active';
type SortState = { key: SortKey; dir: 'asc' | 'desc' } | null;

const SORT_VALUE: Record<SortKey, (row: TopicRow) => number> = {
  mastery: (row) => row.st.mastery,
  coverage: (row) => (row.topic.checklist.length > 0 ? row.st.hitChecklist.length / row.topic.checklist.length : 0),
  quiz: (row) => row.lastQuiz ?? -1,
  sessions: (row) => row.sessions,
  active: (row) => (row.lastActive ? Date.parse(row.lastActive) : 0),
};

function SortHead({ label, sortKey, sort, onSort }: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
}) {
  const dir = sort?.key === sortKey ? sort.dir : null;
  return (
    <th className={s.thNum} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button
        type="button"
        className={s.sortBtn}
        data-active={dir !== null || undefined}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {dir === 'asc' ? <ArrowUp size={13} strokeWidth={2} />
          : dir === 'desc' ? <ArrowDown size={13} strokeWidth={2} />
            : <ChevronsUpDown size={13} strokeWidth={1.75} />}
      </button>
    </th>
  );
}

/** 学情表的课程筛选是界面态,不写入学习档案。选一门课只显示该课,长表关在原区域内竖滚。 */
function TopicProgressTable({ topicRows }: { topicRows: TopicRow[] }) {
  const courseIdentities = [...new Map(topicRows.map((row) => [
    topicCourseKey(row.topic),
    { key: topicCourseKey(row.topic), label: row.topic.course },
  ])).values()];
  const courses = courseIdentities.map((course) => {
    const sameTitle = courseIdentities.filter((candidate) => candidate.label === course.label);
    if (sameTitle.length <= 1) return course;
    if (!course.key.startsWith('custom:')) return { ...course, label: `${course.label} · 内置` };
    const index = sameTitle.filter((candidate) => candidate.key.startsWith('custom:')).findIndex((candidate) => candidate.key === course.key) + 1;
    return { ...course, label: `${course.label} · 自选 ${index}` };
  });
  const [selected, setSelected] = useState(courses[0]?.key ?? '');
  const [sort, setSort] = useState<SortState>(null);

  const visibleRows = useMemo(() => {
    const rows = topicRows.filter((row) => topicCourseKey(row.topic) === selected);
    if (!sort) return rows;
    const value = SORT_VALUE[sort.key];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => (value(a) - value(b)) * sign);
  }, [topicRows, selected, sort]);

  // 点表头:降序 → 升序 → 还原书架顺序
  const cycleSort = (key: SortKey) => {
    setSort((current) => {
      if (current?.key !== key) return { key, dir: 'desc' };
      return current.dir === 'desc' ? { key, dir: 'asc' } : null;
    });
  };

  return (
    <>
      {courses.length > 1 && (
        <div className={s.courseBar}>
          <Segmented
            size="sm"
            label="按课程筛选知识点学情"
            value={selected}
            onChange={setSelected}
            options={courses.map((course) => ({ value: course.key, label: course.label }))}
          />
        </div>
      )}
      <div
        className={s.tableScroll}
        tabIndex={0}
        role="region"
        aria-label="知识点学情表滚动区"
      >
        <table id="topic-progress-table" className={s.table}>
          <thead>
            <tr>
              <th>知识点</th>
              <th>状态</th>
              <SortHead label="掌握度" sortKey="mastery" sort={sort} onSort={cycleSort} />
              <SortHead label="要点覆盖" sortKey="coverage" sort={sort} onSort={cycleSort} />
              <th>误区</th>
              <SortHead label="最近小测" sortKey="quiz" sort={sort} onSort={cycleSort} />
              <SortHead label="会话" sortKey="sessions" sort={sort} onSort={cycleSort} />
              <SortHead label="最近活动" sortKey="active" sort={sort} onSort={cycleSort} />
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const mastery = Math.round(row.st.mastery * 100);
              return (
                <tr key={row.topic.topicId} className={row.adopted > 0 ? s.rowAdopted : undefined}>
                  <td className={s.titleCell}>{row.topic.title}</td>
                  <td><Badge tone={KS_TONE[row.st.knowledgeState]}>{row.st.knowledgeState}</Badge></td>
                  <td className={s.numCell}>
                    <span className={s.masteryCell}>
                      <span className={s.masteryTrack} aria-hidden="true">
                        <span
                          className={cx(s.masteryFill, row.st.knowledgeState === '出师' && s.masteryDone)}
                          style={{ width: `${mastery}%` }}
                        />
                      </span>
                      <span className={s.masteryNum}>{mastery}</span>
                    </span>
                  </td>
                  <td className={s.numCell}>{row.st.hitChecklist.length}/{row.topic.checklist.length}</td>
                  <td className={s.mcSummary}>
                    <span>纠正 <b>{row.corrected}</b></span>
                    <span className={row.adopted > 0 ? s.mcAdopted : undefined}>带偏 <b>{row.adopted}</b></span>
                    <span>待试 <b>{row.pending}</b></span>
                  </td>
                  <td className={s.numCell}>{row.lastQuiz ?? '—'}</td>
                  <td className={s.numCell}>{row.sessions}</td>
                  <td className={s.numCell}>{row.lastActive ? fmtWhen(row.lastActive) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function TeacherPage() {
  useDocTitle('教师看板');
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const global = useAppStore((st) => st.global);
  const topicStates = useAppStore((st) => st.topicStates);
  const topicStateOf = useAppStore((st) => st.topicState);
  const authUser = useAuthStore((st) => st.user);
  const allTopics = useAllTopics();

  // 学籍卡:师道称号与小白科名都由事件流纯派生(与成长册同一口径)
  const rank = useMemo(
    () => deriveTeacherRank({ events, reports, global, topicStates, topics: allTopics }),
    [events, reports, global, topicStates, allTopics],
  );
  const stage = getStageMeta(global.learningLevel);
  const lastEventAt = events.length > 0 ? events[events.length - 1].t : null;

  const openTopics = allTopics.filter((t) => !t.locked);
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

  const stats: { label: string; value: string; unit?: string; tone?: 'ok' | 'bad' }[] = [
    { label: '累计会话', value: String(sessionCount), unit: '次' },
    { label: '累计讲解', value: String(totalTurns), unit: '轮' },
    { label: '已出师', value: String(masteredCount), unit: `/ ${openTopics.length} 讲`, tone: masteredCount > 0 ? 'ok' : undefined },
    { label: '平均掌握度', value: String(avgMastery), unit: '%' },
    { label: '现存盲区', value: String(blindCount), unit: '处', tone: blindCount > 0 ? 'bad' : undefined },
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

  const courseNames = [...new Set(allTopics.map((t) => t.course))];

  return (
    <div className={s.page}>
      <header id="teacher-overview" className={cx(s.head, s.rise)} style={rise(0)}>
        <div className={s.headMain}>
          <h1 className={s.title}>教师看板</h1>
          <p className={s.lead}>
            {courseNames.join(' · ')}。数据来自你的学习记录，每上完一课自动更新。
          </p>
        </div>
        {/* 学籍卡:先生是谁、走到哪一阶、小白如今什么科名 */}
        <dl className={s.roster} aria-label="学籍卡">
          <div>
            <dt>先生</dt>
            <dd>{authUser ?? '本机先生'}</dd>
          </div>
          <div>
            <dt>师道</dt>
            <dd>
              {rank.title}
              {rank.nextTitle && rank.nextAt !== null ? (
                <small>距「{rank.nextTitle}」还差 {Math.max(0, rank.nextAt - rank.score)} 分</small>
              ) : <small>履历 {rank.score} 分</small>}
            </dd>
          </div>
          <div>
            <dt>小白</dt>
            <dd>{stage.name}<small>{stage.description}</small></dd>
          </div>
          <div>
            <dt>最近活动</dt>
            <dd className={s.rosterNum}>{lastEventAt ? fmtWhen(lastEventAt) : '尚未开课'}</dd>
          </div>
        </dl>
      </header>

      {/* ① 档案总览带 */}
      {hasArchive ? (
        <section className={cx(s.stats, s.rise)} style={rise(1)} aria-label="档案总览">
          {stats.map((it) => (
            <div key={it.label} className={s.stat}>
              <span className={s.statLabel}>{it.label}</span>
              <span className={s.statValue}>
                <b className={it.tone === 'ok' ? s.toneOk : it.tone === 'bad' ? s.toneBad : undefined}>{it.value}</b>
                {it.unit && <small>{it.unit}</small>}
              </span>
            </div>
          ))}
        </section>
      ) : (
        <section className={cx(s.panel, s.rise)} style={rise(1)} aria-label="档案总览">
          <Empty
            className={s.emptyCompact}
            icon={<GraduationCap size={22} strokeWidth={1.75} />}
            title="还没有课堂记录"
            description="去学习终端给小白开讲，这里的每一个数字都会随课堂长出来。"
            action={(
              <Button asChild variant="solid" iconRight={<ArrowRight size={16} strokeWidth={1.75} />}>
                <Link to="/learn">去学习终端开讲</Link>
              </Button>
            )}
          />
        </section>
      )}

      <div className={s.grid}>
        {/* ② 「讲不清」盲区榜:每行 = 名次 + 知识点 + 出处 + 横条 + 次数 + 程度 */}
        <section id="blind-spots" className={cx(s.panel, s.rise)} style={rise(2)}>
          <header className={s.secHead}>
            <h2 className={s.h2}>「讲不清」盲区榜</h2>
            <p className={s.secNote}>复盘里小白还没听懂的地方，按出现次数排。</p>
          </header>
          {blindRows.length === 0 ? (
            <Empty
              className={s.emptyCompact}
              icon={<ShieldAlert size={20} strokeWidth={1.75} />}
              title="还没有盲区记录"
              description="开讲之后，这里会记下小白没听懂的地方。"
            />
          ) : (
            <>
              <ol className={s.blindList} aria-label="讲不清盲区计频">
                {blindRows.map((r, i) => (
                  <li
                    key={r.point}
                    className={s.blindRow}
                    /* 行入场与横条展开共用同一阶梯延迟(45ms,封顶 300ms),条通过 --d 自定义属性继承 */
                    style={{ animationDelay: `${Math.min(120 + i * 45, 300)}ms`, '--d': `${Math.min(120 + i * 45, 300)}ms` } as CSSProperties}
                  >
                    <span className={s.blindRank} aria-hidden="true">{i + 1}</span>
                    <div className={s.blindMain}>
                      <p className={s.blindLabel}>
                        <span className={s.blindPoint}>{r.point}</span>
                        <span className={s.blindTopic}>出自「{r.topics.join('」「')}」</span>
                      </p>
                      <span className={s.blindTrack} aria-hidden="true">
                        <span
                          className={cx(s.blindBar, r.severity === 'high' && s.blindBarHigh, r.severity === 'medium' && s.blindBarMid)}
                          style={{ width: `${Math.max((r.count / maxCount) * 100, 6)}%` }}
                        />
                      </span>
                    </div>
                    <span className={s.blindCount}><b>{r.count}</b> 次</span>
                    <Badge tone={SEV_TONE[r.severity]} className={s.blindSev}>{SEV_LABEL[r.severity]}</Badge>
                  </li>
                ))}
              </ol>
              <p className={s.foot}>
                按该盲区在复盘档案中出现的次数排序；<span className={s.toneBad}>红色条是曾把你带偏的高危处</span>。
                盲区只说明小白还没懂，证据链在各自的复盘档案里。
              </p>
            </>
          )}
        </section>

        {/* ⑤ 近期会话 */}
        <section id="recent-sessions" className={cx(s.panel, s.rise)} style={rise(2)}>
          <header className={s.secHead}>
            <h2 className={s.h2}>近期会话</h2>
            <p className={s.secNote}>最近四课的五维画像，点开看完整批注。</p>
          </header>
          {recentReports.length === 0 ? (
            <Empty
              className={s.emptyCompact}
              icon={<RadarIcon size={20} strokeWidth={1.75} />}
              title="还没有会话记录"
              description="第一课下课后，这里会收好每一份复盘。"
            />
          ) : (
            <ul className={s.sessionList}>
              {recentReports.map((r) => (
                <li key={r.sessionId}>
                  <article className={s.sessionCard}>
                    <div className={s.miniRadar}>
                      <Radar radar={r.radar} delta={r.radarDelta} compact />
                    </div>
                    <div className={s.sessionBody}>
                      <header className={s.sessionHead}>
                        <h3 className={s.sessionTopic}>{getTopic(r.topicId)?.title ?? r.topicId}</h3>
                        <Badge tone="accent">{MODE_LABEL[r.mode]}</Badge>
                        {r.masteredNow && <Badge tone="ok">本次出师</Badge>}
                      </header>
                      <p className={s.sessionMeta}>
                        <span>{fmtWhen(r.startedAt)}</span>
                        <span>共 {r.turnCount} 轮</span>
                        <span>{r.highlights.length} 处高光</span>
                        <span>{r.blindSpots.length} 处盲区</span>
                      </p>
                    </div>
                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className={s.sessionLink}
                      iconRight={<ArrowRight size={14} strokeWidth={1.75} />}
                    >
                      <Link to={`/review/${r.sessionId}`}>查看复盘</Link>
                    </Button>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ③ 知识点学情:通栏表 */}
      <section id="topic-progress" className={cx(s.panel, s.rise)} style={rise(3)}>
        <header className={s.secHead}>
          <h2 className={s.h2}>知识点学情</h2>
          <p className={s.secNote}>每一行都由该知识点的课堂记录得出，点表头可排序。</p>
        </header>
        {topicRows.length === 0 ? (
          <Empty
            className={s.emptyCompact}
            icon={<ListChecks size={20} strokeWidth={1.75} />}
            title="还没有开放的知识点"
            description="课程开放后，这里会逐讲列出掌握情况。"
          />
        ) : (
          <>
            <TopicProgressTable topicRows={topicRows} />
            <p className={s.foot}>
              标红的行还留着没纠正回来的误区，先补学，再回讲台重讲。
            </p>
          </>
        )}
      </section>

      {/* ④ 误区台账 —— 事后揭示面,可以点心魔名、引 belief 与注入台词 */}
      <section id="misconceptions" className={cx(s.panel, s.rise)} style={rise(4)}>
        <header className={s.secHead}>
          <h2 className={s.h2}>误区台账</h2>
          <p className={s.secNote}>小白在课堂上说出的每一条误区，以及你当时纠正了还是认同了。</p>
        </header>
        {mcRows.length === 0 ? (
          <Empty
            className={s.emptyCompact}
            icon={<ClipboardList size={20} strokeWidth={1.75} />}
            title="台账还空着"
            description="要点讲到位后，小白才会开始拿错误说法试探你。"
          />
        ) : (
          <ul className={s.mcList}>
            {mcRows.map((r) => (
              <li key={r.mc.mcId} className={s.mcItem} data-state={r.state}>
                <div className={s.mcHead}>
                  <Badge tone="outline">{demonName(r.mc)}</Badge>
                  <Badge tone={MC_TONE[r.state]} dot>{r.state}</Badge>
                  <span className={s.mcFrom}>出自「{r.topicTitle}」</span>
                </div>
                <p className={s.mcBelief}>「{r.mc.belief}」</p>
                <p className={s.mcTrigger}>注入台词：“{r.mc.triggerLine}”</p>
                <dl className={s.mcCounts}>
                  <div><dt>注入</dt><dd>{r.injected}</dd></div>
                  <div><dt>纠正</dt><dd>{r.corrected}</dd></div>
                  <div className={r.adopted > 0 ? s.mcAdopted : undefined}><dt>被带偏</dt><dd>{r.adopted}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
