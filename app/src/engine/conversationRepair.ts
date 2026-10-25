/**
 * 课堂会话修复：识别“老师没听懂小白上一问，请小白换个说法”。
 * 这是元对话，不是老师不会讲；必须在导演推进状态前截住，避免误计卡壳、偏题或备课不足。
 */
import type { ChatMessage, Persona } from '../types';

/** Classroom negotiation is a dialogue turn, not an explanation to grade. */
export function learningPreferenceReply(utterance: string, title: string, persona: Persona): string | null {
  const compact = utterance.replace(/\s+/g, ' ').trim();
  if (compact.length > 500 || !/(?:你|小白)(?:现在|接下来|还|更|最)?(?:想|要|希望)(?:先|继续)?(?:了解|学|学习|听|讲|从).{0,16}(?:哪|什么|啥)|(?:你|小白).{0,8}(?:选一个|选哪|挑一个)/.test(compact)) return null;
  // A substantive explanation following the invitation still belongs to the
  // normal evaluator. Do not turn teaching into a preference-only exchange.
  if (/(?:我先讲|下面讲|它的原理是|具体来说|定义是)/.test(compact)) return null;
  const listed = compact.match(/(?:是|比如|例如|包括|从)[：:，,\s]*(.+?)[？?。!！]*$/)?.[1];
  const options = listed?.split(/还是|或者|或是|[、，,；;]/).map((item) => item.replace(/^(?:是|先|学|学习|讲|听)\s*/, '').replace(/(?:呢|吗|吧|可以吗|好不好)?[？?。!！]*$/, '').trim()).filter((item) => item.length > 0 && item.length <= 40) ?? [];
  const choice = options.length > 1 ? options[0] : title;
  return persona === '严谨型' ? `我想先了解「${choice}」。老师能从一个简单的例子开始讲吗？`
    : persona === '杠精型' ? `那我先选「${choice}」。老师能举个例子，让我看看它怎么用吗？`
    : `我想先学「${choice}」！老师能先举个简单的例子吗？`;
}

const CLARIFICATION_PATTERNS = [
  /(?:没|没有|不)(?:太)?(?:听懂|听清|听明白|明白|理解|懂)(?:你|小白)(?:刚才|前面)?(?:在|想)?(?:说|问|提)(?:的)?(?:什么|啥|意思|问题)?/,
  /(?:没|没有|不)(?:太)?(?:听懂|听清|明白|理解|懂)(?:你|小白)(?:刚才|前面)?(?:的)?(?:意思|问题|问法)/,
  /(?:你|小白)(?:刚才|前面)?(?:在|想)?(?:说|问|提)(?:的)?(?:是)?(?:什么|啥|什么意思|啥意思|什么问题)/,
  /(?:你|小白)?(?:刚才|前面)?(?:这个|那个)?(?:问题|问法|话|意思).{0,6}(?:没|没有|不)(?:太)?(?:听懂|听清|明白|理解|懂)/,
  /(?:你)?(?:这|刚才那)(?:句话|个问题|个问法).{0,8}(?:有点|太)?绕.{0,8}(?:具体|简单|直白|清楚)(?:一点|点)/,
  /(?:你|小白)?(?:刚才|前面)?(?:说|问)?(?:的)?(?:这个|那个)?(?:问题|问法|话).{0,10}(?:换|改)(?:一个|个|一种)?(?:更)?(?:简单|直白|清楚)?(?:一点|点)?(?:的)?(?:说法|问法)/,
  /(?:换|改)(?:一个|个|一种)?(?:更)?(?:简单|直白|清楚)?(?:一点|点)?(?:的)?(?:说法|问法).{0,16}(?:你|小白)(?:刚才|前面)?(?:说|问)?(?:的)?(?:这个|那个)?(?:问题|问法|话)/,
  /^(?:你|小白)?(?:能不能|能否|能|可以|请|麻烦)?(?:你|小白)?(?:换|改)(?:一个|个|一种)?(?:更)?(?:简单|直白|清楚)?(?:一点|点)?(?:的)?(?:说法|问法)[吧吗?？。！!]*$/,
  /^(?:你|小白)?(?:能不能|能否|能|可以|请|麻烦)?(?:你|小白)?(?:把)?(?:刚才|前面)?(?:这个|那个)?(?:问题|问法|话)?(?:再|重新|重)(?:说|问|解释)(?:一遍|一下|清楚点|简单点)?(?:吗)?[?？。！!]*$/,
  /^(?:你|小白)的意思是(?:在)?问.+(?:吗|对吗)[?？。！!]*$/,
  /^(?:我)?(?:没|没有|不)(?:太)?(?:听懂|听清|听明白|明白|理解|懂)[?？。！!]*$/,
  /^(?:你)?(?:这)?(?:是)?(?:什么|啥)意思[?？。！!]*$/,
  /^(?:你)?问(?:的)?(?:什么|啥)[?？。！!]*$/,
];

/** 只拿小白最后一个问号所在问句；开场白可能把数句合在同一条消息中。 */
export function latestXiaobaiQuestion(text: string | null): string {
  if (!text) return '';
  const line = text.split(/\r?\n/).map((item) => item.trim()).reverse()
    .find((item) => /[?？]/.test(item));
  if (!line) return '';
  const normalized = line.replace(/\s+/g, ' ').trim();
  const end = Math.max(normalized.lastIndexOf('?'), normalized.lastIndexOf('？'));
  if (end < 0) return '';
  let start = end - 1;
  while (start >= 0 && !/[。!！]/.test(normalized[start])) start -= 1;
  return normalized.slice(start + 1, end + 1).trim()
    .replace(/^(?:等等等等|等等)[,，:：]?\s*/, '');
}

