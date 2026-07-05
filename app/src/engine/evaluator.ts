/**
 * 评估引擎:判断"发生了什么"。
 * mock 模式 = 规则关键词匹配(演示保稳);api 模式 = LLM 结构化输出,失败降级规则。
 * 客观维度(覆盖度/纠错力)永远走规则 —— 混合评分设计。
 */
import type { EvalResult, LlmSettings, Topic, TopicState } from '../types';
import { llmCall } from './llm';

export interface EvaluateInput {
  utterance: string;
  topic: Topic;
  state: TopicState;
  /** 已注入待判定的误区 */
  pendingMcId: string | null;
  settings: LlmSettings;
}

/** 任一组内关键词全部出现 → 命中 */
export function matchKeywordGroups(text: string, groups: string[][]): boolean {
  return groups.some((g) => g.length > 0 && g.every((k) => text.includes(k)));
}

const STUCK_PATTERNS = ['不太确定', '不知道', '忘了', '想不起来', '不会', '讲不下去', '怎么说呢', '呃', '嗯……'];
const ANALOGY_MARKERS = ['就像', '好比', '比如说', '打个比方', '相当于', '类似于', '就好像'];
const WHY_MARKERS = ['因为', '所以', '本质上', '原因是', '之所以', '设计成这样是'];

function ruleEvaluate(input: EvaluateInput): EvalResult {
  const { utterance, topic, state, pendingMcId } = input;
  const text = utterance.trim();

  // 1. checklist 新命中
  const checklistHits = topic.checklist
    .filter((c) => !state.hitChecklist.includes(c.id))
    .filter((c) => matchKeywordGroups(text, c.keywords))
    .map((c) => c.id);

  // 2. 待判定误区:纠正 or 被带偏
  let mcEvent: EvalResult['mcEvent'] = null;
  if (pendingMcId) {
    const mc = topic.misconceptions.find((m) => m.mcId === pendingMcId);
    if (mc) {
      if (matchKeywordGroups(text, mc.correctionKeywords)) {
        mcEvent = { mcId: mc.mcId, result: 'corrected' };
      } else if (matchKeywordGroups(text, mc.adoptionKeywords)) {
        mcEvent = { mcId: mc.mcId, result: 'adopted' };
      } else {
        mcEvent = { mcId: mc.mcId, result: 'pending' };
      }
    }
  }

  // 3. 卡壳信号:显式卡壳词,或超短且无信息量的回复
  const stuckSignal =
    STUCK_PATTERNS.some((p) => text.includes(p)) ||
    (text.length < 8 && checklistHits.length === 0 && !mcEvent);

  // 4. 偏题:较长发言但与本知识点任何关键词/术语无交集
  const allTerms = topic.checklist.flatMap((c) => [...c.terms, ...c.keywords.flat()]);
  const offTopic =
    text.length > 20 && checklistHits.length === 0 && !mcEvent && !stuckSignal &&
    !allTerms.some((t) => text.includes(t));

  // 5. 金句类比:命中 checklist 且带类比标记
  const goldenAnalogy =
    checklistHits.length > 0 && ANALOGY_MARKERS.some((m) => text.includes(m)) && text.length > 16
      ? text
      : null;

  const reasoning = [
    checklistHits.length ? `命中要点 ${checklistHits.join('/')}` : null,
    mcEvent ? `误区${mcEvent.mcId}判定:${mcEvent.result}` : null,
    stuckSignal ? '检测到卡壳信号' : null,
    offTopic ? '发言与知识点无关' : null,
    goldenAnalogy ? '检测到类比表达' : null,
  ].filter(Boolean).join(';') || '未命中新要点,继续当前层级追问';

  return { checklistHits, accuracyFlags: [], mcEvent, stuckSignal, offTopic, goldenAnalogy, reasoning };
}

/** 深度信号:讲解中是否出现 why 层解释(供逻辑/深度维度启发式) */
export function hasWhySignal(text: string): boolean {
  return WHY_MARKERS.some((m) => text.includes(m));
}

export async function evaluate(input: EvaluateInput): Promise<EvalResult> {
  const base = ruleEvaluate(input);
  if (input.settings.mode !== 'api') return base;
  try {
    const raw = await llmCall('evaluator', buildEvalPrompt(input), input.settings);
    const parsed = JSON.parse(raw) as Partial<EvalResult>;
    // 客观维度(checklist/误区判定)以规则结果为准;LLM 补充主观信号
    return {
      ...base,
      accuracyFlags: Array.isArray(parsed.accuracyFlags) ? parsed.accuracyFlags : base.accuracyFlags,
      stuckSignal: base.stuckSignal || parsed.stuckSignal === true,
      offTopic: base.offTopic || parsed.offTopic === true,
      goldenAnalogy: base.goldenAnalogy ?? (typeof parsed.goldenAnalogy === 'string' ? parsed.goldenAnalogy : null),
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : base.reasoning,
    };
  } catch {
    return base; // API 失败静默降级规则评估
  }
}

function buildEvalPrompt(input: EvaluateInput) {
  const { utterance, topic, state, pendingMcId } = input;
  return {
    system:
      '你是教学评估系统。阅读老师(学生用户)的最新讲解,只输出 JSON:' +
      '{"accuracyFlags":[{"checklistId":"","note":""}],"stuckSignal":false,"offTopic":false,"goldenAnalogy":null,"reasoning":""}。' +
      'temperature=0,不确定时保守。',
    user: JSON.stringify({
      utterance,
      checklist: topic.checklist.map((c) => ({ id: c.id, point: c.point, groundTruth: c.groundTruth })),
      state: { hit: state.hitChecklist, level: state.level, pendingMcId },
    }),
    json: true,
  };
}
