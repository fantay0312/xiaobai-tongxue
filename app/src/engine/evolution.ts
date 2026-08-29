/**
 * 小白成长双轨引擎 —— 从事件流纯派生的「升级 + 进化」。
 * 升级(连续):课堂里小白"真听懂了"的事件按权重累进学识经验(XP)→ 学识阶次(第 N 阶)。
 * 进化(里程碑):出师深度 + 跨课程广度 → 五阶科名(童生→秀才→举人→贡士→进士)。
 * 两轨都不新增事件类型;prep/remedy 是先生自修、小白不在场,一律不计(与师道履历分口径刻意区分)。
 * 未知 topicId 的出师事件(旧档):计深度(masteries),不计广度(coursesTouched)。
 * 铁律:纯函数、Node 安全(不碰 window/localStorage/import.meta),
 * 且不得 re-export 进 engine/index barrel —— simulate 在 Node 直接加载 barrel。
 */
import type { LearnEvent, LearnEventType, Topic, XiaobaiGlobal } from '../types';
import { topicCourseKey } from '../data/runtimeTopics';

/** payload 数值闸口:坏档(手改 localStorage)里的非数值不许污染 reduce——与 achievements.ts 同口径 */
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 按时间稳排(事件流本为追加序,ISO 可字典序比较;排序只为防御乱序注入) */
function chronological(events: LearnEvent[]): LearnEvent[] {
  return [...events].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
}

// ───────────────────────── 升级:学识经验(XP) ─────────────────────────

/**
 * 学识经验权重(只计小白在场且"学到了"的事件,权重即成长价值观):
 * 听懂一个要点 +3 / 解开一个执念 +8 / 记住一个好比方 +6 / 卡壳被拉回来 +2 /
 * 忘了又想起 +10 / 出师大礼 +25。小测另按 ⌊score/10⌋ 折算(见 deriveWisdom)。
 * 被带偏(adopted)与其余事件计 0 —— 成长语言纪律:盲区是"还没懂",不扣分。
 */
export const XP_RULES: Partial<Record<LearnEventType, number>> = {
  checklist_hit: 3,
  misconception_corrected: 8,
  golden_analogy_saved: 6,
  stuck_rescued: 2,
  review_passed: 10,
  topic_mastered: 25,
};

export interface XiaobaiWisdom {
  xp: number;         // 学识经验总点
  level: number;      // 学识阶次(第 N 阶),不设硬顶
  intoLevel: number;  // 当前级内已积累点数
  forNext: number;    // 当前阶进阶所需总点数(intoLevel/forNext = 细进度条)
}

/**
 * 累计门槛 t(n):升到第 n 级所需的经验总点。
 * 第 n→n+1 级需 15 + 10·(n-1) 点(15/25/35/45…),即 t(n)=15(n-1)+5(n-1)(n-2)。
 * t(1)=0 / t(2)=15 / t(3)=40 / t(4)=75 / t(5)=120 …
 */
const cumThreshold = (n: number): number => 15 * (n - 1) + 5 * (n - 1) * (n - 2);

export function deriveWisdom(events: LearnEvent[]): XiaobaiWisdom {
  const evs = chronological(events);
  let xp = 0;
  for (const e of evs) {
    if (e.type === 'xiaobai_quiz_scored') {
      // 考出来的都是学识:score 0-100 → ⌊score/10⌋(0-10);坏分(非数值)经 num() 归 0
      xp += Math.floor(Math.max(0, Math.min(100, num(e.payload.score))) / 10);
    } else {
      xp += XP_RULES[e.type] ?? 0;
    }
  }
  // 等级 = 满足累计门槛的最高级(不设硬顶,一路往上找)
  let level = 1;
  while (cumThreshold(level + 1) <= xp) level += 1;
  const base = cumThreshold(level);
  const nextAt = cumThreshold(level + 1);
  return { xp, level, intoLevel: xp - base, forNext: nextAt - base };
}

// ───────────────────────── 进化:出师深度 + 跨课程广度 ─────────────────────────

/**
 * 科名五阶只负责展示,stage / learningLevel 数值契约仍固定为 1-5。
 * 学识 level 是另一条无上限数值轨,不得拿本表硬映射为功名。
 */
export type EvolutionStage = XiaobaiGlobal['learningLevel'];

export interface EvolutionStageMeta {
  stage: EvolutionStage;
  name: string;
  description: string;
}

export const STAGE_META = [
  { stage: 1, name: '童生', description: '初入问学' },
  { stage: 2, name: '秀才', description: '初通一艺' },
  { stage: 3, name: '举人', description: '旁涉群书' },
  { stage: 4, name: '贡士', description: '问难穷理' },
  { stage: 5, name: '进士', description: '学成登科' },
] as const satisfies readonly EvolutionStageMeta[];

