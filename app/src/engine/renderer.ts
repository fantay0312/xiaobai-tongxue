/**
 * 小白渲染引擎:只负责"怎么说出来"。
 * 每轮近无状态:仅依据 指令卡 + 最近 K 轮对话 新鲜渲染(防线⑥ 逐轮重渲染)。
 * mock 模式:台词模板库 + 槽位填充;api/proxy 模式:LLM 渲染,失败降级 mock。
 * speakXiaobai 是唯一出口:渲染 → 泄漏检测 → 重试(≤2) → 兜底。
 * speakOpening 是一堂课第一句话的入口(内部仍走 speakXiaobai 的守门与重试)。
 * 口吻:模板按轮次轮转并避开上一句的开头;api 路径把小白前两句的开头几个字交给提示词,要求换开头、换句式。
 * 角色卡:性格文字只进 api 提示词;对老师的称呼与活泼程度(settings.temperature 分档)两条路径都认。
 */
import type {
  ChatMessage, InstructionCard, LlmSettings, Persona, SessionMode, Topic, TopicState, XiaobaiGlobal, XiaobaiMood,
} from '../types';
import {
  XIAOBAI_DREAM_LINES, XIAOBAI_EXAM_READY_LINE, XIAOBAI_LINES, XIAOBAI_OPENING_BRIDGES,
  XIAOBAI_OPENING_GREETINGS, XIAOBAI_PROBE_BRIDGES, XIAOBAI_REASK_LINES, XIAOBAI_TANGENT_ACKS,
  XIAOBAI_TIME_HELLOS, timeOfDayOf,
} from '../data/xiaobaiLines';
import type { OpeningKind } from '../data/xiaobaiLines';
import { FALLBACK_LINE, leakageCheck } from './leakage';
import { llmCall } from './llm';
import { mockQuestionClarificationReply, repeatsQuestionVerbatim } from './conversationRepair';
import { parseMoodTag } from './moodTag';
import {
  buildXiaobaiSystem, buildXiaobaiUser, livelinessBand, recentOwnOpeners, teacherAddressOf,
} from './prompts';
import type {
  LivelinessBand, OpeningContext, QuestionClarificationCard, RuntimeInstructionCard, XiaobaiPersonaCard,
} from './prompts';
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

/**
 * 把模板里对老师的称呼换成角色卡指定的叫法。只动小白自己的话:
 * 『』和“”里是引用的原话(往事里老师打过的比方等),不改;老师讲解的复述素材不经过这里。
 */
function withAddress(text: string, address: string): string {
  if (!address) return text;
  return text
    .split(/(『[^』]*』|“[^”]*”)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replaceAll('老师', address)))
    .join('');
}

function fillTemplate(tpl: string, card: InstructionCard, topic: Topic, address = ''): string {
  const item = card.targetChecklistId
    ? topic.checklist.find((c) => c.id === card.targetChecklistId)
    : undefined;
  // 称呼只换模板骨架和小白自己的追问;{term}/{paraphrase} 是老师的原话,原样填入
  return withAddress(tpl, address)
    .replaceAll('{probe}', withAddress(item?.probeLine ?? '能再从头给我讲讲吗?', address))
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
const R4_LINE = '老师,这段我们俩好像都卡住了。要不先记下来,等你备好课咱们再来一次?我等着。';
/** 偏题围栏兜底(部分人格的 stay_confused 模板全都依赖 {belief} 时使用) */
const OFFTOPIC_LINE = '老师,这个好像不是今天要讲的吧?我还想听你接着讲刚才那个呢。';
/** 误区纠正后同轮衔接新误区时,先认下刚听懂的那一点;{p} 是复述素材 */
const CHAIN_AHA: readonly string[] = ['哦,{p}。', '{p},这句我听进去了。', '所以{p}。'];

/**
 * 按轮次轮转取一条,并避开上一句的开头:从 seed 对应的那条起往后找,
 * 第一条「头两个字和小白上一句不一样」的就用;都一样就退回 seed 那条。确定性,无随机。
 */
function pickFresh(lines: readonly string[], seed: number, lastOwnLine: string): string {
  if (lines.length === 0) return '';
  const start = ((seed % lines.length) + lines.length) % lines.length;
  const avoid = lastOwnLine.trim().slice(0, 2);
  if (avoid.length === 2) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[(start + i) % lines.length];
      if (line.slice(0, 2) !== avoid) return line;
    }
  }
  return lines[start];
}

