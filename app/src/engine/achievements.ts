/**
 * 成就印章引擎 —— 师者的印匣。
 * 每一枚印都从真实事件流(LearnEvent)复算:earnedAt 取触发事件的时间戳,
 * evidence 取该事件的证据链原文 —— 评委问「这枚印怎么来的」,答案就在事件里。
 * 不落盘、不硬编码进度;未达成的印给真实计数(now/target),让"差多少"也可追溯。
 * 注意:凡涉及"注入/纠正次数"一律数事件,不读 mcStates 快照
 * (session_ended 会把悬置的"已注入"退回"待注入",快照会低估历史)。
 * 铁律:纯函数、Node 安全(不碰 window/localStorage/import.meta),
 * 且不得 re-export 进 engine/index barrel —— simulate 在 Node 直接加载 barrel。
 */
import type {
  LearnEvent, SessionReport, Topic, TopicState, XiaobaiGlobal,
} from '../types';

export interface Achievement {
  id: string;
  name: string;                          // 印名,2-4 字书斋味
  glyph: string;                         // 印面字,1-2 字
  desc: string;                          // 判据的一句话说明(人读)
  tier: 'ink' | 'cinnabar' | 'gold';     // 墨印(常见)/朱印(进阶)/金印(稀有)
  earnedAt: string | null;               // 触发事件的 t;未达成为 null
  progress: { now: number; target: number };
  evidence: string | null;               // 触发事件的证据链原文
  triggerTopicId?: string | null;        // 落印那一刻触发事件所属的课(印记来历);未达成为 null
}

export interface TeacherRank {
  level: number;
  title: string;
  score: number;                         // 真实履历分,事件流累加
  nextTitle: string | null;
  nextAt: number | null;
}

export interface AchievementInput {
  events: LearnEvent[];
  reports: SessionReport[];
  global: XiaobaiGlobal;
  topicStates: Record<string, TopicState>;
  topics: Topic[];
}

/** 「顿悟」判据:几轮之内讲到出师算速通 */
const SWIFT_TURNS = 6;

/** 「日课」判据:连续几个日历日都有开课记录 */
const DAILY_RUN = 3;

