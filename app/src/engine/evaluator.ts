/**
 * 评估引擎:判断"发生了什么"。
 * mock 模式 = 规则关键词匹配(断网兜底);
 * api 模式 = LLM 语义评估(自由表述也能命中要点/判定误区) + 规则结果合并,失败降级规则。
 * 合并纪律:规则命中永远保留;LLM 只能在规则漏判处补充,幻觉 id 一律过滤。
 */
import type { EvalResult, LlmSettings, Topic, TopicState } from '../types';
import { llmCall } from './llm';
import type { LlmPayload } from './llm';

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

/** 强卡壳词:出现即视为求救(除非本轮有实质内容,见 informative 守卫) */
const STUCK_STRONG = ['不太确定', '不知道', '想不起来', '讲不下去', '不记得', '我忘了', '忘记了', '卡住了', '没学过', '不清楚'];
/** 弱卡壳词(语气填充):只在短句里才算卡壳,避免误伤"呃,浅拷贝是……"这类正常讲解 */
const STUCK_FILLERS = ['呃', '嗯……', '怎么说呢', '这个嘛', '那个……', '唔'];
const ANALOGY_MARKERS = ['就像', '好比', '比如说', '打个比方', '相当于', '类似于', '就好像'];
const WHY_MARKERS = ['因为', '所以', '本质上', '原因是', '之所以', '设计成这样是'];

function ruleEvaluate(input: EvaluateInput): EvalResult {
  const { utterance, topic, state, pendingMcId } = input;
  const text = utterance.trim();

  // 1. checklist 新命中(优先级最高:有命中就绝不算卡壳/偏题)
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

  // 3. 卡壳信号 —— informative 守卫:本轮命中要点、或对误区给出明确判定(纠正/被带偏),
  //    说明讲解有实质内容,即使夹着"呃/不太确定"也不算卡壳(防误伤,方案 §6.2)。
  const resolvedMc = mcEvent !== null && mcEvent.result !== 'pending';
  const informative = checklistHits.length > 0 || resolvedMc;
  const stuckSignal =
    !informative &&
    (STUCK_STRONG.some((p) => text.includes(p)) ||
      (text.length < 26 && STUCK_FILLERS.some((p) => text.includes(p))) ||
      text.length < 8);

  // 4. 偏题:较长发言但与本知识点任何关键词/术语无交集。
  //    只用长度≥2 的词做交集判定 —— 单字关键词(如"新/套")撞车率太高,会放跑真偏题。
  const overlapVocab = topic.checklist
    .flatMap((c) => [...c.terms, ...c.keywords.flat()])
    .filter((t) => t.length >= 2);
  const offTopic =
    text.length > 20 && !informative && !mcEvent && !stuckSignal &&
    !overlapVocab.some((t) => text.includes(t));

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
  // api 与 proxy 都走 LLM 语义评估;仅 mock 纯规则
  if (input.settings.mode === 'mock') return base;
  try {
    const raw = await llmCall('evaluator', buildEvalPrompt(input), input.settings);
    return mergeEval(base, parseLlmEval(raw), input);
  } catch {
    return base; // API 失败静默降级规则评估
  }
}

// ───────────────────────── LLM 语义评估(api 模式) ─────────────────────────

interface LlmEval {
  checklistHits?: unknown;
  mcJudgement?: unknown;
  accuracyFlags?: unknown;
  stuckSignal?: unknown;
  offTopic?: unknown;
  goldenAnalogy?: unknown;
  reasoning?: unknown;
}

/** 剥掉偶发的 markdown 代码围栏再解析 */
function parseLlmEval(raw: string): LlmEval {
  const clean = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed: unknown = JSON.parse(clean);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('llm-eval-shape');
  return parsed as LlmEval;
}

/** 证据比对用归一化:只留汉字/字母/数字,英文一律小写 */
function normForQuote(s: string): string {
  return s.toLowerCase().replace(/[^\p{Script=Han}a-z0-9]/gu, '');
}

/**
 * 合并规则与 LLM 语义评估:
 * - 命中 = 规则 ∪ LLM;LLM 命中必须带"老师原话摘录"且摘录真实存在于原话中(防幻觉命中),
 *   且只能命中"尚未讲清"的合法 id
 * - 误区判定:规则关键词明确命中(corrected/adopted)时以规则为准;规则拿不准(pending)才采信 LLM
 * - 卡壳/偏题:合并后重算 informative 守卫,有实质内容一律不算
 */
