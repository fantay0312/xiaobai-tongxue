/**
 * 成长页 /growth —— 小白的「成长册」:现代页面框住手作物件。
 * 题头(小白档案照 + 一句现状 + 性情) / 概览数字带(阶段·学识·出师·连续) /
 * 科名五阶进阶轨 + 侧注(下一步、师道称号) / 成就印章 / 教学编年史 /
 * 学问星海(深空场景卡;遗忘的知识点化作「小白的来信」) / 金句画廊 /
 * 小白的记忆(四层记忆匣,engine/recall 派生) / 小白眼里的你(印象句+可复算出处)。
 * 纸质物件(档案照、印章册、来信、金句、记忆册、印象笺)根上挂 data-story,回到老学堂纸墨。
 * 数据全部真实派生:印章与师道称号来自 engine/achievements,下一步来自 engine/journey,
 * 编年史把 events 按 sessionId 与 reports 并轨(sessionId 为 null 的备课/补学作独立眉批);
 * 卷二/卷三/卷尾 section 带 id(chronicle/map/bond)供卷五记忆匣的锚点按钮 scrollIntoView。
 * 保留契约:setPersona / 复习 await startReview(topicId) → navigate(`/teach/${topicId}?mode=review`)
 * 且 reviewBusy 防抖原样。
 */
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowRight, Award, Check, ChevronDown, Compass, Flame, GraduationCap, Mail, NotebookText, Presentation, Quote, ScrollText, X,
} from 'lucide-react';
import type { LearnEvent, LearnEventType, Persona, SessionMode, SessionReport, XiaobaiMood } from '../../types';
import { useAppStore } from '../../store/appStore';
import { getTopic } from '../../data';
import { STAR_LINKS } from '../../data/starLinks';
import { TEACHER_RANKS, deriveAchievements, deriveTeacherRank } from '../../engine/achievements';
import { nextStep } from '../../engine/journey';
// 双轨成长引擎:同 achievements/journey 惯例按路径直接 import,不进 engine barrel
import {
  STAGE_META, STAGE_RULES, deriveWisdom, deriveEvolution, getStageMeta, wisdomThreshold,
} from '../../engine/evolution';
import { deriveXiaobaiLetter } from '../../engine/story';
import { deriveMemoryPanorama, deriveRelationshipLines, deriveTopicRecall } from '../../engine/recall';
import { computeMasteryBreakdown } from '../../engine/memory';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { XiaobaiLetter } from '../../components/story/XiaobaiLetter';
import { MemoryPanorama } from '../../components/story/MemoryPanorama';
import { MemoryLedger } from './MemoryLedger';
import { Badge, Button, Empty, Progress, cx } from '../../components/ui';
import { useDocTitle } from '../../hooks/useDocTitle';
import { useAllTopics } from '../../hooks/useAllTopics';
import { KnowledgeMap, type MapNode, type NodeStatus } from './KnowledgeMap';
import { AchievementWall } from './AchievementWall';
import { PersonaPicker } from './PersonaPicker';
import paper from '../../styles/paper.module.css';
import scope from './paperScope.module.css';
import s from './growth.module.css';
import { IconSpark } from '../../components/ui/icons';

const DREAM_GOAL = 5;

const PERSONA_MOOD: Record<Persona, XiaobaiMood> = {
  好奇型: 'curious',
  严谨型: 'thinking',
  杠精型: 'proud',
};

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

const MODE_LABEL: Record<SessionMode, string> = { teach: '讲解', reteach: '重讲', review: '复习' };

/* 巡天筛选器五态(与星图 NodeStatus 咬合);次序 = 出师→衰减→学习中→未学→未开放 */
const STATUS_FILTERS: { key: NodeStatus; label: string }[] = [
  { key: 'mastered', label: '出师' },
  { key: 'forgotten', label: '衰减待复习' },
  { key: 'learning', label: '学习中' },
  { key: 'unlearned', label: '未学' },
  { key: 'locked', label: '未开放' },
];