/**
 * 活泼程度对本地模板的影响:沉稳去掉最长的几条(话少),跳脱去掉最短的几条(话多);
 * 平和/活泼不动(默认 0.8 落在活泼,行为与从前一致)。不足三条时不筛;四条以内只去一条,免得轮转时老撞上同一句。
 * 保持原顺序,仍按 seed 轮转。
 */
function biasByBand(lines: readonly string[], band: LivelinessBand): readonly string[] {
  if (lines.length < 3 || band === '平和' || band === '活泼') return lines;
  const byLength = [...lines].sort((a, b) => a.length - b.length);
  const count = lines.length <= 4 ? lines.length - 1 : Math.ceil(lines.length * 0.6);
  const keep = new Set(band === '沉稳' ? byLength.slice(0, count) : byLength.slice(-count));
  return lines.filter((line) => keep.has(line));
}

/** 跳脱档偶数轮在句首添一个叹词(三型各两个,互不相同) */
const LIVELY_INTERJECTIONS: Record<Persona, readonly string[]> = {
  好奇型: ['诶诶,', '哇,'],
  严谨型: ['咦,', '等等等等,'],
  杠精型: ['嘿,', '哟,'],
};

function enliven(text: string, persona: Persona, seed: number): string {
  if (seed % 2 !== 0 || /^[诶哦啊咦嘿哟哇嗯唔…]/.test(text)) return text;
  const pool = LIVELY_INTERJECTIONS[persona];
  return `${pool[(seed >> 1) % pool.length]}${text}`;
}

function mockRender(
  card: RuntimeInstructionCard, topic: Topic, seed: number,
  opts: { lastOwnLine?: string; opening?: boolean; address?: string; band?: LivelinessBand } = {},
): { text: string; mood: XiaobaiMood } {
  const lastOwnLine = opts.lastOwnLine ?? '';
  const address = opts.address ?? '';
  const band = opts.band ?? '活泼';
  if (card.action === 'rephrase_question') {
    return {
      text: withAddress(mockQuestionClarificationReply(card.questionSource, card.style.persona), address),
      mood: 'shy',
    };
  }
  // 开场第一问:不用课中的「等一下……」类模板(老师还没开口),用专门的起头半句带出第一问
  if (opts.opening && card.action === 'ask_clarify' && card.targetChecklistId) {
    const first = topic.checklist.find((c) => c.id === card.targetChecklistId);
    if (first) {
      const bridges = biasByBand(XIAOBAI_OPENING_BRIDGES[card.style.persona], band);
      return { text: fillTemplate(bridges[seed % bridges.length], card, topic, address), mood: 'curious' };
    }
  }
  // 同一问上一句刚问过、老师这轮没答到:不装作第一次问,用「再问」的说法把同一句追问续上
  if (card.action === 'ask_clarify' || card.action === 'ask_example' || card.action === 'ask_boundary') {
    const probe = card.targetChecklistId
      ? topic.checklist.find((c) => c.id === card.targetChecklistId)?.probeLine
      : undefined;
    if (probe && (lastOwnLine.includes(probe) || lastOwnLine.includes(withAddress(probe, address)))) {
      const lines = biasByBand(XIAOBAI_REASK_LINES[card.style.persona], band)
        .map((tpl) => fillTemplate(tpl, card, topic, address));
      return { text: pickFresh(lines, seed, lastOwnLine), mood: ACTION_MOOD[card.action] ?? 'curious' };
    }
  }
  // 回答了小白自己的题外追问:导演用无复述素材的 express_understanding 表示“收住”。
  if (
    card.action === 'express_understanding' && !card.paraphraseSource &&
    !card.mcBelief && !card.targetChecklistId
  ) {
    const acks = biasByBand(XIAOBAI_TANGENT_ACKS[card.style.persona], band).map((line) => withAddress(line, address));
    return { text: pickFresh(acks, seed, lastOwnLine), mood: 'happy' };
  }
  // inject_misconception 直接使用误区库触发话术(误区库即剧本);
  // 若带 paraphraseSource(纠正成功后同轮衔接注入),先复述开窍再抛新误区。
  if (card.action === 'inject_misconception' && card.mcId) {
    const mc = topic.misconceptions.find((m) => m.mcId === card.mcId);
    if (mc) {
      const aha = card.paraphraseSource
        ? CHAIN_AHA[seed % CHAIN_AHA.length].replace('{p}', pickParaphrase(card.paraphraseSource, topic)) : '';
      return { text: `${aha}${withAddress(mc.triggerLine, address)}`, mood: aha ? 'curious' : 'confused' };
    }
  }
  // stay_confused 无误区语境时分两种:R4 收场(带 targetChecklistId 标记)/ 偏题拉回
  if (card.action === 'stay_confused' && !card.mcBelief && card.targetChecklistId) {
    return { text: withAddress(R4_LINE, address), mood: 'shy' };
  }
  const pool = XIAOBAI_LINES[card.style.persona]?.[card.action] ?? [];
  const usable = pool.filter((tpl) => slotUsable(tpl, card));
  if (usable.length === 0 && card.action === 'stay_confused' && !card.mcBelief) {
    return { text: withAddress(OFFTOPIC_LINE, address), mood: 'confused' };
  }
  // 坚持观点的 stay_confused 只用带 {belief} 的模板(否则会把「这跟今天没关系」说给正在纠正误区的老师)
  const fitting = card.action === 'stay_confused' && card.mcBelief
    ? usable.filter((tpl) => tpl.includes('{belief}'))
    : usable;
  const list = fitting.length ? fitting : usable.length ? usable : pool;
  const candidates = biasByBand(list.length ? list : ['{probe}'], band)
    // 跳脱档:模板骨架里的第一个句号换成感叹号(只动骨架,不碰追问底稿与老师原话)
    .map((tpl) => fillTemplate(band === '跳脱' ? tpl.replace('。', '!') : tpl, card, topic, address));
  let text = pickFresh(candidates, seed, lastOwnLine);
  if (band === '跳脱') text = enliven(text, card.style.persona, seed);
  // 开窍复述后衔接下一问:追问目标的 probeLine 直接续上(probeLine 本身过泄漏纪律)
  if (card.action === 'express_understanding' && card.targetChecklistId) {
    const next = topic.checklist.find((c) => c.id === card.targetChecklistId);
    if (next) {
      const bridges = XIAOBAI_PROBE_BRIDGES[card.style.persona];
      text = `${text}${fillTemplate(bridges[seed % bridges.length], card, topic, address)}`;
    }
  }
  return { text, mood: ACTION_MOOD[card.action] ?? 'idle' };
}

