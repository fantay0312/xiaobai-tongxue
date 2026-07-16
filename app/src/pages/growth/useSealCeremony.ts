import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Achievement } from '../../engine/achievements';

const SEEN_SEALS_KEY = 'xiaobai-growth-seals-seen-v3';
const CEREMONY_MS = 1800;
const fallbackSeenSeals = new Set<string>();

interface PendingSeal {
  id: string;
  mark: string;
}

function sealMark(achievement: Achievement): string | null {
  return achievement.earnedAt ? `${achievement.id}@${achievement.earnedAt}` : null;
}

function readSeenSeals(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_SEALS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const stored = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    stored.forEach((mark) => fallbackSeenSeals.add(mark));
    return new Set(fallbackSeenSeals);
  } catch {
    return new Set(fallbackSeenSeals);
  }
}

function writeSeenSeals(marks: Set<string>): void {
  marks.forEach((mark) => fallbackSeenSeals.add(mark));
  try {
    localStorage.setItem(SEEN_SEALS_KEY, JSON.stringify([...fallbackSeenSeals].slice(-128)));
  } catch {
    // 受限存储下仍由当前挂载周期的内存集合完成去重。
  }
}

function isSealVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const safeTop = Math.min(112, window.innerHeight * 0.18);
  return rect.top >= safeTop && rect.bottom <= window.innerHeight * 0.94
    && rect.right > 0 && rect.left < window.innerWidth;
}

export function useSealCeremony(achievements: Achievement[]) {
  const [queue, setQueue] = useState<PendingSeal[]>([]);
  const [celebrating, setCelebrating] = useState<PendingSeal | null>(null);
  const previousMarksRef = useRef<Set<string> | null>(null);
  const currentMarksRef = useRef(new Set<string>());
  const seenMarksRef = useRef<Set<string> | null>(null);
  const hasObservedEarnedRef = useRef(false);
  const startingMarkRef = useRef<string | null>(null);
  if (!seenMarksRef.current) seenMarksRef.current = readSeenSeals();
  if (seenMarksRef.current.size > 0) hasObservedEarnedRef.current = true;

  useLayoutEffect(() => {
    const earned = achievements.filter((item) => item.earnedAt !== null);
    const currentMarks = new Set(earned.map(sealMark).filter((mark): mark is string => mark !== null));
    const baseline = new Set([...(previousMarksRef.current ?? []), ...(seenMarksRef.current ?? [])]);
    let newlyEarned = earned.flatMap((item) => {
      const mark = sealMark(item);
      return mark && !baseline.has(mark) ? [{ id: item.id, mark }] : [];
    });

    if (!hasObservedEarnedRef.current && newlyEarned.length > 1) {
      const earnedAtById = new Map(earned.map((item) => [item.id, item.earnedAt ?? '']));
      const newest = newlyEarned.reduce((latest, item) => (
        (earnedAtById.get(item.id) ?? '') >= (earnedAtById.get(latest.id) ?? '') ? item : latest
      ));
      const historical = newlyEarned.filter((item) => item.mark !== newest.mark);
      historical.forEach((item) => seenMarksRef.current?.add(item.mark));
      if (seenMarksRef.current) writeSeenSeals(seenMarksRef.current);
      newlyEarned = [newest];
    }

    currentMarksRef.current = currentMarks;
    previousMarksRef.current = currentMarks;
    if (earned.length > 0) hasObservedEarnedRef.current = true;
    if (celebrating && !currentMarks.has(celebrating.mark)) {
      startingMarkRef.current = null;
      setCelebrating(null);
    }
    setQueue((current) => {
      const retained = current.filter((item) => currentMarks.has(item.mark));
      const queuedMarks = new Set(retained.map((item) => item.mark));
      const additions = newlyEarned.filter((item) => !queuedMarks.has(item.mark));
      return additions.length > 0 || retained.length !== current.length ? [...retained, ...additions] : current;
    });
  }, [achievements, celebrating]);

  useLayoutEffect(() => {
    if (queue.length === 0 && !celebrating) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      queue.forEach((item) => seenMarksRef.current?.add(item.mark));
      if (celebrating) seenMarksRef.current?.add(celebrating.mark);
      if (seenMarksRef.current) writeSeenSeals(seenMarksRef.current);
      startingMarkRef.current = null;
      setQueue([]);
      setCelebrating(null);
      return undefined;
    }
    if (celebrating || startingMarkRef.current) return undefined;
    const candidates = queue.flatMap((item) => {
      const element = document.getElementById(`achievement-${item.id}`);
      return element ? [{ element, item }] : [];
    });
    if (candidates.length === 0) return undefined;

    const start = (next: PendingSeal) => {
      if (startingMarkRef.current) return;
      startingMarkRef.current = next.mark;
      seenMarksRef.current?.add(next.mark);
      if (seenMarksRef.current) writeSeenSeals(seenMarksRef.current);
      setQueue((current) => current.filter((item) => item.mark !== next.mark));
      setCelebrating(next);
    };
    const visible = candidates.find(({ element }) => isSealVisible(element));
    if (visible) {
      start(visible.item);
      return undefined;
    }
    let animationFrame: number | null = null;
    const checkVisibleCandidates = () => {
      animationFrame = null;
      const match = candidates.find(({ element }) => isSealVisible(element));
      if (match) start(match.item);
    };
    const scheduleCheck = () => {
      if (animationFrame === null) animationFrame = window.requestAnimationFrame(checkVisibleCandidates);
    };
    const observer = 'IntersectionObserver' in window
      ? new IntersectionObserver(scheduleCheck, { threshold: [0, 0.35, 0.7, 1] })
      : null;
    candidates.forEach(({ element }) => observer?.observe(element));
    window.addEventListener('scroll', scheduleCheck, { passive: true });
    window.addEventListener('resize', scheduleCheck);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', scheduleCheck);
      window.removeEventListener('resize', scheduleCheck);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [celebrating, queue]);

  useEffect(() => {
    if (!celebrating) return undefined;
    const timer = window.setTimeout(() => {
      startingMarkRef.current = null;
      setCelebrating(null);
    }, CEREMONY_MS);
    return () => window.clearTimeout(timer);
  }, [celebrating]);

  const pendingIds = useMemo(
    () => new Set([...queue.map((item) => item.id), ...(celebrating ? [celebrating.id] : [])]),
    [celebrating, queue],
  );
  return { celebratingId: celebrating?.id ?? null, pendingIds };
}
