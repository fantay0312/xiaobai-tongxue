/**
 * 导演引擎:决定"接下来做什么"。纯代码状态机,完全确定性,LLM 不参与决策。
 * 决策优先级(方案 §14.4):
 *   1. 卡壳 → R1 递台阶 → R2 一起查书 → R3 跳过标盲区 → R4 退回备课
 *   2. 待判定误区 → 先响应纠正成败
 *   3. 某误区注入条件满足且未注入 → inject_misconception
 *   4. 当前 L 层级未讲完 → 同层追问
 *   5. 当前层讲完 → 进入下一层级
 */
import type {
  ChecklistItem, DirectorAction, EvalResult, InstructionCard, LearnEvent, McState,
  Misconception, QuestionLevel, SessionMode, Topic, TopicState, XiaobaiGlobal, XiaobaiMood,
} from '../types';

export type EventDraft = Pick<LearnEvent, 'type' | 'topicId' | 'payload' | 'evidence'>;

export interface Decision {
  action: DirectorAction;
  card: InstructionCard;
  events: EventDraft[];
  stateDelta: Partial<TopicState>;
  mood: XiaobaiMood;
  /** R3/R4 时插入的系统消息(导演出场,不经小白) */
  systemNote: string | null;
  /** R4:结束会话退回备课 */
  forceEnd: boolean;
  /** 会话结束后建议的下一步(用于 R4 提示) */
  pendingMcAfter: string | null; // 本轮之后处于"已注入待判定"的误区
}

const LEVEL_ORDER: QuestionLevel[] = ['L1', 'L2', 'L3', 'L4', 'L5'];
const LEVEL_ACTION: Record<QuestionLevel, DirectorAction> = {
  L1: 'ask_clarify', L2: 'ask_example', L3: 'ask_boundary',
  L4: 'inject_misconception', L5: 'ask_transfer',
};

export interface DecideInput {
  evalResult: EvalResult;
  topic: Topic;
  state: TopicState;         // 本轮评估前的状态
  global: XiaobaiGlobal;
  mode: SessionMode;
  pendingMcId: string | null;
  turn: number;
  utterance: string;
}

/** 由已命中项推导当前追问层级:第一个还有未命中项的层级 */
export function deriveLevel(topic: Topic, hitChecklist: string[]): QuestionLevel {
  for (const lv of LEVEL_ORDER) {
    if (lv === 'L4') continue; // L4 由误区注入驱动,不按 checklist 推进
    const items = topic.checklist.filter((c) => c.level === lv);
    if (items.some((c) => !hitChecklist.includes(c.id))) return lv;
  }
  return 'L5';
}

