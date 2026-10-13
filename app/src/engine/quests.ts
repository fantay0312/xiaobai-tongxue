/**
 * 今日课业与连续学习 —— 从真实事件流和闪卡状态纯派生，不落盘、不另发点数。
 * 学识奖励只引用 evolution.XP_RULES 的既有权重：课业做完时，这些学识本来就已经记在事件里。
 * 铁律：纯函数、Node 安全（不碰 window/localStorage/时钟），当前时刻由调用方传入；
 * 不得 re-export 进 engine/index barrel。
 */
import type { LearnEvent, Topic, TopicState } from '../types';
import type { Deck, Flashcard } from '../store/studyData';
import { XP_RULES, deriveWisdom } from './evolution';

export type QuestKey = 'teach' | 'demon' | 'exam' | 'recall' | 'cards' | 'attend';

/** 课业指向哪一步，由界面换成具体路由 */
export type QuestAction = 'teach' | 'exam' | 'review' | 'flashcards';

export interface DailyQuest {
  key: QuestKey;
  title: string;
  hint: string;
  /** 完成时盖下的印面字 */
  glyph: string;
  now: number;
  target: number;
  done: boolean;
  /** 做完这项按既有规则记入的学识；null 表示这项不计学识 */
  rewardXp: number | null;
  rewardLabel: string;
  action: QuestAction;
}

export interface StreakStatus {
  /** 连续学习天数：截至今天，或截至昨天（今天还没学，连续尚未断） */
  days: number;
  activeToday: boolean;
  best: number;
}

export interface QuestBoard {
  /** 本地日历日，YYYY-MM-DD */
  dayKey: string;
  quests: DailyQuest[];
  done: number;
  total: number;
  /** 今天真实记入的学识点数 */
  xpToday: number;
  streak: StreakStatus;
}

export interface QuestInput {
  events: LearnEvent[];
  topicStates: Record<string, TopicState>;
  topics: Topic[];
  decks: Deck[];
  now: Date;
}

const DAY_MS = 86_400_000;
const TEACH_TARGET = 3;
const CARD_TARGET_CAP = 10;

/** 本地日历日序号（相邻日差 1），与 achievements 的日课口径一致 */
function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

function dayNumberOf(iso: string): number | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dayNumber(date);
}

