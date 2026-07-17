/**
 * 小白二维书童形象 —— Props 契约 FROZEN。
 * 以用户提供的角色设定稿派生透明八表情图集；不携带原稿文字、网格或骨骼点。
 * mood 映射独立表情，level 映射学识朱印，variant 适配纸面/黑板场景。
 */
import { useState, type CSSProperties } from 'react';
import type { XiaobaiMood } from '../../types';
import styles from './XiaobaiAvatar.module.css';

export interface XiaobaiAvatarProps {
  mood: XiaobaiMood;
  level: 1 | 2 | 3 | 4 | 5;
  speaking?: boolean;
  /** 画布边长 px,默认 240 */
  size?: number;
  /** 场景:paper 宣纸页面 / board 黑板讲解舱 */
  variant?: 'paper' | 'board';
}

interface SpriteFrame { column: 0 | 1 | 2 | 3; row: 0 | 1 }

const SPRITE_FRAMES: Record<XiaobaiMood, SpriteFrame> = {
  idle: { column: 0, row: 0 },
  curious: { column: 1, row: 0 },
  confused: { column: 2, row: 0 },
  thinking: { column: 3, row: 0 },
  aha: { column: 0, row: 1 },
  happy: { column: 1, row: 1 },
  proud: { column: 2, row: 1 },
  shy: { column: 3, row: 1 },
};
const MOOD_LABELS: Record<XiaobaiMood, string> = {
  idle: '安静等候', curious: '好奇追问', confused: '有些困惑', thinking: '认真思考',
  aha: '恍然大悟', happy: '开心学会', proud: '自信出师', shy: '腼腆作揖',
};
const LEVEL_MARKS = ['壹', '贰', '叁', '肆', '伍'] as const;
const ASSET_URL = `${import.meta.env.BASE_URL}xiaobai-book-boy-atlas.webp`;

function spriteStyle(frame: SpriteFrame): CSSProperties {
  return {
    width: '400%',
    transform: `translate(${-frame.column * 25}%, ${-frame.row * 50}%)`,
  };
}

export function XiaobaiAvatar({
  mood,
  level,
  speaking = false,
  size = 240,
  variant = 'paper',
}: XiaobaiAvatarProps) {
  const [assetFailed, setAssetFailed] = useState(false);
  const normalizedMood: XiaobaiMood = Object.prototype.hasOwnProperty.call(SPRITE_FRAMES, mood)
    ? mood : 'idle';
  const frame = SPRITE_FRAMES[normalizedMood];
  const levelMark = Number.isInteger(level) && level >= 1 && level <= LEVEL_MARKS.length
    ? LEVEL_MARKS[level - 1] ?? LEVEL_MARKS[0] : LEVEL_MARKS[0];
  const className = [styles.avatar, styles[variant], speaking ? styles.speaking : '']
    .filter(Boolean).join(' ');
  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`小白正在${MOOD_LABELS[normalizedMood]}`}
      data-mood={normalizedMood}
    >
      <span className={styles.ahaBloom} aria-hidden="true" />
      <span className={styles.motion} aria-hidden="true">
        {assetFailed ? <span className={styles.fallback}>白</span> : (
          <img
            className={styles.sprite}
            style={spriteStyle(frame)}
            src={ASSET_URL}
            alt=""
            draggable={false}
            decoding="async"
            onError={() => setAssetFailed(true)}
          />
        )}
      </span>
      <span className={styles.confusedThought} aria-hidden="true">
        <span className={styles.thoughtMark}>?</span>
      </span>
      <span className={styles.ahaMarks} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className={styles.levelMark} aria-hidden="true">{levelMark}</span>
    </div>
  );
}
