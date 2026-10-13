/**
 * 复盘页 /review/:sessionId —— 灯下批注。
 * 顺序铁律(方案 §8.2):先高光,后盲区;盲区话术永远「小白还没懂」。
 * 版式:题头 + 概览一行 → 仪式件(证书/钤印) → 三个页签(批注 / 成绩与证据 / 小白日记) → 下一步。
 * 证据链:本 session 事件流 evidence + (会话未关闭时)逐轮评估判语。
 * 叙事层(证书/战报/日记)全部从本场 misconception_* 事件派生,不读 mcStates 快照
 * (session_ended 重放会把悬置误区退回待注入,快照会抹掉本场遭遇记录)。
 * 纸质物件(档案卡、金句票、成绩单)挂 data-story,保留红笔批注的手感;其余走应用外壳的令牌。
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowRight,
  ChevronRight,
  FileSearch,
  Highlighter,
  NotebookText,
  Radar as RadarIcon,
  RotateCcw,
  Sparkles,
  Swords,
} from 'lucide-react';
import type { KnowledgeState, LearnEventType, RadarScores, SessionMode } from '../../types';
import { useAppStore } from '../../store/appStore';
import { getTopic } from '../../data';
import { deriveDemonReport, deriveDiary, type DemonEncounter } from '../../engine/story';
import { deriveSessionHonors } from '../../engine/honors';
import { HonorRoll } from '../../components/story/HonorRoll';
import { MasteryCertificate } from '../../components/story/MasteryCertificate';
import { XiaobaiDiary } from '../../components/story/XiaobaiDiary';
import { Badge, Button, Empty, Progress, TabPanel, Tabs, cx, type Tone } from '../../components/ui';
import { useDocTitle } from '../../hooks/useDocTitle';
import { useAllTopics } from '../../hooks/useAllTopics';
import { Radar } from './Radar';
import { RemedyPath } from './RemedyPath';
import paper from '../../styles/paper.module.css';
import s from './review.module.css';

type ReviewTab = 'notes' | 'scores' | 'diary';

const MODE_LABEL: Record<SessionMode, string> = {
  teach: '常规讲解', reteach: '重讲验证', review: '复习课',
};

const SEVERITY_LABEL = { high: '被带偏', medium: '还没讲到', low: '小测暴露' } as const;
const SEVERITY_TONE: Record<keyof typeof SEVERITY_LABEL, Tone> = { high: 'bad', medium: 'warn', low: 'neutral' };

/** 与 Radar 组件同一维度序(展示层复用,不改数据契约) */
const RADAR_DIMS: (keyof RadarScores)[] = ['覆盖度', '准确度', '逻辑结构', '深度', '纠错力'];

const EVENT_LABEL: Record<LearnEventType, string> = {
  session_started: '开课',
  checklist_hit: '要点命中',
  accuracy_flag: '表述存疑',
  misconception_injected: '误区注入',
  misconception_corrected: '误区纠正',
  misconception_adopted: '被带偏',
  golden_analogy_saved: '金句收录',
  stuck_rescued: '卡壳救援',
  prep_completed: '备课完成',
  remedy_completed: '补学完成',
  topic_mastered: '出师',
  review_triggered: '复习触发',
  review_passed: '复习通过',
  xiaobai_quiz_scored: '小测计分',
  session_ended: '下课',
};

function eventTone(type: LearnEventType): Tone {
  if (['misconception_corrected', 'golden_analogy_saved', 'topic_mastered', 'review_passed', 'checklist_hit'].includes(type)) return 'ok';
  if (['misconception_adopted', 'accuracy_flag'].includes(type)) return 'bad';
  if (['misconception_injected', 'stuck_rescued'].includes(type)) return 'warn';
  return 'neutral';
}

