/**
 * 小白成长双轨引擎 —— 从事件流纯派生的「升级 + 进化」。
 * 升级(连续):课堂里小白"真听懂了"的事件按权重累进学识经验(XP)→ 学识等级(第 N 级)。
 * 进化(里程碑):出师深度 + 跨课程广度 → 五阶形象(嫩芽→灯泡→眼镜→问号→学士帽)。
 * 两轨都不新增事件类型;prep/remedy 是先生自修、小白不在场,一律不计(与师道履历分口径刻意区分)。
 * 未知 topicId 的出师事件(旧档):计深度(masteries),不计广度(coursesTouched)。
 * 铁律:纯函数、Node 安全(不碰 window/localStorage/import.meta),
 * 且不得 re-export 进 engine/index barrel —— simulate 在 Node 直接加载 barrel。
 */
import type { LearnEvent, LearnEventType, Topic, XiaobaiGlobal } from '../types';

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
  level: number;      // 学识等级(第 N 级),不设硬顶
  intoLevel: number;  // 当前级内已积累点数
  forNext: number;    // 当前级升下一级所需总点数(intoLevel/forNext = 细进度条)
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
 * 修行阶跃迁规则(出师=topic_mastered 事件数,同 topicsMastered 口径不去重;课程=出师过的讲所属 course 去重):
 * 1 嫩芽期 初始 / 2 开窍期 出师≥1 / 3 求索期 出师≥2 且 课程≥2 /
 * 4 问难期 出师≥4 且 课程≥2 / 5 出师期 出师≥6 且 课程≥3。
 * 广度刻意轻量(不过量):每阶最多要求"多涉猎一门课、该课出师 1 讲即可"。
 * growth 页据此渲染条件铭文,不得手写复制数字。
 */
export const STAGE_RULES: { stage: 1 | 2 | 3 | 4 | 5; masteries: number; courses: number }[] = [
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
function openCoursesInOrder(topics: Topic[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of topics) {
    if (t.locked) continue;
    if (!seen.has(t.course)) { seen.add(t.course); out.push(t.course); }
  }
  return out;
}

export function deriveEvolution(events: LearnEvent[], topics: Topic[]): EvolutionStatus {
  const evs = chronological(events);
  const courseOf = new Map<string, string>();
  for (const t of topics) courseOf.set(t.topicId, t.course);
  // 课程要求上限用「规则值 ∩ 开放课程数」兜底(万一将来只剩一门课不至永远卡死),下限见 effCourses
  const distinctOpen = openCoursesInOrder(topics).length;

  let masteries = 0;
  const coursesTouched: string[] = [];
  const touched = new Set<string>();
  for (const e of evs) {
    if (e.type !== 'topic_mastered') continue;
    masteries += 1;                                   // 深度:不去重
    const course = courseOf.get(e.topicId);           // 未知 topicId → undefined,不计广度
    if (course !== undefined && !touched.has(course)) {
      touched.add(course);
      coursesTouched.push(course);                    // 广度:首次出师序去重
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
        suggestedCourses: openCoursesInOrder(topics).filter((c) => !touched.has(c)),
      }
    : null;

  return { stage, masteries, coursesTouched, next };
}
