import {
  forwardRef,
  useEffect,
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
const IDLE_REST_DELAY_MIN = 7_000;
const IDLE_REST_DELAY_RANGE = 5_000;
const IDLE_REST_DURATION = 850;
const WORKING_READ_MIN = 2_400;
const WORKING_READ_RANGE = 800;
const WORKING_THINK_DURATION = 850;

const FRAMES = {
  idle: { column: 0, row: 0 },
  rest: { column: 1, row: 0 },
  greet: { column: 2, row: 0 },
  working: { column: 0, row: 1 },
  thinking: { column: 1, row: 1 },
  explaining: { column: 2, row: 1 },
} as const satisfies Record<string, SpriteFrame>;

const STATE_LABELS: Record<XiaoyanPetState, string> = {
  idle: '随时可以帮你理思路',
  listening: '我在听',
  working: '翻材料中…',
  thinking: '让我想想…',
  explaining: '这里这样讲',
};

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

function spriteStyle(frame: SpriteFrame): CSSProperties {
  return {
    transform: `translate(${-frame.column * (100 / 3)}%, ${-frame.row * 50}%)`,
  };
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
  const [resting, setResting] = useState(false);
  const [workingAlternate, setWorkingAlternate] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [assetFailed, setAssetFailed] = useState(false);
  const resolvedState: XiaoyanPetState = Object.hasOwn(STATE_LABELS, state) ? state : 'idle';

  useEffect(() => {
    setResting(false);
    if (resolvedState !== 'idle' || reducedMotion || !pageVisible) return;
    let restTimer: number | undefined;
    let resumeTimer: number | undefined;

    const scheduleRest = () => {
      restTimer = window.setTimeout(() => {
        setResting(true);
        resumeTimer = window.setTimeout(() => {
          setResting(false);
          scheduleRest();
        }, IDLE_REST_DURATION);
      }, IDLE_REST_DELAY_MIN + Math.random() * IDLE_REST_DELAY_RANGE);
    };
    scheduleRest();

    return () => {
      if (restTimer !== undefined) window.clearTimeout(restTimer);
      if (resumeTimer !== undefined) window.clearTimeout(resumeTimer);
    };
  }, [pageVisible, reducedMotion, resolvedState]);

  useEffect(() => {
    setWorkingAlternate(false);
    if (resolvedState !== 'working' || reducedMotion || !pageVisible) return;
    let thinkTimer: number | undefined;
    let readTimer: number | undefined;
    const scheduleThought = () => {
      readTimer = window.setTimeout(() => {
        setWorkingAlternate(true);
        thinkTimer = window.setTimeout(() => {
          setWorkingAlternate(false);
          scheduleThought();
        }, WORKING_THINK_DURATION);
      }, WORKING_READ_MIN + Math.random() * WORKING_READ_RANGE);
    };
    scheduleThought();
    return () => {
      if (thinkTimer !== undefined) window.clearTimeout(thinkTimer);
      if (readTimer !== undefined) window.clearTimeout(readTimer);
    };
  }, [pageVisible, reducedMotion, resolvedState]);

  const canGreet = resolvedState === 'idle' || resolvedState === 'listening';
  const frame = engaged && canGreet
    ? FRAMES.greet
    : resolvedState === 'idle'
      ? resting ? FRAMES.rest : FRAMES.idle
      : resolvedState === 'listening'
        ? FRAMES.greet
        : resolvedState === 'working'
          ? workingAlternate ? FRAMES.thinking : FRAMES.working
          : FRAMES[resolvedState];

  const handlePointerEnter: PointerEventHandler<HTMLButtonElement> = (event) => {
    if (event.pointerType !== 'touch') setEngaged(true);
    onPointerEnter?.(event);
  };
  const handlePointerLeave: PointerEventHandler<HTMLButtonElement> = (event) => {
    setEngaged(false);
    onPointerLeave?.(event);
  };
  const handleFocus: FocusEventHandler<HTMLButtonElement> = (event) => {
    setEngaged(true);
    onFocus?.(event);
  };
  const handleBlur: FocusEventHandler<HTMLButtonElement> = (event) => {
    setEngaged(false);
    onBlur?.(event);
  };

  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      className={[s.button, className].filter(Boolean).join(' ')}
      data-state={resolvedState}
      aria-label={ariaLabel ?? `备课助教小砚，${STATE_LABELS[resolvedState]}`}
      title={title}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <span className={s.figure} aria-hidden="true">
        {assetFailed ? (
          <span className={s.fallback}><span>小砚</span><i>✶</i></span>
        ) : (
          <img
            className={s.atlas}
            src={ATLAS_URL}
            width={ATLAS_SIZE}
            height={ATLAS_SIZE}
            alt=""
            decoding="async"
            draggable={false}
            style={spriteStyle(frame)}
            onError={() => setAssetFailed(true)}
          />
        )}
      </span>
      {!suppressReply && (
        <span className={s.reply} aria-hidden="true">{STATE_LABELS[resolvedState]}</span>
      )}
    </button>
  );
});
