/**
 * 小白渲染引擎:只负责"怎么说出来"。
 * 每轮近无状态:仅依据 指令卡 + 最近 K 轮对话 新鲜渲染(防线⑥ 逐轮重渲染)。
 * mock 模式:台词模板库 + 槽位填充;api 模式:LLM 渲染,失败降级 mock。
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

/** 取讲解中最适合复述的短句(mock 的"正确复述") */
function pickParaphrase(source: string, topic: Topic): string {
  const clauses = source.split(/[。!?;\n]/).map((s) => s.trim()).filter((s) => s.length >= 6);
  const allTerms = topic.checklist.flatMap((c) => c.terms);
  const withTerm = clauses.filter((s) => allTerms.some((t) => s.includes(t)));
  const best = (withTerm.length ? withTerm : clauses).sort((a, b) => a.length - b.length)[0] ?? source;
  return best.length > 50 ? `${best.slice(0, 50)}…` : best;
}

function fillTemplate(tpl: string, card: InstructionCard, topic: Topic): string {
  const item = card.targetChecklistId
    ? topic.checklist.find((c) => c.id === card.targetChecklistId)
    : undefined;
  return tpl
    .replaceAll('{probe}', item?.probeLine ?? '能再从头给我讲讲吗?')
    .replaceAll('{point}', item?.point ?? '这里')
    .replaceAll('{term}', card.recentTeacherTerms[0] ?? '你刚说的那个')
    .replaceAll('{belief}', card.mcBelief ?? '')
    .replaceAll('{paraphrase}', card.paraphraseSource ? pickParaphrase(card.paraphraseSource, topic) : '')
    .replaceAll('{transfer}', topic.transferHint);
}

function mockRender(
  card: InstructionCard, topic: Topic, seed: number,
): { text: string; mood: XiaobaiMood } {
  // inject_misconception 直接使用误区库触发话术(误区库即剧本)
  if (card.action === 'inject_misconception' && card.mcId) {
    const mc = topic.misconceptions.find((m) => m.mcId === card.mcId);
    if (mc) return { text: mc.triggerLine, mood: 'confused' };
  }
  const pool = XIAOBAI_LINES[card.style.persona]?.[card.action] ?? [];
  const tpl = pool.length ? pool[seed % pool.length] : '{probe}';
  return { text: fillTemplate(tpl, card, topic), mood: ACTION_MOOD[card.action] ?? 'idle' };
}

async function apiRender(
  card: InstructionCard, recent: ChatMessage[], settings: LlmSettings,
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
    '3. 你永远不给老师讲课、不总结知识、不主动纠正老师。',
    `4. 每次发言不超过 ${card.style.maxSentences} 句。${card.style.mustEndWithQuestion ? '以一个问题结尾。' : ''}`,
    `5. 语气自然口语化,符合${card.style.persona}学生的性格。只输出台词本身。`,
    `【本轮你要做的事】${actionBrief(card)}`,
  ].filter(Boolean).join('\n');
  const user = recent.slice(-6).map((m) => `${m.role === 'teacher' ? '老师' : '小白'}:${m.text}`).join('\n');
  return llmCall('xiaobai', { system, user }, settings);
}

function actionBrief(card: InstructionCard): string {
  switch (card.action) {
    case 'inject_misconception': return '把【你当前坚信的观点】自然地说出来——语气是真诚地陈述你的理解,不是刻意提问。';
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
  const mcTerms = card.mcBelief ? [card.mcBelief] : [];
  const mc = card.mcId ? topic.misconceptions.find((m) => m.mcId === card.mcId) : undefined;
  if (mc) mcTerms.push(mc.triggerLine, mc.belief);

  for (let attempt = 0; attempt <= 2; attempt++) {
    let text: string; let mood: XiaobaiMood;
    if (settings.mode === 'api' && attempt < 2) {
      try {
        text = (await apiRender(card, recentMessages, settings)).trim();
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
      mcTerms: mcTerms.join(' ').split(/\s+/).concat(mcTerms),
    });
    if (leaks.length === 0) return { text, mood, leakageRetries: attempt, leaked: [] };
    if (attempt === 2) return { text: FALLBACK_LINE, mood: 'confused', leakageRetries: 3, leaked: leaks };
  }
  return { text: FALLBACK_LINE, mood: 'confused', leakageRetries: 3, leaked: [] };
}
