/**
 * 小白台词模板库(mock 渲染)。占位符见 types.ts LineTemplates 注释。
 * 铁律:模板中不得出现任何知识点专业术语——术语只能经 {term}/{belief}/{probe} 槽位进入。
 * 口吻:像平时说话,短句,少感叹号,不夸老师、不喊口号;同一动作的几条模板开头各不相同
 * (渲染层按轮次轮转,并避开上一句的开头)。
 * 模板里一律写「老师」:角色卡改了称呼时由渲染层统一替换;活泼程度由渲染层按档挑长短(沉稳取短、跳脱取长)。
 * simulate.ts 依赖的不变量(改模板时逐条核对):
 *  - stay_confused 里不带 {belief} 的每一条都含「今天」(偏题拉回);
 *  - XIAOBAI_PROBE_BRIDGES 每一条都含「再问一句 / 顺着老师 / 接着老师 / 再确认一处 / 不过我还要问」之一,且 {probe} 原样落入台词;
 *  - XIAOBAI_TANGENT_ACKS 每一条都含「本子 / 记下」之一,且不含「没关系 / 正题 / 知识点」。
 */
import type { LineTemplates, Persona } from '../types';

/** 达到送考门槛后的固定提示；不含数值、清单或误区信息。不带称呼:角色卡可以改小白对老师的叫法,这句由 store 原样发出。 */
export const XIAOBAI_EXAM_READY_LINE =
  '今天这些我心里大概有数了。你要是觉得讲得差不多,就送我去考场试试吧。';

/** 回应小白自己题外追问后的收笔台词:只致谢,不硬推课程路线。 */
export const XIAOBAI_TANGENT_ACKS: Record<Persona, readonly string[]> = {
  好奇型: [
    '哦,是这么回事。这句我记到本子上了。',
    '明白了,谢谢老师。我先记下,回头再翻。',
    '原来是这样,我记下了。',
  ],
  严谨型: [
    '明白了,这一点我记下了。',
    '清楚了。我先记在本子上。',
    '好,这句我记下,先不往外岔了。',
  ],
  杠精型: [
    '行,这回算你答上了,我记下了。',
    '好吧,这句有道理,先记本子上。',
    '嗯,这个我没话说,记下了。',
  ],
};

/** 开窍复述与下一问之间的接榫,{probe} 必须原样落入最终台词。 */
export const XIAOBAI_PROBE_BRIDGES: Record<Persona, readonly string[]> = {
  好奇型: [
    '顺着老师这句往下想,我又冒出一个问题:{probe}',
    '我再问一句,{probe}',
    '接着老师刚才说的,{probe}',
  ],
  严谨型: [
    '再确认一处:{probe}',
    '顺着老师刚才的话,还有一处:{probe}',
    '接着老师这一步往下:{probe}',
  ],
  杠精型: [
    '不过我还要问:{probe}',
    '接着老师这句话往下说,{probe}',
    '我再问一句,{probe}',
  ],
};

// ───────────────────────── 开场白(本地) ─────────────────────────

export type TimeOfDay = '清早' | '上午' | '中午' | '下午' | '晚上' | '深夜';

/** 本地小时(0–23)→ 时段 */
export function timeOfDayOf(hour: number): TimeOfDay {
  const h = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 9;
  if (h < 5) return '深夜';
  if (h < 9) return '清早';
  if (h < 12) return '上午';
  if (h < 14) return '中午';
  if (h < 18) return '下午';
  if (h < 23) return '晚上';
  return '深夜';
}

/** 见面第一句的招呼,按时段;填进开场模板的 {hello} */
export const XIAOBAI_TIME_HELLOS: Record<TimeOfDay, readonly string[]> = {
  清早: ['老师早', '这么早就开课,老师'],
  上午: ['老师上午好', '老师来了'],
  中午: ['老师中午好', '老师,吃过饭了吧'],
  下午: ['老师下午好', '老师来了'],
  晚上: ['老师晚上好', '老师,晚上这节我等了一会儿了'],
  深夜: ['老师,这么晚还上课呀', '都这个点了,老师还没睡'],
};

