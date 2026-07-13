/**
 * 下课钤印 —— 一堂课落下的荣誉(纯派生,不落盘)。
 * 用同一事件流的「课前切片 / 课后切片」各复算一遍印章与师道,差集即本课新落之印;
 * 切片按事件追加序(数组索引)划界,老档案回看时也能还原「当时的印匣」,不被后来课堂污染。
 * 小白升期(进化)与 appStore 同口径:走 deriveEvolution(出师深度 + 跨课程广度)取阶;
 * 学识(升级)另用 deriveWisdom 对前后切片求经验差(xpGained/xpLevel*)。
 * 铁律:纯函数、Node 安全(不碰 window/localStorage/import.meta),
 * 且不得 re-export 进 engine/index barrel —— simulate 在 Node 直接加载 barrel。
 */
import {
  deriveAchievements, deriveTeacherRank,
  type Achievement, type AchievementInput, type TeacherRank,
} from './achievements';
import { deriveEvolution, deriveWisdom } from './evolution';

export interface SessionHonors {
  newSeals: Achievement[];     // 本课新落的实印(含证据链)
  rankBefore: TeacherRank;
  rankAfter: TeacherRank;
  promoted: boolean;           // 师道晋级与否
  scoreGained: number;         // 本课履历分进账
  pupilLevelBefore: number;    // 小白修行阶(1-5,= 进化阶)
  pupilLevelAfter: number;
  levelUp: boolean;            // 小白升期(进化)与否
  xpGained: number;            // 本课学识经验进账
  xpLevelBefore: number;       // 小白学识等级(第 N 级)
  xpLevelAfter: number;
  xpLevelUp: boolean;          // 小白学识晋级与否
}

export function deriveSessionHonors(
  input: AchievementInput,
  sessionId: string,
): SessionHonors | null {
  let first = -1;
  let last = -1;
  input.events.forEach((e, i) => {
    if (e.sessionId !== sessionId) return;
    if (first < 0) first = i;
    last = i;
  });
  if (first < 0) return null;

  const before = { ...input, events: input.events.slice(0, first) };
  const after = { ...input, events: input.events.slice(0, last + 1) };

  const sealsBefore = new Set(
    deriveAchievements(before).filter((a) => a.earnedAt !== null).map((a) => a.id),
  );
  const newSeals = deriveAchievements(after).filter(
    (a) => a.earnedAt !== null && !sealsBefore.has(a.id),
  );

  const rankBefore = deriveTeacherRank(before);
  const rankAfter = deriveTeacherRank(after);
  // 升期(进化):进化新规则 = 出师深度 + 跨课程广度,input 已带 topics
  const pupilLevelBefore = deriveEvolution(before.events, input.topics).stage;
  const pupilLevelAfter = deriveEvolution(after.events, input.topics).stage;
  // 升级(学识):同前后切片各求经验,差即本课进账
  const wisdomBefore = deriveWisdom(before.events);
  const wisdomAfter = deriveWisdom(after.events);

  return {
    newSeals,
    rankBefore,
    rankAfter,
    promoted: rankAfter.level > rankBefore.level,
    scoreGained: Math.max(0, rankAfter.score - rankBefore.score),
    pupilLevelBefore,
    pupilLevelAfter,
    levelUp: pupilLevelAfter > pupilLevelBefore,
    xpGained: Math.max(0, wisdomAfter.xp - wisdomBefore.xp),
    xpLevelBefore: wisdomBefore.level,
    xpLevelAfter: wisdomAfter.level,
    xpLevelUp: wisdomAfter.level > wisdomBefore.level,
  };
}
