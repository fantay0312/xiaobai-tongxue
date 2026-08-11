import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { LEARNING_STAGES } from './landingData';

type PlaybackIntent = 'playing' | 'paused' | 'finished';
export type DemoMotionMode = 'playing' | 'paused' | 'static';
const PLAYBACK_VISIBILITY_THRESHOLD = 0.18;

function readReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

function useInViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(
        entry?.isIntersecting && entry.intersectionRatio >= PLAYBACK_VISIBILITY_THRESHOLD,
      )),
      { threshold: PLAYBACK_VISIBILITY_THRESHOLD },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}

interface PlaybackState {
  activeIndex: number;
  effectivePlaying: boolean;
  remaining: MutableRefObject<number>;
  replayEpoch: number;
  timerEpoch: MutableRefObject<number>;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  setIntent: Dispatch<SetStateAction<PlaybackIntent>>;
  setStaticView: Dispatch<SetStateAction<boolean>>;
}

function saveRemainingTime(
  remaining: MutableRefObject<number>,
  timerEpoch: MutableRefObject<number>,
  expectedEpoch: number,
  startedAt: number,
) {
  if (expectedEpoch !== timerEpoch.current) return;
  remaining.current = Math.max(
    240,
    remaining.current - (performance.now() - startedAt),
  );
}

function useStageTimer(state: PlaybackState) {
  const {
    activeIndex,
    effectivePlaying,
    remaining,
    replayEpoch,
    timerEpoch,
    setActiveIndex,
    setIntent,
    setStaticView,
  } = state;
  useEffect(() => {
    if (!effectivePlaying) return;
    const startedAt = performance.now();
    const expectedEpoch = timerEpoch.current;
    let completed = false;
    const timer = window.setTimeout(() => {
      if (expectedEpoch !== timerEpoch.current) return;
      completed = true;
      if (activeIndex >= LEARNING_STAGES.length - 1) {
        setIntent('finished');
        return;
      }
      const next = activeIndex + 1;
      remaining.current = LEARNING_STAGES[next]?.dwellMs ?? 5600;
      setStaticView(false);
      setActiveIndex(next);
    }, remaining.current);
    return () => {
      window.clearTimeout(timer);
      if (!completed) saveRemainingTime(remaining, timerEpoch, expectedEpoch, startedAt);
    };
  }, [
    activeIndex,
    effectivePlaying,
    remaining,
    replayEpoch,
    timerEpoch,
    setActiveIndex,
    setIntent,
    setStaticView,
  ]);
}

function usePlaybackActions(
  activeIndex: number,
  intent: PlaybackIntent,
  reducedMotion: boolean,
  remaining: MutableRefObject<number>,
  timerEpoch: MutableRefObject<number>,
  setActiveIndex: Dispatch<SetStateAction<number>>,
  setIntent: Dispatch<SetStateAction<PlaybackIntent>>,
  setStaticView: Dispatch<SetStateAction<boolean>>,
  setReplayEpoch: Dispatch<SetStateAction<number>>,
) {
  const selectStage = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(LEARNING_STAGES.length - 1, index));
    timerEpoch.current += 1;
    remaining.current = LEARNING_STAGES[bounded]?.dwellMs ?? 5600;
    setStaticView(false);
    setActiveIndex(bounded);
    setReplayEpoch((epoch) => epoch + 1);
    setIntent(reducedMotion ? 'paused' : 'playing');
  }, [reducedMotion, remaining, setActiveIndex, setIntent, setReplayEpoch, setStaticView, timerEpoch]);
  const pausePlayback = useCallback(() => {
    setIntent('paused');
  }, [setIntent]);
  const togglePlayback = useCallback(() => {
    if (reducedMotion) return;
    if (intent === 'finished') {
      timerEpoch.current += 1;
      remaining.current = LEARNING_STAGES[0]?.dwellMs ?? 5600;
      setStaticView(false);
      setActiveIndex(0);
      setReplayEpoch((epoch) => epoch + 1);
      setIntent('playing');
      return;
    }
    if (intent === 'playing') {
      setIntent('paused');
      return;
    }
    setStaticView(false);
    setIntent('playing');
  }, [
    intent,
    reducedMotion,
    remaining,
    setActiveIndex,
    setIntent,
    setReplayEpoch,
    setStaticView,
    timerEpoch,
  ]);
  const nextStage = useCallback(() => {
    selectStage((activeIndex + 1) % LEARNING_STAGES.length);
  }, [activeIndex, selectStage]);
  return { nextStage, pausePlayback, selectStage, togglePlayback };
}

export function useLearningDemo(workspaceRef: RefObject<HTMLElement | null>) {
  const reducedMotion = useReducedMotion();
  const pageVisible = usePageVisible();
  const inViewport = useInViewport(workspaceRef);
  const [activeIndex, setActiveIndex] = useState(0);
  const [intent, setIntent] = useState<PlaybackIntent>(() =>
    readReducedMotion() ? 'paused' : 'playing');
  const [staticView, setStaticView] = useState(false);
  const [replayEpoch, setReplayEpoch] = useState(0);
  const remaining = useRef(LEARNING_STAGES[0]?.dwellMs ?? 5600);
  const timerEpoch = useRef(0);
  useEffect(() => {
    if (reducedMotion) setIntent('paused');
  }, [reducedMotion]);
  const effectivePlaying = intent === 'playing' && pageVisible && inViewport && !reducedMotion;
  useStageTimer({
    activeIndex,
    effectivePlaying,
    remaining,
    replayEpoch,
    timerEpoch,
    setActiveIndex,
    setIntent,
    setStaticView,
  });
  const actions = usePlaybackActions(
    activeIndex,
    intent,
    reducedMotion,
    remaining,
    timerEpoch,
    setActiveIndex,
    setIntent,
    setStaticView,
    setReplayEpoch,
  );
  const motionMode: DemoMotionMode = reducedMotion || intent === 'finished' || staticView
    ? 'static'
    : effectivePlaying ? 'playing' : 'paused';
  return {
    activeIndex,
    effectivePlaying,
    finished: intent === 'finished',
    intent,
    motionMode,
    replayEpoch,
    reducedMotion,
    ...actions,
  };
}
