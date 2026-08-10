import { useEffect, useMemo, useRef, useState } from 'react';
import type { DemoMotionMode } from './useLearningDemo';
import s from './WorkspaceScenes.module.css';

export function DemoTypewriter({
  text,
  motionMode,
  reducedMotion,
  startDelay = 220,
}: {
  text: string;
  motionMode: DemoMotionMode;
  reducedMotion: boolean;
  startDelay?: number;
}) {
  const chars = useMemo(() => Array.from(text), [text]);
  const initialVisible = reducedMotion || motionMode === 'static' ? chars.length : 0;
  const [visible, setVisible] = useState(initialVisible);
  const visibleRef = useRef(initialVisible);

  useEffect(() => {
    if (reducedMotion || motionMode === 'static') {
      visibleRef.current = chars.length;
      setVisible(chars.length);
      return;
    }
    if (motionMode !== 'playing' || visibleRef.current >= chars.length) return;
    let timer = 0;
    const reveal = () => {
      const next = Math.min(visibleRef.current + 1, chars.length);
      visibleRef.current = next;
      setVisible(next);
      if (next < chars.length) {
        const char = chars[next] ?? '';
        timer = window.setTimeout(reveal, /[，。？！]/u.test(char) ? 86 : 26);
      }
    };
    timer = window.setTimeout(reveal, visibleRef.current === 0 ? startDelay : 26);
    return () => window.clearTimeout(timer);
  }, [chars, motionMode, reducedMotion, startDelay]);

  return (
    <>
      <span aria-hidden="true">
        {chars.slice(0, visible).join('')}
        {motionMode === 'playing' && !reducedMotion && visible < chars.length ? (
          <span className={s.caret} />
        ) : null}
      </span>
      <span className={s.srOnly}>{text}</span>
    </>
  );
}
