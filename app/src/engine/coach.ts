/**
 * 备课助教「小砚」—— 只服务备课页的答疑引擎。
 * 纪律:
 *  - 语料只用备课页本来就展示的内容(taskCard/checklist point+probeLine/误区剧本/微课标题);
 *    groundTruth 与 lookupCard 是评估层专用,永不进入助教提示词(与备课页同一条红线)。
 *  - 摸底未做完时,误区剧本(= 摸底判断题的答案)不进提示词、不进离线锦囊——助教不能替老师答摸底。
 *  - proxy 网关只收 [system, user] 形状:多轮历史折叠进 user 文本,绝不发 assistant 消息。
 *  - api/proxy 失败 → 调用方降级 mockCoachReply(与讲解舱同一条静默降级纪律)。
 *  - 讲解舱(/teach)绝不挂载助教 —— 课堂上它就是答案机,备课页才是学习面。
 *
 * 2026-08-29 深化:
 *  - PrepContext:助教知道老师此刻备到哪(摸底成绩/暴露的误区/在读分节/自检进度),回答落在老师的薄弱处;
 *  - 试讲(rehearsal):小砚扮小白抛一个误区,老师现场纠正,小砚再以助教身份点评接没接住;
 *  - 草稿本:老师把讲稿写进草稿,一键让小砚逐句挑毛病;草稿按知识点落 localStorage(登出清空)。
 */
import type { LlmSettings, Misconception, Topic } from '../types';
import { llmCall } from './llm';

export interface CoachMessage {
  id: string;
  role: 'teacher' | 'coach';
  text: string;
  t: string;
  /** 试讲回合里的消息:小白的试探 / 小砚的点评(渲染时换语气) */
  kind?: 'rehearsal-probe' | 'rehearsal-verdict' | 'critique';
}

/** 备课页此刻的状态快照(全部是页面本来就展示给老师的信息,不含评估层数据) */
export interface PrepContext {
  quiz: { answered: number; total: number; correct: number; done: boolean };
  /** 摸底暴露的误区(belief 原句) */
  weakBeliefs: string[];
  /** 第二波露怯的维度 → 对应要点名 */
  weakDims: { dimension: string; point: string }[];
  /** 当前在读分节名(scrollspy) */
  section: string;
  materialsOpen: boolean;
  selfCheck: { done: number; total: number };
  /** 已翻开的材料标题 */
  openedMaterials: string[];
}

export const EMPTY_PREP_CONTEXT: PrepContext = {
  quiz: { answered: 0, total: 0, correct: 0, done: false },
  weakBeliefs: [],
  weakDims: [],
  section: '摸底快测',
  materialsOpen: false,
  selfCheck: { done: 0, total: 0 },
  openedMaterials: [],
};

/**
 * 会话内问答缓存:按知识点各留一份(换页不丢,刷新即清——答疑是草稿性质,不入持久层)。
 * 放引擎层而非组件层,是为了 authStore.logout 能清空:登出是 SPA 内切换,
 * 不清的话换账号登录会看见上一位老师的草稿。
 */
const threads = new Map<string, CoachMessage[]>();

export function getCoachThread(topicId: string): CoachMessage[] {
  return threads.get(topicId) ?? [];
}

export function appendCoachMessage(topicId: string, m: CoachMessage): CoachMessage[] {
  const next = [...(threads.get(topicId) ?? []), m];
  threads.set(topicId, next);
  return next;
}

export function clearCoachThreads(): void {
  threads.clear();
  clearAllDrafts();
}

/* ── 讲稿草稿本:按知识点落 localStorage(草稿性质,不进账号同步载荷) ── */
const DRAFT_PREFIX = 'xiaobai-coach-draft:';

export function getDraft(topicId: string): string {
  try {
    return localStorage.getItem(DRAFT_PREFIX + topicId) ?? '';
  } catch {
    return '';
  }
}

export function setDraft(topicId: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(DRAFT_PREFIX + topicId, text);
    else localStorage.removeItem(DRAFT_PREFIX + topicId);
  } catch {
    /* 隐私模式下无妨 */
  }
}

function clearAllDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* 无 localStorage 环境 */
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** 老师此刻的备课情况:一段给小砚看的"案头便签" */
function describeContext(ctx: PrepContext): string {
  const lines: string[] = [];
  if (ctx.quiz.total > 0) {
    lines.push(
      ctx.quiz.done
        ? `摸底已做完:${ctx.quiz.correct}/${ctx.quiz.total}。`
        : `摸底进行中:已答 ${ctx.quiz.answered}/${ctx.quiz.total}(还没做完——不要替老师判断摸底题的对错,不要复述误区原句)。`,
    );
  }
  if (ctx.weakBeliefs.length > 0) {
    lines.push(`摸底暴露的误区(老师自己也栽过,优先照顾):${ctx.weakBeliefs.map((b) => `「${b}」`).join('、')}`);
  }
  if (ctx.weakDims.length > 0) {
    lines.push(`选择题露怯的角度:${ctx.weakDims.map((d) => `${d.dimension}(${d.point})`).join('、')}`);
  }
  lines.push(`老师正在看的分节:${ctx.section}。`);
  if (ctx.openedMaterials.length > 0) lines.push(`已翻开的材料:${ctx.openedMaterials.join('、')}。`);
  if (ctx.selfCheck.total > 0) lines.push(`备课自检:已勾 ${ctx.selfCheck.done}/${ctx.selfCheck.total}。`);
  return lines.join('\n');
}

/** 助教人设 + 当前知识点备课语料(压缩在网关 8000 字上限之内) */
export function buildCoachSystem(topic: Topic, ctx: PrepContext = EMPTY_PREP_CONTEXT): string {
  const roadmap = topic.checklist
    .map((c, i) => `${i + 1}. [${c.level}] ${c.point} —— 小白会问:「${c.probeLine}」`)
    .join('\n');
  const drills = topic.misconceptions
    .map(
      (m, i) =>
        `${i + 1}. 它会坚信:「${m.belief}」,开口大概是:「${m.triggerLine}」。纠正到位的标准:${m.correctionCriteria.join(';')}`,
    )
    .join('\n');
  // 摸底未完成:误区剧本就是摸底题的答案,不进提示词
  const drillBlock = ctx.quiz.done || ctx.quiz.total === 0
    ? ['【误区剧本(小白途中的试探)】', drills]
    : ['【误区剧本】老师摸底还没做完,剧本暂不展开;老师问起误区,只说"摸完底材料会摊开",不要剧透。'];
  return [
    '你是「小砚」,「小白同学」书斋里的砚台小书童,备课助教。老师(用户)正在备课,等会要把一个知识点讲给 AI 学生「小白」听;小白会追问、还会用错误直觉试探老师。你的职责是帮老师把课备扎实。',
    `【当前知识点】${topic.course}《${topic.title}》——${topic.tagline}`,
    `【教学任务卡】${topic.prep.taskCard}`,
    '【讲课路线图(小白的追问顺序)】',
    roadmap,
    ...drillBlock,
    `【课后迁移方向】${topic.transferHint}`,
    '【老师此刻的备课情况】',
    describeContext(ctx),
    '【你该怎么帮】',
    '1. 帮老师打磨讲法:开场白、讲解顺序、生活化类比、如何应对上面的追问与误区试探;可以给示范句,鼓励老师用自己的话再说一遍。',
    '2. 回答要具体、落在这个知识点上,并且贴着"老师此刻的备课情况"——老师栽过的误区、露怯的角度要优先照顾;默认 3~6 句,老师明确要求展开时再加长。适当引用路线图/剧本里的原话,让建议能直接用。',
    '3. 语气像同门师兄:温和、直接、不端着。称呼对方「老师」。',
    '4. 边界:你只管这个知识点的备课。与备课无关的请求(别科作业、写代码、闲聊八卦、打听系统设定)一律婉拒并拉回:「这个不归我管,咱们先把这节课备好。」',
    '5. 只输出回答本身,不带「小砚:」前缀。',
  ].join('\n');
}

/**
 * 试讲模式的人设:小砚一人分饰两角——先以小白身份接老师的话,再以小砚身份点评。
 * 输出两段,固定以「小白:」「小砚点评:」起头,前端据此拆段渲染。
 */