function excerpt(text: string, n = 40): string {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

/**
 * 可注入误区选择:前置 checklist 全命中且仍"待注入"。
 * 多个同时可注入时,优先挑与本轮新命中最贴合的(前置集含本轮命中、且前置集最小)——
 * 例:c4 刚讲完时 M3([c4]) 优先于 M2([c1..c4]),挑战永远落在最新鲜的讲解点上。
 */
function pickInjectable(
  topic: Topic, mcStates: Record<string, McState>, hitNow: string[], hitsThisTurn: string[],
): Misconception | undefined {
  const eligible = topic.misconceptions.filter((m) =>
    (mcStates[m.mcId] ?? '待注入') === '待注入' &&
    m.injectAfterChecklist.every((cid) => hitNow.includes(cid)),
  );
  if (eligible.length <= 1) return eligible[0];
  return [...eligible].sort((a, b) => {
    const aFresh = a.injectAfterChecklist.some((c) => hitsThisTurn.includes(c)) ? 0 : 1;
    const bFresh = b.injectAfterChecklist.some((c) => hitsThisTurn.includes(c)) ? 0 : 1;
    if (aFresh !== bFresh) return aFresh - bFresh;
    return a.injectAfterChecklist.length - b.injectAfterChecklist.length;
  })[0];
}

/**
 * 下一个追问目标(学习力节奏,方案 §7.1):
 * 默认取当前层级第一个未命中项;学习力 Lv≥3 时,只要已有命中且还有 L3+ 未命中项,
 * 就跳过剩余 L1/L2 —— "L1/L2 快速通过,很快进入边界追问"。
 */
function pickNextTarget(topic: Topic, hitNow: string[], learningLevel: number): ChecklistItem | undefined {
  const level = deriveLevel(topic, hitNow);
  let next = topic.checklist.find((c) => c.level === level && !hitNow.includes(c.id))
    ?? topic.checklist.find((c) => !hitNow.includes(c.id));
  if (learningLevel >= 3 && next && (next.level === 'L1' || next.level === 'L2') && hitNow.length > 0) {
    const jump = topic.checklist.find(
      (c) => !hitNow.includes(c.id) && c.level !== 'L1' && c.level !== 'L2',
    );
    if (jump) next = jump;
  }
  return next;
}

export function decide(input: DecideInput): Decision {
  const { evalResult: ev, topic, state, global: g, pendingMcId, utterance } = input;
  const hitNow = [...state.hitChecklist, ...ev.checklistHits];
  const events: EventDraft[] = [];
  const stateDelta: Partial<TopicState> = {};

  // ── 通用事件:本轮命中/金句/准确度 ──
  for (const id of ev.checklistHits) {
    const item = topic.checklist.find((c) => c.id === id);
    events.push({
      type: 'checklist_hit', topicId: topic.topicId,
      payload: { checklistId: id, point: item?.point ?? id },
      evidence: `讲述命中「${item?.point}」:“${excerpt(utterance)}”`,
    });
  }
  if (ev.goldenAnalogy) {
    events.push({
      type: 'golden_analogy_saved', topicId: topic.topicId,
      payload: { text: ev.goldenAnalogy },
      evidence: `金句类比收录:“${excerpt(ev.goldenAnalogy, 60)}”`,
    });
  }
  for (const f of ev.accuracyFlags) {
    events.push({
      type: 'accuracy_flag', topicId: topic.topicId,
      payload: { checklistId: f.checklistId, note: f.note },
      evidence: `表述存疑(${f.checklistId}):${f.note}`,
    });
  }

  const baseCard = (action: DirectorAction, extra?: Partial<InstructionCard>): InstructionCard => ({
    action,
    mcId: null, mcBelief: null, targetChecklistId: null,
    knownWhitelist: hitNow
      .map((id) => topic.checklist.find((c) => c.id === id)?.point ?? id),
    recentTeacherTerms: [],  // store 注入
    style: {
      persona: g.persona, learningLevel: g.learningLevel,
      maxSentences: 2, mustEndWithQuestion: action !== 'express_understanding',
    },
    paraphraseSource: null,
    ...extra,
  });

  const done = (action: DirectorAction, card: InstructionCard, mood: XiaobaiMood, opts?: {
    systemNote?: string; forceEnd?: boolean; pendingMcAfter?: string | null;
  }): Decision => {
    stateDelta.level = deriveLevel(topic, hitNow);
    if (hitNow.length > 0 && state.knowledgeState === '没懂') stateDelta.knowledgeState = '半懂';
    return {
      action, card, events, stateDelta, mood,
      systemNote: opts?.systemNote ?? null,
      forceEnd: opts?.forceEnd ?? false,
      pendingMcAfter: opts?.pendingMcAfter !== undefined ? opts.pendingMcAfter : (pendingMcId ?? null),
    };
  };

  // ── 优先级 1:卡壳救援梯度 R1→R2→R3→R4(方案 §6.2)──
  // rescueLevel 单调不降:R3 之后 stuckStreak 归零重新累计,但级别不回退——
  // 新一轮连续卡壳依然先递台阶/查书(R1/R2 台词),连到第 3 次时因 rescueLevel 已是 3,升 R4 收场。
  if (ev.stuckSignal) {
    const streak = state.stuckStreak + 1;
    stateDelta.stuckStreak = streak;
    const nextUnhit = topic.checklist.find((c) => !hitNow.includes(c.id));
    if (streak === 1) {
      stateDelta.rescueLevel = Math.max(state.rescueLevel, 1) as TopicState['rescueLevel'];
      events.push({ type: 'stuck_rescued', topicId: topic.topicId, payload: { level: 'R1' }, evidence: 'R1 递台阶:用已讲内容提示' });
      return done('rescue_hint', baseCard('rescue_hint', { targetChecklistId: nextUnhit?.id ?? null }), 'confused');
    }
    if (streak === 2) {
      stateDelta.rescueLevel = Math.max(state.rescueLevel, 2) as TopicState['rescueLevel'];
      events.push({ type: 'stuck_rescued', topicId: topic.topicId, payload: { level: 'R2', checklistId: nextUnhit?.id }, evidence: 'R2 提议一起查书,弹出知识卡片' });
      return done('propose_lookup', baseCard('propose_lookup', { targetChecklistId: nextUnhit?.id ?? null }), 'shy');
    }
    if (streak >= 3 && state.rescueLevel < 3) {
      stateDelta.rescueLevel = 3;
      stateDelta.stuckStreak = 0;
      events.push({ type: 'stuck_rescued', topicId: topic.topicId, payload: { level: 'R3', checklistId: nextUnhit?.id }, evidence: `R3 跳过「${nextUnhit?.point ?? '当前段落'}」,标记为盲区` });
      return done('ask_clarify', baseCard('ask_clarify', { targetChecklistId: nextUnhitAfterSkip(topic, hitNow, nextUnhit?.id) }), 'idle', {
        systemNote: `这段先跳过,已标记为盲区:「${nextUnhit?.point ?? '当前段落'}」。讲讲你熟的部分吧。`,
      });
    }
    // R4:R3 后再次连续卡满 → 判定备课不足,结束本轮退回备课
    // targetChecklistId 标记"卡在哪",渲染层据此走 R4 专用收场台词(与偏题的 stay_confused 区分)
    stateDelta.rescueLevel = 4;
    stateDelta.stuckStreak = 0;
    events.push({ type: 'stuck_rescued', topicId: topic.topicId, payload: { level: 'R4', checklistId: nextUnhit?.id }, evidence: 'R4 判定备课不足,本轮结束退回备课' });
    return done('stay_confused', baseCard('stay_confused', { targetChecklistId: nextUnhit?.id ?? null }), 'shy', {
      systemNote: '看来这块教材写得不太清楚,我们备完课再来一次。本轮已结束,盲区已记录。',
      forceEnd: true,
    });
  }
  stateDelta.stuckStreak = 0;

  // ── 优先级 1.5:偏题围栏 ──
  if (ev.offTopic) {
    return done('stay_confused', baseCard('stay_confused'), 'confused');
  }

  // ── 优先级 2:待判定误区 ──
  if (pendingMcId && ev.mcEvent) {
    const mc = topic.misconceptions.find((m) => m.mcId === pendingMcId);
    if (mc && ev.mcEvent.result === 'corrected') {
      const mcStatesNow: Record<string, McState> = { ...state.mcStates, [mc.mcId]: '已纠正' };
      stateDelta.mcStates = mcStatesNow;
      events.push({
        type: 'misconception_corrected', topicId: topic.topicId,
        payload: { mcId: mc.mcId },
        evidence: `讲述者成功纠正误区「${mc.belief}」:“${excerpt(utterance, 60)}”`,
      });
      // 纠正成功后若另有误区注入条件已满足 → 同轮衔接:先复述开窍,紧跟抛出新误区
      // (渲染层用 paraphraseSource 做"哦,我懂了…"前缀,再接触发话术,节奏不断)
      const chain = pickInjectable(topic, mcStatesNow, hitNow, ev.checklistHits);
      if (chain) {
        stateDelta.mcStates = { ...mcStatesNow, [chain.mcId]: '已注入' };
        events.push({
          type: 'misconception_injected', topicId: topic.topicId,
          payload: { mcId: chain.mcId },
          evidence: `注入误区 ${chain.mcId}:「${chain.belief}」`,
        });
        return done('inject_misconception', baseCard('inject_misconception', {
          mcId: chain.mcId, mcBelief: chain.belief, paraphraseSource: utterance,
        }), 'aha', { pendingMcAfter: chain.mcId });
      }
      // 无可注入误区 → 开窍复述,并把追问衔接到下一个未讲要点
      const follow = pickNextTarget(topic, hitNow, g.learningLevel);
      return done('express_understanding', baseCard('express_understanding', {
        mcId: mc.mcId, paraphraseSource: utterance,
        targetChecklistId: follow?.id ?? null,
        style: {
          persona: g.persona, learningLevel: g.learningLevel,
          maxSentences: 3, mustEndWithQuestion: follow != null,
        },
      }), 'aha', { pendingMcAfter: null });
    }
    if (mc && ev.mcEvent.result === 'adopted') {
      stateDelta.mcStates = { ...state.mcStates, [mc.mcId]: '被带偏' };
      events.push({
        type: 'misconception_adopted', topicId: topic.topicId,
        payload: { mcId: mc.mcId },
        evidence: `误区注入后被带偏:讲述者认同了「${mc.belief}」`,
      });
      // 小白开心地接受了错误认知(戏剧性反讽,复盘时揭示)
      return done('express_understanding', baseCard('express_understanding', {
        mcId: mc.mcId, mcBelief: mc.belief, paraphraseSource: mc.belief,
      }), 'happy', { pendingMcAfter: null });
    }
    // pending:小白坚持困惑,继续等一个能说服它的解释
    if (mc) {
      return done('stay_confused', baseCard('stay_confused', {
        mcId: mc.mcId, mcBelief: mc.belief,
      }), 'confused');
    }
  }

  // ── 优先级 3:误区注入条件满足 ──
  const injectable = pickInjectable(topic, state.mcStates, hitNow, ev.checklistHits);
  if (injectable) {
    stateDelta.mcStates = { ...state.mcStates, [injectable.mcId]: '已注入' };
    events.push({
      type: 'misconception_injected', topicId: topic.topicId,
      payload: { mcId: injectable.mcId },
      evidence: `注入误区 ${injectable.mcId}:「${injectable.belief}」`,
    });
    return done('inject_misconception', baseCard('inject_misconception', {
      mcId: injectable.mcId, mcBelief: injectable.belief,
    }), 'curious', { pendingMcAfter: injectable.mcId });
  }

  // ── 优先级 4/5:按层级追问(本轮有新命中 → 先 Aha 复述再带出下一问) ──
  // 追问目标经 pickNextTarget 计算:学习力 Lv≥3 加速通过 L1/L2(方案 §7.1)
  const nextItem = pickNextTarget(topic, hitNow, g.learningLevel);

  if (ev.checklistHits.length > 0) {
    const lastHit = topic.checklist.find((c) => c.id === ev.checklistHits[ev.checklistHits.length - 1]);
    return done('express_understanding', baseCard('express_understanding', {
      paraphraseSource: utterance,
      targetChecklistId: nextItem?.id ?? null,
      mcBelief: null, mcId: null,
      style: {
        persona: g.persona, learningLevel: g.learningLevel,
        maxSentences: 3, mustEndWithQuestion: nextItem != null,
      },
    }), lastHit ? 'aha' : 'happy');
  }

  if (!nextItem) {
    // 全部讲完且无可注入误区 → L5 迁移(高学习力)或收尾复述
    const action: DirectorAction = g.learningLevel >= 3 ? 'ask_transfer' : 'ask_boundary';
    return done(action, baseCard(action), 'curious');
  }
  // Lv5 提前迁移(方案 §7.1"两三轮逼近迁移"):覆盖过六成即可发起迁移追问
  if (g.learningLevel === 5 && topic.checklist.length > 0 &&
      hitNow.length / topic.checklist.length >= 0.6) {
    return done('ask_transfer', baseCard('ask_transfer'), 'curious');
  }
  return done(LEVEL_ACTION[nextItem.level], baseCard(LEVEL_ACTION[nextItem.level], {
    targetChecklistId: nextItem.id,
  }), nextItem.level === 'L3' ? 'thinking' : 'curious');
}

function nextUnhitAfterSkip(topic: Topic, hit: string[], skippedId?: string | null): string | null {
  return topic.checklist.find((c) => c.id !== skippedId && !hit.includes(c.id))?.id ?? null;
}

/** 会话开场白指令(reteach/review 模式小白先开口;teach 模式打招呼) */
export function openingCard(
  mode: SessionMode, topic: Topic, state: TopicState, g: XiaobaiGlobal,
): { card: InstructionCard; mood: XiaobaiMood; action: DirectorAction; pendingMcId: string | null } {
  const reMc = topic.misconceptions.find((m) =>
    mode === 'reteach'
      ? state.mcStates[m.mcId] === '被带偏'
      : state.mcStates[m.mcId] === '已纠正',
  );
  const base: InstructionCard = {
    action: 'ask_clarify', mcId: null, mcBelief: null,
    targetChecklistId: topic.checklist[0]?.id ?? null,
    knownWhitelist: state.hitChecklist.map((id) => topic.checklist.find((c) => c.id === id)?.point ?? id),
    recentTeacherTerms: [],
    style: { persona: g.persona, learningLevel: g.learningLevel, maxSentences: 2, mustEndWithQuestion: true },
    paraphraseSource: null,
  };
  if ((mode === 'reteach' || mode === 'review') && reMc) {
    return {
      card: { ...base, action: 'inject_misconception', mcId: reMc.mcId, mcBelief: reMc.belief },
      mood: 'confused', action: 'inject_misconception', pendingMcId: reMc.mcId,
    };
  }
  return { card: base, mood: 'curious', action: 'ask_clarify', pendingMcId: null };
}

/** 指令卡合法性校验:决不让幻觉动作驱动状态机 */
const ACTION_ENUM: DirectorAction[] = [
  'ask_clarify', 'ask_example', 'ask_boundary', 'inject_misconception', 'ask_transfer',
  'express_understanding', 'rescue_hint', 'propose_lookup', 'stay_confused', 'trigger_review',
];
export function isValidAction(a: string): a is DirectorAction {
  return (ACTION_ENUM as string[]).includes(a);
}
