/**
 * 所选课程的带法卡：按小白对这门课的熟练度换一种带法。
 * 还没讲的领他学习，讲过的帮他温书，忘了的帮他想起来，被带偏的帮他改过来。
 */
import { ArrowRight, BookOpenCheck, Check, ChevronsUpDown, CircleAlert, Compass, RotateCcw } from 'lucide-react';
import type { ComponentType } from 'react';
import { Button } from '../../../../components/ui';
import type { Topic } from '../../../../types';
import { FOCUS_TAGS, type CourseFocus as Focus, type FocusAction, type FocusKind } from './data';
import s from './feynman.module.css';

const ICONS: Record<FocusKind, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  lead: Compass,
  refresh: BookOpenCheck,
  recall: RotateCcw,
  correct: CircleAlert,
};

interface Props {
  topic: Topic;
  focus: Focus;
  busy: boolean;
  onRun: (action: FocusAction) => void;
  /** 主区里能换课时：桌面在卡角放「换一门课」，手机把标题做成换课按钮 */
  onPick?: () => void;
  compact?: boolean;
}

function PointList({ title, items, done }: { title: string; items: string[]; done: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className={s.focusPoints} data-done={done || undefined}>
      <p className={s.focusPointsTitle}>{title} · {items.length}</p>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <span className={s.focusPointMark} aria-hidden="true">{done && <Check size={11} strokeWidth={2.75} />}</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CourseFocus({ topic, focus, busy, onRun, onPick, compact = false }: Props) {
  const KindIcon = ICONS[focus.kind];
  const lead = focus.kind === 'lead';

  const heading = (
    <span className={s.focusHeading}>
      <b>{topic.title}</b>
      <span>{topic.course}</span>
    </span>
  );

  return (
    <section className={s.focus} data-kind={focus.kind} aria-labelledby="feynman-focus-tag">
      <header className={s.focusHead}>
        <span id="feynman-focus-tag" className={s.focusTag}>
          <KindIcon size={14} strokeWidth={2} />
          {FOCUS_TAGS[focus.kind]}
        </span>
        {!lead && (
          <span className={s.focusMastery}>
            <span
              className={s.focusMeter}
              role="progressbar"
              aria-label={`「${topic.title}」掌握度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={focus.mastery}
            >
              <i style={{ width: `${focus.mastery}%` }} />
            </span>
            掌握 {focus.mastery}%
          </span>
        )}
        {onPick && !compact && (
          <Button variant="ghost" size="sm" className={s.focusPick} onClick={onPick}>换一门课</Button>
        )}
      </header>

      {onPick && compact ? (
        <button type="button" className={s.courseSwitch} aria-haspopup="dialog" onClick={onPick}>
          <span className={s.courseSwitchText}>
            <b>{topic.title}</b>
            <span>{topic.course}</span>
          </span>
          <span className={s.courseSwitchHint}>
            换一门
            <ChevronsUpDown size={15} strokeWidth={1.75} aria-hidden="true" />
          </span>
        </button>
      ) : heading}

      <blockquote className={s.focusVoice}>{focus.line}</blockquote>

      {lead && (
        <ol className={s.focusSteps}>
          {focus.steps.map((step, index) => (
            <li key={step.label} data-done={step.done || undefined}>
              <span className={s.focusStepNode} aria-hidden="true">
                {step.done ? <Check size={13} strokeWidth={2.5} /> : index + 1}
              </span>
              <span>
                <b>{step.label}</b>
                <small>{step.note}</small>
              </span>
            </li>
          ))}
        </ol>
      )}

      {focus.beliefs.length > 0 && (
        <ul className={s.focusBeliefs}>
          {focus.beliefs.map((belief) => (
            <li key={belief}>
              <span>小白现在以为</span>
              {belief}
            </li>
          ))}
        </ul>
      )}

      {lead ? (
        <PointList title="要讲明白的" items={focus.pending} done={false} />
      ) : (
        <div className={s.focusPointGrid}>
          <PointList title={focus.kind === 'recall' ? '上次记得的' : '他记得的'} items={focus.known} done />
          <PointList title="还没讲到的" items={focus.pending} done={false} />
        </div>
      )}

      <footer className={s.focusFoot}>
        {focus.facts.length > 0 && <p className={s.focusFacts}>{focus.facts.join(' · ')}</p>}
        <div className={s.focusActions}>
          {focus.secondary && (
            <Button variant="ghost" disabled={busy} onClick={() => onRun(focus.secondary!)}>
              {focus.secondary.label}
            </Button>
          )}
          <Button
            variant="solid"
            loading={busy && !!focus.primary.review}
            disabled={busy}
            iconRight={<ArrowRight size={16} strokeWidth={1.75} />}
            onClick={() => onRun(focus.primary)}
          >
            {focus.primary.label}
          </Button>
        </div>
      </footer>
    </section>
  );
}
