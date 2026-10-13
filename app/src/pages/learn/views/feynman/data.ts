/**
 * 「教小白」页的派生数据 —— 四站状态、课程分组、课堂记录、当下一步。
 * 全部从 appStore 的事件、报告与知识点状态复算，这里不保存、不发明任何进度。
 */
import type { LearnEvent, LiveSession, SessionReport, Topic, TopicState } from '../../../../types';
import type { Achievement, AchievementInput } from '../../../../engine/achievements';
import { deriveSessionHonors } from '../../../../engine/honors';
import { nextStep } from '../../../../engine/journey';
import { deriveDemonReport, deriveDiary, type DiaryPage } from '../../../../engine/story';

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';

// ───────────────────────── 课程分组 ─────────────────────────

export type CourseGroup = 'reteach' | 'taught' | 'fresh';

export const GROUP_LABELS: Record<CourseGroup, string> = {
  reteach: '该回讲了',
  taught: '讲过的',
  fresh: '还没讲的',
};

/** 分段筛选里放不下全名，用两个字的短名 */
export const GROUP_SHORT: Record<CourseGroup, string> = {
  reteach: '回讲',
  taught: '讲过',
  fresh: '没讲',
};

export interface CourseRow {
  topic: Topic;
  group: CourseGroup;
  /** 掌握度 0-100 */
  mastery: number;
  sessions: number;
  label: string;
  tone: Tone;
}

function isForgotten(state: TopicState | undefined, now: Date): boolean {
  if (!state) return false;
  if (state.forgotten) return true;
  // 出师后过了复习期，掌握度已按遗忘曲线衰减（与 engine/memory 的判定同口径）
  return state.knowledgeState === '出师' && !!state.reviewDue && now.toISOString() > state.reviewDue;
}

function isStrayed(state: TopicState | undefined): boolean {
  return !!state && Object.values(state.mcStates).some((value) => value === '被带偏');
}

export function deriveCourseRows(input: {
  topics: Topic[];
  topicStates: Record<string, TopicState>;
  events: LearnEvent[];
  now: Date;
}): CourseRow[] {
  const { topics, topicStates, events, now } = input;
  const sessionCount = new Map<string, number>();
  for (const event of events) {
    if (event.type === 'session_started') {
      sessionCount.set(event.topicId, (sessionCount.get(event.topicId) ?? 0) + 1);
    }
  }

  return topics.filter((topic) => !topic.locked).map((topic) => {
    const state = topicStates[topic.topicId];
    const sessions = sessionCount.get(topic.topicId) ?? 0;
    const hits = state?.hitChecklist.length ?? 0;
    const forgotten = isForgotten(state, now);
    const strayed = isStrayed(state);
    const taught = sessions > 0 || hits > 0 || (!!state && state.knowledgeState !== '没懂');
    const mastery = Math.round(Math.max(0, Math.min(1, state?.mastery ?? 0)) * 100);

    let label = '还没教';
    let tone: Tone = 'neutral';
    if (forgotten) { label = '小白忘了'; tone = 'warn'; }
    else if (strayed) { label = '被带偏了'; tone = 'bad'; }
    else if (state?.knowledgeState === '出师') { label = '已出师'; tone = 'ok'; }
    else if (taught) { label = `讲明白 ${hits}/${topic.checklist.length}`; tone = 'accent'; }
    else if (state?.prepDone) { label = '已备课'; }

    return {
      topic,
      group: forgotten || strayed ? 'reteach' : taught ? 'taught' : 'fresh',
      mastery,
      sessions,
      label,
      tone,
    };
  });
}

// ───────────────────────── 四站 ─────────────────────────

export type StationKey = 'prepare' | 'teach' | 'exam' | 'review';

export interface Station {
  key: StationKey;
  name: string;
  status: string;
  state: 'done' | 'current' | 'todo';
  /** 去这一站的路由；null 表示还到不了 */
  to: string | null;
  cta: string;
  /** 小白忘了这门课：上课这一站走温书，进课堂前先登记复习 */
  review?: boolean;
}

/** 课堂路由：温书、重讲的会话要带上 mode，课堂页据此显示收尾按钮 */
export function classroomRoute(topicId: string, mode: LiveSession['mode'] = 'teach'): string {
  return mode === 'teach' ? `/teach/${topicId}` : `/teach/${topicId}?mode=${mode}`;
}