const ASKING_ACTIONS: ReadonlySet<string> = new Set([
  'ask_clarify', 'ask_example', 'ask_boundary', 'express_understanding',
]);

/**
 * 这一问是不是「上一句已经问过、老师这轮没答到」:本轮是带靶子的追问,而小白上一句也是以问句收尾的追问/开窍衔接问。
 * 靶子只在老师讲通一个点之后才往前挪,所以连着两轮追问问的就是同一个点;提示词据此要求换一种问法,不原样再问。
 */
function isReask(card: RuntimeInstructionCard, recent: readonly ChatMessage[]): boolean {
  if (card.action !== 'ask_clarify' && card.action !== 'ask_example' && card.action !== 'ask_boundary') return false;
  if (!card.targetChecklistId) return false;
  const last = [...recent].reverse()
    .find((m) => m.role === 'xiaobai' && m.text !== XIAOBAI_EXAM_READY_LINE);
  // 半角与全角问号都算(模型多用全角;写成转义,免得输入法把两个字符打成一样)
  return !!last?.action && ASKING_ACTIONS.has(last.action) && /[?\uFF1F]/.test(last.text);
}

/**
 * api/proxy 渲染:提示词全部出自 engine/prompts。
 * 先剥心情标签(模型原文),再剥引号/「小白:」前缀 —— 下游(复读检测、泄漏守门、重试、UI)只见剥净文本。
 */
