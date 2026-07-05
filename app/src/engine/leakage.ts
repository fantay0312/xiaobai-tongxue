/**
 * 泄漏检测器(出口守门,防线⑤)
 * 台词生成后扫描是否含白名单外的 checklist 专业术语,命中 → 重新生成(最多2次)→ 兜底话术。
 */
import type { Topic } from '../types';

export const FALLBACK_LINE = '呃……老师,你刚说的我有点没跟上,能再讲一遍吗?';

export interface LeakageInput {
  reply: string;
  topic: Topic;
  /** 已解锁 checklist 项 id(白名单来源) */
  whitelistChecklist: string[];
  /** 老师(学生用户)说过的词 */
  teacherTerms: string[];
  /** 当前指令卡误区条目涉及的词 */
  mcTerms: string[];
}

/** 返回越权术语列表;空数组 = 通过 */
export function leakageCheck(input: LeakageInput): string[] {
  const { reply, topic, whitelistChecklist, teacherTerms, mcTerms } = input;
  const allowed = new Set<string>([...teacherTerms, ...mcTerms]);
  for (const item of topic.checklist) {
    if (whitelistChecklist.includes(item.id)) {
      for (const t of item.terms) allowed.add(t);
    }
  }
  const banned = new Set<string>();
  for (const item of topic.checklist) {
    for (const t of item.terms) {
      if (!allowed.has(t)) banned.add(t);
    }
  }
  return [...banned].filter((t) => reply.includes(t));
}