function mergeEval(base: EvalResult, llm: LlmEval, input: EvaluateInput): EvalResult {
  const { topic, state, pendingMcId, utterance } = input;
  const validIds = new Set(topic.checklist.map((c) => c.id));
  const uttNorm = normForQuote(utterance);

  const llmHits = (Array.isArray(llm.checklistHits) ? llm.checklistHits : [])
    .map((h) => {
      if (typeof h !== 'object' || h === null) return null;
      const { id, quote } = h as { id?: unknown; quote?: unknown };
      if (typeof id !== 'string' || typeof quote !== 'string') return null;
      const q = normForQuote(quote);
      // 摘录必须有实质长度且逐字出自老师原话 —— 幻觉命中在此被丢弃
      if (q.length < 4 || !uttNorm.includes(q)) return null;
      return id;
    })
    .filter((id): id is string => id !== null && validIds.has(id) && !state.hitChecklist.includes(id));
  const checklistHits = [...new Set([...base.checklistHits, ...llmHits])];

  // 误区判定:api 模式下语义判定优先 —— 规则关键词是子串匹配,分不清"一样"和"不一样",
  // 自由表述下会把正确反驳误判成被带偏(或反向);LLM 给出合法判定时采信 LLM,
  // LLM 缺失/非法/调用失败时才落回规则结果兜底
  let mcEvent = base.mcEvent;
  if (
    pendingMcId && mcEvent &&
    (llm.mcJudgement === 'corrected' || llm.mcJudgement === 'adopted' || llm.mcJudgement === 'pending')
  ) {
    mcEvent = { mcId: pendingMcId, result: llm.mcJudgement };
  }

  const resolvedMc = mcEvent !== null && mcEvent.result !== 'pending';
  const informative = checklistHits.length > 0 || resolvedMc;
  const stuckSignal = !informative && (base.stuckSignal || llm.stuckSignal === true);
  const offTopic = !informative && !stuckSignal && !mcEvent && (base.offTopic || llm.offTopic === true);

  // 金句与命中同纪律:必须逐字出自老师原话,防止 LLM 转述/编造被当成"老师金句"存档
  const llmGoldenRaw = typeof llm.goldenAnalogy === 'string' ? llm.goldenAnalogy : null;
  const llmGoldenNorm = llmGoldenRaw ? normForQuote(llmGoldenRaw) : '';
  const goldenAnalogy = base.goldenAnalogy ??
    (informative && llmGoldenRaw && llmGoldenNorm.length >= 8 && uttNorm.includes(llmGoldenNorm)
      ? llmGoldenRaw
      : null);

  const accuracyFlags = (Array.isArray(llm.accuracyFlags) ? llm.accuracyFlags : [])
    .filter((f): f is { checklistId: string; note: string } =>
      typeof f === 'object' && f !== null &&
      typeof (f as { checklistId?: unknown }).checklistId === 'string' &&
      validIds.has((f as { checklistId: string }).checklistId) &&
      typeof (f as { note?: unknown }).note === 'string' &&
      (f as { note: string }).note.length > 0)
    .slice(0, 3);

  const reasoning =
    typeof llm.reasoning === 'string' && llm.reasoning
      ? `${llm.reasoning}(语义评估)`
      : base.reasoning;

  return { checklistHits, accuracyFlags, mcEvent, stuckSignal, offTopic, goldenAnalogy, reasoning };
}

function buildEvalPrompt(input: EvaluateInput): LlmPayload {
  const { utterance, topic, state, pendingMcId } = input;
  const unhit = topic.checklist.filter((c) => !state.hitChecklist.includes(c.id));
  const mc = pendingMcId ? topic.misconceptions.find((m) => m.mcId === pendingMcId) : undefined;
  const system = [
    '你是「小白同学」的教学评估引擎:学生用户(下称"老师")正在给 AI 学生讲课,你要判定老师这一轮讲解发生了什么。',
    '严格按证据判定,不脑补。只输出 JSON,结构如下:',
    '{"checklistHits":[{"id":"c1","quote":"老师原话摘录"}],"mcJudgement":null,"accuracyFlags":[],"stuckSignal":false,"offTopic":false,"goldenAnalogy":null,"reasoning":""}',
    '判定标准:',
    '- checklistHits:老师本轮讲解【明确、正面、正确】讲到了哪些"待讲要点"。按含义判定,与具体措辞无关;只能填待讲要点列表中的 id。宁缺毋滥:仅仅沾边、间接暗示、需要推理补全、复读提问、或讲错了的一律不算。每一项必须附 quote:从老师本轮原话中一字不差摘录的短句(≤40字),作为该要点被讲到的直接证据;给不出原话证据就不要报命中。',
    mc
      ? '- mcJudgement:老师对"当前误区"的回应判定 → "corrected"(明确指出该说法错误,并给出符合纠正标准的解释)/"adopted"(认同、附和或迎合了这个错误说法)/"pending"(没有正面回应)。'
      : '- mcJudgement:本轮无待判定误区,恒为 null。',
    '- accuracyFlags:老师讲解中与 groundTruth 相悖或含糊有歧义的表述,格式 {"checklistId":"","note":"≤30字"};没有则空数组。',
    '- stuckSignal:老师明显卡壳、说不下去、直接表示不会/求助时为 true。',
    '- offTopic:发言与本知识点完全无关(闲聊、其他话题)才为 true;讲得不好、讲得浅不算偏题。',
    '- goldenAnalogy:老师若用了贴切的生活化类比,摘录包含类比的原句;没有则为 null。',
    '- reasoning:一句话判定依据,中文,不超过 40 字。',
  ].join('\n');
  const user = JSON.stringify({
    知识点: topic.title,
    老师本轮讲解: utterance,
    待讲要点: unhit.map((c) => ({ id: c.id, point: c.point, groundTruth: c.groundTruth })),
    已讲清的要点: state.hitChecklist.map(
      (id) => topic.checklist.find((c) => c.id === id)?.point ?? id,
    ),
    当前误区: mc ? { 错误认知: mc.belief, 纠正标准: mc.correctionCriteria } : null,
  });
  return { system, user, json: true };
}