/** 集中科名查表:拒绝越界,避免界面悄悄把无上限 wisdom.level 当成五阶科名。 */
export function getStageMeta(stage: number): EvolutionStageMeta {
  const meta = STAGE_META.find((candidate) => candidate.stage === stage);
  if (!meta) throw new RangeError(`Invalid evolution stage: ${stage}`);
  return meta;
}

/**
 * 科名跃迁规则(出师=topic_mastered 事件数,同 topicsMastered 口径不去重;课程=出师过的讲所属 course 去重):
 * 1 童生 初始 / 2 秀才 出师≥1 / 3 举人 出师≥2 且 课程≥2 /
 * 4 贡士 出师≥4 且 课程≥2 / 5 进士 出师≥6 且 课程≥3。
 * 广度刻意轻量(不过量):每阶最多要求"多涉猎一门课、该课出师 1 讲即可"。
 * growth 页据此渲染条件铭文,不得手写复制数字。
 */
export const STAGE_RULES: { stage: EvolutionStage; masteries: number; courses: number }[] = [
  { stage: 1, masteries: 0, courses: 0 },
  { stage: 2, masteries: 1, courses: 1 },
  { stage: 3, masteries: 2, courses: 2 },
  { stage: 4, masteries: 4, courses: 2 },
  { stage: 5, masteries: 6, courses: 3 },
];

export interface EvolutionStatus {
  stage: XiaobaiGlobal['learningLevel'];   // 1-5
  masteries: number;                        // topic_mastered 事件数(不去重)
  coursesTouched: string[];                 // 出师涉猎过的课程名,按首次出师序
  next: null | {                            // stage=5 时 null
    stage: 2 | 3 | 4 | 5;
    needMasteries: number; haveMasteries: number;
    needCourses: number; haveCourses: number;
    breadthBlocked: boolean;                // 深度已够、只差"换门课"
    suggestedCourses: string[];             // 尚未出师过的课程名(书架序)
  };
}

/** 开放(非 locked)主题的去重课程名,按 TOPICS 书架序 */
function openCoursesInOrder(topics: Topic[]): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const t of topics) {
    if (t.locked) continue;
    const key = topicCourseKey(t);
    if (!seen.has(key)) { seen.add(key); out.push({ key, label: t.course }); }
  }
  return out;
}

export function deriveEvolution(events: LearnEvent[], topics: Topic[]): EvolutionStatus {
  const evs = chronological(events);
  const courseOf = new Map<string, { key: string; label: string }>();
  for (const t of topics) courseOf.set(t.topicId, { key: topicCourseKey(t), label: t.course });
  // 课程要求上限用「规则值 ∩ 开放课程数」兜底(万一将来只剩一门课不至永远卡死),下限见 effCourses
  const distinctOpen = openCoursesInOrder(topics).length;

  let masteries = 0;
  const coursesTouched: string[] = [];
  const touched = new Set<string>();
  for (const e of evs) {
    if (e.type !== 'topic_mastered') continue;
    masteries += 1;                                   // 深度:不去重
    const course = courseOf.get(e.topicId);           // 未知 topicId → undefined,不计广度
    if (course !== undefined && !touched.has(course.key)) {
      touched.add(course.key);
      coursesTouched.push(course.label);              // 展示名可重复，广度按稳定 key 去重
    }
  }
  const haveCourses = coursesTouched.length;

  // 有广度要求的阶:上限 min(规则值, 开放课程数),下限 1;无广度要求(stage 1)保持 0
  const effCourses = (raw: number): number => (raw === 0 ? 0 : Math.max(1, Math.min(raw, distinctOpen)));

  // 阶 = 深度、广度两道门槛都满足的最高阶(两门槛均单调,取最后一个通过者即最高)
  let stage: EvolutionStatus['stage'] = 1;
  for (const r of STAGE_RULES) {
    if (masteries >= r.masteries && haveCourses >= effCourses(r.courses)) stage = r.stage;
  }

  const nextRule = STAGE_RULES.find((r) => r.stage > stage) ?? null;
  const next = nextRule
    ? {
        stage: nextRule.stage as 2 | 3 | 4 | 5,
        needMasteries: nextRule.masteries,
        haveMasteries: masteries,
        needCourses: effCourses(nextRule.courses),
        haveCourses,
        breadthBlocked: masteries >= nextRule.masteries && haveCourses < effCourses(nextRule.courses),
        suggestedCourses: openCoursesInOrder(topics)
          .filter((course) => !touched.has(course.key))
          .map((course) => course.label),
      }
    : null;

  return { stage, masteries, coursesTouched, next };
}