/** first = 这门课头一回听;again = 听过一部分;reteach = 补课;review = 隔了一阵回来复习 */
export type OpeningKind = 'first' | 'again' | 'reteach' | 'review';

/** 开场第一句。槽位:{hello} 时段招呼、{title} 课名(课名本来就显示在页面上,属白名单) */
export const XIAOBAI_OPENING_GREETINGS: Record<Persona, Record<OpeningKind, readonly string[]>> = {
  好奇型: {
    first: [
      '{hello}。今天是「{title}」对吧,这名字我看着就有点晕。',
      '{hello}。「{title}」……我来之前翻了两页,没怎么看进去。',
      '{hello}。今天讲「{title}」?我本子已经翻到新的一页了。',
    ],
    again: [
      '{hello}。「{title}」上回没讲完,我本子上还空着半页呢。',
      '{hello}。又是「{title}」,上回记的那几句我来之前又看了一遍。',
    ],
    reteach: [
      '{hello}。上回那个地方我回去又想了想,还是没转过来。',
      '{hello}。上次卡住的那一处,我到现在也没想通。',
    ],
    review: [
      '{hello}。隔了这么些天,上回学的我好像记混了。',
      '{hello}。「{title}」我有一阵没碰了,脑子里只剩个大概。',
    ],
  },
  严谨型: {
    first: [
      '{hello}。今天的内容是「{title}」,我想从最基础的地方问起。',
      '{hello}。「{title}」我只看过标题,别的还没有概念。',
    ],
    again: [
      '{hello}。「{title}」上次停在半路,我把记下的几句又对了一遍。',
      '{hello}。接着上次的「{title}」,我还有几处没对上。',
    ],
    reteach: [
      '{hello}。上次那个问题我回去想过,还是没有想通。',
      '{hello}。上回没弄清的那一处,我想再听一遍。',
    ],
    review: [
      '{hello}。隔了一段时间,上次学的我有些记不牢了。',
      '{hello}。「{title}」我需要再过一遍,有的地方已经模糊了。',
    ],
  },
  杠精型: {
    first: [
      '{hello}。「{title}」是吧,名字起得挺唬人,我倒要听听有多难。',
      '{hello}。今天讲「{title}」?先说好,讲不清我可不点头。',
    ],
    again: [
      '{hello}。「{title}」上回没讲完,欠着的今天得补上。',
      '{hello}。又是「{title}」,上回那几句我可都记着呢。',
    ],
    reteach: [
      '{hello}。上回那个地方,我回去想了,还是不服。',
      '{hello}。上次那一处我没被说服,今天你再试试。',
    ],
    review: [
      '{hello}。先承认,上回学的我有点记混了。',
      '{hello}。「{title}」隔太久,我忘了一些,你别笑。',
    ],
  },
};

/** 开场带出第一问的半句;{probe} 原样落入 */
export const XIAOBAI_OPENING_BRIDGES: Record<Persona, readonly string[]> = {
  好奇型: [
    '我先问个最基础的:{probe}',
    '有个地方我想先问——{probe}',
    '那我就从这儿问起,{probe}',
  ],
  严谨型: [
    '我先确认第一处:{probe}',
    '开始之前先问一句:{probe}',
    '第一个问题:{probe}',
  ],
  杠精型: [
    '先问一个,{probe}',
    '那我可就直接问了:{probe}',
    '你先回答我这个:{probe}',
  ],
};

/** 同一个问题上一句刚问过、老师这轮没答到时的再问:不装作第一次问;{probe} 原样落入 */
export const XIAOBAI_REASK_LINES: Record<Persona, readonly string[]> = {
  好奇型: [
    '刚才那个我还是没弄明白——{probe}',
    '老师,我还想回到刚才问的那个:{probe}',
    '这段我听了,可我那个问题还悬着:{probe}',
  ],
  严谨型: [
    '刚才那一问还没有着落:{probe}',
    '我还是想先把上一个问题对清楚:{probe}',
    '这一段我记下了,但上一问还没解决:{probe}',
  ],
  杠精型: [
    '别绕开啊,刚才那个你还没答我:{probe}',
    '说了半天,我那个问题呢?{probe}',
    '这段我先收着。刚才问的你还欠着:{probe}',
  ],
};

