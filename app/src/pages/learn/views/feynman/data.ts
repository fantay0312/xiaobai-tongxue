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

/** 小白对这门课的熟练度，比分组细一档：决定侧栏图标和主区的带法 */
export type Standing = 'forgotten' | 'strayed' | 'mastered' | 'learning' | 'prepped' | 'new';

export interface CourseRow {
  topic: Topic;
  group: CourseGroup;
  standing: Standing;
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

    let standing: Standing = 'new';
    if (forgotten) standing = 'forgotten';
    else if (strayed) standing = 'strayed';
    else if (state?.knowledgeState === '出师') standing = 'mastered';
    else if (taught) standing = 'learning';
    else if (state?.prepDone) standing = 'prepped';

    return {
      topic,
      group: forgotten || strayed ? 'reteach' : taught ? 'taught' : 'fresh',
      standing,
      mastery,
      sessions,
      label,
      tone,
    };
  });
}

// ───────────────────────── 所选课的带法 ─────────────────────────

/** 还没讲的领他学习；讲过的帮他温书；忘了的帮他想起来；被带偏的帮他改过来 */
export type FocusKind = 'lead' | 'refresh' | 'recall' | 'correct';

export const FOCUS_TAGS: Record<FocusKind, string> = {
  lead: '领他学习',
  refresh: '帮他温书',
  recall: '帮他想起来',
  correct: '帮他改过来',
};

/** 分组标题旁那句「这一组该怎么带」 */
export const GROUP_HINTS: Record<CourseGroup, string> = {
  reteach: '先补这些',
  taught: '帮他温书',
  fresh: '领他学习',
};

export interface FocusAction {
  label: string;
  to: string;
  /** 小白忘了：进课堂前先登记复习 */
  review?: boolean;
}

export interface CourseFocus {
  kind: FocusKind;
  /** 小白口吻的一句话 */
  line: string;
  mastery: number;
  /** 一行小字：上过几堂、最近一卷、何时该复习 */
  facts: string[];
  /** 小白已经听懂的要点 */
  known: string[];
  /** 还没讲到的要点 */
  pending: string[];
  /** 小白眼下信着的错误说法 */
  beliefs: string[];
  /** 领学的三步；其余带法为空 */
  steps: { label: string; note: string; done: boolean }[];
  primary: FocusAction;
  secondary: FocusAction | null;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 与 journey.nextStep 同口径：最近一次被带偏之后还没走完补学，就该先去复盘补学 */
function needsRemedy(topicId: string, mcIds: string[], events: LearnEvent[]): boolean {
  return mcIds.some((mcId) => {
    let lastAdopt = -1;
    let lastRemedy = -1;
    events.forEach((event, index) => {
      if (event.topicId !== topicId || String(event.payload.mcId ?? '') !== mcId) return;
      if (event.type === 'misconception_adopted') lastAdopt = index;
      if (event.type === 'remedy_completed') lastRemedy = index;
    });
    return lastAdopt >= 0 && lastRemedy < lastAdopt;
  });
}

export function deriveCourseFocus(input: {
  row: CourseRow;
  state: TopicState | undefined;
  events: LearnEvent[];
  reports: SessionReport[];
  live: LiveSession | null;
}): CourseFocus {
  const { row, state, events, reports, live } = input;
  const { topic } = row;
  const id = topic.topicId;
  const title = topic.title;
  const topicReports = reports.filter((report) => report.topicId === id);
  const latest = topicReports.at(-1) ?? null;
  const latestQuiz = [...topicReports].reverse().find((report) => report.quiz) ?? null;
  const hit = new Set(state?.hitChecklist ?? []);
  const known = topic.checklist.filter((item) => hit.has(item.id)).map((item) => item.point);
  const pending = topic.checklist.filter((item) => !hit.has(item.id)).map((item) => item.point);
  const prepRoute = `/prep/${id}?view=prepare`;
  const prepDone = !!state?.prepDone || events.some((event) => event.topicId === id && event.type === 'prep_completed');
  const backToClass: FocusAction | null = live && live.topicId === id && !live.ended
    ? { label: '回到课堂', to: classroomRoute(id, live.mode) }
    : null;
  const lastNotes: FocusAction | null = latest ? { label: '看上次批注', to: `/review/${latest.sessionId}` } : null;

  const facts: string[] = [];
  if (row.sessions > 0) facts.push(`上过 ${row.sessions} 堂`);
  if (latestQuiz?.quiz) facts.push(`最近一卷 ${latestQuiz.quiz.score} 分`);
  const base = { mastery: row.mastery, facts, known, pending, beliefs: [] as string[], steps: [] as CourseFocus['steps'] };

  if (row.group === 'fresh') {
    return {
      ...base,
      kind: 'lead',
      line: prepDone
        ? `「${title}」的讲义先生读过了。现在一句一句讲给我听吧。`
        : `「${title}」我一个字都没听过。先生先把它读懂，再领我学？`,
      steps: [
        { label: '自己先读懂', note: prepDone ? '讲义已经读过' : '微课讲义加自检，十来分钟', done: prepDone },
        { label: '讲给小白听', note: `这一课要讲明白 ${topic.checklist.length} 件事`, done: false },
        { label: '送他赴考', note: '下课后他独立答卷，看你讲得透不透', done: false },
      ],
      primary: backToClass ?? (prepDone
        ? { label: '开第一堂课', to: classroomRoute(id) }
        : { label: '先去备课', to: prepRoute }),
      secondary: prepDone ? { label: '再看讲义', to: prepRoute } : { label: '直接开讲', to: classroomRoute(id) },
    };
  }

  if (row.standing === 'forgotten') {
    if (state?.lastVerified) facts.push(`${dayLabel(state.lastVerified)} 出师`);
    return {
      ...base,
      kind: 'recall',
      line: `「${title}」我记不清了……先生帮我想起来？`,
      primary: backToClass ?? { label: '帮他温书', to: classroomRoute(id, 'review'), review: true },
      secondary: { label: '先翻讲义', to: prepRoute },
    };
  }

  if (row.standing === 'strayed') {
    const strayed = topic.misconceptions.filter((item) => state?.mcStates[item.mcId] === '被带偏');
    const remedy = !!latest && needsRemedy(id, strayed.map((item) => item.mcId), events);
    const reteach: FocusAction = { label: '回讲解舱重讲', to: classroomRoute(id, 'reteach') };
    return {
      ...base,
      kind: 'correct',
      line: `「${title}」有个地方我好像记岔了，先生帮我改过来？`,
      beliefs: strayed.map((item) => item.belief),
      primary: backToClass ?? (remedy && latest ? { label: '先去复盘补学', to: `/review/${latest.sessionId}` } : reteach),
      secondary: remedy ? { label: '直接重讲', to: reteach.to } : lastNotes,
    };
  }

  const mastered = row.standing === 'mastered';
  if (mastered && state?.reviewDue) facts.push(`${dayLabel(state.reviewDue)} 该复习`);
  let line = `「${title}」我听懂了 ${known.length} 处，还差 ${pending.length} 处。先陪我把学过的温一遍？`;
  if (mastered) line = `「${title}」我出师了。隔些日子考考我，就不容易忘。`;
  else if (pending.length === 0) line = `「${title}」的要点我都听过了，再陪我温一遍就更稳了。`;
  return {
    ...base,
    kind: 'refresh',
    line,
    primary: backToClass ?? { label: '帮他温书', to: classroomRoute(id, 'review') },
    secondary: pending.length > 0 ? { label: `接着讲剩下 ${pending.length} 处`, to: classroomRoute(id) } : lastNotes,
  };
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
