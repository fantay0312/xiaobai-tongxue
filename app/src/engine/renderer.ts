/**
 * 小白渲染引擎:只负责"怎么说出来"。
 * 每轮近无状态:仅依据 指令卡 + 最近 K 轮对话 新鲜渲染(防线⑥ 逐轮重渲染)。
 * mock 模式:台词模板库 + 槽位填充;api/proxy 模式:LLM 渲染,失败降级 mock。
 * speakXiaobai 是唯一出口:渲染 → 泄漏检测 → 重试(≤2) → 兜底。
 */
import type {
  ChatMessage, InstructionCard, LlmSettings, Topic, TopicState, XiaobaiGlobal, XiaobaiMood,
} from '../types';
import {
  XIAOBAI_LINES, XIAOBAI_PROBE_BRIDGES, XIAOBAI_TANGENT_ACKS,
} from '../data/xiaobaiLines';
import { FALLBACK_LINE, leakageCheck } from './leakage';
import { llmCall } from './llm';
import { mockQuestionClarificationReply, repeatsQuestionVerbatim } from './conversationRepair';
import { parseMoodTag } from './moodTag';
import { buildXiaobaiSystem, buildXiaobaiUser } from './prompts';
import type { QuestionClarificationCard, RuntimeInstructionCard } from './prompts';
import type { SessionBrief } from './sessionBrief';

/** 按动作查表的心情(mock 路径唯一来源;api 路径在模型没给标签时的兜底) */
const ACTION_MOOD: Record<string, XiaobaiMood> = {
  ask_clarify: 'curious', ask_example: 'curious', ask_boundary: 'thinking',
  inject_misconception: 'confused', ask_transfer: 'curious',
  express_understanding: 'aha', rescue_hint: 'confused', propose_lookup: 'shy',
  stay_confused: 'confused', trigger_review: 'shy',
  rephrase_question: 'shy',
};

/**
 * 导演意图锁:这些动作的心情不由模型自选(api 路径也按表)。
 * 装不懂/卡住/查书/重述时若模型说"开窍",复盘页的判语与表情会自相矛盾;误区注入必须显得真困惑。
 */
export const ACTION_MOOD_LOCK: Partial<Record<string, XiaobaiMood>> = {
  inject_misconception: 'confused',
  stay_confused: 'confused',
  propose_lookup: 'shy',
  rephrase_question: 'shy',
};

/** 从老师最近发言中提取本知识点术语(术语镜像规则的白名单来源) */
export function extractTeacherTerms(messages: ChatMessage[], topic: Topic): string[] {
  const teacherText = messages.filter((m) => m.role === 'teacher').slice(-4).map((m) => m.text).join(' ');
  const terms = new Set<string>();
  for (const c of topic.checklist) {
    for (const t of c.terms) if (teacherText.includes(t)) terms.add(t);
  }
  return [...terms];
}

/** 复述时剔除的开场引子/口头禅(复述"我先说说…"会显得鹦鹉学舌) */
const LEADIN_RE = /^(我先说说|我们再来|我再说说|接下来|接着说|然后|首先|其次|最后|另外|其实|所以|那么|总之|比如说|比如|不对|不是|不用不用|不用|那可不行|呃+|嗯+|哦+|啊+)[,、::\s]*/;

/**
 * 取讲解中最适合复述的短句(mock 的"正确复述")。
 * 评分:含专业术语 +2 / 含判断词(是/不/没/会…)+1 / 长度 10-38 字 +1;同分取短。
 * 超长子句按逗号重组到 ~46 字,避免半句截断。
 */
function pickParaphrase(source: string, topic: Topic): string {
  const clean = source.replace(/\s+/g, ' ').trim();
  const clauses = clean
    .split(/[。!?;\n!?;]/)
    .map((s) => s.trim().replace(LEADIN_RE, '').trim())
    .filter((s) => s.length >= 6);
  const allTerms = topic.checklist.flatMap((c) => c.terms);
  const score = (s: string) =>
    (allTerms.some((t) => s.includes(t)) ? 2 : 0) +
    (/[是不没会]|指向|等于|变/.test(s) ? 1 : 0) +
    (s.length >= 10 && s.length <= 38 ? 1 : 0);
  let best = [...clauses].sort((a, b) => score(b) - score(a) || a.length - b.length)[0] ?? clean;
  if (best.length > 46) {
    const parts = best.split(/[,,、]/);
    let acc = '';
    for (const p of parts) {
      const cand = acc ? `${acc},${p}` : p;
      if (cand.length > 46) break;
      acc = cand;
    }
    best = acc || best.slice(0, 46);
  }
  return best.length > 50 ? `${best.slice(0, 50)}…` : best;
}

function fillTemplate(tpl: string, card: InstructionCard, topic: Topic): string {
  const item = card.targetChecklistId
    ? topic.checklist.find((c) => c.id === card.targetChecklistId)
    : undefined;
  return tpl
    .replaceAll('{probe}', item?.probeLine ?? '能再从头给我讲讲吗?')
    .replaceAll('{point}', item?.point ?? '这里')
    .replaceAll('{term}', card.recentTeacherTerms[0] ?? '那个')
    .replaceAll('{belief}', card.mcBelief ?? '')
    .replaceAll('{paraphrase}', card.paraphraseSource ? pickParaphrase(card.paraphraseSource, topic) : '')
    .replaceAll('{transfer}', topic.transferHint);
}