async function apiRender(
  card: RuntimeInstructionCard, topic: Topic, recent: ChatMessage[], settings: LlmSettings,
  bannedTerms: string[], memoryHints: string[], sessionBrief: SessionBrief | null,
  opening: OpeningContext | null, personaCard: XiaobaiPersonaCard | null,
): Promise<{ text: string; mood: XiaobaiMood | null }> {
  const system = buildXiaobaiSystem({
    card, topic, bannedTerms, memoryHints, sessionBrief, opening,
    // 角色卡(性格文字 + 称呼)与活泼程度:卡文里的未教术语由提示词层按 bannedTerms 抹掉
    personaCard, liveliness: settings.temperature,
    // 只取小白前两句各自的开头几个字,提醒「别再这样起头」;整句不进 system
    ownOpeners: recentOwnOpeners(recent),
    reask: isReask(card, recent),
  });
  const user = buildXiaobaiUser({ recentMessages: recent, opening });
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
  /** 开场白上下文(只由 speakOpening 传入);api 路径据此让模型一口气说完招呼与第一问 */
  opening?: OpeningContext | null;
  /** 用户的角色卡(性格文字 + 对老师的称呼);由 store 读出后传入。卡文不算「老师说过的词」,泄漏守门照旧 */
  personaCard?: XiaobaiPersonaCard | null;
}): Promise<SpeakResult> {
  const { card, topic, state, recentMessages, settings, seed, memoryHints, sessionBrief } = input;
  const opening = input.opening ?? null;
  const personaCard = input.personaCard ?? null;
  // 称呼(与本课术语相撞则退回「老师」)与活泼档:模板与提示词共用同一口径
  const address = teacherAddressOf(personaCard, topic);
  const band = livelinessBand(settings.temperature);
  // mock 路径「别和上一句同一个开头」的依据:小白自己的上一句(不算送考提示)
  const lastOwnLine = [...recentMessages].reverse()
    .find((m) => m.role === 'xiaobai' && m.text !== XIAOBAI_EXAM_READY_LINE)?.text ?? '';
  const mockOpts = { lastOwnLine, opening: opening !== null, address, band };

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
          card, topic, recentMessages, settings, banned, memoryHints ?? [], sessionBrief ?? null, opening,
          personaCard,
        );
        text = rendered.text.trim();
        source = 'api';
        // 心情:导演锁 > 模型标签 > 动作查表
        const modelMood = lockedMood ? null : rendered.mood;
        mood = lockedMood ?? modelMood ?? ACTION_MOOD[card.action] ?? 'idle';
        moodSource = modelMood ? 'model' : 'table';
      } catch {
        ({ text, mood } = mockRender(card, topic, seed + attempt, mockOpts));
        source = 'mock';
      }
    } else {
      ({ text, mood } = mockRender(card, topic, seed + attempt, mockOpts));
      source = 'mock';
    }
    if (
      card.action === 'rephrase_question'
      && repeatsQuestionVerbatim(text, card.questionSource)
    ) {
      continue;
    }
    // 开场白里模型可以整个原样提课名(课名本来就印在页面上,此前由模板拼在守门之外);
    // 守门时先把完整课名摘掉——拆开说课名里的词照样算泄漏
    const guarded = opening && source === 'api' ? text.split(topic.title).join('') : text;
    const leaks = leakageCheck({
      reply: guarded, topic,
      whitelistChecklist: state.hitChecklist,
      teacherTerms: card.recentTeacherTerms,
    });
    if (leaks.length === 0) return { text, mood, leakageRetries: attempt, leaked: [], source, moodSource };
    if (attempt === 2) {
      return { text: withAddress(FALLBACK_LINE, address), mood: 'confused', leakageRetries: 3, leaked: leaks, source: 'mock', moodSource: 'table' };
    }
    // 把实际泄漏词并入违禁清单,下次重试时明确点名
    for (const t of leaks) if (!banned.includes(t)) banned.push(t);
  }
  return { text: withAddress(FALLBACK_LINE, address), mood: 'confused', leakageRetries: 3, leaked: [], source: 'mock', moodSource: 'table' };
}

/** 开场白里的一条旧笔记(梦里惦记的一句)要过和学伴记忆提示同一道泄漏守门:白名单 = 已讲明白的要点,老师词 = 空 */
function guardedNote(text: string | null | undefined, topic: Topic, state: TopicState): string | null {
  // 梦境记录用的是册页语域「先生」,课堂上只称「老师」
  const note = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80).replaceAll('先生', '老师');
  if (!note) return null;
  // 完整课名不算泄漏(与开场白守门同一口径);课名之外出现未教术语就整句丢
  const leaks = leakageCheck({
    reply: note.split(topic.title).join(''), topic, whitelistChecklist: state.hitChecklist, teacherTerms: [],
  });
  return leaks.length > 0 ? null : note;
}

