import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type FocusEventHandler,
  type PointerEventHandler,
} from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import s from './XiaoyanPet.module.css';

export type XiaoyanPetState = 'idle' | 'listening' | 'working' | 'thinking' | 'explaining';

export interface XiaoyanPetProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  state: XiaoyanPetState;
  suppressReply?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

interface SpriteFrame {
  column: 0 | 1 | 2;
  row: 0 | 1;
}

const ATLAS_URL = `${import.meta.env.BASE_URL}xiaoyan-prep-coach-atlas.webp`;
const ATLAS_SIZE = 1254;
const IDLE_REST_TIMING = [[7_000, 5_000], [620, 480]] as const;
const WORKING_THOUGHT_TIMING = [[2_700, 1_900], [900, 550]] as const;
const GREET_DURATION = 620;

const FRAMES = {
  idle: { column: 0, row: 0 },
  rest: { column: 1, row: 0 },
  greet: { column: 2, row: 0 },
  working: { column: 0, row: 1 },
  thinking: { column: 1, row: 1 },
  explaining: { column: 2, row: 1 },
} as const satisfies Record<string, SpriteFrame>;

type FrameName = keyof typeof FRAMES;
type MotionCue =
  | 'still' | 'greet' | 'look-left' | 'look-right' | 'settle' | 'nod'
  | 'listen-in' | 'read-scan' | 'page-settle' | 'ponder'
  | 'explain-a' | 'explain-b';

interface MotionMoment { cue: MotionCue; duration: number; durationRange: number; }
interface MotionProfile { delay: number; delayRange: number; moments: readonly MotionMoment[]; }
interface ActiveMotion { cue: MotionCue; duration: number; }

const STATE_LABELS: Record<XiaoyanPetState, string> = {
  idle: '随时可以帮你理思路',
  listening: '我在听',
  working: '翻材料中…',
  thinking: '让我想想…',
  explaining: '这里这样讲',
};

const MOTION_PROFILES = {
  idle: { delay: 2_400, delayRange: 4_200, moments: [
    { cue: 'look-left', duration: 1_050, durationRange: 350 },
    { cue: 'look-right', duration: 1_050, durationRange: 350 },
    { cue: 'settle', duration: 850, durationRange: 350 },
  ] },
  listening: {
    delay: 2_500, delayRange: 2_500, moments: [
      { cue: 'nod', duration: 780, durationRange: 240 },
      { cue: 'listen-in', duration: 1_050, durationRange: 350 },
      { cue: 'look-left', duration: 950, durationRange: 300 },
      { cue: 'look-right', duration: 950, durationRange: 300 },
    ],
  },
  working: { delay: 1_300, delayRange: 2_000, moments: [
    { cue: 'read-scan', duration: 1_200, durationRange: 400 },
    { cue: 'page-settle', duration: 900, durationRange: 300 },
    { cue: 'ponder', duration: 1_100, durationRange: 350 },
  ] },
  thinking: {
    delay: 1_400, delayRange: 2_200, moments: [
      { cue: 'ponder', duration: 1_200, durationRange: 400 },
      { cue: 'nod', duration: 850, durationRange: 250 },
      { cue: 'look-left', duration: 1_050, durationRange: 300 },
      { cue: 'look-right', duration: 1_050, durationRange: 300 },
    ],
  },
  explaining: { delay: 2_500, delayRange: 2_500, moments: [
    { cue: 'explain-a', duration: 900, durationRange: 250 },
    { cue: 'explain-b', duration: 1_050, durationRange: 350 },
    { cue: 'nod', duration: 800, durationRange: 220 },
  ] },
} as const satisfies Record<XiaoyanPetState, MotionProfile>;

const STILL_MOTION: ActiveMotion = { cue: 'still', duration: 1 };

function randomDuration(base: number, range: number) {
  return Math.round(base + Math.random() * range);
}