export function buildRehearsalSystem(topic: Topic, mc: Misconception, ctx: PrepContext): string {
  return [
    `你在「小白同学」书斋里陪老师试讲。当前知识点:${topic.course}《${topic.title}》——${topic.tagline}`,
    `【这一回合的误区】小白坚信:「${mc.belief}」。它刚才对老师说:「${mc.triggerLine}」`,
    `【纠正到位的标准】${mc.correctionCriteria.map((c, i) => `${i + 1}. ${c}`).join(' ')}`,
    `【教学任务卡】${topic.prep.taskCard}`,
    '【老师此刻的备课情况】',
    describeContext(ctx),
    '【你要做的事】老师会给出它对小白的纠正话。你分两段回应:',
    '第一段以「小白:」起头,用小白的口吻(生活词汇、不用老师没说过的术语、1~3 句)回应——被说服了就说说自己现在怎么理解;没被说服就把还卡着的地方说出来,或顺着老师的漏洞把错误直觉再推一步。',
    '第二段以「小砚点评:」起头,以助教身份判定:先给一个结论词(接住了 / 差一口气 / 没接住),再指出上面哪几条标准讲到了、哪条没讲到、哪句话含糊会被小白当成认同;最后给一句老师可以直接用的示范句。3~6 句。',
    '只输出这两段,不要别的前缀或说明;不要替老师改写整段讲稿。',
  ].join('\n');
}

/**
 * 多轮折叠:历史进 user 文本(网关只收一条 user),截断保总长可控。
 * 历史各条裁 500;当前问题裁 800(与输入框 maxLength 对齐——
 * 老师贴 700 字讲稿求逐句挑毛病是设计内用例,不能只喂一半)。
 */
function foldHistory(history: CoachMessage[], question: string, questionCap = 800): string {
  const recent = history.slice(-8);
  if (recent.length === 0) return `老师问:${clip(question, questionCap)}`;
  const lines = recent
    .map((m) => `${m.role === 'teacher' ? '老师' : '小砚'}:${clip(m.text, 500)}`)
    .join('\n');
  return `以下是你(小砚)和老师此前的答疑记录:\n${lines}\n———\n老师接着问:${clip(question, questionCap)}`;
}

/** 走 LLM 的真实答疑;失败抛错,由调用方降级 mock */
export async function askCoach(input: {
  topic: Topic;
  history: CoachMessage[];
  question: string;
  settings: LlmSettings;
  ctx?: PrepContext;
}): Promise<string> {
  const { topic, history, question, settings } = input;
  if (settings.mode === 'mock') throw new Error('llm-mock-mode');
  const raw = await llmCall(
    'coach',
    { system: buildCoachSystem(topic, input.ctx ?? EMPTY_PREP_CONTEXT), user: foldHistory(history, question) },
    settings,
  );
  return raw.trim().replace(/^小砚[:\uFF1A]\s*/, '').trim();
}

/** 试讲一回合:老师的纠正话 → 小白回应 + 小砚点评(两段) */
export async function rehearseWithCoach(input: {
  topic: Topic;
  mc: Misconception;
  answer: string;
  settings: LlmSettings;
  ctx: PrepContext;
}): Promise<string> {
  const { topic, mc, answer, settings, ctx } = input;
  if (settings.mode === 'mock') throw new Error('llm-mock-mode');
  const raw = await llmCall(
    'coach',
    {
      system: buildRehearsalSystem(topic, mc, ctx),
      user: `老师对小白说:${clip(answer, 800)}`,
    },
    settings,
  );
  return raw.trim();
}

/** 讲稿挑毛病:草稿本一键送审(走普通答疑通道,问题带上固定审稿指令) */
export async function critiqueDraft(input: {
  topic: Topic;
  draft: string;
  settings: LlmSettings;
  ctx: PrepContext;
}): Promise<string> {
  const { topic, draft, settings, ctx } = input;
  if (settings.mode === 'mock') throw new Error('llm-mock-mode');
  const raw = await llmCall(
    'coach',
    {
      system: buildCoachSystem(topic, ctx),
      user: [
        '老师把讲稿草稿发给你,请逐段挑毛病:',
        '1) 路线图上哪几个要点还没讲到;2) 哪句话含糊、会被小白当成认同它的错误直觉;3) 类比有没有说破对应关系;4) 最值得先改的一处,给一句示范。',
        '用短小标题分段,总共 6~10 句,不要重写整篇。',
        '———讲稿开始———',
        clip(draft, 1600),
        '———讲稿结束———',
      ].join('\n'),
    },
    settings,
  );
  return raw.trim().replace(/^小砚[:\uFF1A]\s*/, '').trim();
}