const CN_CLOCK = ['十二', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一'];
/** 给模型的时刻:时段 + 大概几点(如「晚上八点多」),免得它自己编钟点 */
function clockLabel(hour: number): string {
  const h = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 9;
  return `${timeOfDayOf(h)}${CN_CLOCK[h % 12]}点多`;
}

/**
 * 一堂课的第一句话(唯一入口)。
 * api/proxy:模型一口气说完「随口起个头 + 第一问」,知道现在几点、这课是不是头一回、是不是补课/复习;
 *            往事(recall)和梦里惦记的一句(dreamHint)作为小白自己的旧笔记放进 user 消息,可提可不提。
 * mock 或模型不可用:本地模板按时段 / 头一回或再来 / 补课 / 复习各有几条,按 seed 轮转。
 */
export async function speakOpening(input: {
  mode: SessionMode;
  card: InstructionCard;
  topic: Topic;
  state: TopicState;
  settings: LlmSettings;
  /** 轮转用的种子:调用方给一个每堂课都不一样的整数(如事件总数) */
  seed: number;
  /** 本地时间的小时(0–23);调用方传入,引擎不读时钟 */
  hour: number;
  memoryHints?: string[];
  sessionBrief?: SessionBrief | null;
  /** recall 模块给的往事整句(小白口吻);没有为 null */
  recall?: string | null;
  /** 梦里还惦记着的一句(xiaobaiDreamHint);在这里过泄漏守门,不过就丢 */
  dreamHint?: string | null;
  /** 用户的角色卡;开场白同样按它的性格、称呼来 */
  personaCard?: XiaobaiPersonaCard | null;
}): Promise<SpeakResult> {
  const { mode, card, topic, state, settings, seed, memoryHints, sessionBrief } = input;
  const personaCard = input.personaCard ?? null;
  const address = teacherAddressOf(personaCard, topic);
  const recall = input.recall?.trim() || null;
  const dream = guardedNote(input.dreamHint, topic, state);
  const timeOfDay = timeOfDayOf(input.hour);
  const heardBefore = state.hitChecklist.length > 0 || state.knowledgeState !== '没懂';
  const opening: OpeningContext = {
    mode, timeOfDay: clockLabel(input.hour), history: heardBefore ? 'again' : 'first', recall, dreamHint: dream,
  };
  const speak = await speakXiaobai({
    // 开场要容得下「起个头 + 第一问」,句数上限放到 3
    card: { ...card, style: { ...card.style, maxSentences: Math.max(3, card.style.maxSentences) } },
    topic, state, recentMessages: [], settings, seed, memoryHints, sessionBrief, opening, personaCard,
  });
  if (speak.source === 'api') return speak;

  // 本地开场:招呼(时段 × 头一回/再来/补课/复习)+ 梦 + 第一问 + 往事。课名与往事由代码拼接,同从前一样在守门之外
  const kind: OpeningKind = mode === 'teach' ? (heardBefore ? 'again' : 'first') : mode;
  const hellos = XIAOBAI_TIME_HELLOS[timeOfDay];
  const greetings = biasByBand(XIAOBAI_OPENING_GREETINGS[card.style.persona][kind], livelinessBand(settings.temperature));
  const hello = hellos[seed % hellos.length];
  // 往事那句已经在说这门课时,招呼只留时段那半句,免得同一件事说两遍
  const greeting = recall?.includes(topic.title)
    ? `${hello}。`
    : greetings[seed % greetings.length].replaceAll('{hello}', hello).replaceAll('{title}', topic.title);
  const dreamLine = dream
    ? XIAOBAI_DREAM_LINES[seed % XIAOBAI_DREAM_LINES.length].replaceAll('{dream}', dream)
    : '';
  // 泄漏重试耗尽落到的兜底句说的是「你刚说的我没跟上」,开场时老师还没开口,换成一句中性的
  const first = speak.text === withAddress(FALLBACK_LINE, address) ? '今天这课,老师打算从哪儿讲起?' : speak.text;
  // 招呼、往事、梦里那句都是代码拼的,称呼在这里统一换(往事里『』引的老师原话不动);第一问已在渲染时换过
  const lead = [greeting, recall ?? '', dreamLine].filter(Boolean).map((line) => withAddress(line, address));
  return { ...speak, text: [...lead, withAddress(first, address)].join('\n') };
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
  /** 用户的角色卡;换说法时口气与称呼不变 */
  personaCard?: XiaobaiPersonaCard | null;
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
  return speakXiaobai({ card, topic, state, recentMessages, settings, seed, personaCard: input.personaCard });
}