/** 槽位可填性检查:缺素材的模板直接淘汰,保证任何指令卡下台词都通顺 */
function slotUsable(tpl: string, card: InstructionCard): boolean {
  if (tpl.includes('{belief}') && !card.mcBelief) return false;
  if (tpl.includes('{paraphrase}') && !card.paraphraseSource) return false;
  if (tpl.includes('{term}') && card.recentTeacherTerms.length === 0) return false;
  return true;
}

/** R4 收场专用(卡壳到底,导演结束会话)——不含任何知识点术语 */
const R4_LINE = '唔……老师,这段我们俩好像都卡住了。要不先记下来,备好课咱们再来一次?我等你!';
/** 偏题围栏兜底(部分人格的 stay_confused 模板全都依赖 {belief} 时使用) */
const OFFTOPIC_LINE = '老师,这个好像不是今天要讲的吧?我还想听你接着讲刚才那个呢。';

function mockRender(
  card: RuntimeInstructionCard, topic: Topic, seed: number,
): { text: string; mood: XiaobaiMood } {
  if (card.action === 'rephrase_question') {
    return {
      text: mockQuestionClarificationReply(card.questionSource, card.style.persona),
      mood: 'shy',
    };
  }
  // 回答了小白自己的题外追问:导演用无复述素材的 express_understanding 表示“收住”。
  if (
    card.action === 'express_understanding' && !card.paraphraseSource &&
    !card.mcBelief && !card.targetChecklistId
  ) {
    const pool = XIAOBAI_TANGENT_ACKS[card.style.persona];
    return { text: pool[seed % pool.length], mood: 'happy' };
  }
  // inject_misconception 直接使用误区库触发话术(误区库即剧本);
  // 若带 paraphraseSource(纠正成功后同轮衔接注入),先复述开窍再抛新误区。
  if (card.action === 'inject_misconception' && card.mcId) {
    const mc = topic.misconceptions.find((m) => m.mcId === card.mcId);
    if (mc) {
      const aha = card.paraphraseSource
        ? `哦——我懂了,${pickParaphrase(card.paraphraseSource, topic)}!` : '';
      return { text: `${aha}${mc.triggerLine}`, mood: aha ? 'curious' : 'confused' };
    }
  }
  // stay_confused 无误区语境时分两种:R4 收场(带 targetChecklistId 标记)/ 偏题拉回
  if (card.action === 'stay_confused' && !card.mcBelief && card.targetChecklistId) {
    return { text: R4_LINE, mood: 'shy' };
  }
  const pool = XIAOBAI_LINES[card.style.persona]?.[card.action] ?? [];
  const usable = pool.filter((tpl) => slotUsable(tpl, card));
  if (usable.length === 0 && card.action === 'stay_confused' && !card.mcBelief) {
    return { text: OFFTOPIC_LINE, mood: 'confused' };
  }
  const list = usable.length ? usable : pool;
  const tpl = list.length ? list[seed % list.length] : '{probe}';
  let text = fillTemplate(tpl, card, topic);
  // 开窍复述后衔接下一问:追问目标的 probeLine 直接续上(probeLine 本身过泄漏纪律)
  if (card.action === 'express_understanding' && card.targetChecklistId) {
    const next = topic.checklist.find((c) => c.id === card.targetChecklistId);
    if (next) {
      const bridges = XIAOBAI_PROBE_BRIDGES[card.style.persona];
      text = `${text}${fillTemplate(bridges[seed % bridges.length], card, topic)}`;
    }
  }
  return { text, mood: ACTION_MOOD[card.action] ?? 'idle' };
}

/**
 * api/proxy 渲染:提示词全部出自 engine/prompts。
 * 先剥心情标签(模型原文),再剥引号/「小白:」前缀 —— 下游(复读检测、泄漏守门、重试、UI)只见剥净文本。
 */
async function apiRender(
  card: RuntimeInstructionCard, topic: Topic, recent: ChatMessage[], settings: LlmSettings,
  bannedTerms: string[], memoryHints: string[], sessionBrief: SessionBrief | null,
): Promise<{ text: string; mood: XiaobaiMood | null }> {
  const system = buildXiaobaiSystem({ card, topic, bannedTerms, memoryHints, sessionBrief });
  const user = buildXiaobaiUser({ recentMessages: recent });
  const raw = await llmCall('xiaobai', { system, user }, settings);
  const parsed = parseMoodTag(raw.trim());
  const text = parsed.text
    .replace(/^["“「『]+/, '').replace(/["”」』]+$/, '').replace(/^小白[:：]\s*/, '').trim();
  return { text, mood: parsed.mood };
}

