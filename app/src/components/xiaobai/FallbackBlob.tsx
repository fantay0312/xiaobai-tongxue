/**
 * CSS 团子降级组件:WebGL 不可用或 three 场景渲染出错时使用。
 * 观感沿用最初的占位实现(颜文字表情),保证任何环境下小白都在场。
 */
import type { XiaobaiMood } from '../../types';
import styles from './FallbackBlob.module.css';

const MOOD_FACE: Record<XiaobaiMood, string> = {
  idle: '· ᴗ ·', curious: '◕ ᴗ ◕', confused: '@ _ @', thinking: '– ᴗ –',
  aha: '✧ ▽ ✧', happy: '≧ ▽ ≦', proud: '¯ ▽ ¯', shy: '> _ <',
};

export interface FallbackBlobProps {
  mood: XiaobaiMood;
  size?: number;
  variant?: 'paper' | 'board';
}

export function FallbackBlob({ mood, size = 240, variant = 'paper' }: FallbackBlobProps) {
  return (
    <div
      className={variant === 'board' ? `${styles.blob} ${styles.board}` : styles.blob}
      style={{ width: size, height: size, fontSize: size / 8 }}
      aria-label={`小白(${mood})`}
    >
      {MOOD_FACE[mood]}
    </div>
  );
}