/** 备课页快捷提问(同时是 mock 模式的可答集) */
export const COACH_QUICK_ASKS = [
  '帮我想个开场白',
  '误区试探怎么接才稳?',
  '帮我把类比打磨一下',
  '我先讲哪个点比较顺?',
] as const;

/** 追问小签:小砚答完一条后可一键接着要 */
export const COACH_FOLLOW_UPS: { label: string; ask: string }[] = [
  { label: '再短一点', ask: '上面这条再精简一点,三句话以内,只留能直接说出口的话。' },
  { label: '换个类比', ask: '换一个生活里的类比再讲一遍,并说破对应关系。' },
  { label: '给我示范句', ask: '就按上面的思路,给我一到两句可以直接对小白说的示范句。' },
];

/**
 * 情境化快捷问:按老师此刻备到哪儿给 3~4 条,最贴的排最前。
 * 摸底未完成时绝不提误区(那是摸底题答案)。
 */
export function deriveQuickAsks(topic: Topic, ctx: PrepContext): string[] {
  const asks: string[] = [];
  if (!ctx.quiz.done && ctx.quiz.total > 0) {
    asks.push('这节课最核心的一句话是什么?', '帮我想个开场白', '我先讲哪个点比较顺?');
    return asks;
  }
  if (ctx.weakBeliefs.length > 0) {
    asks.push(`我刚栽在「${clip(ctx.weakBeliefs[0], 18)}」,怎么纠正才到位?`);
  }
  if (ctx.weakDims.length > 0) {
    asks.push(`「${clip(ctx.weakDims[0].point, 14)}」这个角度我没答稳,怎么讲清楚?`);
  }
  if (ctx.section === '讲课路线图') {
    const first = topic.checklist[0];
    if (first) asks.push(`第 1 点「${clip(first.point, 14)}」怎么开讲更顺?`);
  } else if (ctx.section === '研读材料包') {
    asks.push('讲义里最该讲透的是哪一段?');
  } else if (ctx.section === '备课自检') {
    asks.push('帮我过一遍自检清单,看看哪条我可能虚');
  }
  for (const q of COACH_QUICK_ASKS) {
    if (asks.length >= 4) break;
    if (!asks.includes(q)) asks.push(q);
  }
  return asks.slice(0, 4);
}

/**
 * mock 锦囊:无 LLM 时按问题关键词路由到基于知识点数据的固定建议。
 * 不装成 AI —— 开头点明是「离线锦囊」,内容全部来自本知识点的备课材料。
 */
