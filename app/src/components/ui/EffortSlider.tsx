/** 思考强度滑杆：粗轨、圆点分档、白色大拇指，参考 Codex / DeepStudent 的模型强度调节。 */
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import s from './modelPicker.module.css';

export function EffortSlider({ value, onChange, labels, ariaLabel = '思考强度', disabled }: {
  /** 当前档位下标 */
  value: number;
  onChange: (index: number) => void;
  /** 每一档的名称，长度即档数 */
  labels: string[];
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(0, labels.length - 1);
  const current = Math.min(max, Math.max(0, value));
  const pick = (clientX: number) => {
    const node = ref.current;
    if (!node || !max) return;
    const rect = node.getBoundingClientRect();
    const inset = rect.height / 2;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - inset) / Math.max(1, rect.width - inset * 2)));
    const next = Math.round(ratio * max);
    if (next !== current) onChange(next);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pick(event.clientX);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) pick(event.clientX);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? current + 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? current - 1
        : event.key === 'Home' ? 0 : event.key === 'End' ? max : null;
    if (next === null) return;
    event.preventDefault();
    const clamped = Math.min(max, Math.max(0, next));
    if (clamped !== current) onChange(clamped);
  };
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={current}
      aria-valuetext={labels[current]}
      aria-disabled={disabled || undefined}
      className={s.effort}
      style={{ '--p': max ? current / max : 0 } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <div className={s.effortFill} aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
      {labels.map((label, index) => (
        <span key={label + index} className={s.effortStop} data-on={index <= current || undefined} style={{ '--i': max ? index / max : 0 } as CSSProperties} aria-hidden="true" />
      ))}
      <div className={s.effortThumb} aria-hidden="true" />
    </div>
  );
}