/**
 * 只在上一轮老师发言之后找问题；允许越过同轮追加的送考提示等无问句小白消息，
 * 但不翻回更早的课堂轮次误认旧问题。
 */
export function recentXiaobaiQuestionText(messages: ChatMessage[]): string | null {
  let previousTeacher = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'teacher') {
      previousTeacher = index;
      break;
    }
  }
  for (let index = messages.length - 1; index > previousTeacher; index -= 1) {
    const message = messages[index];
    if (message.role === 'xiaobai' && latestXiaobaiQuestion(message.text)) return message.text;
  }
  return null;
}

/**
 * 命中时返回需要重述的原问题；否则返回 null。
 * 显式澄清整轮按元对话处理；不直接信任要点/误区子串，
 * 避免把老师引用小白原话误判成讲解、认同或纠正。
 */
export function questionClarificationSource(
  utterance: string, lastXiaobaiText: string | null,
): string | null {
  const question = latestXiaobaiQuestion(lastXiaobaiText);
  if (!question) return null;
  const compact = utterance.replace(/\s+/g, '').trim();
  if (/我(?:来|给你|再)?(?:换|改)(?:一个|个|一种)?(?:说法|讲法).{0,6}(?:给你)?(?:讲|说|解释)/.test(compact)) {
    return null;
  }
  if (!compact || !CLARIFICATION_PATTERNS.some((pattern) => pattern.test(compact))) return null;
  return question;
}

function normalizedDialogue(text: string): string {
  return text.toLowerCase().replace(/[^\p{Script=Han}a-z0-9]/gu, '');
}

/** API 即便忽略提示词也不能把上一问整句再贴回来；命中后交给重试/确定性 mock。 */
export function repeatsQuestionVerbatim(reply: string, question: string): boolean {
  const source = normalizedDialogue(question);
  return source.length >= 6 && normalizedDialogue(reply).includes(source);
}

const REPAIR_PREFIX: Record<Persona, string> = {
  好奇型: '是我刚才问绕了,老师。',
  严谨型: '是我刚才问得不够清楚。',
  杠精型: '行,是我刚才问绕了。',
};

function simplifyStandaloneQuestion(body: string): string {
  const question = body.replace(/[?？]+$/, '').trim();
  if (/^(?:为什么|为啥)会这样$/.test(question)) {
    return '我真正想问的是:前面这件事为什么会发生?';
  }
  let match = question.match(/^(?:为什么|为啥)(.+)$/);
  if (match) return `我真正想问的是:${match[1]}背后的原因是什么?`;
  match = question.match(/^(.+?)会不会(.+)$/);
  if (match) return `我只想确认:${match[1]}到底会${match[2]},还是不会${match[2]}?`;
  match = question.match(/^(.+?)能不能(.+)$/);
  if (match) return `我只想确认:${match[1]}到底能${match[2]},还是不能${match[2]}?`;
  match = question.match(/^(.+?)是不是(.+)$/);
  if (match) return `我只想确认:${match[1]}到底是${match[2]},还是不是${match[2]}?`;
  match = question.match(/^有没有(.+)$/);
  if (match) return `我只想确认:${match[1]}究竟存在不存在?`;
  match = question.match(/^(.+?)吗$/);
  if (match) return `我只想确认:${match[1]}究竟成立不成立?`;
  match = question.match(/^(.+?)是什么$/);
  if (match) return `我想问的是:怎样用最直白的话说明「${match[1]}」?`;
  match = question.match(/^什么是(.+)$/);
  if (match) return `我想问的是:「${match[1]}」具体指哪一种东西?`;

  const middle = Math.max(1, Math.ceil(question.length / 2));
  const first = question.slice(0, middle);
  const second = question.slice(middle);
  return second
    ? `我把问题拆成两小段:先看「${first}」;我真正想问的是「${second}」会得到什么结果?`
    : '我刚才的问题太短了。老师告诉我是哪个词没听清,我从那个词重新问,好吗?';
}

/** mock/降级台词：只拆问题结构，不补答案，也不引入原问题之外的专业词。 */
export function mockQuestionClarificationReply(question: string, persona: Persona): string {
  const source = latestXiaobaiQuestion(question) || question.replace(/\s+/g, ' ').trim();
  const body = source.replace(/[?？]+$/, '').replace(/^(?:等等等等|等等|比如|那么)[,，:：]?/, '').trim();
  const prefix = REPAIR_PREFIX[persona];
  if (/写个等号.+另一个名字.+复制出新的一份/.test(body)) {
    return `${prefix}我换个直白点的问法:写下等号、再给原来的东西添一个名字以后,到底是多出了一份新的东西,还是原来那份东西有了两个名字?`;
  }
  const parts = body.split(/[,，;；:：]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return `${prefix}${simplifyStandaloneQuestion(body)}`;
  }
  let core = parts.at(-1) ?? '';
  core = core
    .replace(/^这样算(.+)吗$/, '前面这种情况到底算不算$1')
    .replace(/^那?是不是(.+)$/, '我只想确认:$1,到底对不对')
    .replace(/^有没有(.+)$/, '我只问这一点:到底有没有$1');
  const setup = parts.slice(0, -1).join(',');
  return `${prefix}前面「${setup}」只是我举的情形;我真正想问的是:${core}?`;
}