export function mockCoachReply(topic: Topic, question: string, ctx: PrepContext = EMPTY_PREP_CONTEXT): string {
  const first = topic.checklist[0];
  const q = question;
  const quizLocked = !ctx.quiz.done && ctx.quiz.total > 0;
  if (/开场|开头|开讲|第一句/.test(q)) {
    return [
      '(离线锦囊·开场)不用憋华丽的开场,小白吃的是「从它的困惑出发」:',
      `它的第一问多半是:「${first?.probeLine ?? ''}」。你可以反着来——先自己把这个问题抛出来,再用一个生活里的画面接住它。`,
      `记住任务卡的靶心:${topic.prep.taskCard}`,
      '开场只需要做到一件事:让它觉得「这跟我有关系」。',
    ].join('\n');
  }
  if (/核心|一句话|最重要|讲什么/.test(q)) {
    return [
      '(离线锦囊·核心)任务卡上写的就是靶心,一句话版本可以这么压:',
      topic.prep.taskCard,
      `讲完这一句,小白最可能追的是:「${first?.probeLine ?? ''}」——把它当成你开讲后的第一个检查点。`,
    ].join('\n');
  }
  if (/误区|试探|带偏|坑|纠正|栽/.test(q)) {
    if (quizLocked) {
      return [
        '(离线锦囊)摸底还没做完——误区剧本就是这几道判断题的答案,我先不剧透。',
        '把壹的题答完,材料一摊开,「预演:小白会怎么为难你」里每条误区都配了纠正标准,到时再来问我怎么接。',
      ].join('\n');
    }
    const stumbled = topic.misconceptions.filter((m) => ctx.weakBeliefs.includes(m.belief));
    const list = stumbled.length > 0 ? stumbled : topic.misconceptions;
    const drills = list
      .map((m, i) => `${i + 1}. 它说「${m.triggerLine}」时,别只说「不对」——要讲到:${m.correctionCriteria[0] ?? ''}`)
      .join('\n');
    return [
      stumbled.length > 0
        ? `(离线锦囊·误区预演)先照顾你刚栽过的 ${stumbled.length} 处:`
        : '(离线锦囊·误区预演)它一共会用这几个错误直觉试探你:',
      drills,
      '共同要领:先重复它的说法(表示听懂了),再指出错在哪个环节,最后用一个它能验证的例子钉死。含糊的「差不多是这样」会被它当成认同——那就被带偏了。',
      '想真刀真枪练一遍?切到「试讲」,我扮小白抛一个,你来接。',
    ].join('\n');
  }
  if (/类比|比喻|例子|生活/.test(q)) {
    return [
      '(离线锦囊·类比打磨)好类比的三个检验:',
      '1. 对应关系一一说破——「A 就像 B」之后,必须补一句「这里的 X 相当于 Y」,不然小白会把类比字面化;',
      '2. 说完类比马上回到本体,用术语重讲一遍,类比只是梯子,不是目的地;',
      `3. 提前想好类比在哪里失效——小白最爱顺着类比推到失效区(它的边界追问就埋在:「${topic.checklist.find((c) => c.level === 'L3')?.probeLine ?? '边界情况'}」)。`,
      '把类比写进「草稿」,连线模式下我可以逐句挑毛病。',
    ].join('\n');
  }
  if (/顺序|先讲|路线|从哪|哪个点|开讲更顺/.test(q)) {
    const route = topic.checklist.map((c, i) => `${i + 1}. ${c.point}`).join(' → ');
    return [
      '(离线锦囊·讲课顺序)路线图就是为这个准备的,照着走最稳:',
      route,
      '每讲完一个点停一拍,等它复述;它复述对了再进下一个点。中途它会突然抛出误区试探——那不是打断,是它在消化,接住比赶进度重要。',
    ].join('\n');
  }
  if (/自检|清单|虚/.test(q)) {
    const items = topic.prep.selfCheck.map((c, i) => `${i + 1}. ${c}`).join('\n');
    return [
      '(离线锦囊·自检)清单上每一条都对应小白课上会卡的一处,别只是勾——每条试着用一句话答出来:',
      items,
      ctx.weakDims.length > 0
        ? `你在「${ctx.weakDims[0].point}」这个角度露过怯,那一条多停一停。`
        : '哪条答不出一句完整的话,就回材料包把那一节再翻一遍。',
    ].join('\n');
  }
  if (/讲义|哪一段|讲透|角度|讲清楚/.test(q)) {
    const target = ctx.weakDims[0]?.point ?? ctx.weakBeliefs[0] ?? topic.checklist[0]?.point ?? '';
    return [
      `(离线锦囊·材料)先盯住这一处:「${target}」。`,
      `讲义《${topic.prep.microLecture.title}》里对应它的那一段读两遍,然后合上讲义,用自己的话讲给自己听——讲不顺的地方就是小白会卡的地方。`,
      '例题别只看答案,先猜结果再运行,猜错的地方就是课上要慢讲的地方。',
    ].join('\n');
  }
  return [
    '(离线锦囊)当前是本地模式,我只能按备课材料给你固定的锦囊;在设置里接上 LLM 后,我就能针对你的讲稿逐句出主意了。',
    `现在可以问我:${deriveQuickAsks(topic, ctx).map((a) => `「${a}」`).join('')}`,
    `或者直接从任务卡入手:${topic.prep.taskCard}`,
  ].join('\n');
}

/**
 * mock 试讲判定:用误区自带的纠正关键词在本地粗判(仅前端本地,不进任何提示词),
 * 点评只引用页面本来就展示的纠正标准。
 */
