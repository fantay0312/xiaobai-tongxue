/**
 * 小白的记忆（只读派生）：侧栏的计数和主区的各个切片共用这一份。
 * 单课回执走 engine/recall，掌握度与衰减走 engine/memory，条目来自 appStore.memory。
 */
import { useMemo } from 'react';
import { getTopic } from '../../../../data';
import { computeMastery, decayedMastery, replayTopicState } from '../../../../engine/memory';
import { deriveTopicRecall } from '../../../../engine/recall';
import type { TopicRecall } from '../../../../engine/recall';
import { useAppStore } from '../../../../store/appStore';
import type { GoldenAnalogy, LearnerProfile, MemoryItem, MemoryKind, Topic, TopicState } from '../../../../types';

export interface Lesson {
  topic: Topic;
  state: TopicState;
  recall: TopicRecall;
  /** 不计遗忘的掌握度 0..1 */
  base: number;
  /** 按遗忘曲线衰减到此刻的掌握度 0..1 */
  current: number;
  fogged: boolean;
  lastAt: number;
}

export type XiaobaiSlice = 'all' | 'lessons' | 'quotes' | 'profile' | 'items';
export const XIAOBAI_SLICES: readonly XiaobaiSlice[] = ['all', 'lessons', 'quotes', 'profile', 'items'];

// 情分（bond）不列条目：它只经「小白眼里的先生」的情分一行露面，与成长册一致
const KIND_GROUPS: { kind: MemoryKind; label: string }[] = [
  { kind: 'preference', label: '偏好' },
  { kind: 'habit', label: '习惯' },
  { kind: 'strength', label: '长处' },
  { kind: 'weakness', label: '短板' },
  { kind: 'milestone', label: '里程碑' },
  { kind: 'note', label: '笔记' },
];
export const PROFILE_ROWS: { key: 'style' | 'strengths' | 'weaknesses' | 'pace' | 'bond'; label: string }[] = [
  { key: 'style', label: '讲法' },
  { key: 'strengths', label: '长处' },
  { key: 'weaknesses', label: '短板' },
  { key: 'pace', label: '节奏' },
  { key: 'bond', label: '情分' },
];

function sortRows(items: MemoryItem[]): MemoryItem[] {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || Number(a.muted) - Number(b.muted)
    || b.lastSeenAt.localeCompare(a.lastSeenAt)
    || a.id.localeCompare(b.id));
}

export interface XiaobaiMemoryData {
  lessons: Lesson[];
  mastered: number;
  /** 讲课时纠正误区的次数 */
  cleared: number;
  quotes: GoldenAnalogy[];
  /** 各门课清掉的心魔（按课列名字） */
  demons: { topicId: string; title: string; names: string[] }[];
  demonCount: number;
  groups: { kind: MemoryKind; label: string; items: MemoryItem[] }[];
  /** 列出来的条目数（不含情分） */
  listed: number;
  profile: LearnerProfile | null;
  hasProfile: boolean;
  paused: boolean;
  nothingYet: boolean;
  titleOf: (topicId: string) => string | null;
}

export function useXiaobaiMemory(topics: Topic[]): XiaobaiMemoryData {
  const memory = useAppStore((st) => st.memory);
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const topicStates = useAppStore((st) => st.topicStates);
  const goldenAnalogies = useAppStore((st) => st.global.goldenAnalogies);

  /* 教过的课：只算真正开过课的，按最近一次上课排序 */
  const lessons = useMemo<Lesson[]>(() => {
    const lastSeen = new Map<string, number>();
    for (const event of events) {
      if (!event.sessionId && event.type !== 'session_started') continue;
      const at = Date.parse(event.t);
      if (Number.isFinite(at) && at > (lastSeen.get(event.topicId) ?? 0)) lastSeen.set(event.topicId, at);
    }
    const now = new Date();
    const list: Lesson[] = [];
    for (const [topicId, lastAt] of lastSeen) {
      const topic = topics.find((entry) => entry.topicId === topicId) ?? getTopic(topicId);
      if (!topic) continue;
      const recall = deriveTopicRecall({ topicId, events, reports, topicStates, topics, now: now.getTime() });
      if (!recall) continue;
      const own = events.filter((event) => event.topicId === topicId);
      const state = topicStates[topicId] ?? replayTopicState(topic, events, now);
      const base = computeMastery(state, topic, own);
      const current = decayedMastery(base, state.lastVerified, now);
      const fogged = state.forgotten || (recall.daysToFog != null && recall.daysToFog < 0);
      list.push({ topic, state, recall, base, current, fogged, lastAt });
    }
    return list.sort((a, b) => b.lastAt - a.lastAt);
  }, [events, reports, topicStates, topics]);

  const cleared = useMemo(() => events.filter((event) => event.type === 'misconception_corrected').length, [events]);
  const quotes = useMemo(() => [...goldenAnalogies].sort((a, b) => b.t.localeCompare(a.t)), [goldenAnalogies]);
  const demons = useMemo(
    () => lessons
      .filter((lesson) => lesson.recall.clearedDemons.length > 0)
      .map((lesson) => ({ topicId: lesson.topic.topicId, title: lesson.topic.title, names: lesson.recall.clearedDemons })),
    [lessons],
  );
  const groups = useMemo(
    () => KIND_GROUPS
      .map((group) => ({ ...group, items: sortRows(memory.items.filter((item) => item.kind === group.kind)) }))
      .filter((group) => group.items.length > 0),
    [memory.items],
  );

  const { profile, paused } = memory;
  const listed = groups.reduce((sum, group) => sum + group.items.length, 0);
  const hasProfile = !!profile && (profile.summary !== '' || PROFILE_ROWS.some(({ key }) => profile.sections[key] !== ''));
  const titleOf = (topicId: string) => topics.find((entry) => entry.topicId === topicId)?.title ?? getTopic(topicId)?.title ?? null;

  return {
    lessons,
    mastered: lessons.filter((lesson) => lesson.state.knowledgeState === '出师').length,
    cleared,
    quotes,
    demons,
    demonCount: demons.reduce((sum, entry) => sum + entry.names.length, 0),
    groups,
    listed,
    profile,
    hasProfile,
    paused,
    nothingYet: lessons.length === 0 && listed === 0 && !hasProfile && quotes.length === 0,
    titleOf,
  };
}
