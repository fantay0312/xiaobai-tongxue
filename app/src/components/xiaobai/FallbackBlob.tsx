/**
 * WebGL 不可用、异步场景加载中或运行时上下文丢失时的 CSS 小书生。
 * 轮廓与 3D 版保持同一身份:瓷白头、月白衣袍、交领、抱书和成长配饰。
 */
import type { XiaobaiMood } from '../../types';
import { Icon, type IconName } from '../ui/Icon';
import styles from './FallbackBlob.module.css';

export interface FallbackBlobProps {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  variant?: 'paper' | 'board';
}

const LEVEL_ICON: Record<FallbackBlobProps['level'], IconName> = {
  1: 'sprout',
  2: 'lightbulb',
  3: 'glasses',
  4: 'circle-help',
  5: 'graduation',
};

export function FallbackBlob({ mood, level, variant = 'paper' }: FallbackBlobProps) {
  return (
    <div
      className={variant === 'board' ? `${styles.blob} ${styles.board}` : styles.blob}
      data-mood={mood}
      aria-hidden="true"
    >
      {level !== 3 ? (
        <span className={`${styles.accessory} ${styles[`level${level}`]}`}>
          <Icon name={LEVEL_ICON[level]} size="1.35em" strokeWidth={1.8} />
        </span>
      ) : null}

      <span className={styles.head}>
        <span className={styles.face}>
          <i className={`${styles.eye} ${styles.eyeLeft}`} />
          <i className={`${styles.eye} ${styles.eyeRight}`} />
          <i className={styles.nose} />
          <i className={styles.mouth} />
        </span>
        {level === 3 || level === 4 ? (
          <span className={styles.glasses}>
            <Icon name="glasses" size="2.05em" strokeWidth={1.65} />
          </span>
        ) : null}
      </span>

      <span className={styles.robe}>
        <span className={`${styles.sleeve} ${styles.sleeveLeft}`} />
        <span className={`${styles.sleeve} ${styles.sleeveRight}`} />
        <span className={styles.collar}><i /><i /></span>
        <span className={styles.book}><i /><i /></span>
        <span className={`${styles.hand} ${styles.handLeft}`} />
        <span className={`${styles.hand} ${styles.handRight}`} />
      </span>
    </div>
  );
}
