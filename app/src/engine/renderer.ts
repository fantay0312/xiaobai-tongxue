/**
 * 小白渲染引擎:只负责"怎么说出来"。
 * 每轮近无状态:仅依据 指令卡 + 最近 K 轮对话 新鲜渲染(防线⑥ 逐轮重渲染)。
 * mock 模式:台词模板库 + 槽位填充;api/proxy 模式:LLM 渲染,失败降级 mock。
 * speakXiaobai 是唯一出口:渲染 → 泄漏检测 → 重试(≤2) → 兜底。
 */
import type {
  ChatMessage, InstructionCard, LlmSettings, Topic, TopicState, XiaobaiMood,
} from '../types';
import { XIAOBAI_LINES } from '../data/xiaobaiLines';
import { FALLBACK_LINE, leakageCheck } from './leakage';
import { llmCall } from './llm';

const ACTION_MOOD: Record<string, XiaobaiMood> = {
  ask_clarify: 'curious', ask_example: 'curious', ask_boundary: 'thinking',
  inject_misconception: 'confused', ask_transfer: 'curious',
  express_understanding: 'aha', rescue_hint: 'confused', propose_lookup: 'shy',
  stay_confused: 'confused', trigger_review: 'shy',
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
  card: InstructionCard, topic: Topic, seed: number,
): { text: string; mood: XiaobaiMood } {
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
    if (next) text = `${text}${next.probeLine}`;
  }
  return { text, mood: ACTION_MOOD[card.action] ?? 'idle' };
}

async function apiRender(
  card: InstructionCard, recent: ChatMessage[], settings: LlmSettings, bannedTerms: string[],
): Promise<string> {
  const system = [
    `你正在扮演「小白」——一个${card.style.persona}的大学低年级学生,正在听老师(用户)给你讲解知识。`,
    '【你的认知状态(白名单,这是你全部的知识)】',
    card.knownWhitelist.length ? card.knownWhitelist.map((w) => `- ${w}`).join('\n') : '(你还什么都不懂)',
    card.mcBelief ? `【你当前坚信的观点】${card.mcBelief}\n你真诚地认为这是对的,除非老师给出让你信服的解释。` : '',
    '【铁律】',
    '1. 白名单之外的任何概念你都不懂,被问到只能困惑求教:"我就是不知道才问你呀,老师。"',
    '2. 你只能使用三类词汇:老师说过的词 / 白名单中的词 / 你观点中的词。绝不使用其他专业术语。',
    `   老师最近说过的词:${card.recentTeacherTerms.join('、') || '(无)'}`,
    bannedTerms.length
      ? `   这些词老师还没教到,你压根不认识,严禁说出口(一个字都不能出现):${bannedTerms.join('、')}`
      : '',
    '3. 你永远不给老师讲课、不总结知识、不主动纠正老师。',
    `4. 每次发言不超过 ${card.style.maxSentences} 句。${card.style.mustEndWithQuestion ? '以一个问题结尾。' : ''}`,
    `5. 语气自然口语化,符合${card.style.persona}学生的性格。只输出台词本身,不带引号、不带"小白:"前缀。`,
    `【本轮你要做的事】${actionBrief(card)}`,
  ].filter(Boolean).join('\n');
  const user = recent.slice(-6).map((m) => `${m.role === 'teacher' ? '老师' : '小白'}:${m.text}`).join('\n');
  const raw = await llmCall('xiaobai', { system, user }, settings);
  return raw.trim().replace(/^["“「『]+/, '').replace(/["”」』]+$/, '').replace(/^小白[::]\s*/, '').trim();
}

function actionBrief(card: InstructionCard): string {
  switch (card.action) {
    case 'inject_misconception':
      return card.paraphraseSource
        ? '先用一句话复述你刚被讲明白的点(表达开窍),紧接着把【你当前坚信的观点】自然地说出来——语气是真诚地陈述你的理解,不是刻意提问。'
        : '把【你当前坚信的观点】自然地说出来——语气是真诚地陈述你的理解,不是刻意提问。';
    case 'express_understanding': return '你刚被讲明白了!用自己的话正确复述老师刚讲的要点,表达开窍的喜悦。';
    case 'rescue_hint': return '老师卡住了。用老师之前讲过的内容轻轻递个台阶,比如"是不是跟你刚才说的那个有关系呀?"';
    case 'propose_lookup': return '老师讲不下去了。提议"要不我们一起查查书?",语气体贴。';
    case 'stay_confused': return card.mcBelief ? '坚持你的观点,请老师证明给你看。' : '表达困惑,把话题拉回今天的知识点。';
    case 'ask_transfer': return '提出迁移问题:这个道理在相近场景是不是也一样?';
    default: return '就你还没懂的地方,向老师提一个具体的问题。';
  }
}

export interface SpeakResult { text: string; mood: XiaobaiMood; leakageRetries: number; leaked: string[] }

/** 渲染 + 出口守门(唯一调用入口) */
export async function speakXiaobai(input: {
  card: InstructionCard;
  topic: Topic;
  state: TopicState;
  recentMessages: ChatMessage[];
  settings: LlmSettings;
  seed: number;
}): Promise<SpeakResult> {
  const { card, topic, state, recentMessages, settings, seed } = input;
  // 误区语料整句作为允许来源:其中出现的术语按"当前误区条目术语"放行(方案 §11 防线④)
  const mcTerms = card.mcBelief ? [card.mcBelief] : [];
  const mc = card.mcId ? topic.misconceptions.find((m) => m.mcId === card.mcId) : undefined;
  if (mc) mcTerms.push(mc.triggerLine, mc.belief);

  // api 模式预告违禁词:未解锁 checklist 的术语(泄漏检测的 banned 集),先说清比事后拦截省一次重试
  const allowedNow = new Set(card.recentTeacherTerms);
  for (const item of topic.checklist) {
    if (state.hitChecklist.includes(item.id)) for (const t of item.terms) allowedNow.add(t);
  }
  const banned = [...new Set(
    topic.checklist
      .filter((item) => !state.hitChecklist.includes(item.id))
      .flatMap((item) => item.terms)
      .filter((t) => !allowedNow.has(t) && !mcTerms.some((s) => s.includes(t))),
  )];

  for (let attempt = 0; attempt <= 2; attempt++) {
    let text: string; let mood: XiaobaiMood;
    if (settings.mode !== 'mock' && attempt < 2) {
      try {
        text = (await apiRender(card, recentMessages, settings, banned)).trim();
        mood = ACTION_MOOD[card.action] ?? 'idle';
      } catch {
        ({ text, mood } = mockRender(card, topic, seed + attempt));
      }
    } else {
      ({ text, mood } = mockRender(card, topic, seed + attempt));
    }
    const leaks = leakageCheck({
      reply: text, topic,
      whitelistChecklist: state.hitChecklist,
      teacherTerms: card.recentTeacherTerms,
      mcTerms,
    });
    if (leaks.length === 0) return { text, mood, leakageRetries: attempt, leaked: [] };
    if (attempt === 2) return { text: FALLBACK_LINE, mood: 'confused', leakageRetries: 3, leaked: leaks };
    // 把实际泄漏词并入违禁清单,下次重试时明确点名
    for (const t of leaks) if (!banned.includes(t)) banned.push(t);
  }
  return { text: FALLBACK_LINE, mood: 'confused', leakageRetries: 3, leaked: [] };
}
