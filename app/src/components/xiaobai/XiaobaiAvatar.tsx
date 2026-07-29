/**
 * 小白二维书童形象 —— Props 契约 FROZEN。
 * 以用户提供的角色设定稿派生透明八表情图集；不携带原稿文字、网格或骨骼点。
 * mood 映射独立表情，variant 适配纸面/黑板场景。
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { XiaobaiMood } from '../../types';
import styles from './XiaobaiAvatar.module.css';
import motionStyles from './XiaobaiMotion.module.css';

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
type GestureName = 'still' | 'look-left' | 'look-right' | 'settle' | 'nod' | 'lean-in';

interface GestureProfile {
  delayMin: number;
  delayRange: number;
  gestures: readonly GestureName[];
}

interface ActiveGesture {
  name: GestureName;
  duration: number;
}

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
const GESTURE_PROFILES: Record<XiaobaiMood, GestureProfile> = {
  idle: { delayMin: 4_200, delayRange: 4_200, gestures: ['look-left', 'look-right', 'settle'] },
  curious: { delayMin: 3_200, delayRange: 3_600, gestures: ['lean-in', 'nod', 'look-left'] },
  confused: { delayMin: 4_000, delayRange: 3_800, gestures: ['settle', 'look-right', 'nod'] },
  thinking: { delayMin: 3_400, delayRange: 3_600, gestures: ['lean-in', 'settle', 'nod'] },
  aha: { delayMin: 5_200, delayRange: 4_000, gestures: ['nod', 'settle'] },
  happy: { delayMin: 4_000, delayRange: 3_800, gestures: ['nod', 'look-left', 'look-right'] },
  proud: { delayMin: 5_000, delayRange: 4_200, gestures: ['settle', 'nod'] },
  shy: { delayMin: 5_200, delayRange: 4_400, gestures: ['nod', 'settle'] },
};
const ASSET_URL = `${import.meta.env.BASE_URL}xiaobai-book-boy-atlas.webp`;
const STILL_GESTURE: ActiveGesture = { name: 'still', duration: 1 };

function randomBetween(min: number, range: number) {
  return Math.round(min + Math.random() * range);
}

function usePageVisible() {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

function useNaturalGesture(mood: XiaobaiMood, enabled: boolean): ActiveGesture {
  const [gesture, setGesture] = useState<ActiveGesture>(STILL_GESTURE);
  useEffect(() => {
    let timer: number | undefined;
    let previous: GestureName = 'still';
    const profile = GESTURE_PROFILES[mood];
    const schedule = () => {
      timer = window.setTimeout(play, randomBetween(profile.delayMin, profile.delayRange));
    };
    const play = () => {
      const choices = profile.gestures.filter((name) => name !== previous);
      const name = choices[Math.floor(Math.random() * choices.length)] ?? profile.gestures[0];
      const duration = randomBetween(760, 440);
      previous = name;
      setGesture({ name, duration });
      timer = window.setTimeout(() => {
        setGesture(STILL_GESTURE);
        schedule();
      }, duration);
    };

    setGesture(STILL_GESTURE);
    if (enabled) schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, mood]);
  return gesture;
}

function spriteStyle(frame: SpriteFrame): CSSProperties {
  return {
    width: '400%',
    transform: `translate(${-frame.column * 25}%, ${-frame.row * 50}%)`,
  };
}

export function XiaobaiAvatar({
  mood,
  speaking = false,
  size = 240,
  variant = 'paper',
}: XiaobaiAvatarProps) {
  const [assetFailed, setAssetFailed] = useState(false);
  const reducedMotion = useReducedMotion();
  const pageVisible = usePageVisible();
  const normalizedMood: XiaobaiMood = Object.prototype.hasOwnProperty.call(SPRITE_FRAMES, mood)
    ? mood : 'idle';
  const motionEnabled = !reducedMotion && pageVisible;
  const gesture = useNaturalGesture(normalizedMood, motionEnabled && !speaking);
  const frame = SPRITE_FRAMES[normalizedMood];
  const gestureStyle = {
    '--gesture-duration': `${gesture.duration}ms`,
  } as CSSProperties;
  return (
    <div
      className={[styles.avatar, styles[variant]].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`小白正在${MOOD_LABELS[normalizedMood]}`}
      data-mood={normalizedMood}
      data-motion={motionEnabled ? 'active' : 'paused'}
    >
      <span className={styles.ahaBloom} aria-hidden="true" />
      <span className={styles.motion} aria-hidden="true">
        <span className={[
          motionStyles.breath,
          motionEnabled ? '' : motionStyles.paused,
        ].filter(Boolean).join(' ')}>
          <span
            className={[
              motionStyles.gesture,
              speaking && motionEnabled ? motionStyles.speaking : '',
              motionEnabled ? '' : motionStyles.paused,
            ].filter(Boolean).join(' ')}
            style={gestureStyle}
            data-gesture={gesture.name}
          >
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
        </span>
      </span>
      <span className={styles.confusedThought} aria-hidden="true">
        <span className={styles.thoughtMark}>?</span>
      </span>
      <span className={styles.ahaMarks} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