export interface SpeakResult {
  text: string;
  mood: XiaobaiMood;
  leakageRetries: number;
  leaked: string[];
  /** 最终台词的出处:api = 模型原话过守门;mock = 离线模板(含 api 失败/重试耗尽后的降级) */
  source: 'api' | 'mock';
  /** 心情出处:model = 模型标签(经导演锁校验);table = 查表 */
  moodSource: 'model' | 'table';
}

/** 渲染 + 出口守门(唯一调用入口) */
export async function speakXiaobai(input: {
  card: RuntimeInstructionCard;
  topic: Topic;
  state: TopicState;
  recentMessages: ChatMessage[];
  settings: LlmSettings;
  seed: number;
  /** 学伴记忆的固定话术(≤2 句,已过泄漏守门);只进 api 系统提示,mock 路径忽略 */
  memoryHints?: string[];
  /** 课堂小本本(本场结构化笔记);只进 api 系统提示【这堂课到现在】,mock 路径忽略 */
  sessionBrief?: SessionBrief | null;
}): Promise<SpeakResult> {
  const { card, topic, state, recentMessages, settings, seed, memoryHints, sessionBrief } = input;

  // api 模式预告违禁词:未解锁 checklist 的术语(泄漏检测的 banned 集),先说清比事后拦截省一次重试
  const allowedNow = new Set(card.recentTeacherTerms);
  for (const item of topic.checklist) {
    if (state.hitChecklist.includes(item.id)) for (const t of item.terms) allowedNow.add(t);
  }
  const banned = [...new Set(
    topic.checklist
      .filter((item) => !state.hitChecklist.includes(item.id))
      .flatMap((item) => item.terms)
      .filter((t) => !allowedNow.has(t)),
  )];
  // 题外致谢轮(无复述素材的 express_understanding)与 mock 路径同 mood,不误标"开窍"
  const isTangentAck = card.action === 'express_understanding' &&
    !card.paraphraseSource && !card.mcBelief && !card.targetChecklistId;
  const lockedMood: XiaobaiMood | undefined = isTangentAck ? 'happy' : ACTION_MOOD_LOCK[card.action];

  for (let attempt = 0; attempt <= 2; attempt++) {
    let text: string; let mood: XiaobaiMood;
    let source: 'api' | 'mock';
    let moodSource: 'model' | 'table' = 'table';
    if (settings.mode !== 'mock' && attempt < 2) {
      try {
        const rendered = await apiRender(
          card, topic, recentMessages, settings, banned, memoryHints ?? [], sessionBrief ?? null,
        );
        text = rendered.text.trim();
        source = 'api';
        // 心情:导演锁 > 模型标签 > 动作查表
        const modelMood = lockedMood ? null : rendered.mood;
        mood = lockedMood ?? modelMood ?? ACTION_MOOD[card.action] ?? 'idle';
        moodSource = modelMood ? 'model' : 'table';
      } catch {
        ({ text, mood } = mockRender(card, topic, seed + attempt));
        source = 'mock';
      }
    } else {
      ({ text, mood } = mockRender(card, topic, seed + attempt));
      source = 'mock';
    }
    if (
      card.action === 'rephrase_question'
      && repeatsQuestionVerbatim(text, card.questionSource)
    ) {
      continue;
    }
    const leaks = leakageCheck({
      reply: text, topic,
      whitelistChecklist: state.hitChecklist,
      teacherTerms: card.recentTeacherTerms,
    });
    if (leaks.length === 0) return { text, mood, leakageRetries: attempt, leaked: [], source, moodSource };
    if (attempt === 2) {
      return { text: FALLBACK_LINE, mood: 'confused', leakageRetries: 3, leaked: leaks, source: 'mock', moodSource: 'table' };
    }
    // 把实际泄漏词并入违禁清单,下次重试时明确点名
    for (const t of leaks) if (!banned.includes(t)) banned.push(t);
  }
  return { text: FALLBACK_LINE, mood: 'confused', leakageRetries: 3, leaked: [], source: 'mock', moodSource: 'table' };
}

/** 元对话专用出口：只让小白重述自己的上一问，不进入教学导演与事件流。 */
export function speakQuestionClarification(input: {
  questionSource: string;
  topic: Topic;
  state: TopicState;
  global: XiaobaiGlobal;
  recentMessages: ChatMessage[];
  settings: LlmSettings;
  seed: number;
}): Promise<SpeakResult> {
  const { questionSource, topic, state, global, recentMessages, settings, seed } = input;
  const card: QuestionClarificationCard = {
    action: 'rephrase_question',
    questionSource,
    mcId: null,
    mcBelief: null,
    targetChecklistId: null,
    knownWhitelist: state.hitChecklist.map(
      (id) => topic.checklist.find((item) => item.id === id)?.point ?? id,
    ),
    recentTeacherTerms: extractTeacherTerms(recentMessages, topic),
    style: {
      persona: global.persona,
      learningLevel: global.learningLevel,
      maxSentences: 2,
      mustEndWithQuestion: true,
    },
    paraphraseSource: null,
  };
  return speakXiaobai({ card, topic, state, recentMessages, settings, seed });
}
