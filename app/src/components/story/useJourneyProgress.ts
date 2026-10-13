/**
 * 师徒进度 —— 侧栏进度卡和「教小白」页共用的一份派生数据。
 * 科名、学识、连续天数、今日课业全部从事件流与闪卡状态复算，这里不存任何进度。
 */
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useAuthStore } from '../../store/authStore';
import { useStudyData } from '../../store/studyData';
import { useAllTopics } from '../../hooks/useAllTopics';
import {
  deriveEvolution, deriveWisdom, getStageMeta,
  type EvolutionStageMeta, type EvolutionStatus, type XiaobaiWisdom,
} from '../../engine/evolution';
import { deriveQuestBoard, type QuestBoard } from '../../engine/quests';
import type { XiaobaiMood } from '../../types';

export interface JourneyProgress {
  stage: EvolutionStageMeta;
  nextStage: EvolutionStageMeta | null;
  evolution: EvolutionStatus;
  wisdom: XiaobaiWisdom;
  board: QuestBoard;
  mood: XiaobaiMood;
  /** 距下一科名还差什么，一句话；已登顶为 null */
  nextStageLine: string | null;
  /** 本次派生所用的时刻 */
  now: Date;
}

/** 当前时刻：每分钟、以及页面回到前台时刷新，跨日和闪卡到期都能跟上 */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}

function describeNextStage(evolution: EvolutionStatus): string | null {
  const next = evolution.next;
  if (!next) return null;
  const name = getStageMeta(next.stage).name;
  const needMasteries = Math.max(0, next.needMasteries - next.haveMasteries);
  const needCourses = Math.max(0, next.needCourses - next.haveCourses);
  if (needMasteries > 0 && needCourses > 0) {
    return `再教到出师 ${needMasteries} 门、多涉猎 ${needCourses} 门课，晋「${name}」`;
  }
  if (needMasteries > 0) return `再教到出师 ${needMasteries} 门，晋「${name}」`;
  if (needCourses > 0) return `换一门课教到出师，晋「${name}」`;
  return `晋「${name}」在即`;
}

/** owner 省略时取当前登录账号；本地演示为 null */
export function useJourneyProgress(owner?: string | null): JourneyProgress {
  const events = useAppStore((state) => state.events);
  const topicStates = useAppStore((state) => state.topicStates);
  const live = useAppStore((state) => state.live);
  const user = useAuthStore((state) => state.user);
  const topics = useAllTopics();
  const data = useStudyData(owner === undefined ? user : owner);
  const now = useNow();

  return useMemo(() => {
    const evolution = deriveEvolution(events, topics);
    const wisdom = deriveWisdom(events);
    const board = deriveQuestBoard({ events, topicStates, topics, decks: data.decks, now });
    const anyForgotten = topics.some((topic) => !topic.locked && topicStates[topic.topicId]?.forgotten);

    let mood: XiaobaiMood = 'idle';
    if (live && !live.ended) mood = live.mood;
    else if (events.length === 0) mood = 'shy';
    else if (anyForgotten) mood = 'confused';
    else if (board.total > 0 && board.done === board.total) mood = 'proud';
    else if (board.streak.activeToday) mood = 'happy';
    else mood = 'curious';

    return {
      stage: getStageMeta(evolution.stage),
      nextStage: evolution.next ? getStageMeta(evolution.next.stage) : null,
      evolution,
      wisdom,
      board,
      mood,
      nextStageLine: describeNextStage(evolution),
      now,
    };
  }, [events, topicStates, topics, data.decks, live, now]);
}