export function mockRehearsalReply(mc: Misconception, answer: string): string {
  const text = answer.replace(/\s+/g, '');
  const hit = mc.correctionKeywords.some((group) => group.every((kw) => text.includes(kw.replace(/\s+/g, ''))));
  const adopted = mc.adoptionKeywords.some((group) => group.every((kw) => text.includes(kw.replace(/\s+/g, ''))));
  const vague = /差不多|大概是|也可以这么说|某种程度|可以这么理解/.test(answer);
  const criteria = mc.correctionCriteria;
  if (adopted && !hit) {
    return [
      `小白:哦,那我没说错嘛——${mc.belief}。老师你也这么觉得,那我就记住了。`,
      `小砚点评:没接住——你顺着它的说法点了头,它已经把「${mc.belief}」当成你认可的结论记下了。先重复它的话再翻过来:「你说得对的部分是……,但这里不一样……」。纠正到位至少要讲到:${criteria[0] ?? ''}`,
    ].join('\n');
  }
  if (hit && !vague) {
    return [
      '小白:哦——所以之前是我把两件事混一块儿了。那我再说一遍看对不对:……(它开始用自己的话复述)',
      `小砚点评:接住了。要点都到了:${criteria.slice(0, 2).join(';')}。再补一个它能自己验证的小例子钉死,这一条它就不会再拿出来试探了。`,
    ].join('\n');
  }
  if (hit && vague) {
    return [
      `小白:嗯……老师说"差不多",那我原来的理解也算对吧?${mc.triggerLine}`,
      `小砚点评:差一口气——内容讲到了,但「差不多」「大概」这种词它会当成认同。把结论说死:先明确「不是这样」,再给它一个能自己验证的例子。示范:「不,${criteria[0] ?? ''}」`,
    ].join('\n');
  }
  return [
    `小白:老师,我还是没转过弯来……${mc.triggerLine}`,
    `小砚点评:没接住——它还卡在原处。纠正到位的标准是:${criteria.map((c, i) => `${i + 1}. ${c}`).join(' ')}。先复述它的说法表示听懂了,再指出错在哪个环节,最后用一个例子钉死。`,
  ].join('\n');
}

/** mock 讲稿挑毛病:按路线图要点名粗查覆盖,提醒误区与含糊词 */
export function mockCritiqueReply(topic: Topic, draft: string, ctx: PrepContext): string {
  const text = draft.replace(/\s+/g, '');
  const missing = topic.checklist.filter((c) => !text.includes(c.point.replace(/\s+/g, '').slice(0, 4)));
  const vague = /差不多|大概|应该是|可能是|某种程度/.test(draft);
  const lines = ['(离线锦囊·挑毛病)只能按备课材料粗看,接上 LLM 才能逐句点评:'];
  lines.push(
    missing.length === 0
      ? '要点覆盖:路线图上的要点名都出现了,顺序对不对再自己过一遍。'
      : `要点覆盖:还没提到 ${missing.map((c) => `「${c.point}」`).join('')}——小白到那一步会追问:「${missing[0].probeLine}」`,
  );
  if (vague) lines.push('含糊词:稿里有「差不多 / 大概 / 应该是」——这种话小白会当成你认同它的错误直觉,把结论说死。');
  if (draft.length < 120) lines.push('篇幅:不到两分钟的量,至少把任务卡的靶心和一个生活类比写进去。');
  if (ctx.weakBeliefs.length > 0) lines.push(`别忘了你栽过的:「${ctx.weakBeliefs[0]}」——稿里得有一句专门翻过来。`);
  lines.push(`靶心对照:${topic.prep.taskCard}`);
  return lines.join('\n');
}

/** 拆试讲回复的两段(容错:模型没按格式给就整段当点评) */
export function splitRehearsal(text: string): { probe: string; verdict: string } {
  const m = text.match(/小白[:\uFF1A]\s*([\s\S]*?)\n+\s*小砚点评[:\uFF1A]\s*([\s\S]*)$/);
  if (m) return { probe: m[1].trim(), verdict: m[2].trim() };
  return { probe: '', verdict: text.replace(/^小砚点评[:\uFF1A]\s*/, '').trim() };
}
