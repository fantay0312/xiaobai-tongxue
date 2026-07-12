/**
 * 下课钤印 —— 一堂课落下的荣誉(纯派生,不落盘)。
 * 用同一事件流的「课前切片 / 课后切片」各复算一遍印章与师道,差集即本课新落之印;
 * 切片按事件追加序(数组索引)划界,老档案回看时也能还原「当时的印匣」,不被后来课堂污染。
 * 小白学级与 appStore 同口径:出师门数 + 1,封顶 5 —— 只数切片内 topic_mastered 事件。
 * 铁律:纯函数、Node 安全(不碰 window/localStorage/import.meta),
 * 且不得 re-export 进 engine/index barrel —— simulate 在 Node 直接加载 barrel。
 */
import {
  deriveAchievements, deriveTeacherRank,
  type Achievement, type AchievementInput, type TeacherRank,
} from './achievements';

export interface SessionHonors {
  newSeals: Achievement[];     // 本课新落的实印(含证据链)
  rankBefore: TeacherRank;
  rankAfter: TeacherRank;
  promoted: boolean;           // 师道晋级与否
  scoreGained: number;         // 本课履历分进账
  pupilLevelBefore: number;    // 小白学级(1-5)
  pupilLevelAfter: number;
  levelUp: boolean;            // 小白升期与否
}

/** 切片内出师事件数 → 小白学级(与 appStore.endSession 的 1 + topicsMastered 同口径:
    topicsMastered 逐 topic_mastered 事件累加,这里也数事件、不去重) */
function pupilLevel(events: AchievementInput['events']): number {
  const mastered = events.filter((e) => e.type === 'topic_mastered').length;
  return Math.min(5, 1 + mastered);
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
  const pupilLevelBefore = pupilLevel(before.events);
  const pupilLevelAfter = pupilLevel(after.events);

  return {
    newSeals,
    rankBefore,
    rankAfter,
    promoted: rankAfter.level > rankBefore.level,
    scoreGained: Math.max(0, rankAfter.score - rankBefore.score),
    pupilLevelBefore,
    pupilLevelAfter,
    levelUp: pupilLevelAfter > pupilLevelBefore,
  };
}
