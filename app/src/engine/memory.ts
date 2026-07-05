/**
 * 记忆引擎:事件溯源。
 * 状态不直接改,追加不可变事件,TopicState 由事件流派生(可随时重算 = 证据链可回放)。
 */
import type { LearnEvent, McState, Topic, TopicState } from '../types';

export function initialTopicState(topic: Topic): TopicState {
  const mcStates: Record<string, McState> = {};
  for (const m of topic.misconceptions) mcStates[m.mcId] = '待注入';
  return {
    topicId: topic.topicId,
    knowledgeState: '没懂',
    level: 'L1',
    hitChecklist: [],
    mcStates,
    accuracyFlags: [],
    stuckStreak: 0,
    rescueLevel: 0,
    prepDone: false,
    lastVerified: null,
    reviewDue: null,
    forgotten: false,
    mastery: 0,
  };
}

const REVIEW_INTERVAL_DAYS = 7;

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

/** 单事件折叠(注意:不含 stuckStreak/rescueLevel,那是会话内状态,由导演 stateDelta 维护) */
export function applyEvent(state: TopicState, ev: LearnEvent): TopicState {
  const s: TopicState = { ...state, mcStates: { ...state.mcStates }, hitChecklist: [...state.hitChecklist], accuracyFlags: [...state.accuracyFlags] };
  switch (ev.type) {
    case 'checklist_hit': {
      const id = String(ev.payload.checklistId ?? '');
      if (id && !s.hitChecklist.includes(id)) s.hitChecklist.push(id);
      if (s.knowledgeState === '没懂') s.knowledgeState = '半懂';
      break;
    }
    case 'accuracy_flag':
      s.accuracyFlags.push(String(ev.payload.note ?? ''));
      break;
    case 'misconception_injected':
      s.mcStates[String(ev.payload.mcId)] = '已注入';
      break;
    case 'misconception_corrected':
      s.mcStates[String(ev.payload.mcId)] = '已纠正';
      break;
    case 'misconception_adopted':
      s.mcStates[String(ev.payload.mcId)] = '被带偏';
      break;
    case 'prep_completed':
      s.prepDone = true;
      break;
    case 'remedy_completed':
      // 补学完成后误区保持"被带偏"——openingCard(reteach) 正是按此状态找到要重放的误区;
      // 重讲纠正成功后由 misconception_corrected 事件翻到"已纠正"
      if (ev.payload.mcId) s.mcStates[String(ev.payload.mcId)] = '被带偏';
      break;
    case 'topic_mastered':
      s.knowledgeState = '出师';
      s.lastVerified = ev.t;
      s.reviewDue = addDays(ev.t, REVIEW_INTERVAL_DAYS);
      s.forgotten = false;
      break;
    case 'review_triggered':
      s.forgotten = true;
      break;
    case 'review_passed':
      s.forgotten = false;
      s.lastVerified = ev.t;
      s.reviewDue = addDays(ev.t, REVIEW_INTERVAL_DAYS * 2);
      break;
    case 'session_ended':
      // 会话结束仍悬置的"已注入"误区退回"待注入":
      // 否则它既不满足 reteach/review 的重放条件,也永远不会被再次注入,该知识点从此无法出师
      for (const [id, st] of Object.entries(s.mcStates)) {
        if (st === '已注入') s.mcStates[id] = '待注入';
      }
      break;
    default:
      break;
  }
  return s;
}

/** 掌握度:覆盖 45% + 纠错 35% + 小白测验 20%,随时可由事件流重算 */
export function computeMastery(state: TopicState, topic: Topic, events: LearnEvent[]): number {
  const coverage = topic.checklist.length
    ? state.hitChecklist.length / topic.checklist.length : 0;
  const mcs = Object.values(state.mcStates);
  const seen = mcs.filter((m) => m !== '待注入').length;
  const corrected = mcs.filter((m) => m === '已纠正').length;
  const mcScore = seen ? corrected / seen : 0;
  const quizScores = events
    .filter((e) => e.topicId === state.topicId && e.type === 'xiaobai_quiz_scored')
    .map((e) => Number(e.payload.score ?? 0) / 100);
  const quizBest = quizScores.length ? Math.max(...quizScores) : 0;
  return Math.round((coverage * 0.45 + mcScore * 0.35 + quizBest * 0.2) * 100) / 100;
}

/** 艾宾浩斯衰减:出师后随天数衰减,复习通过则重置 */
export function decayedMastery(mastery: number, lastVerified: string | null, now: Date): number {
  if (!lastVerified || mastery <= 0) return mastery;
  const days = Math.max(0, (now.getTime() - new Date(lastVerified).getTime()) / 86400000);
  const retention = 0.4 + 0.6 * Math.exp(-days / 6);
  return Math.round(mastery * retention * 100) / 100;
}

/** 全量重放(证据链回放 / 应用启动重建缓存) */
export function replayTopicState(topic: Topic, events: LearnEvent[], now = new Date()): TopicState {
  let s = initialTopicState(topic);
  const own = events.filter((e) => e.topicId === topic.topicId);
  for (const ev of own) s = applyEvent(s, ev);
  s.mastery = decayedMastery(computeMastery(s, topic, own), s.lastVerified, now);
  // 衰减过阈值 → 图谱由绿转黄(战术性遗忘的触发条件)
  if (s.knowledgeState === '出师' && s.reviewDue && now.toISOString() > s.reviewDue) {
    s.forgotten = true;
  }
  return s;
}

export function applyEvents(state: TopicState, topic: Topic, events: LearnEvent[], all: LearnEvent[]): TopicState {
  let s = state;
  for (const ev of events) s = applyEvent(s, ev);
  s.mastery = decayedMastery(
    computeMastery(s, topic, all.filter((e) => e.topicId === topic.topicId)),
    s.lastVerified, new Date(),
  );
  return s;
}
