/**
 * CSS 团子降级组件:WebGL 不可用或 three 场景渲染出错时使用。
 * 以纯 CSS 眼口保持跨平台一致,保证任何环境下小白都在场。
 */
import type { XiaobaiMood } from '../../types';
import { Icon, type IconName } from '../ui/Icon';
import styles from './FallbackBlob.module.css';

export interface FallbackBlobProps {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  size?: number;
  variant?: 'paper' | 'board';
}

const LEVEL_ICON: Record<FallbackBlobProps['level'], IconName> = {
  1: 'sprout',
  2: 'lightbulb',
  3: 'glasses',
  4: 'circle-help',
  5: 'graduation',
};

export function FallbackBlob({ mood, level, size = 240, variant = 'paper' }: FallbackBlobProps) {
  return (
    <div
      className={variant === 'board' ? `${styles.blob} ${styles.board}` : styles.blob}
      style={{ width: size, height: size, fontSize: size / 8 }}
      data-mood={mood}
      role="img"
      aria-label="小白的动态形象"
    >
      <span className={`${styles.accessory} ${styles[`level${level}`]}`} aria-hidden="true">
        <Icon name={LEVEL_ICON[level]} size={Math.round(size * 0.2)} strokeWidth={1.7} />
      </span>
      <span className={styles.face} aria-hidden="true">
        <i className={`${styles.eye} ${styles.eyeLeft}`} />
        <i className={`${styles.eye} ${styles.eyeRight}`} />
        <i className={styles.mouth} />
      </span>
      {level === 4 && (
        <span className={styles.glasses} aria-hidden="true">
          <Icon name="glasses" size={Math.round(size * 0.2)} strokeWidth={1.7} />
        </span>
      )}
    </div>
  );
}