/* 状态→图例色点:复用星图图例的 swatch 配色,筛选器与星链行同一套色语 */
const STATUS_SWATCH: Record<NodeStatus, string> = {
  mastered: s.swJade,
  forgotten: s.swAmber,
  learning: s.swAzure,
  unlearned: s.swDust,
  locked: s.swLocked,
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

/* 入场步进 60ms,同屏最长 delay 封顶 240ms */
const rise = (i: number) => ({ animationDelay: `${Math.min(i * 60, 240)}ms` });

// ── 连续学习:只数事件流里真实出现过的自然日 ──

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

function learningStreak(events: LearnEvent[]): { streak: number; activeDays: number } {
  const days = new Set(events.map((e) => dayKey(new Date(e.t))));
  const cursor = new Date();
  // 今天还没开课不算断:从昨天往回数
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { streak, activeDays: days.size };
}

// ── 卷二·编年史装订:events 按 sessionId 分组,与 reports 并轨,倒序 ──

interface SessionEntry {
  kind: 'session';
  sessionId: string;
  t: string;
  topicId: string;
  mode: SessionMode;
  turns: number | null;
  corrected: number;
  adopted: number;
  golden: number;
  reviewPassed: boolean;
  quizScore: number | null;
  mastered: boolean;
  abandoned: boolean;
  hasReport: boolean;
}

interface MarginEntry {
  kind: 'margin';
  id: string;
  t: string;
  topicId: string;
  type: 'prep_completed' | 'remedy_completed';
  evidence: string;
}

type ChronicleEntry = SessionEntry | MarginEntry;

function buildChronicle(events: LearnEvent[], reports: SessionReport[]): ChronicleEntry[] {
  const reportOf = new Map(reports.map((r) => [r.sessionId, r]));
  const groups = new Map<string, LearnEvent[]>();
  const margins: MarginEntry[] = [];
  for (const e of events) {
    if (e.sessionId) {
      const list = groups.get(e.sessionId);
      if (list) list.push(e);
      else groups.set(e.sessionId, [e]);
    } else if (e.type === 'prep_completed' || e.type === 'remedy_completed') {
      // 无会话归属的备课/补学:作独立眉批,evidence 本身已是一句人话
      margins.push({ kind: 'margin', id: e.id, t: e.t, topicId: e.topicId, type: e.type, evidence: e.evidence });
    }
  }
  const sessions: SessionEntry[] = [];
  for (const [sessionId, evs] of groups) {
    const report = reportOf.get(sessionId) ?? null;
    const first = evs[0];
    const rawMode = evs.find((e) => e.type === 'session_started')?.payload.mode;
    const ended = evs.find((e) => e.type === 'session_ended');
    const turnsRaw = report?.turnCount ?? ended?.payload.turns;
    const scoreRaw = report?.quiz?.score ?? evs.find((e) => e.type === 'xiaobai_quiz_scored')?.payload.score;
    sessions.push({
      kind: 'session',
      sessionId,
      t: first.t,
      topicId: first.topicId,
      mode: rawMode === 'reteach' || rawMode === 'review' ? rawMode : (report?.mode ?? 'teach'),
      turns: typeof turnsRaw === 'number' ? turnsRaw : null,
      corrected: evs.filter((e) => e.type === 'misconception_corrected').length,
      adopted: evs.filter((e) => e.type === 'misconception_adopted').length,
      golden: evs.filter((e) => e.type === 'golden_analogy_saved').length,
      reviewPassed: evs.some((e) => e.type === 'review_passed'),
      quizScore: typeof scoreRaw === 'number' ? scoreRaw : null,
      mastered: (report?.masteredNow ?? false) || evs.some((e) => e.type === 'topic_mastered'),
      abandoned: ended?.payload.abandoned === true,
      hasReport: report !== null,
    });
  }
  return [...sessions, ...margins].sort((a, b) => (a.t < b.t ? 1 : -1));
}

/** 一句叙事:按真实事件拼装,措辞克制;盲区语言纪律——只说小白怎么样,不说你错了。
    中途弃课不是互斥分支而是后缀从句:有成果也要如实记下「合上了书」,免得编年史与事实相反 */
function narrate(en: SessionEntry, title: string): string {
  const t = `〈${title}〉`;
  const head =
    en.mode === 'review' ? `这天你陪小白复习${t}`
      : en.mode === 'reteach' ? `这天你把${t}回炉重讲`
        : `这天你把${t}讲给小白`;
  const tail = en.abandoned && !en.mastered ? ',这一课中途合上了书' : '';
  if (en.mode === 'review' && en.reviewPassed) return `${head},几句点拨,它「想起来了」。`;
  if (en.mastered) return `${head},讲到它当堂出师。`;
  if (en.adopted > 0 && en.corrected > 0) return `${head},它把你将了一军,你也识破了它埋的误区${tail}。`;
  if (en.adopted > 0) return `${head},它在误区上把你将了一军${tail}。`;
  if (en.corrected > 0) return `${head},它埋的误区被你当场识破${tail}。`;
  if (en.golden > 0) return `${head},你打的比方被它记进了小本子${tail}。`;
  if (en.abandoned) return `${head},这一课中途合上了书。`;
  if (en.quizScore !== null) return `${head},随堂小测考了小白 ${en.quizScore} 分。`;
  // 只有 session_started 落档(直接关了标签页,没有下课事件):不能谎称「一问一答」
  if (!en.hasReport && en.turns === null) return `${head},这一课开了个头,还没讲完。`;
  return `${head},一问一答,平实往来。`;
}

export default function GrowthPage() {
  useDocTitle('成长册');
  const navigate = useNavigate();
  const global = useAppStore((st) => st.global);
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const topicStates = useAppStore((st) => st.topicStates);
  // 卷五当堂层要跟着课堂实时走:live 也入订阅,开课/下课/答问都会让记忆匣重新派生
  const live = useAppStore((st) => st.live);
  const topicStateOf = useAppStore((st) => st.topicState);
  const setPersona = useAppStore((st) => st.setPersona);
  const startReview = useAppStore((st) => st.startReview);
  const allTopics = useAllTopics();

  const [selected, setSelected] = useState<string | null>(null);
  const [statusFocus, setStatusFocus] = useState<NodeStatus | null>(null);
  const [oldPages, setOldPages] = useState(false);
  const [previewStage, setPreviewStage] = useState<number | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  // 印章 / 师道称号 / 下一步 / 编年史:全部由事件流等真实数据纯函数派生
  const deriveInput = useMemo(
    () => ({ events, reports, global, topicStates, topics: allTopics }),
    [events, reports, global, topicStates, allTopics],
  );
  const achievements = useMemo(() => deriveAchievements(deriveInput), [deriveInput]);
  const rank = useMemo(() => deriveTeacherRank(deriveInput), [deriveInput]);
  const step = useMemo(
    () => nextStep({ events, reports, topicStates, topics: allTopics }),
    [events, reports, topicStates, allTopics],
  );
  const chronicle = useMemo(() => buildChronicle(events, reports), [events, reports]);
  // 双轨成长(纯派生,不新增事件):学识经验轨(进阶)+ 五阶科名轨(进化),均从 events 重算
  const wisdom = useMemo(() => deriveWisdom(events), [events]);
  const evolution = useMemo(() => deriveEvolution(events, allTopics), [events, allTopics]);
  const next = evolution.next;
  // 卷五·四层记忆匣 + 卷尾·印象句:engine/recall 纯派生,每句都带可复算的出处
  const panorama = useMemo(
    () => deriveMemoryPanorama({ events, reports, topicStates, topics: allTopics, global, live }),
    [events, reports, topicStates, allTopics, global, live],
  );
  // 印象句只从真实事件派生:存量 relationshipMemory 字符串已停写(关系记忆改由学伴记忆承担),不再回灌
  const bondLines = useMemo(
    () => deriveRelationshipLines({ events, reports, global: { ...global, relationshipMemory: [] } }),
    [events, reports, global],
  );

  // 学识条:intoLevel 已入本阶的点数 / forNext 进阶门槛(deriveWisdom 收口,恒 >0)
  const wisdomLeft = Math.max(0, wisdom.forNext - wisdom.intoLevel);
  const wisdomPct = wisdom.forNext > 0 ? Math.min(100, (wisdom.intoLevel / wisdom.forNext) * 100) : 100;

  const earnedCount = achievements.filter((a) => a.earnedAt !== null).length;
  // 星图↔印章叙事桥:距《全谱》还差几星(全谱印的真实进度差)+ 已落印几枚(实印数)
  const fullMapSeal = achievements.find((a) => a.id === 'full-map');
  const starsToFull = fullMapSeal
    ? Math.max(0, fullMapSeal.progress.target - fullMapSeal.progress.now)
    : 0;
  const shownChronicle = oldPages ? chronicle : chronicle.slice(0, 6);

  const nodes: MapNode[] = useMemo(() => allTopics.map((t) => {
    if (t.locked) return { topic: t, state: null, status: 'locked' as const };
    const st = topicStates[t.topicId] ?? topicStateOf(t.topicId);
    const touched =
      st.hitChecklist.length > 0 || st.prepDone || st.knowledgeState !== '没懂' ||
      events.some((e) => e.topicId === t.topicId);
    const status = st.forgotten
      ? ('forgotten' as const)
      : st.knowledgeState === '出师'
        ? ('mastered' as const)
        : touched
          ? ('learning' as const)
          : ('unlearned' as const);
    return { topic: t, state: st, status };
  }), [allTopics, events, topicStateOf, topicStates]);

  const selNode = nodes.find((n) => n.topic.topicId === selected) ?? null;
  const evidencePanelRef = useRef<HTMLElement | null>(null);
  // 同印章册预览:收起时缓存内容,折叠动画不吃空
  const lastNodeRef = useRef<MapNode | null>(null);
  if (selNode) lastNodeRef.current = selNode;
  const shownNode = selNode ?? lastNodeRef.current;
  const shownEvents = shownNode ? events.filter((e) => e.topicId === shownNode.topic.topicId) : [];
  const masteryBreakdown = shownNode?.state
    ? computeMasteryBreakdown(shownNode.state, shownNode.topic, shownEvents)
    : null;
  const hasQuizEvidence = shownEvents.some((event) => event.type === 'xiaobai_quiz_scored');
  const forgottenNodes = nodes.filter((n) => n.status === 'forgotten');

  // 逐星记忆:选中星时派生「小白记得」——命中要点/金句/已纠正心魔/留存,空则不渲染
  const shownRecallId = shownNode?.topic.topicId ?? null;
  const recall = useMemo(
    () => (shownRecallId
      ? deriveTopicRecall({ topicId: shownRecallId, events, reports, topicStates, topics: allTopics })
      : null),
    [shownRecallId, events, reports, topicStates, allTopics],
  );

  // 巡天筛选器的实时计数:每一态多少颗星,直接从 nodes 数,不新造状态
  const statusCounts = nodes.reduce(
    (acc, n) => { acc[n.status] += 1; return acc; },
    { mastered: 0, forgotten: 0, learning: 0, unlearned: 0, locked: 0 } as Record<NodeStatus, number>,
  );

  // 选中星的星链邻居(用缓存的 shownNode,折叠动画中不塌空);端点均来自 STAR_LINKS
  const linkNeighbors = shownNode
    ? STAR_LINKS.flatMap((l) => {
      const id = shownNode.topic.topicId;
      if (l.a === id) return [{ id: l.b, note: l.note, cluster: l.cluster }];
      if (l.b === id) return [{ id: l.a, note: l.note, cluster: l.cluster }];
      return [];
    })
    : [];

  const mood: XiaobaiMood =
    global.learningLevel >= 5 ? 'proud' : global.topicsMastered > 0 ? 'happy' : PERSONA_MOOD[global.persona];
  const currentStage = getStageMeta(global.learningLevel);
  const expandedStage = previewStage ?? global.learningLevel;

  const goReview = async (topicId: string) => {
    if (reviewBusy) return;
    setReviewBusy(true);
    try {
      await startReview(topicId);
      navigate(`/teach/${topicId}?mode=review`);
    } finally {
      setReviewBusy(false);
    }
  };

  const selectStar = (topicId: string) => {
    setSelected(selected === topicId ? null : topicId);
  };

  // 题头一句现状 + 概览数字带:全部来自上面的真实派生
  const { streak, activeDays } = useMemo(() => learningStreak(events), [events]);
  const nextStageName = next ? getStageMeta(next.stage).name : null;
  const statusLine = (() => {
    if (!next || !nextStageName) return `小白已是「${currentStage.name}」，${currentStage.description}。`;
    const needs: string[] = [];
    const moreMasteries = Math.max(0, next.needMasteries - next.haveMasteries);
    const moreCourses = Math.max(0, next.needCourses - next.haveCourses);
    if (moreMasteries > 0) needs.push(`再教到出师 ${moreMasteries} 讲`);
    if (moreCourses > 0) needs.push(`再涉猎 ${moreCourses} 门课`);
    return `小白现在是「${currentStage.name}」，${needs.join('、') || '条件已齐'}就升「${nextStageName}」。`;
  })();

  const closeEvidence = () => {
    const closingId = selected;
    setSelected(null);
    if (!closingId) return;
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-star-id="${closingId}"] button`)
        ?.focus({ preventScroll: true });
    });
  };

  return (
    <div className={s.page}>
      {/* ── 卷首:题头档案 / 概览数字带 / 五阶进阶轨 / 侧注 ── */}
      <header
        id="growth-overview"
        className={cx(s.hero, s.rise)}
        style={rise(0)}
        aria-labelledby="growth-title"
      >
        <section className={s.profileColumn} aria-labelledby="growth-title">
          <div className={s.profileHeading}>
            <h1 id="growth-title" className={s.heroTitle}>小白的成长册</h1>
            <p className={s.heroSub}>{statusLine}</p>
            <p className={s.heroHint}>你教得越明白，它追问得越刁钻。</p>
          </div>

          {/* 进阶轨已完整播报身份；档案照只承担视觉叙事，避免读屏重复。 */}
          <figure className={cx(s.portrait, paper.texture)} data-story aria-hidden="true">
            <div className={s.portraitStage}>
              <XiaobaiAvatar mood={mood} level={global.learningLevel} variant="paper" size={124} />
            </div>
            <figcaption className={s.portraitCaption}>
              <span className={s.portraitName}>弟子 · 小白</span>
              <span className={s.portraitSeal}>白</span>
            </figcaption>
          </figure>

          <dl className={s.profileFacts} aria-label="小白档案">
            <div><dt>姓名</dt><dd>小白</dd></div>
            <div><dt>科名</dt><dd>{currentStage.name}</dd></div>
            <div className={s.personaFact}>
              <dt className={s.srOnly}>性情</dt>
              <dd><PersonaPicker value={global.persona} onChange={setPersona} /></dd>
            </div>
          </dl>
        </section>

        {/* 概览数字带:阶段 / 学识 / 出师 / 连续,只放真实值 */}
        <dl className={s.statRow} aria-label="成长概览">
          <div className={s.statTile}>
            <dt><GraduationCap size={15} strokeWidth={1.75} aria-hidden="true" />阶段</dt>
            <dd>
              <b>{currentStage.name}</b>
              <span className={s.stagePips} aria-hidden="true">
                {STAGE_META.map((meta) => (
                  <i key={meta.stage} data-on={meta.stage <= global.learningLevel || undefined} />
                ))}
              </span>
            </dd>
            <dd className={s.statNote}>第 {global.learningLevel} / {STAGE_META.length} 阶 · {currentStage.description}</dd>
          </div>
          <div className={s.statTile}>
            <dt><IconSpark size={15} />学识</dt>
            <dd>
              <b>{wisdom.xp}</b><small>点</small>
              <span className={s.statMeter} aria-hidden="true"><i style={{ width: `${wisdomPct}%` }} /></span>
            </dd>
            <dd className={s.statNote}>第 {wisdom.level} 阶 · 距进阶还差 {wisdomLeft} 点</dd>
          </div>
          <div className={s.statTile}>
            <dt><Award size={15} strokeWidth={1.75} aria-hidden="true" />出师</dt>
            <dd><b>{global.topicsMastered}</b><small>讲</small></dd>
            <dd className={s.statNote}>
              {evolution.coursesTouched.length > 0 ? `涉猎 ${evolution.coursesTouched.length} 门课` : '还没有出师的课'}
            </dd>
          </div>
          <div className={s.statTile}>
            <dt><Flame size={15} strokeWidth={1.75} aria-hidden="true" />连续</dt>
            <dd><b>{streak}</b><small>天</small></dd>
            <dd className={s.statNote}>
              {activeDays > 0 ? `累计 ${activeDays} 天有课堂记录` : '开第一课后开始计数'}
            </dd>
          </div>
        </dl>

        <section className={s.chronicleColumn} aria-label="小白的五阶成长进度">
          <header className={s.railHead}>
            <h2 className={s.h2}>科名进阶</h2>
            <p className={s.secNote}>出师讲数与涉猎课程决定科名；学识点数是另一条不封顶的成长轨。</p>
          </header>
          <div className={s.chronicleTrack}>
            <ol
              className={s.ladder}
              aria-label={`小白的科名成长阶梯，当前${currentStage.name}·${currentStage.description}`}
            >
              {STAGE_META.map((stageMeta) => {
                const stageRule = STAGE_RULES.find((rule) => rule.stage === stageMeta.stage);
                const isCurrent = stageMeta.stage === global.learningLevel;
                const isPast = stageMeta.stage < global.learningLevel;
                const isNext = !!next && next.stage === stageMeta.stage;
                const isExpanded = expandedStage === stageMeta.stage;
                const previewTarget = wisdomThreshold(stageMeta.stage + 1);
                const togglePreview = () => setPreviewStage(isExpanded ? 0 : stageMeta.stage);
                const stateLabel = isPast ? '已完成' : isCurrent ? '当前阶段' : '未达到';
                return (
                  <li
                    key={stageMeta.stage}
                    aria-current={isCurrent ? 'step' : undefined}
                    className={cx(s.rung, isCurrent && s.currentRung, isPast && s.rungPast, isNext && s.rungNext)}
                  >
                    {isCurrent ? (
                      <section className={s.currentChapter} aria-label={`当前科名：${currentStage.name}，${currentStage.description}`}>
                        <div className={s.rungHead}>
                          <button
                            type="button"
                            className={s.stageToggle}
                            onClick={togglePreview}
                            aria-label={`${isExpanded ? '收起' : '展开'}${stageMeta.name}学识进度`}
                            aria-expanded={isExpanded}
                            aria-controls={`stage-wisdom-${stageMeta.stage}`}
                          >
                            <span className={s.currentMarker} aria-hidden="true" />
                          </button>
                          <div className={s.currentHeading}>
                            <h3>{currentStage.name}</h3>
                            <p>{currentStage.description}</p>
                          </div>
                          <Badge tone="accent" className={s.rungState}>当前阶段</Badge>
                          <ChevronDown size={16} strokeWidth={1.75} className={s.rungChevron} aria-hidden="true" />
                        </div>

                        {/* 学识经验与科名是两条独立成长轨；无上限学识只称“第 N 阶”。 */}
                        <div id={`stage-wisdom-${stageMeta.stage}`} className={s.wisdom} hidden={!isExpanded}>
                          <div className={s.wisdomHead}>
                            <span className={s.wisdomLabel}>学识 · 第 {wisdom.level} 阶</span>
                            <span className={s.wisdomGap}>
                              <b className={s.num}>{wisdom.intoLevel}</b> / {wisdom.forNext} 点 · 距进阶还差 <b className={s.num}>{wisdomLeft}</b> 点
                            </span>
                          </div>
                          <div
                            className={s.wisdomTrack}
                            role="progressbar"
                            aria-valuenow={wisdom.intoLevel}
                            aria-valuemin={0}
                            aria-valuemax={wisdom.forNext}
                            aria-label={`小白学识第 ${wisdom.level} 阶`}
                            aria-valuetext={`已积 ${wisdom.intoLevel} 点，距第 ${wisdom.level + 1} 阶还差 ${wisdomLeft} 点`}
                          >
                            <span className={s.wisdomFill} style={{ width: `${wisdomPct}%` }} />
                          </div>
                        </div>

                        <blockquote className={cx(s.dreamThread, scope.scope)} data-story>
                          <p className={s.dreamLabel}>小白一直记着的愿望</p>
                          <p className={s.dreamText}>“我想有一天，也能像先生一样，把道理讲给别人听。”</p>
                          <footer className={s.dreamProgress}>
                            {global.topicsMastered >= DREAM_GOAL
                              ? '第一程已圆满'
                              : `离第一次试讲还差 ${DREAM_GOAL - global.topicsMastered} 门`}
                          </footer>
                        </blockquote>

                        {global.topicsMastered >= DREAM_GOAL && (
                          <section className={s.graduationScene} aria-label="小白的第一次试讲，已由五门出师记录解锁">
                            <span className={s.graduationLectern} aria-hidden="true">
                              <Presentation size={20} strokeWidth={1.75} />
                            </span>
                            <div>
                              <p className={s.graduationLabel}>终章已启 · 小白的第一次试讲</p>
                              <blockquote className={s.graduationQuote}>“先生，这回换我来讲给小小白听。”</blockquote>
                              <p className={s.graduationProof}>由已教到出师的 {global.topicsMastered} 门学问真实解锁</p>
                            </div>
                          </section>
                        )}
                      </section>
                    ) : (
                      <>
                        <div className={s.rungHead}>
                          <button
                            type="button"
                            className={s.stageToggle}
                            onClick={togglePreview}
                            aria-label={`${isExpanded ? '收起' : '展开'}${stageMeta.name}学识进度`}
                            aria-expanded={isExpanded}
                            aria-controls={`stage-wisdom-${stageMeta.stage}`}
                          >
                            <span className={s.rungMarker} aria-hidden="true">
                              {isPast && <Check size={12} strokeWidth={3} />}
                            </span>
                          </button>
                          <span className={s.srOnly}>{stateLabel}</span>
                          <span className={s.rungSign}>{stageMeta.name}</span>
                          <span className={s.rungDesc}>{stageMeta.description}</span>
                          {stageMeta.stage === 1 ? (
                            <span className={s.rungReq}>无需门槛</span>
                          ) : next && next.stage === stageMeta.stage ? (
                            <span className={s.rungReq}>
                              <span className={s.reqMeter} data-done={next.haveMasteries >= next.needMasteries || undefined}>
                                <i style={{ width: `${Math.min(100, (next.haveMasteries / Math.max(1, next.needMasteries)) * 100)}%` }} />
                                <span className={s.reqClause}>出师 <b className={s.num}>{next.haveMasteries}</b>/<b className={s.num}>{next.needMasteries}</b></span>
                              </span>
                              {next.needCourses >= 2 && (
                                <span className={s.reqMeter} data-done={next.haveCourses >= next.needCourses || undefined}>
                                  <i style={{ width: `${Math.min(100, (next.haveCourses / Math.max(1, next.needCourses)) * 100)}%` }} />
                                  <span className={s.reqClause}>课程 <b className={s.num}>{next.haveCourses}</b>/<b className={s.num}>{next.needCourses}</b></span>
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className={s.rungReq}>
                              <span className={s.reqClause}>出师 <b className={s.num}>{stageRule?.masteries ?? 0}</b> 讲</span>
                              {(stageRule?.courses ?? 0) >= 2 && (
                                <> · <span className={s.reqClause}>涉猎 <b className={s.num}>{stageRule?.courses}</b> 门</span></>
                              )}
                            </span>
                          )}
                          <Badge
                            tone={isPast ? 'ok' : isNext ? 'accent' : 'neutral'}
                            className={s.rungState}
                            aria-hidden="true"
                          >
                            {isNext ? '下一阶' : stateLabel}
                          </Badge>
                          <ChevronDown size={16} strokeWidth={1.75} className={s.rungChevron} aria-hidden="true" />
                        </div>
                        <div id={`stage-wisdom-${stageMeta.stage}`} className={s.stagePreview} hidden={!isExpanded}>
                          <div className={s.wisdomHead}>
                            <span className={s.wisdomLabel}>学识进阶参考</span>
                            <span className={s.wisdomGap}><b className={s.num}>{wisdom.xp}</b> / {previewTarget} 点</span>
                          </div>
                          <div
                            className={s.wisdomTrack}
                            role="progressbar"
                            aria-label={`${stageMeta.name}学识点数参考`}
                            aria-valuemin={0}
                            aria-valuemax={previewTarget}
                            aria-valuenow={Math.min(wisdom.xp, previewTarget)}
                            aria-valuetext={`已积 ${wisdom.xp} 点，参考目标 ${previewTarget} 点；科名仍按出师与课程条件达成`}
                          >
                            <span className={s.wisdomFill} style={{ width: `${Math.min(100, wisdom.xp / previewTarget * 100)}%` }} />
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {next?.breadthBlocked && next.suggestedCourses[0] && (
            <p className={s.morphHint}>
              <Compass size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>
                小白想去别的书架看看——先生哪天换一门<em className={s.morphCourse}>《{next.suggestedCourses[0]}》</em>讲给他听？
              </span>
            </p>
          )}
        </section>

        <aside className={s.notesColumn} aria-label="成长侧注">
          {step && (
            <section className={s.journeyCard} aria-label={`下一步：${step.title}`}>
              <p className={s.journeyLabel}>下一步 · {step.title}</p>
              <p className={s.journeyLine}>{step.line}</p>
              <Button asChild variant="solid" iconRight={<ArrowRight size={16} strokeWidth={1.75} />}>
                <Link to={step.to}>{step.cta}</Link>
              </Button>
            </section>
          )}

          <section className={cx(s.rankCard, s.sidebarRankCard)} aria-label={`先生当前称号：${rank.title}`}>
            <div className={s.rankHead}>
              <span className={s.rankSeal} aria-hidden="true">师道</span>
              <div className={s.rankBody}>
                <p className={s.rankLabel}>先生的称号</p>
                <p className={s.rankTitle}>{rank.title}</p>
              </div>
            </div>
            <p className={s.rankScore}>
              出师 <b className={s.num}>{global.topicsMastered}</b> 门 · 实印 <b className={s.num}>{earnedCount}</b> 枚 · 履历 <b className={s.num}>{rank.score}</b> 分
            </p>
            <p className={s.rankNext}>
              {rank.nextTitle && rank.nextAt !== null
                ? <>距「{rank.nextTitle}」还差 <b className={s.num}>{rank.nextAt - rank.score}</b> 分。</>
                : '已至夫子，桃李成蹊。'}
            </p>
            <ol className={s.teacherRanks} aria-label="先生称号达成条件">
              {TEACHER_RANKS.map((tier) => {
                const reached = tier.at === 0 || rank.score >= tier.at;
                return (
                  <li key={tier.title} aria-current={tier.title === rank.title ? 'step' : undefined}>
                    <span className={s.tierName}>{tier.title}</span>
                    <small className={s.tierNeed}>{tier.at === 0 ? '初始称号' : `履历 ${tier.at} 分`}</small>
                    <Progress
                      className={s.tierBar}
                      tone={reached ? 'ok' : 'accent'}
                      max={Math.max(1, tier.at)}
                      value={tier.at === 0 ? 1 : Math.min(rank.score, tier.at)}
                      label={`${tier.title}达成进度`}
                    />
                    <small className={s.tierState}>{reached ? '已达成' : `${rank.score}/${tier.at}`}</small>
                  </li>
                );
              })}
            </ol>
            <p className={s.rankNote}>讲解要点、纠正误区、备课、复习与出师都会积累履历分。</p>
            <Button asChild variant="soft" size="sm" icon={<NotebookText size={15} strokeWidth={1.75} />}>
              <Link to="/growth#memory">查看小白的记忆</Link>
            </Button>
          </section>
        </aside>
      </header>

      {/* ── 成就印章:分叶装订的印章册,实印/虚印,点一枚看来历 ── */}
      <section className={cx(s.section, s.rise)} style={rise(1)} aria-labelledby="seals-title">
        <header className={s.secHead}>
          <div>
            <h2 className={s.h2} id="seals-title">成就印章</h2>
            <p className={s.secNote}>课堂有迹，落印有据。每一枚都由真实课堂记录解锁。</p>
          </div>
          <Badge tone={earnedCount > 0 ? 'accent' : 'neutral'} className={s.secCount}>
            已落印 {earnedCount} / {achievements.length}
          </Badge>
        </header>
        <AchievementWall achievements={achievements} litStars={statusCounts.mastered} />
      </section>

      {/* ── 教学编年史:events×reports 并轨的会话日志,倒序,默认最近 6 条 ── */}
      <section
        id="chronicle"
        className={cx(s.section, s.rise)}
        style={rise(2)}
        aria-labelledby="chronicle-title"
      >
        <header className={s.secHead}>
          <div>
            <h2 className={s.h2} id="chronicle-title">教学编年史</h2>
            <p className={s.secNote}>每一课都记在案，自新往旧翻。</p>
          </div>
          <dl className={s.ledgerMeta} aria-label="编年史摘要">
            <div>
              <dt>已出师</dt>
              <dd><b>{global.topicsMastered}</b><span>门</span></dd>
            </div>
            <div>
              <dt>最快纪录</dt>
              <dd><b>{global.bestRecord ?? '—'}</b></dd>
            </div>
            <div>
              <dt>金句入藏</dt>
              <dd><b>{global.goldenAnalogies.length}</b><span>句</span></dd>
            </div>
          </dl>
        </header>
        {chronicle.length === 0 ? (
          <div className={s.emptyCard}>
            <Empty
              icon={<ScrollText size={22} strokeWidth={1.75} />}
              title="第一课，还没落笔"
              description="去学习终端开一课，这本册子会替你记下每次讲明白的时刻。"
              action={(
                <Button asChild variant="outline" iconRight={<ArrowRight size={16} strokeWidth={1.75} />}>
                  <Link to="/learn">去学习终端</Link>
                </Button>
              )}
            />
          </div>
        ) : (
          <div className={s.logCard}>
            <ol className={s.logList} id="chronicle-log" role="list">
              {shownChronicle.map((en) => {
                if (en.kind === 'margin') {
                  return (
                    <li key={en.id} className={s.marginItem}>
                      <time className={s.logDate} dateTime={en.t}>{fmtDay(en.t)}</time>
                      <div className={s.marginRecord}>
                        <Badge tone="outline" className={s.marginTag}>{en.type === 'prep_completed' ? '备课' : '补学'}</Badge>
                        <span className={s.marginText}>「{getTopic(en.topicId)?.title ?? en.topicId}」· {en.evidence}</span>
                      </div>
                    </li>
                  );
                }
                const title = getTopic(en.topicId)?.title ?? en.topicId;
                return (
                  <li key={en.sessionId} className={en.mastered ? `${s.logItem} ${s.logMastered}` : s.logItem}>
                    <time className={s.logDate} dateTime={en.t}>{fmtDay(en.t)}</time>
                    <article className={s.logRecord}>
                      <header className={s.logHead}>
                        <h3 className={s.logTopic}>{title}</h3>
                        <div className={s.logFacts} aria-label="课堂纪录">
                          <Badge>{MODE_LABEL[en.mode]}</Badge>
                          {en.turns !== null && <Badge tone="outline">{en.turns} 轮</Badge>}
                          {en.corrected > 0 && <Badge tone="ok">纠正 ×{en.corrected}</Badge>}
                          {en.adopted > 0 && <Badge tone="bad">被带偏 ×{en.adopted}</Badge>}
                          {en.golden > 0 && <Badge tone="warn">金句 ×{en.golden}</Badge>}
                          {en.quizScore !== null && <Badge tone="outline">小测 {en.quizScore} 分</Badge>}
                          {en.mastered && <Badge tone="ok" dot>出师</Badge>}
                        </div>
                      </header>
                      <p className={s.logLine}>{narrate(en, title)}</p>
                      {en.hasReport && (
                        <Link to={`/review/${en.sessionId}`} className={s.logLink}>
                          查看复盘 <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
                        </Link>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
            {chronicle.length > 6 && (
              <Button
                variant="ghost"
                block
                className={s.pageTurn}
                aria-expanded={oldPages}
                aria-controls="chronicle-log"
                onClick={() => setOldPages((v) => !v)}
                iconRight={<ChevronDown size={16} strokeWidth={1.75} className={oldPages ? s.flip : undefined} aria-hidden="true" />}
              >
                {oldPages ? '收起旧页' : `翻旧页，还有 ${chronicle.length - 6} 条`}
              </Button>
            )}
          </div>
        )}
      </section>

      {/* ── 学问星海:单一深空场景 + 证据链 + 遗忘复习入口 ── */}
      <section id="map" className={cx(s.section, s.rise)} style={rise(3)} aria-labelledby="map-title">
        <header className={s.secHead}>
          <div>
            <h2 className={s.h2} id="map-title">学问星海</h2>
            <p className={s.secNote}>
              {forgottenNodes.length > 0
                ? '小白来信了——雾气漫上来的地方，该温一温。'
                : '一讲一星，点一颗星看这一讲的掌握证据。'}
            </p>
          </div>
        </header>
        <div className={s.filterRow} role="group" aria-label="巡天筛选:按状态聚焦星宿">
          <Button
            size="sm"
            pill
            variant="ghost"
            className={s.filterChip}
            aria-pressed={statusFocus === null}
            onClick={() => setStatusFocus(null)}
          >
            全览 <b className={s.filterCount}>{nodes.length}</b>
          </Button>
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              pill
              variant="ghost"
              className={s.filterChip}
              aria-pressed={statusFocus === f.key}
              onClick={() => setStatusFocus((cur) => (cur === f.key ? null : f.key))}
            >
              <span className={`${s.swatch} ${STATUS_SWATCH[f.key]}`} aria-hidden="true" />
              {f.label} <b className={s.filterCount}>{statusCounts[f.key]}</b>
            </Button>
          ))}
        </div>
        <div className={s.observatory}>
          <div className={s.chartColumn}>
            <div className={s.mapWrap}>
              <KnowledgeMap
                nodes={nodes}
                selectedId={selected}
                statusFocus={statusFocus}
                bridge={{ toFull: starsToFull, seals: earnedCount }}
                onSelect={selectStar}
              >
                {selNode ? (
                  <aside
                    id="knowledge-evidence"
                    ref={evidencePanelRef}
                    className={`${s.evidenceDock} ${s.evidenceDockOpen}`}
                    aria-label="掌握度证据链"
                    aria-live="polite"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') closeEvidence();
                    }}
                  >
                    <button
                      type="button"
                      className={s.evidenceClose}
                      aria-label={`收起${selNode.topic.title}的证据链`}
                      onClick={closeEvidence}
                    >
                      <X size={18} strokeWidth={2.2} aria-hidden="true" />
                    </button>
                    <div className={`${s.collapse} ${s.open}`}>
                      <div>
                        {shownNode && shownNode.state && (
                          <div className={s.nodePanel}>
                            <div className={s.panelHead}>
                              <h3 className={s.panelTitle}>{shownNode.topic.title}</h3>
                              <span className={
                                shownNode.status === 'mastered' ? `${s.chip} ${s.chipJade}`
                                  : shownNode.status === 'forgotten' ? `${s.chip} ${s.chipAmber}`
                                    : `${s.chip} ${s.chipAzure}`
                              }>
                                {shownNode.status === 'mastered' ? '已出师'
                                  : shownNode.status === 'forgotten' ? '小白说它忘了'
                                    : shownNode.state.knowledgeState}
                              </span>
                              <span className={s.chip}>掌握度 {Math.round(shownNode.state.mastery * 100)}</span>
                              <span className={s.chip}>
                                要点 {shownNode.state.hitChecklist.length}/{shownNode.topic.checklist.length}
                              </span>
                            </div>
                            {/* 星链行:这颗星在星海里牵着的邻星,点一枚即跳选(证据链随之切换);
                                未开放的邻星按星图纪律禁用,不做空跳 */}
                            {linkNeighbors.length > 0 && (
                              <div className={s.starLinkRow}>
                                <span className={s.starLinkLabel}>星链</span>
                                <div className={s.starLinkChips}>
                                  {linkNeighbors.map((nb) => {
                                    const nbNode = nodes.find((n) => n.topic.topicId === nb.id);
                                    const nbStatus = nbNode?.status ?? 'locked';
                                    const nbTitle = nbNode?.topic.title ?? getTopic(nb.id)?.title ?? nb.id;
                                    return (
                                      <button
                                        key={nb.id}
                                        type="button"
                                        className={s.starLinkChip}
                                        disabled={nbStatus === 'locked'}
                                        onClick={() => setSelected(nb.id)}
                                      >
                                        <span className={`${s.swatch} ${STATUS_SWATCH[nbStatus]}`} aria-hidden="true" />
                                        <span className={s.starLinkTitle}>{nbTitle}</span>
                                        <span className={s.starLinkNote}>{nb.note}</span>
                                        {nb.cluster ? <span className={s.starLinkCluster}>{nb.cluster}</span> : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {shownNode.status === 'forgotten' && (
                              <Button
                                size="sm"
                                variant="solid"
                                className={s.dockAction}
                                disabled={reviewBusy}
                                onClick={() => goReview(shownNode.topic.topicId)}
                                iconRight={<ArrowRight size={14} strokeWidth={1.75} />}
                              >
                                小白说它忘了，帮它复习
                              </Button>
                            )}
                            {masteryBreakdown ? (
                              <section className={s.masteryProof} aria-label="掌握度计算依据">
                                <header className={s.masteryProofHead}>
                                  <div>
                                    <p>计算依据</p>
                                    <h3>这束星光如何点亮</h3>
                                  </div>
                                  <strong>{Math.round(masteryBreakdown.finalMastery * 100)}%</strong>
                                </header>
                                <dl className={s.masteryFactors}>
                                  <div>
                                    <dt>
                                      <span>要点覆盖 · 权重 45%</span>
                                      <b>+{Math.round(masteryBreakdown.coverageContribution * 100)}</b>
                                    </dt>
                                    <dd>
                                      <span aria-hidden="true">
                                        <i style={{ width: `${masteryBreakdown.coverageRatio * 100}%` }} />
                                      </span>
                                      已讲清 {shownNode.state.hitChecklist.length}/{shownNode.topic.checklist.length} 个要点
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>
                                      <span>误区纠正 · 权重 35%</span>
                                      <b>+{Math.round(masteryBreakdown.correctionContribution * 100)}</b>
                                    </dt>
                                    <dd>
                                      <span aria-hidden="true">
                                        <i style={{ width: `${masteryBreakdown.correctionRatio * 100}%` }} />
                                      </span>
                                      {masteryBreakdown.seenMisconceptions > 0
                                        ? `已纠正 ${masteryBreakdown.correctedMisconceptions}/${masteryBreakdown.seenMisconceptions} 个出现过的误区`
                                        : '课堂里还没有出现可判定的误区'}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>
                                      <span>随堂小测 · 权重 20%</span>
                                      <b>+{Math.round(masteryBreakdown.quizContribution * 100)}</b>
                                    </dt>
                                    <dd>
                                      <span aria-hidden="true">
                                        <i style={{ width: `${masteryBreakdown.bestQuizScore}%` }} />
                                      </span>
                                      {hasQuizEvidence ? `最佳成绩 ${masteryBreakdown.bestQuizScore} 分` : '尚无随堂小测记录'}
                                    </dd>
                                  </div>
                                </dl>
                                <p className={s.masteryFormula}>
                                  基础掌握度 <b>{Math.round(masteryBreakdown.baseMastery * 100)}%</b>
                                  {masteryBreakdown.daysSinceVerified !== null ? (
                                    <> · 距上次验证 <b>{Math.floor(masteryBreakdown.daysSinceVerified)}</b> 天 · 留存系数 <b>{Math.round(masteryBreakdown.retention * 100)}%</b></>
                                  ) : (
                                    <> · 尚未进入记忆衰减期</>
                                  )}
                                </p>
                              </section>
                            ) : null}
                            {/* 逐星记忆:evidence 日志之上先渲染「小白记得」——称呼「先生/它」;
                                每块空则不渲染,recall 为 null 整段隐去(deriveTopicRecall 防御式消费) */}
                            {recall && (
                              recall.rememberedPoints.length > 0
                              || recall.goldenQuotes.length > 0
                              || recall.clearedDemons.length > 0
                              || recall.retention !== null
                              || recall.lastOutcome
                            ) ? (
                              <div className={s.recallCard}>
                                <p className={s.recallHead}>小白记得<small>上堂课,它把这些收进了小本子</small></p>
                                {recall.lastOutcome ? <p className={s.recallOutcome}>{recall.lastOutcome}</p> : null}
                                {recall.rememberedPoints.length > 0 && (
                                  <div className={s.recallRow}>
                                    <span className={s.recallTag}>还记得的要点</span>
                                    <span className={s.recallVals}>
                                      {recall.rememberedPoints.map((p) => (
                                        <span key={p} className={s.recallChip}>{p}</span>
                                      ))}
                                    </span>
                                  </div>
                                )}
                                {recall.goldenQuotes.length > 0 && (
                                  <div className={s.recallRow}>
                                    <span className={s.recallTag}>还念着的比方</span>
                                    <span className={s.recallVals}>
                                      {recall.goldenQuotes.map((q) => (
                                        <span key={q} className={s.recallQuote}>「{q}」</span>
                                      ))}
                                    </span>
                                  </div>
                                )}
                                {recall.clearedDemons.length > 0 && (
                                  <div className={s.recallRow}>
                                    <span className={s.recallTag}>已放下的心魔</span>
                                    <span className={s.recallVals}>
                                      {recall.clearedDemons.map((d) => (
                                        <span key={d} className={s.recallDemon}>{d}</span>
                                      ))}
                                    </span>
                                  </div>
                                )}
                                {(recall.retention !== null || recall.daysToFog !== null) && (
                                  <p className={s.recallMeta}>
                                    {recall.retention !== null && (
                                      <>它对这门的掌握留存 <b className={s.num}>{Math.round(recall.retention * 100)}</b>%</>
                                    )}
                                    {recall.retention !== null && recall.daysToFog !== null ? ' · ' : null}
                                    {recall.daysToFog !== null && (recall.daysToFog < 0
                                      ? <>已过复习期 <b className={s.num}>{Math.abs(recall.daysToFog)}</b> 天</>
                                      : recall.daysToFog === 0
                                        ? <>今日起雾</>
                                        : <>距起雾还有 <b className={s.num}>{recall.daysToFog}</b> 天</>)}
                                  </p>
                                )}
                              </div>
                            ) : null}
                            <h3 className={s.h3}>掌握度证据链</h3>
                            {shownEvents.length === 0 ? (
                              <p className={s.muted}>还没有任何事件——这个知识点还没开讲。</p>
                            ) : (
                              <ol className={s.timeline}>
                                {shownEvents.map((e) => (
                                  <li key={e.id} className={s.timelineItem}>
                                    <span className={s.timelineTime}>{fmtDateTime(e.t)}</span>
                                    <span className={s.chip}>{EVENT_LABEL[e.type] ?? e.type}</span>
                                    <span className={s.timelineText}>{e.evidence}</span>
                                  </li>
                                ))}
                              </ol>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </aside>
                ) : null}
              </KnowledgeMap>
            </div>
          </div>
        </div>

        {/* 遗忘不是干瘪一行:每个雾里的知识点是一封「小白的来信」,
            素材由 deriveXiaobaiLetter 从真实命中要点与金句派生;回信即原 goReview 契约 */}
        {forgottenNodes.length > 0 && (
          <div className={s.letterBlock}>
            <h3 className={s.subHead}>
              <Mail size={16} strokeWidth={1.75} aria-hidden="true" />
              小白的来信
              <Badge tone="warn">{forgottenNodes.length} 封待回</Badge>
            </h3>
            <div className={cx(s.letterFlow, scope.scope)} data-story>
              {forgottenNodes.map((n) => n.state && (
                <XiaobaiLetter
                  key={n.topic.topicId}
                  topicTitle={n.topic.title}
                  data={deriveXiaobaiLetter({ topic: n.topic, state: n.state, events })}
                  busy={reviewBusy}
                  onReply={() => goReview(n.topic.topicId)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── 金句画廊:goldenAnalogies 裱成一张张纸笺,自然排版,不横滚 ── */}
      <section
        className={cx(s.section, s.rise)}
        style={rise(4)}
        aria-labelledby="gallery-title"
      >
        <header className={s.secHead}>
          <div>
            <h2 className={s.h2} id="gallery-title">金句画廊</h2>
            <p className={s.secNote}>你打过的好比方，小白替你裱起来了。</p>
          </div>
          {global.goldenAnalogies.length > 0 && (
            <Badge tone="accent" className={s.secCount}>馆藏 {global.goldenAnalogies.length} 句</Badge>
          )}
        </header>
        {global.goldenAnalogies.length === 0 ? (
          <div className={s.emptyCard}>
            <Empty
              icon={<Quote size={22} strokeWidth={1.75} />}
              title="第一句，还在课堂里等你"
              description="讲课时打一个好比方，小白听懂后会把它收进这本画册。"
            />
          </div>
        ) : (
          <ol className={s.galleryList} role="list">
            {global.goldenAnalogies.map((g, index) => {
              const topicTitle = getTopic(g.topicId)?.title ?? g.topicId;
              return (
                <li key={g.id} className={s.galleryItem}>
                  <figure className={cx(s.galleryFigure, scope.scope, scope.sheet)} data-story>
                    <span className={s.galleryIndex} aria-hidden="true">
                      馆藏 {String(index + 1).padStart(2, '0')}
                    </span>
                    <blockquote className={s.galleryText}><p>{g.text}</p></blockquote>
                    <figcaption className={s.galleryFrom}>
                      <cite>《{topicTitle}》</cite>
                      <time dateTime={g.t}>{fmtDateTime(g.t)}</time>
                    </figcaption>
                  </figure>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ── 小白的记忆:四层记忆存续登记册(recall.ts 派生) + 可改可删的记忆条目 ── */}
      <section
        id="memory"
        className={cx(s.section, s.rise)}
        style={rise(4)}
        aria-labelledby="memory-title"
      >
        <header className={s.secHead}>
          <div>
            <h2 className={s.h2} id="memory-title">小白的记忆</h2>
            <p className={s.secNote}>从一堂课的余温，到师徒间的长久记得。</p>
          </div>
        </header>
        <div className={cx(s.storyWrap, scope.scope)} data-story>
          <MemoryPanorama layers={panorama} />
        </div>
        <MemoryLedger />
      </section>

      {/* ── 小白眼里的你:印象句由 deriveRelationshipLines 派生,每句带可复算出处 ── */}
      <section id="bond" className={cx(s.section, s.rise)} style={rise(4)} aria-labelledby="bond-title">
        <header className={s.secHead}>
          <div>
            <h2 className={s.h2} id="bond-title">小白眼里的你</h2>
            <p className={s.secNote}>它记得的，是你教书的样子。</p>
          </div>
        </header>
        {bondLines.length === 0 ? (
          <div className={s.emptyCard}>
            <Empty
              icon={<NotebookText size={22} strokeWidth={1.75} />}
              title="还没熟起来"
              description="多讲几课，小白会慢慢记住你的教学风格。"
            />
          </div>
        ) : (
          <ul className={cx(s.memoryList, scope.scope, scope.sheet)} data-story>
            {bondLines.map((m) => (
              <li key={m.line} className={s.memoryItem}>
                <span className={s.memoryLine}>{m.line}</span>
                <span className={s.memoryEvidence}>{m.evidence}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