export function deriveStations(input: {
  topic: Topic;
  state: TopicState | undefined;
  events: LearnEvent[];
  reports: SessionReport[];
  live: LiveSession | null;
  now: Date;
}): Station[] {
  const { topic, state, events, reports, live, now } = input;
  const id = topic.topicId;
  const topicEvents = events.filter((event) => event.topicId === id);
  const topicReports = reports.filter((report) => report.topicId === id);
  const latest = topicReports.at(-1) ?? null;
  const latestQuiz = [...topicReports].reverse().find((report) => report.quiz) ?? null;

  const sessions = topicEvents.filter((event) => event.type === 'session_started').length;
  const prepDone = !!state?.prepDone || topicEvents.some((event) => event.type === 'prep_completed');
  const hits = state?.hitChecklist.length ?? 0;
  const mastered = state?.knowledgeState === '出师';
  const forgotten = isForgotten(state, now);
  const liveHere = !!live && live.topicId === id && !live.ended;

  const done: Record<StationKey, boolean> = {
    prepare: prepDone,
    teach: topicReports.length > 0,
    exam: !!latestQuiz,
    review: mastered && !forgotten,
  };

  let current: StationKey | null;
  if (liveHere || forgotten) current = 'teach';
  else if (!prepDone && sessions === 0) current = 'prepare';
  else if (!done.teach) current = 'teach';
  else if (!done.exam) current = 'exam';
  else if (!done.review) current = 'review';
  else current = null;

  const stateOf = (key: StationKey): Station['state'] => (
    key === current ? 'current' : done[key] ? 'done' : 'todo'
  );

  let teachStatus = '还没开讲';
  let teachCta = '开始上课';
  if (liveHere) { teachStatus = '课堂进行中'; teachCta = '回到课堂'; }
  else if (forgotten) { teachStatus = '小白记不清了，等你温书'; teachCta = '帮他温书'; }
  else if (sessions > 0) {
    teachStatus = `上过 ${sessions} 堂 · 讲明白 ${hits}/${topic.checklist.length} 处`;
    teachCta = mastered ? '再讲一遍' : '接着讲';
  }

  let reviewStatus = '考完看哪里没讲透';
  if (latest) {
    if (mastered) reviewStatus = '小白已出师';
    else if (latest.blindSpots.length > 0) reviewStatus = `${latest.blindSpots.length} 处还没讲透`;
    else reviewStatus = '批注已出';
  }

  return [
    {
      key: 'prepare',
      name: '备课',
      status: prepDone ? '已备好' : sessions > 0 ? '上次没备课就开讲了' : '先自己把这课弄懂',
      state: stateOf('prepare'),
      to: `/prep/${id}?view=prepare`,
      cta: prepDone ? '再看讲义' : '去备课',
    },
    {
      key: 'teach',
      name: '上课',
      status: teachStatus,
      state: stateOf('teach'),
      to: liveHere && live ? classroomRoute(id, live.mode) : classroomRoute(id),
      cta: teachCta,
      review: forgotten && !liveHere,
    },
    {
      key: 'exam',
      name: '赴考',
      status: latestQuiz?.quiz ? `最近一卷 ${latestQuiz.quiz.score} 分` : '下课后小白独立答卷',
      state: stateOf('exam'),
      to: latestQuiz ? `/exam/${latestQuiz.sessionId}` : null,
      cta: '看答卷',
    },
    {
      key: 'review',
      name: '批注复盘',
      status: reviewStatus,
      state: stateOf('review'),
      to: latest ? `/review/${latest.sessionId}` : null,
      cta: '看批注',
    },
  ];
}

// ───────────────────────── 当下一步 ─────────────────────────

export interface PrimaryAction {
  key: string;
  /** 小白口吻的一句话 */
  line: string;
  cta: string;
  to: string;
  /** 这一步指向的课，用来默认选中 */
  topicId: string | null;
  /** 需要先登记复习再进课堂的课 */
  reviewTopicId?: string;
}

