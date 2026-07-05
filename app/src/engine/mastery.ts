/**
 * 掌握度评估:考小白、五维雷达、复盘报告。
 * 客观维度(覆盖度/纠错力/测验)规则计算;主观维度(逻辑/深度)启发式或 LLM(temperature=0)。
 */
import type {
  BlindSpot, RadarScores, SessionMode, SessionReport, Topic, TopicState,
  TurnTrace, XiaobaiGlobal, XiaobaiQuizResult,
} from '../types';
import { hasWhySignal } from './evaluator';

const clamp01 = (n: number) => Math.max(0, Math.min(1, Math.round(n * 100) / 100));

/**
 * 考小白,不考你:小白只会被教明白的东西。
 * 命中的 checklist 项 → 会;关联误区被带偏/未纠正 → 必错。
 */
export function runXiaobaiQuiz(topic: Topic, state: TopicState): XiaobaiQuizResult {
  const answers = topic.quizBank.map((q) => {
    const taught = state.hitChecklist.includes(q.checklistRef);
    const mcBad = q.mcRef
      ? state.mcStates[q.mcRef] === '被带偏' || state.mcStates[q.mcRef] === '已注入'
      : false;
    return { quizId: q.id, correct: taught && !mcBad, checklistRef: q.checklistRef };
  });
  const score = answers.length
    ? Math.round((answers.filter((a) => a.correct).length / answers.length) * 100)
    : 0;
  const failedChecklist = [...new Set(answers.filter((a) => !a.correct).map((a) => a.checklistRef))];
  return { score, answers, failedChecklist };
}

export function computeRadar(
  traces: TurnTrace[], topic: Topic, state: TopicState, quiz: XiaobaiQuizResult | null,
): RadarScores {
  const teacherTexts = traces.map((t) => t.teacherText);
  const coverage = topic.checklist.length
    ? state.hitChecklist.length / topic.checklist.length : 0;

  const flags = traces.flatMap((t) => t.evalResult.accuracyFlags).length;
  const hits = state.hitChecklist.length;
  const accuracy = hits === 0 ? 0 : clamp01(0.95 - 0.18 * flags - (quiz ? (1 - quiz.score / 100) * 0.2 : 0));

  // 逻辑结构:连接词密度 + 要点按层级递进覆盖
  const connectives = ['首先', '然后', '接着', '其次', '最后', '所以', '也就是说', '换句话说', '总的来说', '这就意味着'];
  const connectiveTurns = teacherTexts.filter((t) => connectives.some((c) => t.includes(c))).length;
  const logic = hits === 0 ? 0 : clamp01(0.45 + 0.35 * (connectiveTurns / Math.max(1, teacherTexts.length)) + 0.25 * coverage);

  // 深度:why 层解释比例 + 类比使用
  const whyTurns = teacherTexts.filter(hasWhySignal).length;
  const analogies = traces.filter((t) => t.evalResult.goldenAnalogy).length;
  const depth = hits === 0 ? 0 : clamp01(0.3 + 0.45 * (whyTurns / Math.max(1, teacherTexts.length)) + 0.15 * Math.min(1, analogies));

  // 纠错力(独有指标):注入误区的纠正率
  const mcs = Object.values(state.mcStates);
  const injected = mcs.filter((m) => m !== '待注入').length;
  const corrected = mcs.filter((m) => m === '已纠正').length;
  const debug = injected === 0 ? 0 : clamp01(corrected / injected);

  return {
    覆盖度: clamp01(coverage), 准确度: accuracy, 逻辑结构: logic, 深度: depth, 纠错力: debug,
  };
}

export function buildReport(input: {
  sessionId: string;
  topic: Topic;
  mode: SessionMode;
  startedAt: string;
  endedAt: string;
  traces: TurnTrace[];
  state: TopicState;         // 会话结束时点状态
  quiz: XiaobaiQuizResult | null;
  prevRadar: RadarScores | null;
  global: XiaobaiGlobal;
}): SessionReport {
  const { sessionId, topic, mode, startedAt, endedAt, traces, state, quiz, prevRadar } = input;
  const radar = computeRadar(traces, topic, state, quiz);

  const radarDelta: Partial<RadarScores> | null = prevRadar
    ? Object.fromEntries(
        (Object.keys(radar) as (keyof RadarScores)[])
          .map((k) => [k, Math.round((radar[k] - prevRadar[k]) * 100) / 100])
          .filter(([, v]) => (v as number) !== 0),
      ) as Partial<RadarScores>
    : null;

  // 高光优先:金句 → 亮眼维度 → 小白测验佳绩
  const golden = traces.map((t) => t.evalResult.goldenAnalogy).filter((s): s is string => !!s);
  const highlights: string[] = [];
  for (const gline of golden) highlights.push(`🌟 金句类比已收录:「${gline.length > 40 ? `${gline.slice(0, 40)}…` : gline}」`);
  const bestDim = (Object.entries(radar) as [string, number][]).sort((a, b) => b[1] - a[1])[0];
  if (bestDim && bestDim[1] >= 0.7) highlights.push(`本次讲解「${bestDim[0]}」表现最好(${Math.round(bestDim[1] * 100)} 分)`);
  if (quiz && quiz.score >= 80) highlights.push(`小白随堂小测考了 ${quiz.score} 分——你讲明白了!`);
  if (highlights.length === 0) highlights.push('你完成了一次完整的讲解——迈出教学第一步本身就是高光。');

  // 盲区:被带偏误区(high) + 未讲到要点(medium) + 测验暴露(low)
  const blindSpots: BlindSpot[] = [];
  for (const m of topic.misconceptions) {
    if (state.mcStates[m.mcId] === '被带偏') {
      blindSpots.push({
        knowledgePoint: m.belief, mcId: m.mcId, checklistId: null, severity: 'high',
        evidence: `误区注入后,小白还没懂——它现在真的相信「${m.belief}」了`,
      });
    }
  }
  for (const c of topic.checklist) {
    if (!state.hitChecklist.includes(c.id)) {
      blindSpots.push({
        knowledgePoint: c.point, mcId: null, checklistId: c.id, severity: 'medium',
        evidence: `这个要点小白还没听你讲过`,
      });
    }
  }
  if (quiz) {
    for (const cid of quiz.failedChecklist) {
      if (blindSpots.some((b) => b.checklistId === cid)) continue;
      const c = topic.checklist.find((x) => x.id === cid);
      blindSpots.push({
        knowledgePoint: c?.point ?? cid, mcId: null, checklistId: cid, severity: 'low',
        evidence: `小白小测在这个点上答错了`,
      });
    }
  }

  const masteredNow =
    state.hitChecklist.length === topic.checklist.length &&
    topic.misconceptions.every((m) => state.mcStates[m.mcId] === '已纠正') &&
    (quiz?.score ?? 0) >= 80;

  return {
    sessionId, topicId: topic.topicId, mode, startedAt, endedAt,
    radar, radarDelta, highlights,
    goldenAnalogies: golden,
    blindSpots, quiz,
    turnCount: traces.length,
    masteredNow,
  };
}
