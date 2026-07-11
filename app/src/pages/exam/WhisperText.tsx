import { useEffect, useMemo, useRef, useState } from 'react';
import s from './examQuestion.module.css';

export function WhisperText({
  text, mode, durationMs, reducedMotion, onDone,
}: {
  text: string;
  mode: 'hidden' | 'typing' | 'complete';
  durationMs: number;
  reducedMotion: boolean;
  onDone: () => void;
}) {
  const chars = useMemo(() => Array.from(text), [text]);
  const [visible, setVisible] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (mode === 'hidden') {
      setVisible(0);
      return;
    }
    if (mode === 'complete') {
      setVisible(chars.length);
      return;
    }
    if (reducedMotion) {
      setVisible(chars.length);
      const doneTimer = window.setTimeout(() => doneRef.current(), 0);
      return () => window.clearTimeout(doneTimer);
    }

    const weight = (char: string) => char === '…' ? 3 : /[，。！？；]/u.test(char) ? 1.8 : 1;
    const unit = durationMs / Math.max(1, chars.reduce((sum, char) => sum + weight(char), 0));
    let index = 0;
    let timer = 0;
    setVisible(0);

    const revealNext = () => {
      index += 1;
      setVisible(index);
      if (index >= chars.length) {
        timer = window.setTimeout(() => doneRef.current(), 280);
        return;
      }
      timer = window.setTimeout(revealNext, Math.max(28, unit * weight(chars[index])));
    };
    timer = window.setTimeout(revealNext, Math.max(28, unit * weight(chars[0] ?? '')));
    return () => window.clearTimeout(timer);
  }, [chars, durationMs, mode, reducedMotion]);

  return (
    <>
      {chars.slice(0, visible).join('')}
      {mode === 'typing' ? <span className={s.caret} aria-hidden="true" /> : null}
    </>
  );
}
