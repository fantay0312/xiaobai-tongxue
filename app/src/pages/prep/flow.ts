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
