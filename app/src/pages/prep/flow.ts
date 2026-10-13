import type { Topic } from '../../types';

type TeachingFlowSource = Pick<Topic, 'checklist' | 'misconceptions' | 'transferHint'>;

/** 把既有备课数据缀成一条讲课线；不读取或泄露具体误区内容。 */
export function deriveTeachingFlow(topic: TeachingFlowSource): string {
  const opening = topic.checklist.find((item) => item.level === 'L1')
    ?? topic.checklist[0];
  const closing = topic.checklist.find((item) => item.level === 'L5')
    ?? topic.checklist.at(-1);
  const openingPhrase = opening?.point ?? '开篇要义';
  const closingPhrase = closing?.point ?? '眼前的新情境';
  const transferPhrase = topic.transferHint.trim();
  const detour = topic.misconceptions.length > 0
    ? `中途小白会有 ${topic.misconceptions.length} 处想岔的地方等你纠，正好借岔路把前后接上。`
    : '中途没有预设岔路，可顺着小白的追问查漏。';

  return [
    `先从「${openingPhrase}」起笔，把话讲清。`,
    '再拿例子把道理立住，随后逼到边界，看看它能不能经住追问。',
    detour,
    `最后沿着「${closingPhrase}」${transferPhrase ? `迁移到「${transferPhrase}」` : '作一次迁移'}收束，让整堂课首尾相照。`,
  ].join('');
}

const FENCE_LINE = /^\s*(```|~~~)/;
/** 列表、标题、引用、表格、公式块这些行自成一块，不需要也不能加硬换行 */
const BLOCK_LINE = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||\$\$|-{3,}\s*$)/;

/**
 * 讲义正文交给 CoachMarkdown 前的整理：数据层讲义按「单个换行即换行」写成，
 * 标准 Markdown 会把相邻两行并成一段，这里给普通行补上硬换行（行尾两个空格）。
 * 代码围栏内原样不动。
 */
export function lectureMarkdown(text: string): string {
  const lines = text.split('\n');
  let fenced = false;
  return lines
    .map((line, index) => {
      if (FENCE_LINE.test(line)) {
        fenced = !fenced;
        return line;
      }
      const next = lines[index + 1];
      if (fenced || next === undefined || !line.trim() || !next.trim()) return line;
      if (BLOCK_LINE.test(line) || BLOCK_LINE.test(next) || FENCE_LINE.test(next)) return line;
      return `${line.replace(/\s+$/, '')}  `;
    })
    .join('\n');
}

/** 把例题代码包成围栏代码块；代码里自带三个反引号时改用波浪线围栏 */
export function codeFence(code: string, language = ''): string {
  const fence = code.includes('```') ? '~~~' : '```';
  return `${fence}${language}\n${code.replace(/\n+$/, '')}\n${fence}`;
}

/** 课程名里看得出语言时给代码块标上，高亮才准；看不出就不标 */
export function codeLanguage(course: string): string {
  return /python/i.test(course) ? 'python' : '';
}

/** 文本里是否带公式或代码块（有才走 Markdown 渲染，纯文本里的下划线、星号不被误当成强调） */
export function hasRichMarkup(text: string): boolean {
  return /```|\$\$|\$[^$\n]{1,80}\$/.test(text);
}
