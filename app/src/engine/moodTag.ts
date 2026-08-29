/**
 * 心情标签解析(api/proxy 路径专用,纯函数、Node 安全,不进 engine barrel)。
 * 小白系统提示要求模型在台词末尾附 〔心情:X〕;这里把标签从原文剥掉并映射为 XiaobaiMood。
 * 纪律:标签绝不进 UI / store 消息 / trace —— 下游(句数、泄漏守门、重试、打字动画)只看剥净后的文本。
 */
import type { XiaobaiMood } from '../types';

/** 中文标签 → 心情;idle/proud 永远不由模型自选。「不好意思」「琢磨中」与 classroom MOOD_ZH 用词对齐。 */
export const MOOD_LABEL: Readonly<Record<string, XiaobaiMood>> = {
  好奇: 'curious',
  困惑: 'confused',
  开窍: 'aha',
  开心: 'happy',
  害羞: 'shy',
  不好意思: 'shy',
  思考: 'thinking',
  琢磨中: 'thinking',
};

/** 提示词里列给模型的六个标签(顺序即提示顺序) */
export const MOOD_TAG_LABELS: readonly string[] = ['好奇', '困惑', '开窍', '开心', '害羞', '思考'];

/** 任意位置的完整标签:全/半角括号、全/半角冒号、标签内 ≤8 字 */
const MOOD_TAG_RE = /[〔[［(（【]\s*心情\s*[：:]\s*([^〕\]］)）】\n]{0,8}?)\s*[〕\]］)）】]/gu;
/** 被 max_tokens 截断的残标签(只在末尾) */
const MOOD_TAG_TRUNC_RE = /[〔[［(（【]\s*心情\s*[：:]?\s*[^〕\]］)）】\n]{0,8}$/u;

export interface ParsedMoodTag {
  text: string;
  mood: XiaobaiMood | null;
}

/**
 * 剥掉所有心情标签(非法标签也剥,但 mood 保持 null);多枚合法标签取最后一枚;
 * 没有「心情」二字的〔〕原样保留。
 */
export function parseMoodTag(raw: string): ParsedMoodTag {
  let mood: XiaobaiMood | null = null;
  const text = raw
    .replace(MOOD_TAG_RE, (_m, label: string) => {
      const mapped = MOOD_LABEL[label.trim()];
      if (mapped) mood = mapped;
      return '';
    })
    .replace(MOOD_TAG_TRUNC_RE, '')
    .replace(/[ \t　]+$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return { text, mood };
}
