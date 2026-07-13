import type { XiaobaiMood } from '../../types';

const MOOD_NAME: Record<XiaobaiMood, string> = {
  idle: '平静',
  curious: '好奇',
  confused: '困惑',
  thinking: '思考',
  aha: '顿悟',
  happy: '欣喜',
  proud: '自信',
  shy: '害羞',
};

const LEVEL_NAME = ['嫩芽期', '开窍期', '求索期', '问难期', '出师期'] as const;

export function getXiaobaiLabel(mood: XiaobaiMood, level: 1 | 2 | 3 | 4 | 5) {
  return `弟子小白，心情${MOOD_NAME[mood]}，${LEVEL_NAME[level - 1]}`;
}
