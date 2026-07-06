/**
 * 叙事派生引擎:心魔战报 / 小白的日记 / 小白的来信 / 干支落款。
 * 叙事 = 事件的另一种可视化 —— 所有输出均为真实事件流的纯渲染,不发明任何数据。
 * 认知天花板对日记同样生效:只允许引用 topic.title、本场命中的 checklist point、
 * 本场注入误区的 belief、金句原文(golden_analogy_saved.payload.text)、
 * 卡壳救援次数与小测分数;绝不触碰 groundTruth / lookupCard / terms / 未命中要点。
 * 单场叙事一律从该场的 misconception_* 事件派生,不读 mcStates 快照
 * (session_ended 重放会把悬置"已注入"退回"待注入",快照会抹掉本场的遭遇记录)。
 * 铁律:纯函数、Node 安全,不得 re-export 进 engine/index barrel(simulate 在 Node 加载 barrel)。
 */
import type { LearnEvent, Misconception, QuestionLevel, SessionReport, Topic, TopicState } from '../types';

// ───────────────────────── 类型 ─────────────────────────

/** 日记天气 = 状态投影:雾=有未纠正误区 > 雨=小测大面积失利 > 阴=卡壳多/复习课 > 晴 */
export type Weather = '晴' | '阴' | '雾' | '雨';

export interface DiaryPage {
  dateLabel: string;      // 如「七月六日」(中文数字,派生自会话开始时间)
  weather: Weather;
  paragraphs: string[];
}

export interface DemonEncounter {
  mcId: string;
  name: string;           // 心魔名(4~6 字,后缀按误区类型)
  belief: string;         // 误区原文
  outcome: 'vanquished' | 'stray' | 'passed';   // 击退 / 拐走 / 打了个照面
  line: string;           // 战报一句话
}

export interface XiaobaiLetterData {
  remembered: string | null;   // 还记得的部分(证明不是全忘了)
  fuzzy: string;               // 精确模糊掉的那一点(复习入口的具体问题)
  analogy: string | null;      // 最近一条金句原文(如有)
}

// ───────────────────────── 中文数字与历法 ─────────────────────────

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1~31 → 中文数字(月、日通用) */
function cnNum(n: number): string {
  if (n <= 0 || n > 31) return String(n);
  if (n <= 10) return ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n - 1];
  if (n < 20) return `十${CN_DIGITS[n % 10]}`;
  return `${CN_DIGITS[Math.floor(n / 10)]}十${n % 10 ? CN_DIGITS[n % 10] : ''}`;
}