/** 开场提到梦的一句;{dream} 是已过泄漏守门的那句话 */
export const XIAOBAI_DREAM_LINES: readonly string[] = [
  '对了,我昨晚还梦到这课了,梦里一直在想:{dream}',
  '说来好笑,这课我连做梦都在琢磨——{dream}',
];

export const XIAOBAI_LINES: LineTemplates = {
  好奇型: {
    ask_clarify: [
      '老师,{term}到底是什么意思?我在这儿就跟不上了。',
      '等一下,我先问一句——{probe}',
      '这块我脑子里还没有画面。{probe}',
      '我可能问得有点笨:{probe}',
      '{probe}',
    ],
    ask_example: [
      '道理我好像听进去一点了,能拿个生活里的例子比划一下吗?',
      '老师,光听说法我有点飘,有没有一个具体的例子?',
      '要不拿身边的东西打个比方?那样我比较容易跟上。',
      '我想看它真的发生一次是什么样,能举一个吗?',
    ],
    ask_boundary: [
      '{probe}',
      '我突然想到一种情况——{probe}',
      '那换一种用法呢?{probe}',
      '我又冒出来一个问题:{probe}',
    ],
    inject_misconception: [
      '{belief}',
      '我自己琢磨了一下,觉得{belief}。是这样吧?',
      '可我怎么觉得,{belief}?',
    ],
    ask_transfer: [
      '那{transfer}是不是也一个道理?',
      '我猜一下——{transfer}也是这么回事吧?',
      '要是把它挪到{transfer}上,这个道理还通吗?',
      '说到这个我想起{transfer},它俩是一回事吗?',
    ],
    express_understanding: [
      '哦,所以说{paraphrase},对吧?',
      '{paraphrase}……这下我脑子里有画面了。',
      '等等我说一遍:{paraphrase}。我这样说没走样吧?',
      '原来卡在这儿。{paraphrase},这句我记下了。',
    ],
    rescue_hint: [
      '老师,是不是跟你刚才说的{term}有关系?要不顺着那个往下讲。',
      '要不从你刚才讲的{term}那儿接着说?我觉得就差一点了。',
      '不着急,老师。你从最有把握的那一小块讲起就行,我听着。',
      '卡住也没事,刚才那段我还想再听一遍,从那儿接着来?',
    ],
    propose_lookup: [
      '老师别急,要不我们一起查查书?查到了你再讲给我听。',
      '要不翻翻书吧,你查到了再讲,我在旁边等着。',
      '卡住就卡住呗,咱们查一查,查完你再接着讲,好不好?',
    ],
    stay_confused: [
      '可我还是觉得{belief}。你能拿个例子让我看看吗?',
      '老师,这个跟今天要讲的好像不是一回事?我还想听你接着讲刚才那个。',
      '我们还是回到今天这课吧,刚才那儿我还没听完呢。',
      '嗯……我还是转不过来,{belief}这个想法我放不下。哪一步不对,你带我走一遍?',
    ],
    trigger_review: [
      '老师,上次那个我好像有点忘了,你再给我讲讲?',
      '之前讲的那块,我脑子里就剩个影子了,再带我过一遍吧。',
      '不好意思老师,上回那个我好像又还回去了……能再讲一次吗?',
    ],
  },
  严谨型: {
    ask_clarify: [
      '等一下,这里我想先对一个细节:{probe}',
      '老师,{term}具体指的是什么?我想先把这个词弄清楚。',
      '往下讲之前我先问一处:{probe}',
      '有一步我没对上。{probe}',
      '{probe}',
    ],
    ask_example: [
      '能给一个具体的例子吗?我想照着它走一遍。',
      '有没有一个具体的场合?我想把它代进去看看。',
      '请举一个最小的例子,越小越好,我想看清每一步。',
    ],
    ask_boundary: [
      '我想确认一种边上的情况:{probe}',
      '如果条件稍微变一下呢?{probe}',
      '有个地方我得问清楚:{probe}',
      '{probe}',
    ],
    inject_misconception: [
      '{belief}',
      '按我的理解,{belief}。如果不对,请告诉我错在哪一步。',
      '我先说我的想法:{belief}。你帮我看看对不对?',
    ],
    ask_transfer: [
      '按这个思路往下推,{transfer}应该也成立,对吗?',
      '换到{transfer}上,同样的推理还成立吗?',
      '我想拿{transfer}对照一下:它也是这样吗?',
    ],
    express_understanding: [
      '明白了。{paraphrase},我这样说对吗?',
      '我复述一遍:{paraphrase}。没有走样吧?',
      '{paraphrase}。这一步我对上了。',
      '所以是这样:{paraphrase}。我先这么记。',
    ],
    rescue_hint: [
      '可以从你刚才提到的{term}接着讲吗?那一段我听得很清楚。',
      '不急,你先把前面的再理一遍,我在听。',
      '要不先说你最确定的那一步?后面的我们慢慢对。',
    ],
    propose_lookup: [
      '要不我们查一下资料再继续?我想要一个可靠的依据。',
      '这里建议先翻一下书,免得我们俩都记岔了。',
      '先查一查吧,查到了你再往下讲。',
    ],
    stay_confused: [
      '抱歉,我还是认为{belief}。能给我一个能说服我的例子吗?',
      '这个好像超出今天这课的范围了。我们回到刚才那一步,我还有一处没弄清。',
      '我还是没被说服:{belief}。是哪一步不成立?',
      '这和今天要讲的内容没有对上,能回到刚才讲到的地方吗?',
    ],
    trigger_review: [
      '老师,上次那一讲有个细节我记不清了,能再讲一次吗?',
      '上次那部分我已经记得不牢了,麻烦再讲一遍。',
    ],
  },
  杠精型: {
    ask_clarify: [
      '且慢。{probe}你先把这个说圆了。',
      '{term}?这个词你还没说清呢,展开讲讲。',
      '你这话说得太快了吧。{probe}',
      '我还没被说服。{probe}',
      '{probe}',
    ],
    ask_example: [
      '光说不算,举个例子来听听?',
      '例子呢?没有例子我可不认。',
      '你要是真懂,现编一个例子应该不难吧?',
    ],
    ask_boundary: [
      '我抬个杠——{probe}',
      '你说得这么满,那我问你:{probe}',
      '我偏要挑个刁钻的:{probe}',
      '{probe}',
    ],
    inject_misconception: [
      '{belief}',
      '我看未必吧。要我说,{belief}。',
      '不对吧老师,明明是{belief},我记得清清楚楚。',
    ],
    ask_transfer: [
      '行,就算你说得对,那{transfer}呢?也一样?',
      '先别急着高兴,换成{transfer},你还敢这么说吗?',
      '那{transfer}怎么说?别告诉我又是另一套。',
    ],
    express_understanding: [
      '……好吧,这回算你讲明白了。{paraphrase},我认。',
      '行吧,{paraphrase}——这回我挑不出毛病。',
      '{paraphrase}……好吧,记下了。',
      '我本来还想杠一下的。{paraphrase},这句我没话说。',
    ],
    rescue_hint: [
      '卡住了?你刚才{term}不是讲得挺顺的吗,从那儿接着来。',
      '这就没词了?从你刚才讲顺的那段接着说呗。',
      '别停啊,我还等着挑毛病呢。从你有把握的地方讲起?',
    ],
    propose_lookup: [
      '讲不下去了吧?行了,一起查书,查完你再给我讲。',
      '干吵没意思,翻书吧,白纸黑字看了再说。',
      '查一下呗,又不丢人。查到了你再接着讲。',
    ],
    stay_confused: [
      '我不信。{belief}——你倒是拿个例子给我看啊。',
      '打住,今天不是说好讲这课的吗?别岔开。',
      '还是没说服我。{belief},哪儿不对你指出来。',
      '这跟今天要讲的有什么关系?接着说刚才那个。',
    ],
    trigger_review: [
      '老师,上次那个我忘了,你不会也忘了吧?再讲一遍。',
      '上次那个,你要是还能原样再讲一遍,我就服你。',
    ],
  },
};
