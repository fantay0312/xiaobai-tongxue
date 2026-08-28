import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { Icon } from '../../components/ui/Icon';
import { LEARNING_STAGES, type LearningStage } from './landingData';
import s from './LearningWorkspace.module.css';

interface PlaybackHeaderProps {
  stage: LearningStage;
  intent: 'playing' | 'paused' | 'finished';
  finished: boolean;
  reducedMotion: boolean;
  onNext: () => void;
  onToggle: () => void;
}

export function PlaybackHeader(props: PlaybackHeaderProps) {
  const label = props.reducedMotion
    ? '已按系统设置暂停动态演示'
    : props.finished
    ? '重新播放六阶段演示'
    : props.intent === 'playing' ? '暂停六阶段演示' : '继续六阶段演示';
  const atLastStage = props.stage.id === 'reteach';
  const nextLabel = atLastStage ? '从头查看演示' : '查看下一阶段';
  return (
    <header className={s.demoHeader}>
      <div>
        <span>《Token 与分词》演示回放</span>
        <strong>{props.stage.step} / 06 · {props.stage.title}</strong>
      </div>
      <div className={s.playbackControls}>
        <button
          type="button"
          onClick={props.onToggle}
          disabled={props.reducedMotion}
          aria-label={label}
          title={props.reducedMotion ? '系统已开启减少动态效果，可用下一步查看' : undefined}
        >
          <Icon name={props.finished || props.intent !== 'playing' ? 'play' : 'pause'} size={15} />
          {props.reducedMotion
            ? '已暂停'
            : props.finished ? '重播' : props.intent === 'playing' ? '暂停' : '继续'}
        </button>
        <button type="button" onClick={props.onNext} aria-label={nextLabel}>
          {atLastStage ? '从头看' : '下一步'} <Icon name="chevron-right" size={15} />
        </button>
      </div>
    </header>
  );
}

function stageIndexForKey(key: string, index: number): number | null {
  const count = LEARNING_STAGES.length;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

interface StageTabsProps {
  activeIndex: number;
  effectivePlaying: boolean;
  finished: boolean;
  onChoose: (index: number, focus?: boolean) => void;
  onPause: () => void;
}

function revealActiveTab(tabs: Array<HTMLButtonElement | null>, index: number) {
  const tab = tabs[index];
  const scroller = tab?.parentElement;
  if (!tab || !scroller) return;
  const hiddenLeft = tab.offsetLeft < scroller.scrollLeft;
  const hiddenRight = tab.offsetLeft + tab.offsetWidth > scroller.scrollLeft + scroller.clientWidth;
  if (!hiddenLeft && !hiddenRight) return;
  const left = tab.offsetLeft - (scroller.clientWidth - tab.offsetWidth) / 2;
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  scroller.scrollTo({ left: Math.max(0, left), behavior });
}

export function StageTabs(props: StageTabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => revealActiveTab(refs.current, props.activeIndex), [props.activeIndex]);
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = stageIndexForKey(event.key, index);
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    props.onChoose(next, true);
  };
  return (
    <div className={s.stageTabs} role="tablist" aria-label="一堂课的六个步骤">
      {LEARNING_STAGES.map((stage, index) => {
        const active = index === props.activeIndex;
        return (
          <button
            className={[
              s.stageTab,
              active ? s.stageTabActive : '',
              active && props.effectivePlaying ? s.stageTabPlaying : '',
              active && props.finished ? s.stageTabFinished : '',
            ].filter(Boolean).join(' ')}
            id={`learning-stage-${stage.id}`}
            key={stage.id}
            ref={(node) => { refs.current[index] = node; }}
            role="tab"
            type="button"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            aria-controls="learning-workspace-panel"
            style={{ '--stage-duration': `${stage.dwellMs}ms` } as CSSProperties}
            onClick={() => props.onChoose(index)}
            onFocus={props.onPause}
            onKeyDown={(event) => handleKey(event, index)}
          >
            <span className={s.stageNumber}>{stage.step}</span>
            <strong>{stage.title}</strong>
          </button>
        );
      })}
    </div>
  );
}
