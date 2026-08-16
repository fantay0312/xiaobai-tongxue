import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Persona } from '../../types';
import styles from './PersonaPicker.module.css';

interface PersonaPickerProps {
  value: Persona;
  onChange: (persona: Persona) => void;
}

interface PersonaOption {
  name: Persona;
  line: string;
}

const PERSONAS: readonly PersonaOption[] = [
  { name: '好奇型', line: '「哇，为什么会这样？然后呢然后呢？」' },
  { name: '严谨型', line: '「等等，这个说法有依据吗？边界在哪儿？」' },
  { name: '杠精型', line: '「我不信。你要是对的，这段代码怎么解释？」' },
];

const wrapIndex = (index: number): number =>
  (index + PERSONAS.length) % PERSONAS.length;

export function PersonaPicker({ value, onChange }: PersonaPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestedFocusRef = useRef<number | null>(null);
  const baseId = useId();
  const menuId = `${baseId}-persona-menu`;
  const menuLabelId = `${baseId}-persona-label`;
  const selectedIndex = PERSONAS.findIndex((option) => option.name === value);
  const selected = PERSONAS[selectedIndex] ?? PERSONAS[0];

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => {
      const requestedIndex = requestedFocusRef.current;
      requestedFocusRef.current = null;
      optionRefs.current[requestedIndex ?? Math.max(0, selectedIndex)]?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => document.removeEventListener('pointerdown', dismissOutside, true);
  }, [open]);

  const focusOption = (index: number) => {
    optionRefs.current[wrapIndex(index)]?.focus();
  };

  const closeAndFocusTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const selectPersona = (persona: Persona) => {
    onChange(persona);
    closeAndFocusTrigger();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    requestedFocusRef.current = event.key === 'ArrowDown' || event.key === 'Home'
      ? 0
      : PERSONAS.length - 1;
    setOpen(true);
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectPersona(PERSONAS[index].name);
      return;
    }
    const nextIndex = event.key === 'ArrowDown' || event.key === 'ArrowRight'
      ? index + 1
      : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
        ? index - 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? PERSONAS.length - 1
            : null;
    if (nextIndex === null) return;
    event.preventDefault();
    focusOption(nextIndex);
  };

  return (
    <div
      ref={rootRef}
      className={styles.picker}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          closeAndFocusTrigger();
        }
      }}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && !event.currentTarget.contains(nextTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={`性情，当前${value}，点击更换小白的问法`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          requestedFocusRef.current = null;
          setOpen((current) => !current);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={styles.triggerCopy}>
          <span className={styles.triggerLabel}>性情 · 可更换</span>
          <strong>{value}</strong>
          <span className={styles.triggerLine}>{selected.line}</span>
        </span>
        <span className={open ? `${styles.arrow} ${styles.arrowOpen}` : styles.arrow} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.menu}>
          <p id={menuLabelId} className={styles.menuLabel}>换一种追问的性情</p>
          <div id={menuId} className={styles.menuList} role="listbox" aria-labelledby={menuLabelId}>
            {PERSONAS.map((option, index) => {
              const active = option.name === value;
              return (
                <button
                  key={option.name}
                  ref={(node) => { optionRefs.current[index] = node; }}
                  id={`${baseId}-persona-${index}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  tabIndex={-1}
                  className={active ? `${styles.option} ${styles.optionSelected}` : styles.option}
                  onClick={() => selectPersona(option.name)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                >
                  <span className={styles.optionHead}>
                    <strong>{option.name}</strong>
                    {active && <span className={styles.currentMark} aria-hidden="true">现用</span>}
                  </span>
                  <span className={styles.optionLine}>{option.line}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <span className={styles.liveStatus} aria-live="polite">当前性情：{value}</span>
    </div>
  );
}