/** 心魔结局 → 行配色与结局签:击退归绿,拐走归红(真警示语境),照面归中性 */
const OUTCOME_CLASS: Record<DemonEncounter['outcome'], 'demonVanquished' | 'demonStray' | 'demonPassed'> = {
  vanquished: 'demonVanquished',
  stray: 'demonStray',
  passed: 'demonPassed',
};
const OUTCOME_BADGE: Record<DemonEncounter['outcome'], { tone: Tone; label: string }> = {
  vanquished: { tone: 'ok', label: '已击退' },
  stray: { tone: 'bad', label: '小白被拐走' },
  passed: { tone: 'neutral', label: '打了个照面' },
};

const STATE_BADGE: Record<KnowledgeState, { tone: Tone; label: string }> = {
  没懂: { tone: 'neutral', label: '还没懂' },
  半懂: { tone: 'warn', label: '半懂' },
  出师: { tone: 'ok', label: '已出师' },
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

/** 入场错峰:R6 纪律,同屏最长 delay 封顶 300ms,别让后排内容白屏 */
const rise = (i: number) => ({ animationDelay: `${Math.min(i * 75, 300)}ms` });

/** 红笔勾叉:成绩单上老师手批的记号(对错都用红笔,像真卷子) */
function PenMark({ right }: { right: boolean }) {
  return (
    <svg className={s.penMark} viewBox="0 0 22 22" width="20" height="20" aria-hidden="true">
      {right
        ? <path d="M3.5 12.5c2 1.6 3.6 3.4 4.8 5.4C10.6 12 14 7.4 19 3.6" />
        : <path d="M4.5 4.5c4.6 4.2 8.6 8.4 13 13.2M17.6 4.2C13 8.8 9 13 4.4 17.8" />}
    </svg>
  );
}

export default function ReviewPage() {
  const { sessionId } = useParams();
  const reports = useAppStore((st) => st.reports);
  const events = useAppStore((st) => st.events);
  const live = useAppStore((st) => st.live);
  const global = useAppStore((st) => st.global);
  const topicStates = useAppStore((st) => st.topicStates);
  const allTopics = useAllTopics();

  const report = reports.find((r) => r.sessionId === sessionId);
  const topic = report ? getTopic(report.topicId) : undefined;
  useDocTitle(topic ? `灯下批注 · ${topic.title}` : '灯下批注');

  const [openRemedy, setOpenRemedy] = useState<string | null>(
    () => report?.blindSpots.find((b) => b.mcId)?.mcId ?? null,
  );
  const [openEvidence, setOpenEvidence] = useState(false);
  const [tab, setTab] = useState<ReviewTab>('notes');

  if (!report) {
    return (
      <div className={s.page}>
        <Empty
          className={s.rise}
          icon={<FileSearch size={22} strokeWidth={1.75} />}
          title="这份教学档案还不存在"
          description="可能链接有误,或者演示数据刚被重置。先回学习终端给小白讲一课,这里就会长出属于你的第一份档案。"
          action={<Button asChild variant="solid"><Link to="/learn">回学习终端</Link></Button>}
        />
      </div>
    );
  }

  const sessionEvents = events.filter((e) => e.sessionId === sessionId);
  const traces = live && live.sessionId === sessionId ? live.traces : [];
  const hasPrev = !!report.radarDelta && Object.keys(report.radarDelta).length > 0;

  // 叙事派生:纯函数、小数组,每帧直接算,不值得 memo
  const encounters = topic ? deriveDemonReport(topic, sessionEvents) : [];
  const diary = topic ? deriveDiary({ topic, sessionEvents, report }) : null;
  // 下课钤印:课前/课后事件切片各复算一遍印匣,差集即本课新落之印(老档案回看同样成立)
  const honors = sessionId
    ? deriveSessionHonors({ events, reports, global, topicStates, topics: allTopics }, sessionId)
    : null;

  // 概览一行的四个数:全部由报告现成字段换算,展示用整数相减(与雷达同一套记账)
  const radarAvg = Math.round(RADAR_DIMS.reduce((sum, k) => sum + report.radar[k], 0) / RADAR_DIMS.length * 100);
  const prevAvg = hasPrev
    ? Math.round(RADAR_DIMS.reduce((sum, k) => sum + report.radar[k] - (report.radarDelta?.[k] ?? 0), 0) / RADAR_DIMS.length * 100)
    : radarAvg;
  const avgDelta = radarAvg - prevAvg;
  const quizRight = report.quiz ? report.quiz.answers.filter((a) => a.correct).length : 0;
  const remedyCount = report.blindSpots.filter((b) => b.mcId).length;
  const topicState = topicStates[report.topicId];
  const masteryPct = topicState ? Math.round(Math.min(1, Math.max(0, topicState.mastery)) * 100) : 0;

  // 下一步:同一门课里排在后面的那个可进入的知识点
  const courseTopics = topic ? allTopics.filter((t) => t.course === topic.course && !t.locked) : [];
  const nextTopic = topic ? courseTopics[courseTopics.findIndex((t) => t.topicId === topic.topicId) + 1] : undefined;

  /** 「去救小白」:展开该心魔的补学微路径,并把对应盲区条目滚进视野 */
  const rescueXiaobai = (mcId: string) => {
    setOpenRemedy(mcId);
    // 滚动必须推迟到 React 提交 + 折叠过渡(320ms)结束后:同步滚会用旧布局坐标,
    // 上方原本展开的补学路径收起时内容整体上移,目标就滚偏了。reduced-motion 下全局
    // 开关已把过渡压到 0.01ms,0ms 延时(等提交)即可
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
      document.getElementById(`blind-${mcId}`)?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth',
        block: 'center',
      });
    }, reduce ? 0 : 360);
  };

  return (
    <div className={s.page}>
      {/* 题头:左题名,右一张档案卡(卷宗索引卡,「批阅讫」方章盖在卡角) */}
      <header className={cx(s.head, s.rise)} style={rise(0)}>
        <div className={s.headMain}>
          <nav className={s.crumb} aria-label="所在位置">
            <Link to="/learn">学习终端</Link>
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>第四章 · 灯下批注</span>
          </nav>
          <h1 className={s.title}>{topic?.title ?? report.topicId}</h1>
          <p className={s.subTitle}>这一课的完整复盘:先看讲得好的,再看小白还没懂的。</p>
          <div className={s.metaRow}>
            <Badge tone="outline">{MODE_LABEL[report.mode]}</Badge>
            <span>{fmtDate(report.startedAt)} 开讲</span>
            <span>共 {report.turnCount} 轮</span>
            {report.masteredNow && <Badge tone="ok" dot>本次出师</Badge>}
          </div>
        </div>
        <aside className={cx(s.fileCard, paper.texture)} data-story aria-label="教学档案卡">
          <p className={s.fileCardHead}>
            <span className={paper.typeLabel}>DOSSIER · 教学档案</span>
          </p>
          <dl className={s.fileRows}>
            <div><dt>档案号</dt><dd className={s.fileNo}>{report.sessionId}</dd></div>
            <div><dt>课型</dt><dd>{MODE_LABEL[report.mode]}</dd></div>
            <div><dt>批阅</dt><dd>{report.highlights.length} 处高光 · {report.blindSpots.length} 处盲区</dd></div>
          </dl>
          <span className={s.seal} aria-hidden="true">批阅讫</span>
        </aside>
      </header>

      {/* 概览:四个数 + 当前掌握度,一行读完这一课 */}
      <section className={cx(s.summary, s.rise)} style={rise(1)} aria-label="本课概览">
        <div className={s.stats}>
          <div className={s.stat}>
            <span className={s.statLabel}>小白小测</span>
            <strong className={s.statValue}>
              {report.quiz ? report.quiz.score : '—'}
              {report.quiz && <small>分</small>}
            </strong>
            <span className={s.statNote}>
              {report.quiz ? `${quizRight} / ${report.quiz.answers.length} 题答稳` : '复习课不设小测'}
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>五维均分</span>
            <strong className={s.statValue}>
              {radarAvg}
              {avgDelta !== 0 && (
                <em className={avgDelta > 0 ? s.deltaUp : s.deltaDown}>{avgDelta > 0 ? '+' : ''}{avgDelta}</em>
              )}
            </strong>
            <span className={s.statNote}>{hasPrev ? '只和你自己的上一次比' : '这一课的首份画像'}</span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>高光</span>
            <strong className={s.statValue}>{report.highlights.length}<small>处</small></strong>
            <span className={s.statNote}>
              {report.goldenAnalogies.length > 0 ? `金句 ${report.goldenAnalogies.length} 句已收录` : '这一课没有金句'}
            </span>
          </div>
          <div className={s.stat}>
            <span className={s.statLabel}>小白还没懂</span>
            <strong className={s.statValue}>{report.blindSpots.length}<small>处</small></strong>
            <span className={s.statNote}>
              {report.blindSpots.length === 0
                ? '小白全都听懂了'
                : remedyCount > 0 ? `${remedyCount} 处附补学路径` : '回讲台再讲一遍'}
            </span>
          </div>
        </div>
        {topicState && (
          <div className={s.masteryRow}>
            <span className={s.masteryLabel}>当前掌握度</span>
            <Progress
              className={s.masteryBar}
              value={masteryPct}
              tone={topicState.knowledgeState === '出师' ? 'ok' : 'accent'}
              label="当前掌握度"
            />
            <span className={s.masteryVal}>{masteryPct}%</span>
            <Badge tone={STATE_BADGE[topicState.knowledgeState].tone}>
              {STATE_BADGE[topicState.knowledgeState].label}
            </Badge>
          </div>
        )}
      </section>

      {/* 出师那一课:结业证书顶格,先于一切分栏(doc §7 仪式资产) */}
      {report.masteredNow && topic && <MasteryCertificate topic={topic} report={report} />}

      {/* 下课钤印:本课新落的印章/晋级/升期,无新荣誉整条不渲染 */}
      {honors && <div data-story><HonorRoll honors={honors} /></div>}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ReviewTab)}
        label="复盘分栏"
        className={s.tabs}
        items={[
          { value: 'notes', label: '批注', icon: <Highlighter size={15} strokeWidth={1.75} /> },
          { value: 'scores', label: '成绩与证据', icon: <RadarIcon size={15} strokeWidth={1.75} /> },
          { value: 'diary', label: '小白日记', icon: <NotebookText size={15} strokeWidth={1.75} /> },
        ]}
      >
        {/* ── 批注:高光在前,盲区在后(顺序铁律) ── */}
        <TabPanel value="notes" forceMount className={s.panel}>
          <section className={s.section}>
            <header className={s.sectionHead}>
              <h2>高光时刻</h2>
              <p>讲得好的地方先记一笔,金句会收进教学素材库。</p>
            </header>
            {/* 老档案兜底:高光与金句都缺席时给一行紧凑空态,不留死白 */}
            {report.highlights.length === 0 && report.goldenAnalogies.length === 0 && (
              <p className={s.muted}>这一课没有留下高光记录。</p>
            )}
            {report.highlights.length > 0 && (
              <ul className={s.highlightList}>
                {report.highlights.map((h) => (
                  <li key={h} className={s.highlightItem}>
                    <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}
            {report.goldenAnalogies.length > 0 && (
              <div className={s.goldenRow}>
                {report.goldenAnalogies.map((g) => (
                  <figure key={g} className={cx(s.goldenCard, paper.texture)} data-story>
                    <span className={s.goldenTag}>金句收录 · GOLDEN QUOTE</span>
                    <blockquote className={s.goldenText}>{g}</blockquote>
                    <figcaption className={s.goldenFrom}>出自「{topic?.title ?? report.topicId}」</figcaption>
                    <span className={s.penNote} aria-hidden="true">这句好,收了。</span>
                  </figure>
                ))}
              </div>
            )}
          </section>

          <section className={s.section}>
            <header className={s.sectionHead}>
              <h2>小白还没懂的地方</h2>
              <p>不是你不行,是它还没被讲明白。</p>
            </header>
            {/* 心魔战报(doc §3.2):注入当下零提示,一切戏剧化只落在课后这里 */}
            {encounters.length > 0 && (
              <div className={s.demonReport}>
                <p className={s.demonHead}>
                  <Swords size={17} strokeWidth={1.75} aria-hidden="true" />
                  本课遭遇心魔 × {encounters.length}
                </p>
                <ul className={s.demonList}>
                  {encounters.map((en) => (
                    <li key={en.mcId} className={cx(s.demonCard, s[OUTCOME_CLASS[en.outcome]])}>
                      <div className={s.demonRow}>
                        <span className={s.demonChip}>{en.name}</span>
                        <Badge tone={OUTCOME_BADGE[en.outcome].tone}>{OUTCOME_BADGE[en.outcome].label}</Badge>
                      </div>
                      {en.belief && <p className={s.demonBelief}>「{en.belief}」</p>}
                      <p className={s.demonLine}>{en.line}</p>
                      {en.outcome === 'stray' && (
                        <Button
                          variant="danger"
                          size="sm"
                          pill
                          className={s.rescueBtn}
                          iconRight={<ArrowRight size={14} strokeWidth={1.75} />}
                          onClick={() => rescueXiaobai(en.mcId)}
                        >
                          去救小白
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.blindSpots.length === 0 ? (
              <p className={s.muted}>
                {report.masteredNow
                  ? '本场满分出师,没有留下盲区——「补学小径」只在小白答错或被带偏时才会出现。'
                  : '这次没有留下盲区——小白全都听懂了。「补学小径」只在小白答错或被带偏时才会出现。'}
              </p>
            ) : (
              <>
                <p className={s.blindLead}>下面每一条,都是小白还没转过弯来的地方。带补学路径的,三步就能把它讲明白。</p>
                <ul className={s.blindList}>
                  {report.blindSpots.map((spot, i) => {
                    const mc = spot.mcId ? topic?.misconceptions.find((m) => m.mcId === spot.mcId) : undefined;
                    const opened = !!mc && openRemedy === mc.mcId;
                    return (
                      <li
                        key={`${spot.knowledgePoint}-${i}`}
                        id={spot.mcId ? `blind-${spot.mcId}` : undefined}
                        className={cx(s.blindItem, spot.severity === 'high' && s.blindItemHigh)}
                      >
                        <div className={s.blindHead}>
                          <span className={s.blindPoint}>{spot.knowledgePoint}</span>
                          <Badge tone={SEVERITY_TONE[spot.severity]} dot>{SEVERITY_LABEL[spot.severity]}</Badge>
                        </div>
                        <p className={s.blindEvidence}>{spot.evidence}</p>
                        {mc && (
                          <>
                            <button
                              type="button"
                              className={s.remedyToggle}
                              aria-expanded={opened}
                              aria-controls={`remedy-${mc.mcId}`}
                              onClick={() => setOpenRemedy(opened ? null : mc.mcId)}
                            >
                              <ChevronRight size={16} strokeWidth={1.75} className={cx(s.chev, opened && s.chevOpen)} aria-hidden="true" />
                              {opened ? '收起补学路径' : '展开补学路径:三步把它讲明白'}
                            </button>
                            <div id={`remedy-${mc.mcId}`} className={cx(s.collapse, opened && s.open)}>
                              <div inert={!opened}>
                                <RemedyPath topicId={report.topicId} mc={mc} />
                              </div>
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        </TabPanel>

        {/* ── 成绩与证据:五维画像、小测成绩单、可展开的证据链 ── */}
        <TabPanel value="scores" forceMount className={s.panel}>
          <section className={s.section}>
            <header className={s.sectionHead}>
              <h2>五维画像</h2>
              <p>雷达只和你自己的上一次比,不与任何人排名。</p>
            </header>
            <div className={s.radarSplit}>
              <div className={s.radarWrap}>
                <Radar radar={report.radar} delta={report.radarDelta} />
              </div>
              <div className={s.dimCol}>
                <ul className={s.dimList}>
                  {RADAR_DIMS.map((k) => {
                    const val = Math.round(report.radar[k] * 100);
                    const d = report.radarDelta?.[k];
                    // 与 Radar 同一套「展示用整数相减」,避免 85 旁挂 +1 的错账
                    const dPct = typeof d === 'number' ? val - Math.round((report.radar[k] - d) * 100) : 0;
                    return (
                      <li key={k} className={s.dimRow}>
                        <span className={s.dimName}>{k}</span>
                        <Progress className={s.dimBar} value={val} label={k} />
                        <span className={s.dimVal}>
                          {val}
                          {dPct !== 0 && (
                            <em className={dPct > 0 ? s.deltaUp : s.deltaDown}>{dPct > 0 ? '+' : ''}{dPct}</em>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className={s.legend}>
                  <span className={s.legendNow}>本次</span>
                  {hasPrev && <span className={s.legendPrev}>上次</span>}
                </div>
              </div>
            </div>
          </section>

          <section className={s.section}>
            <header className={s.sectionHead}>
              <h2>放榜细目</h2>
              <p>考的是小白,不是你。</p>
            </header>
            {report.quiz ? (
              <div className={cx(s.quizCard, paper.texture)} data-story>
                <div className={s.quizStub}>
                  <span className={s.quizStubLabel}>成绩单 · SCORECARD</span>
                  <span className={s.quizScoreWrap}>
                    <span className={s.quizScore}>{report.quiz.score}</span>
                    <span className={s.quizUnit}>分</span>
                    {/* 红笔圈分:老师批完卷在分数外随手画的一圈 */}
                    <svg className={s.scoreRing} viewBox="0 0 140 76" preserveAspectRatio="none" aria-hidden="true">
                      <path d="M20 44C12 20 52 5 88 8c30 3 46 18 40 36-6 17-38 26-70 24C28 66 6 52 16 30" />
                    </svg>
                  </span>
                  <p className={s.quizCaption}>小白只答得出你教明白的东西——它答错的题,就是你没讲清的地方。</p>
                </div>
                <ul className={s.quizList}>
                  {report.quiz.answers.map((a, i) => {
                    const q = topic?.quizBank.find((x) => x.id === a.quizId);
                    const point = topic?.checklist.find((c) => c.id === a.checklistRef)?.point ?? a.checklistRef;
                    return (
                      <li key={a.quizId} className={s.quizItem}>
                        <PenMark right={a.correct} />
                        <div>
                          <p className={s.quizQ}>{i + 1}. {q?.question ?? a.quizId}</p>
                          <p className={s.quizNote}>
                            {a.correct
                              ? `小白答对了——「${point}」你讲清了`
                              : `小白答错了——「${point}」正是你还没讲清的地方`}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className={s.muted}>本次是复习课,没有安排随堂小测。</p>
            )}
          </section>

          {/* 证据链 —— 可审计的教学录像带,默认收起 */}
          <section className={s.section}>
            <header className={s.sectionHead}>
              <h2>证据链</h2>
              <p>每个分数都有出处,能回放到它发生的那一刻。</p>
            </header>
            <button
              type="button"
              className={s.evidenceToggle}
              aria-expanded={openEvidence}
              aria-controls="review-evidence"
              onClick={() => setOpenEvidence((v) => !v)}
            >
              <ChevronRight size={16} strokeWidth={1.75} className={cx(s.chev, openEvidence && s.chevOpen)} aria-hidden="true" />
              <span>{openEvidence ? '收起证据链' : '这些分数怎么来的?展开证据链'}</span>
              <Badge>{sessionEvents.length} 条记录</Badge>
            </button>
            <div id="review-evidence" className={cx(s.collapse, openEvidence && s.open)}>
              <div className={s.evidenceBody} inert={!openEvidence}>
                <ol className={s.timeline}>
                  {sessionEvents.length === 0 && (
                    <li className={s.mutedSmall}>本会话没有留下事件记录。</li>
                  )}
                  {sessionEvents.map((e) => (
                    <li key={e.id} className={s.timelineItem}>
                      <span className={s.timelineTime}>{fmtTime(e.t)}</span>
                      <Badge tone={eventTone(e.type)}>{EVENT_LABEL[e.type] ?? e.type}</Badge>
                      <span className={s.timelineText}>{e.evidence}</span>
                    </li>
                  ))}
                </ol>
                {traces.length > 0 ? (
                  <div className={s.traceBlock}>
                    <h3 className={s.h3}>逐轮评估判语</h3>
                    <ol className={s.traceList}>
                      {traces.map((t) => (
                        <li key={t.turn} className={s.traceItem}>
                          <span className={s.traceTurn}>第 {t.turn} 轮</span>
                          <span className={s.traceText}>{t.evalResult.reasoning}</span>
                          <span className={s.traceAction}>→ {t.card.action}</span>
                          {t.llmMode !== undefined && t.llmMode !== 'mock' && (t.renderSource === 'mock' || t.evalSource === 'rules') ? (
                            <span className={s.traceNote}>
                              {[t.evalSource === 'rules' ? '规则评估' : null, t.renderSource === 'mock' ? '离线台词' : null].filter(Boolean).join(' · ')}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p className={cx(s.mutedSmall, s.traceGone)}>
                    逐轮评估判语随讲解舱会话窗口关闭而释放;上面的事件流是永久留存的证据,每一分都能回放到它发生的那一刻。
                  </p>
                )}
              </div>
            </div>
          </section>
        </TabPanel>

        {/* ── 小白日记:它把今天听懂的、听岔的,都当真写了下来 ── */}
        <TabPanel value="diary" forceMount className={s.panel}>
          <section className={s.section}>
            <header className={s.sectionHead}>
              <h2>小白眼里的今天</h2>
              <p>它把今天听懂的、听岔的,都当真写进了日记。</p>
            </header>
            {diary
              ? <XiaobaiDiary page={diary} />
              : <p className={s.muted}>这一课的讲义已经不在书架上,日记没法重写了。</p>}
          </section>
        </TabPanel>
      </Tabs>

      {/* 下一步 —— 档案读完不留死胡同 */}
      <footer className={cx(s.footNav, s.rise)} style={rise(3)}>
        <div className={s.footText}>
          <strong>{report.masteredNow ? '这一课,小白出师了' : '下一步'}</strong>
          <span>
            {report.masteredNow
              ? '趁热打铁,带小白学下一个知识点。'
              : report.blindSpots.length > 0
                ? '回讲台把盲区讲明白,小白还在等。'
                : '再讲一轮,把小白送到出师。'}
          </span>
        </div>
        <div className={s.footActions}>
          {report.masteredNow ? (
            nextTopic ? (
              <Button asChild variant="solid" size="lg" iconRight={<ArrowRight size={17} strokeWidth={1.75} />}>
                <Link to={`/prep/${nextTopic.topicId}`}>学下一个:{nextTopic.title}</Link>
              </Button>
            ) : (
              <Button asChild variant="solid" size="lg" iconRight={<ArrowRight size={17} strokeWidth={1.75} />}>
                <Link to="/learn">回学习终端,再挑一本</Link>
              </Button>
            )
          ) : (
            <Button asChild variant="solid" size="lg" icon={<RotateCcw size={17} strokeWidth={1.75} />}>
              <Link to={`/teach/${report.topicId}`}>
                {report.blindSpots.length > 0 ? '回讲台,把盲区讲明白' : '回讲台,再讲一轮'}
              </Link>
            </Button>
          )}
          {!report.masteredNow && nextTopic && (
            <Button asChild variant="outline" size="lg">
              <Link to={`/prep/${nextTopic.topicId}`}>下一个知识点</Link>
            </Button>
          )}
          {(!report.masteredNow || nextTopic) && (
            <Button asChild variant="ghost" size="lg">
              <Link to="/learn">回学习终端</Link>
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}