export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 连续学习：任何一条学习事件都算当天来过书斋 */
export function deriveStreak(events: LearnEvent[], now: Date): StreakStatus {
  const days = new Set<number>();
  for (const event of events) {
    const day = dayNumberOf(event.t);
    if (day !== null) days.add(day);
  }
  const today = dayNumber(now);
  const activeToday = days.has(today);

  let current = 0;
  for (let day = activeToday ? today : today - 1; days.has(day); day -= 1) current += 1;

  const sorted = [...days].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  sorted.forEach((day, index) => {
    run = index > 0 && day === sorted[index - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });

  return { days: current, activeToday, best };
}

/**
 * 一张闪卡上次复习的时刻，从排期反推（见 studyData.scheduleCard）：
 * 评「再来」时 interval 归 0、十分钟后到期；其余评级按 interval 天后到期。从未复习过返回 null。
 */
function lastReviewedAt(card: Flashcard): number | null {
  if (card.reps === 0 && card.lapses === 0) return null;
  const due = Date.parse(card.due);
  if (!Number.isFinite(due)) return null;
  return card.interval > 0 ? due - card.interval * DAY_MS : due - 10 * 60_000;
}

function countToday(events: LearnEvent[], type: LearnEvent['type']): number {
  return events.reduce((sum, event) => sum + (event.type === type ? 1 : 0), 0);
}

export function deriveQuestBoard(input: QuestInput): QuestBoard {
  const { events, topicStates, topics, decks, now } = input;
  const today = dayNumber(now);
  const todayEvents = events.filter((event) => dayNumberOf(event.t) === today);
  const streak = deriveStreak(events, now);

  const hits = countToday(todayEvents, 'checklist_hit');
  const corrected = countToday(todayEvents, 'misconception_corrected');
  const recalled = countToday(todayEvents, 'review_passed');
  const exams = todayEvents.filter((event) => event.type === 'xiaobai_quiz_scored');
  // 赴考的学识按分数折算，与 deriveWisdom 同一条公式，直接让它算
  const examXp = deriveWisdom(exams).xp;

  const hitXp = XP_RULES.checklist_hit ?? 0;
  const correctXp = XP_RULES.misconception_corrected ?? 0;
  const recallXp = XP_RULES.review_passed ?? 0;

  const quests: DailyQuest[] = [
    {
      key: 'teach',
      title: '给小白上一课',
      hint: `讲明白 ${TEACH_TARGET} 处要点`,
      glyph: '讲',
      now: Math.min(hits, TEACH_TARGET),
      target: TEACH_TARGET,
      done: hits >= TEACH_TARGET,
      rewardXp: hitXp * TEACH_TARGET,
      rewardLabel: `学识 +${hitXp * TEACH_TARGET}`,
      action: 'teach',
    },
    {
      key: 'demon',
      title: '降服一个心魔',
      hint: '小白想岔时，把他拉回来',
      glyph: '破',
      now: Math.min(corrected, 1),
      target: 1,
      done: corrected >= 1,
      rewardXp: correctXp,
      rewardLabel: `学识 +${correctXp}`,
      action: 'teach',
    },
    {
      key: 'exam',
      title: '送小白赴考',
      hint: '下课后让他独立答一张卷',
      glyph: '考',
      now: Math.min(exams.length, 1),
      target: 1,
      done: exams.length >= 1,
      rewardXp: exams.length >= 1 ? examXp : null,
      rewardLabel: exams.length >= 1 ? `学识 +${examXp}` : '学识最高 +10',
      action: 'exam',
    },
  ];

  // 小白有忘掉的课，或今天已经帮他想起来过，才出这一项
  const openIds = new Set(topics.filter((topic) => !topic.locked).map((topic) => topic.topicId));
  const forgotten = Object.values(topicStates).filter((state) => state.forgotten && openIds.has(state.topicId)).length;
  if (forgotten > 0 || recalled > 0) {
    quests.push({
      key: 'recall',
      title: '帮小白温一课',
      hint: forgotten > 0 ? `有 ${forgotten} 门课他记不清了` : '今天已经帮他想起来了',
      glyph: '温',
      now: Math.min(recalled, 1),
      target: 1,
      done: recalled >= 1,
      rewardXp: recallXp,
      rewardLabel: `学识 +${recallXp}`,
      action: 'review',
    });
  }

  // 有到期闪卡，或今天复习过闪卡，才出这一项；闪卡不计学识
  const cards = decks.flatMap((deck) => deck.cards);
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const reviewedToday = cards.filter((card) => {
    const at = lastReviewedAt(card);
    return at !== null && at >= dayStart && at <= now.getTime();
  }).length;
  const dueNow = cards.filter((card) => {
    const due = Date.parse(card.due);
    return Number.isFinite(due) && due <= now.getTime();
  }).length;
  if (reviewedToday + dueNow > 0) {
    const target = Math.min(CARD_TARGET_CAP, reviewedToday + dueNow);
    quests.push({
      key: 'cards',
      title: '复习到期闪卡',
      hint: dueNow > 0 ? `还有 ${dueNow} 张到期` : '到期的卡都过完了',
      glyph: '卡',
      now: Math.min(reviewedToday, target),
      target,
      done: reviewedToday >= target,
      rewardXp: null,
      rewardLabel: '巩固记忆',
      action: 'flashcards',
    });
  }

  quests.push({
    key: 'attend',
    title: '保持连续',
    hint: streak.activeToday ? '今天已经来过书斋' : '今天学一点就算',
    glyph: '恒',
    now: streak.activeToday ? 1 : 0,
    target: 1,
    done: streak.activeToday,
    rewardXp: null,
    rewardLabel: streak.days > 0 ? `连续 ${streak.days} 天` : '开始连续',
    action: 'teach',
  });

  return {
    dayKey: dayKey(now),
    quests,
    done: quests.filter((quest) => quest.done).length,
    total: quests.length,
    xpToday: deriveWisdom(todayEvents).xp,
    streak,
  };
}
