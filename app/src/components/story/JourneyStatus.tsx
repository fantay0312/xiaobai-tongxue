/**
 * 师徒进度卡 —— 侧栏底部常驻的一张小卡：小白的科名、学识进度、连续学习天数、今日课业。
 * 数字全部来自 useJourneyProgress 的事件流派生；点开进入「教小白」。
 */
import { useNavigate } from 'react-router';
import { ChevronRight, CircleCheck, Flame, Target } from 'lucide-react';
import { XiaobaiAvatar } from '../xiaobai/XiaobaiAvatar';
import { useJourneyProgress } from './useJourneyProgress';
import s from './journeyStatus.module.css';

export function JourneyStatusCard({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  const navigate = useNavigate();
  const { stage, wisdom, board, mood } = useJourneyProgress();
  const { streak } = board;

  const ratio = wisdom.forNext > 0 ? Math.min(1, wisdom.intoLevel / wisdom.forNext) : 0;
  const allDone = board.total > 0 && board.done === board.total;
  const streakText = streak.days > 0 ? `连续 ${streak.days} 天` : '还没开始连续';
  const label = `小白 · ${stage.name}，学识第 ${wisdom.level} 阶 ${wisdom.intoLevel}/${wisdom.forNext}，${streakText}，今日课业 ${board.done}/${board.total}。打开教小白`;

  const open = () => {
    if (onOpen) onOpen();
    else navigate('/learn?view=feynman');
  };

  const bar = (
    <span
      className={s.track}
      role="progressbar"
      aria-label="学识进度"
      aria-valuemin={0}
      aria-valuemax={wisdom.forNext}
      aria-valuenow={wisdom.intoLevel}
    >
      <i style={{ width: `${Math.max(ratio * 100, wisdom.intoLevel > 0 ? 6 : 0)}%` }} />
    </span>
  );

  const streakChip = (
    <span className={s.chip} data-on={streak.activeToday || undefined} title={streak.activeToday ? streakText : `${streakText}，今天还没学`}>
      <Flame size={14} strokeWidth={1.75} aria-hidden="true" />
      <b>{streak.days}</b>
      {!compact && <span>天连续</span>}
    </span>
  );

  const questChip = (
    <span className={s.chip} data-done={allDone || undefined} title={`今日课业 ${board.done}/${board.total}`}>
      {allDone
        ? <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
        : <Target size={14} strokeWidth={1.75} aria-hidden="true" />}
      <b>{board.done}/{board.total}</b>
      {!compact && <span>今日课业</span>}
    </span>
  );

  if (compact) {
    return (
      <button type="button" className={`${s.card} ${s.compact}`} onClick={open} aria-label={label}>
        <span className={s.face} data-story aria-hidden="true">
          <XiaobaiAvatar mood={mood} level={stage.stage} size={30} variant="paper" />
        </span>
        <span className={s.main}>
          <span className={s.nameRow}>
            <b className={s.stage}>{stage.name}</b>
            <span className={s.level}>学识 {wisdom.level} 阶</span>
          </span>
          {bar}
        </span>
        {streakChip}
        {questChip}
      </button>
    );
  }

  return (
    <button type="button" className={s.card} onClick={open} aria-label={label}>
      <span className={s.head}>
        <span className={s.face} data-story aria-hidden="true">
          <XiaobaiAvatar mood={mood} level={stage.stage} size={40} variant="paper" />
        </span>
        <span className={s.main}>
          <span className={s.nameRow}>
            <b className={s.stage}>小白 · {stage.name}</b>
          </span>
          <span className={s.level}>{stage.description} · 学识第 {wisdom.level} 阶</span>
        </span>
        <ChevronRight className={s.go} size={16} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className={s.barRow}>
        {bar}
        <span className={s.count}>{wisdom.intoLevel}/{wisdom.forNext}</span>
      </span>
      <span className={s.foot}>
        {streakChip}
        {questChip}
      </span>
    </button>
  );
}