function pickMotion(profile: MotionProfile, previous: MotionCue): MotionMoment {
  const choices = profile.moments.filter(({ cue }) => cue !== previous);
  return choices[Math.floor(Math.random() * choices.length)] ?? profile.moments[0];
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

function useNaturalMotion(
  state: XiaoyanPetState,
  enabled: boolean,
  engaged: boolean,
): ActiveMotion {
  const [motion, setMotion] = useState<ActiveMotion>(STILL_MOTION);
  const previousCue = useRef<MotionCue>('still');

  useEffect(() => {
    let timer: number | undefined;
    setMotion(STILL_MOTION);
    if (!enabled) return;
    if (engaged) {
      setMotion({ cue: 'greet', duration: GREET_DURATION });
      return;
    }

    const profile = MOTION_PROFILES[state];
    const schedule = () => {
      timer = window.setTimeout(play, randomDuration(profile.delay, profile.delayRange));
    };
    const play = () => {
      const moment = pickMotion(profile, previousCue.current);
      const duration = randomDuration(moment.duration, moment.durationRange);
      previousCue.current = moment.cue;
      setMotion({ cue: moment.cue, duration });
      timer = window.setTimeout(() => {
        setMotion(STILL_MOTION);
        schedule();
      }, duration);
    };

    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, engaged, state]);

  return motion;
}

function useTimedAlternate(
  enabled: boolean,
  timing: readonly [readonly [number, number], readonly [number, number]],
) {
  const [alternate, setAlternate] = useState(false);
  useEffect(() => {
    setAlternate(false);
    if (!enabled) return;
    let timer: number | undefined;
    const [[pauseMin, pauseRange], [activeMin, activeRange]] = timing;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setAlternate(true);
        timer = window.setTimeout(() => {
          setAlternate(false);
          schedule();
        }, randomDuration(activeMin, activeRange));
      }, randomDuration(pauseMin, pauseRange));
    };
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, timing]);
  return alternate;
}

function spriteStyle(frame: SpriteFrame): CSSProperties {
  return {
    transform: `translate(${-frame.column * (100 / 3)}%, ${-frame.row * 50}%)`,
  };
}

function resolveFrameName(
  state: XiaoyanPetState,
  engaged: boolean,
  resting: boolean,
  workingAlternate: boolean,
): FrameName {
  if (engaged && (state === 'idle' || state === 'listening')) return 'greet';
  if (state === 'idle') return resting ? 'rest' : 'idle';
  if (state === 'listening') return 'greet';
  if (state === 'working') return workingAlternate ? 'thinking' : 'working';
  return state;
}

export const XiaoyanPet = forwardRef<HTMLButtonElement, XiaoyanPetProps>(function XiaoyanPet({
  state,
  suppressReply = false,
  className,
  type = 'button',
  title = '小砚 · 备课助教',
  'aria-label': ariaLabel,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  ...buttonProps
}, ref) {
  const reducedMotion = useReducedMotion();
  const pageVisible = usePageVisible();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const resolvedState: XiaoyanPetState = Object.hasOwn(STATE_LABELS, state) ? state : 'idle';

  const motionEnabled = !reducedMotion && pageVisible;
  const engaged = hovered || focused;
  const resting = useTimedAlternate(
    motionEnabled && resolvedState === 'idle',
    IDLE_REST_TIMING,
  );
  const workingAlternate = useTimedAlternate(
    motionEnabled && resolvedState === 'working',
    WORKING_THOUGHT_TIMING,
  );
  const motion = useNaturalMotion(resolvedState, motionEnabled, engaged);
  const frameName = resolveFrameName(resolvedState, engaged, resting, workingAlternate);
  const motionStyle = { '--motion-duration': `${motion.duration}ms` } as CSSProperties;

  const handlePointerEnter: PointerEventHandler<HTMLButtonElement> = (event) => {
    if (event.pointerType !== 'touch') setHovered(true);
    onPointerEnter?.(event);
  };
  const handlePointerLeave: PointerEventHandler<HTMLButtonElement> = (event) => {
    setHovered(false);
    onPointerLeave?.(event);
  };
  const handleFocus: FocusEventHandler<HTMLButtonElement> = (event) => {
    setFocused(event.currentTarget.matches(':focus-visible'));
    onFocus?.(event);
  };
  const handleBlur: FocusEventHandler<HTMLButtonElement> = (event) => {
    setFocused(false);
    onBlur?.(event);
  };

  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      className={[s.button, className].filter(Boolean).join(' ')}
      data-state={resolvedState}
      data-motion-active={motionEnabled}
      aria-label={ariaLabel ?? `备课助教小砚，${STATE_LABELS[resolvedState]}`}
      title={title}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <span className={s.figure} data-motion={motion.cue} style={motionStyle} aria-hidden="true">
        <span className={s.body}>
          {assetFailed ? (
            <span className={s.fallback}><span>小砚</span><i>✶</i></span>
          ) : (
            <span key={frameName} className={s.pose}>
              <img
                className={s.atlas}
                src={ATLAS_URL}
                width={ATLAS_SIZE}
                height={ATLAS_SIZE}
                alt=""
                decoding="async"
                draggable={false}
                style={spriteStyle(FRAMES[frameName])}
                onError={() => setAssetFailed(true)}
              />
            </span>
          )}
        </span>
      </span>
      {!suppressReply && (
        <span className={s.reply} aria-hidden="true">{STATE_LABELS[resolvedState]}</span>
      )}
    </button>
  );
});