function topicIdOfRoute(to: string, reports: SessionReport[]): string | null {
  const [path] = to.split('?');
  const [, section, id] = path.split('/');
  if (!id) return null;
  if (section === 'teach' || section === 'prep') return decodeURIComponent(id);
  if (section === 'review' || section === 'exam') {
    return reports.find((report) => report.sessionId === id)?.topicId ?? null;
  }
  return null;
}

/**
 * 唯一主按钮：课堂开着就回课堂，否则听 journey.nextStep 的。
 * 只把两处路由换成更直接的：白纸一张时从所选课的备课开始；小白忘了时直接进温书课堂。
 */
export function derivePrimaryAction(input: {
  events: LearnEvent[];
  reports: SessionReport[];
  topicStates: Record<string, TopicState>;
  topics: Topic[];
  live: LiveSession | null;
  fallbackTopic: Topic | undefined;
}): PrimaryAction {
  const { events, reports, topicStates, topics, live, fallbackTopic } = input;

  if (live && !live.ended) {
    const title = topics.find((topic) => topic.topicId === live.topicId)?.title;
    return {
      key: 'live',
      line: title
        ? `「${title}」的课还开着，小白坐在原位等你回来。`
        : '课还开着，小白坐在原位等你回来。',
      cta: '回到课堂',
      to: classroomRoute(live.topicId, live.mode),
      topicId: live.topicId,
    };
  }

  const step = nextStep({ events, reports, topicStates, topics });

  if (step.key === 'first-prep') {
    return {
      key: step.key,
      line: step.line,
      cta: fallbackTopic ? '从备课开始' : step.cta,
      to: fallbackTopic ? `/prep/${fallbackTopic.topicId}?view=prepare` : step.to,
      topicId: fallbackTopic?.topicId ?? null,
    };
  }

  if (step.key === 'review-due') {
    const forgot = topics.find((topic) => !topic.locked && topicStates[topic.topicId]?.forgotten);
    if (forgot) {
      return {
        key: step.key,
        line: step.line,
        cta: '帮他温书',
        to: classroomRoute(forgot.topicId, 'review'),
        topicId: forgot.topicId,
        reviewTopicId: forgot.topicId,
      };
    }
  }

  if (step.key === 'new-prep') {
    return {
      key: step.key,
      line: step.line,
      cta: step.cta,
      to: `${step.to}?view=prepare`,
      topicId: topicIdOfRoute(step.to, reports),
    };
  }

  return {
    key: step.key,
    line: step.line,
    cta: step.cta,
    to: step.to,
    topicId: topicIdOfRoute(step.to, reports),
  };
}

// ───────────────────────── 课堂记录 ─────────────────────────

const MODE_LABELS: Record<SessionReport['mode'], string> = {
  teach: '讲解',
  reteach: '重讲',
  review: '温书',
};

export interface SessionRecord {
  report: SessionReport;
  topic: Topic | undefined;
  title: string;
  when: string;
  modeLabel: string;
  score: number | null;
  demonsBeaten: number;
  demonsMet: number;
  newSeals: Achievement[];
  xpGained: number;
  /** 这堂课的日记；课已下架时为 null */
  diary: DiaryPage | null;
}

function whenLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

/** 最近的课堂记录，新的在前 */
export function deriveSessionRecords(input: AchievementInput, limit: number): SessionRecord[] {
  const recent = [...input.reports].reverse().slice(0, limit);
  return recent.map((report) => {
    const topic = input.topics.find((item) => item.topicId === report.topicId);
    const sessionEvents = input.events.filter((event) => event.sessionId === report.sessionId);
    const demons = topic ? deriveDemonReport(topic, sessionEvents) : [];
    const honors = deriveSessionHonors(input, report.sessionId);
    return {
      report,
      topic,
      title: topic?.title ?? '已下架的课',
      when: whenLabel(report.endedAt || report.startedAt),
      modeLabel: MODE_LABELS[report.mode] ?? '讲解',
      score: report.quiz ? report.quiz.score : null,
      demonsBeaten: demons.filter((demon) => demon.outcome === 'vanquished').length,
      demonsMet: demons.length,
      newSeals: honors?.newSeals ?? [],
      xpGained: honors?.xpGained ?? 0,
      diary: topic ? deriveDiary({ topic, sessionEvents, report }) : null,
    };
  });
}