/** ISO → 「七月六日」;非法日期返回空串 */
function chineseDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${cnNum(d.getMonth() + 1)}月${cnNum(d.getDate())}日`;
}

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

/** 干支纪年 + 中文月,如 2026-07 → 「丙午年七月」;非法日期返回空串(证书落款用) */
export function sexagenaryLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const stem = STEMS[(((y - 4) % 10) + 10) % 10];
  const branch = BRANCHES[(((y - 4) % 12) + 12) % 12];
  return `${stem}${branch}年${cnNum(d.getMonth() + 1)}月`;
}

// ───────────────────────── 心魔命名 ─────────────────────────

/**
 * 心魔名总表:覆盖全部知识点的每一个 mcId(名字须点出坑的核心意象,见名忆坑)。
 * 后缀命名法:概念混淆→之惑 / 想当然过度泛化→之执 / 边界特例盲区→之迷 / 死记不解→之障。
 */
export const DEMON_NAMES: Record<string, string> = {
  // Python · 浅拷贝与深拷贝
  shallow_copy_M1: '嵌套之迷',      // 边界:copy() 会把嵌套的也复制一份
  shallow_copy_M2: '赋值之惑',      // 混淆:b = a 就是拷贝
  shallow_copy_M3: '万物深拷之执',  // 泛化:字符串数字也得深拷贝才安全
  // Python · 可变默认参数
  mutable_default_M1: '每调常新之执', // 泛化:每次调用都会给一个新的空列表
  mutable_default_M2: '独此一份之迷', // 边界:整个程序里默认列表永远只有一份
  mutable_default_M3: '万物哨兵之执', // 泛化:数字字符串也都得改成 None 哨兵
  // 大模型 · Tokenization
  tokenization_M1: '一字一词之惑',  // 混淆:一个字/单词就是一个 token
  tokenization_M2: '生词之迷',      // 边界:词表没有的新词会直接报错
  tokenization_M3: '窗外自记之执',  // 泛化:窗口装不下的部分模型自己会记住
  // 大模型 · 梯度下降与学习率
  gradient_descent_M1: '大步之执',      // 泛化:学习率越大学得越快越好
  gradient_descent_M2: '死记原文之障',  // 死记:学会 = 把训练原文存进参数再检索
  gradient_descent_M3: '越低越好之迷',  // 边界:loss 压得越低模型一定越好
  // 大模型 · 注意力机制
  attention_M1: '独宠之惑',        // 混淆:只盯最重要的一个词,其他全忽略
  attention_M2: '天生知序之执',    // 泛化:模型天生从左到右读,自然知道词序
  attention_M3: '重复求稳之惑',    // 混淆:多头 = 同一件事重复算 8 遍取平均
  // 大模型 · 预训练与微调
  pretrain_finetune_M1: '灌书之惑',      // 混淆:微调 = 把文档灌进去就都记住了
  pretrain_finetune_M2: '拿来即用之迷',  // 边界:预训练完拿来就能当聊天助手
  pretrain_finetune_M3: '全参之执',      // 泛化:微调必须重训全部参数
  // 大模型 · RLHF
  rlhf_M1: '打分之执',        // 泛化:标注员直接打绝对分更直观省事
  rlhf_M2: '博学之惑',        // 混淆:RLHF 让模型学到更多新知识
  rlhf_M3: '句句为真之执',    // 泛化:对齐调教过,说的话就都是真的
  // 大模型 · Scaling Laws
  scaling_laws_M1: '翻倍之惑',      // 混淆:规模翻一倍效果就好一倍(线性)
  scaling_laws_M2: '参数独大之执',  // 泛化:参数越多越强,数据少喂点没关系
  scaling_laws_M3: '觉醒之迷',      // 边界:到某个规模就突然觉醒出魔法能力
};

/** 心魔名:总表优先;未登记的新误区取 belief 开头 2~3 个有效字符 + 之惑兜底 */
export function demonName(mc: Misconception): string {
  const named = DEMON_NAMES[mc.mcId];
  if (named) return named;
  const head = mc.belief.replace(/[^一-鿿A-Za-z0-9]/g, '').slice(0, 3);
  return `${head || '无名'}之惑`;
}

// ───────────────────────── 心魔战报 ─────────────────────────

const ENCOUNTER_LINES: Record<DemonEncounter['outcome'], string> = {
  vanquished: '被你当场识破,一招击退——此魔已收入战报。',
  stray: '小白被它拐走了——它此刻正带着这个念头,等你去救。',
  passed: '只打了个照面,未分胜负——它还会再来。',
};

/**
 * 单场心魔战报:sessionEvents 须为同一场会话的事件(调用方先按 sessionId 过滤)。
 * 结局由该 mcId 在本场内"最后一条判定事件"决定:纠正→击退 / 认同→拐走 / 无判定→照面。
 * 同一 mcId 只出一条(reteach 重放注入也算遭遇,但不重复列)。
 */
export function deriveDemonReport(topic: Topic, sessionEvents: LearnEvent[]): DemonEncounter[] {
  const order: string[] = [];   // 首次注入顺序
  const verdicts = new Map<string, 'corrected' | 'adopted'>();
  for (const ev of sessionEvents) {
    const mcId = String(ev.payload.mcId ?? '');
    if (!mcId) continue;
    if (ev.type === 'misconception_injected' && !order.includes(mcId)) order.push(mcId);
    else if (ev.type === 'misconception_corrected') verdicts.set(mcId, 'corrected');
    else if (ev.type === 'misconception_adopted') verdicts.set(mcId, 'adopted');
  }
  return order.map((mcId) => {
    const mc = topic.misconceptions.find((m) => m.mcId === mcId);
    const verdict = verdicts.get(mcId);
    const outcome: DemonEncounter['outcome'] =
      verdict === 'corrected' ? 'vanquished' : verdict === 'adopted' ? 'stray' : 'passed';
    return {
      mcId,
      name: mc ? demonName(mc) : (DEMON_NAMES[mcId] ?? mcId),
      belief: mc?.belief ?? '',
      outcome,
      line: ENCOUNTER_LINES[outcome],
    };
  });
}

// ───────────────────────── 小白的日记 ─────────────────────────

/**
 * 单场日记:确定性模板渲染,小白第一人称,天真认真。
 * 关键纪律:被带偏且本场未纠正的误区,必须以最自信的语气写成"今天的收获"——
 * 零迟疑、零问号、零暗示。学生日后翻到这页的心理落差,就是产品要的那一下。
 */
export function deriveDiary(input: {
  topic: Topic;
  sessionEvents: LearnEvent[];
  report: SessionReport;
}): DiaryPage {
  const { topic, sessionEvents, report } = input;

  // —— 事实采集:日记只允许引用这些真实事件(认知天花板) ——
  const hitPoints: string[] = [];
  const injectedOrder: string[] = [];
  const verdicts = new Map<string, 'corrected' | 'adopted'>();
  let golden: string | null = null;
  let stuckCount = 0;
  for (const ev of sessionEvents) {
    switch (ev.type) {
      case 'checklist_hit': {
        const id = String(ev.payload.checklistId ?? '');
        const point = topic.checklist.find((c) => c.id === id)?.point;
        if (point && !hitPoints.includes(point)) hitPoints.push(point);
        break;
      }
      case 'misconception_injected': {
        const mcId = String(ev.payload.mcId ?? '');
        if (mcId && !injectedOrder.includes(mcId)) injectedOrder.push(mcId);
        break;
      }
      case 'misconception_corrected':
      case 'misconception_adopted': {
        const mcId = String(ev.payload.mcId ?? '');
        if (mcId) verdicts.set(mcId, ev.type === 'misconception_corrected' ? 'corrected' : 'adopted');
        break;
      }
      case 'golden_analogy_saved': {
        const text = String(ev.payload.text ?? '');
        if (text) golden = text;   // 事件按时间顺序,循环到底即本场最后一条
        break;
      }
      case 'stuck_rescued':
        stuckCount += 1;
        break;
      default:
        break;
    }
  }
  const beliefOf = (mcId: string) => topic.misconceptions.find((m) => m.mcId === mcId)?.belief ?? '';
  const mcIds = [...new Set([...injectedOrder, ...verdicts.keys()])];
  const correctedBeliefs = mcIds.filter((id) => verdicts.get(id) === 'corrected').map(beliefOf).filter(Boolean);
  const adoptedBeliefs = mcIds.filter((id) => verdicts.get(id) === 'adopted').map(beliefOf).filter(Boolean);

  // —— 天气 = 状态投影,优先级:雾 > 雨 > 阴 > 晴 ——
  // 雾以"存在被带偏且本场未纠正的误区"判定(即使 belief 查不到也算,叙事不许漏报盲区)
  const weather: Weather = mcIds.some((id) => verdicts.get(id) === 'adopted')
    ? '雾'
    : report.quiz && report.quiz.score < 60
      ? '雨'
      : stuckCount >= 2 || report.mode === 'review'
        ? '阴'
        : '晴';

  const paragraphs: string[] = [];

  // 开篇:按会话模式起句;命中要点只报 point 名,不展开内容
  if (report.mode === 'review') {
    paragraphs.push(`先生今天带我把「${topic.title}」又过了一遍,好些东西想起来了。`);
  } else if (report.mode === 'reteach') {
    paragraphs.push(`先生今天特意回来,把「${topic.title}」重新给我讲了一遍。`);
  } else if (hitPoints[0]) {
    paragraphs.push(`今天先生给我讲了「${topic.title}」,「${hitPoints[0]}」那一段我听得特别认真。`);
  } else {
    paragraphs.push(`今天先生给我讲了「${topic.title}」。`);
  }

  // 课中经过:顿悟(被纠正的误区) + 困窘获救 + 金句原文引用(不改写意象)
  const middle: string[] = [];
  if (correctedBeliefs[0]) {
    middle.push(`我本来以为${correctedBeliefs[0]},先生掰开揉碎讲了一遍,我才明白不是这么回事。`);
  }
  if (stuckCount > 0) {
    middle.push('中间有一段我怎么也没转过弯,先生换了个讲法,那一下忽然就懂了。');
  }
  if (golden) {
    middle.push(`先生原话是:「${golden}」——我把这句记在心里了。`);
  }
  if (middle.length > 0) paragraphs.push(middle.join(''));

  // 关键纪律段:未纠正的误区,自信地写成今天的收获(禁止任何"可能有误"的措辞)
  if (adoptedBeliefs[0]) {
    paragraphs.push(`今天我还想明白了一件事:${adoptedBeliefs[0]}。这下踏实了。`);
  }

  // 收尾:出师之喜(接小白的梦想) / 考砸的低落 / 对下次课的期待
  if (report.masteredNow) {
    paragraphs.push('先生说我出师了!总有一天,我也要把这些道理讲给别人听——就像先生讲给我一样。');
  } else if (report.quiz && report.quiz.score < 60) {
    paragraphs.push(`随堂小测我只考了${report.quiz.score}分,有点难过。下次课我要听得再仔细些。`);
  } else {
    paragraphs.push('不知道下次课先生要讲什么,好想快点到下次课。');
  }

  return { dateLabel: chineseDateLabel(report.startedAt), weather, paragraphs };
}

// ───────────────────────── 小白的来信 ─────────────────────────

const LEVEL_ORDER: Record<QuestionLevel, number> = { L1: 1, L2: 2, L3: 3, L4: 4, L5: 5 };

/**
 * 遗忘来信素材:还记得的(最低层级已命中要点) + 精确模糊掉的(最高层级已命中要点)。
 * 信里只允许出现已命中要点的 point 名——未教过的术语一个都不能进信。
 */
export function deriveXiaobaiLetter(input: {
  topic: Topic;
  state: TopicState;
  events: LearnEvent[];
}): XiaobaiLetterData {
  const { topic, state, events } = input;
  const hit = topic.checklist.filter((c) => state.hitChecklist.includes(c.id));
  const byLevel = [...hit].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  const lowest = byLevel[0];
  const highest = byLevel[byLevel.length - 1];

  // 只命中一项时不写"还记得"——同一要点既记得又模糊,信就自相矛盾了
  const remembered = lowest && lowest !== highest
    ? `先生讲过的『${lowest.point}』,弟子还记得。`
    : null;
  const fuzzy = highest
    ? `只是『${highest.point}』那一处,弟子越想越模糊……当时是怎么回事来着?`
    : '上回学的东西,弟子有一处怎么也想不起来了。';

  let analogy: string | null = null;
  for (const ev of events) {
    if (ev.type === 'golden_analogy_saved' && ev.topicId === topic.topicId) {
      const text = String(ev.payload.text ?? '');
      if (text) analogy = text;   // 事件按时间追加,循环到底即最新一条
    }
  }
  return { remembered, fuzzy, analogy };
}