/** 本地日历日序号(整数,相邻日差 1)——只用事件自带时间戳,引擎不碰时钟 */
function dayNumber(iso: string): number {
  const d = new Date(iso);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** payload 数值闸口:坏档(手改 localStorage)里的非数值不许污染 reduce——与 teacher 页 num() 同口径 */
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 按时间稳排(事件流本为追加序,ISO 字符串可字典序比较;排序只为防御乱序注入) */
function chronological(events: LearnEvent[]): LearnEvent[] {
  return [...events].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

/** 计数型印章:第 target 次匹配事件即落印时刻,进度即真实匹配数 */
function countSeal(
  id: string, name: string, glyph: string, desc: string,
  tier: Achievement['tier'], matched: LearnEvent[], target: number,
): Achievement {
  const trigger = matched.length >= target ? matched[target - 1] : null;
  return {
    id, name, glyph, desc, tier,
    earnedAt: trigger?.t ?? null,
    progress: { now: matched.length, target },
    evidence: trigger?.evidence ?? null,
    triggerTopicId: trigger?.topicId ?? null,
  };
}

export function deriveAchievements(input: AchievementInput): Achievement[] {
  const events = chronological(input.events);
  const of = (type: LearnEvent['type']) => events.filter((e) => e.type === type);

  const analogies = of('golden_analogy_saved');
  const masteries = of('topic_mastered');
  const quizzes = of('xiaobai_quiz_scored');

  // 满卷:进度用历史最高分(真实、可解释),落印取第一张满分卷
  const bestScore = quizzes.reduce((m, e) => Math.max(m, num(e.payload.score)), 0);
  const perfect = quizzes.find((e) => num(e.payload.score) >= 100) ?? null;

  // 顿悟:出师事件自带 payload.turns,速通与否由事件说话
  // turns 缺省必须是 Infinity(没记轮数不算速通),不能用 0 兜底的 num()
  const swift = masteries.filter((e) => {
    const turns = e.payload.turns;
    return typeof turns === 'number' && Number.isFinite(turns) && turns <= SWIFT_TURNS;
  });

  // 补天(金):同一主题先有 misconception_adopted(把小白带偏过),之后仍讲到出师
  const mended = masteries.filter((m) => events.some(
    (e) => e.type === 'misconception_adopted' && e.topicId === m.topicId && e.t <= m.t,
  ));

  // 全谱(金):全部开放主题各有 topic_mastered;落印取补全最后一块的那次出师
  const openTopics = input.topics.filter((t) => !t.locked);
  const masteredIds = new Set<string>();
  let fullTrigger: LearnEvent | null = null;
  for (const m of masteries) {
    if (!openTopics.some((t) => t.topicId === m.topicId)) continue;
    masteredIds.add(m.topicId);
    if (!fullTrigger && openTopics.length > 0 && masteredIds.size === openTopics.length) fullTrigger = m;
  }

  // 夜读:任一真实事件落在 22:00-06:00(本地时区),不看会话类型,灯下即算
  const nightly = events.filter((e) => {
    const h = new Date(e.t).getHours();
    return h >= 22 || h < 6;
  });

  // 日课:连续 DAILY_RUN 个日历日都有开课,补全连串最后一天的第一课即落印时刻;
  // 进度取历史最长连串(真实、可解释),中断重数不清零历史
  const sessionStarts = of('session_started');
  const dayFirst = new Map<number, LearnEvent>();
  for (const e of sessionStarts) {
    const dn = dayNumber(e.t);
    if (!dayFirst.has(dn)) dayFirst.set(dn, e);
  }
  const days = [...dayFirst.keys()].sort((a, b) => a - b);
  let bestRun = days.length > 0 ? 1 : 0;
  let run = bestRun;
  let dailyTrigger: LearnEvent | null = null;
  for (let i = 1; i < days.length; i += 1) {
    run = days[i] === days[i - 1] + 1 ? run + 1 : 1;
    bestRun = Math.max(bestRun, run);
    if (!dailyTrigger && run >= DAILY_RUN) dailyTrigger = dayFirst.get(days[i]) ?? null;
  }

  return [
    countSeal('first-lesson', '开讲', '启', '第一次把小白领进讲解舱', 'ink', of('session_started'), 1),
    countSeal('first-correct', '正误', '正', '第一次把小白从误区里拉回来', 'ink', of('misconception_corrected'), 1),
    countSeal('corrections-5', '破迷', '破', '五次把小白从误区里拉回来,迷雾尽破', 'cinnabar', of('misconception_corrected'), 5),
    countSeal('first-analogy', '妙喻', '喻', '第一句被小白记进小本本的金句', 'ink', analogies, 1),
    countSeal('analogy-grove', '喻林', '林', '金句攒满五句,张口即比方', 'cinnabar', analogies, 5),
    {
      id: 'perfect-quiz', name: '满卷', glyph: '满',
      desc: '随堂小测考小白,答了满分', tier: 'cinnabar',
      earnedAt: perfect?.t ?? null,
      progress: { now: bestScore, target: 100 },
      evidence: perfect?.evidence ?? null,
      triggerTopicId: perfect?.topicId ?? null,
    },
    countSeal('swift-master', '顿悟', '悟', `${SWIFT_TURNS} 轮之内把一门课讲到出师`, 'cinnabar', swift, 1),
    countSeal('first-master', '出师', '师', '第一门课讲到小白出师', 'cinnabar', masteries, 1),
    countSeal('masters-5', '五车', '车', '学富五车——把五门课讲到小白出师', 'gold', masteries, 5),
    countSeal('hits-25', '积微', '积', '讲明白的要点累计二十五处', 'ink', of('checklist_hit'), 25),
    countSeal('sessions-10', '不辍', '勤', '开课十讲,弦歌不辍', 'ink', of('session_started'), 10),
    {
      id: 'daily-run', name: '日课', glyph: '日',
      desc: `连着 ${DAILY_RUN} 天,书斋里天天有讲书声`, tier: 'cinnabar',
      earnedAt: dailyTrigger?.t ?? null,
      progress: { now: bestRun, target: DAILY_RUN },
      evidence: dailyTrigger?.evidence ?? null,
      triggerTopicId: dailyTrigger?.topicId ?? null,
    },
    countSeal('review-pass', '温故', '温', '小白忘了的,你帮他重新想了起来', 'ink', of('review_passed'), 1),
    countSeal('night-read', '夜读', '夜', '子夜灯下,仍有讲书声', 'ink', nightly, 1),
    countSeal('mend-heaven', '补天', '补', '小白曾被带偏的课,你重新讲到了出师', 'gold', mended, 1),
    {
      id: 'full-map', name: '全谱', glyph: '谱',
      desc: '书架上每一门开放的课都讲到了出师', tier: 'gold',
      earnedAt: fullTrigger?.t ?? null,
      progress: { now: masteredIds.size, target: Math.max(1, openTopics.length) },
      evidence: fullTrigger?.evidence ?? null,
      triggerTopicId: fullTrigger?.topicId ?? null,
    },
  ];
}

/**
 * 师道等级 —— 履历分计分口径(全部来自事件,权重即教学价值观):
 * 讲明白一个要点 +2 / 纠正一个误区 +6 / 一句金句 +5 / 备课 +3 / 补学 +4 /
 * 复习通过 +8 / 出师 +20 / 小测按得分折算 0-5(score/20 取整)。
 * 被带偏不扣分 —— 成长语言纪律:盲区是"小白还没懂",不是"你错了"。
 */
const SCORE_RULES: Partial<Record<LearnEvent['type'], number>> = {
  checklist_hit: 2,
  misconception_corrected: 6,
  golden_analogy_saved: 5,
  prep_completed: 3,
  remedy_completed: 4,
  review_passed: 8,
  topic_mastered: 20,
};

/** 等级阶梯:门槛间距递增,前两级一节课内可达(给正反馈),宗师需通几门课 */
const RANKS: { at: number; title: string }[] = [
  { at: 0, title: '蒙师' },
  { at: 30, title: '塾师' },
  { at: 80, title: '讲席' },
  { at: 160, title: '山长' },
  { at: 280, title: '宗师' },
];

export function deriveTeacherRank(input: AchievementInput): TeacherRank {
  const score = input.events.reduce((sum, e) => {
    if (e.type === 'xiaobai_quiz_scored') {
      return sum + Math.round(Math.max(0, Math.min(100, num(e.payload.score))) / 20);
    }
    return sum + (SCORE_RULES[e.type] ?? 0);
  }, 0);

  let level = 1;
  for (let i = 0; i < RANKS.length; i += 1) {
    if (score >= RANKS[i].at) level = i + 1;
  }
  const next = level < RANKS.length ? RANKS[level] : null;
  return {
    level,
    title: RANKS[level - 1].title,
    score,
    nextTitle: next?.title ?? null,
    nextAt: next?.at ?? null,
  };
}
