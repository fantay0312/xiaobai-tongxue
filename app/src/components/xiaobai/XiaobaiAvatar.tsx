/**
 * 小白 3D 形象 —— Props 契约 FROZEN(实现待 three.js 版本替换)
 * mood 驱动表情与形变;level 驱动头顶配饰(1嫩芽 2灯泡 3-4眼镜 5学士帽);
 * speaking 时轻微弹跳;variant 适配纸面/黑板两种场景光照。
 */
import type { XiaobaiMood } from '../../types';

export interface XiaobaiAvatarProps {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  speaking?: boolean;
  /** 画布边长 px,默认 240 */
  size?: number;
  /** 场景:paper 宣纸页面 / board 黑板讲解舱 */
  variant?: 'paper' | 'board';
}

const MOOD_FACE: Record<XiaobaiMood, string> = {
  idle: '· ᴗ ·', curious: '◕ ᴗ ◕', confused: '@ _ @', thinking: '– ᴗ –',
  aha: '✧ ▽ ✧', happy: '≧ ▽ ≦', proud: '¯ ▽ ¯', shy: '> _ <',
};

/** 占位实现:纯 CSS 团子(three.js 版本完成后整体替换本组件内部) */
export function XiaobaiAvatar({ mood, size = 240 }: XiaobaiAvatarProps) {
  return (
    <div
      style={{
        width: size, height: size, display: 'grid', placeItems: 'center',
        borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%, #fff, #e8e4da)',
        fontSize: size / 8, fontFamily: 'var(--font-display)', color: 'var(--ink)',
      }}
      aria-label={`小白(${mood})`}
    >
      {MOOD_FACE[mood]}
    </div>
  );
}
