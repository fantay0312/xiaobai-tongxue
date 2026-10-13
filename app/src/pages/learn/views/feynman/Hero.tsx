/**
 * 页首：小白本人 —— 科名、学识进度、连续天数、他此刻想说的一句话，以及唯一的主按钮。
 */
import { ArrowRight, Flame, NotebookText } from 'lucide-react';
import { XiaobaiAvatar } from '../../../../components/xiaobai/XiaobaiAvatar';
import { Button, Progress } from '../../../../components/ui';
import { STAGE_META } from '../../../../engine/evolution';
import type { JourneyProgress } from '../../../../components/story/useJourneyProgress';
import type { PrimaryAction } from './data';
import s from './feynman.module.css';

interface Props {
  progress: JourneyProgress;
  primary: PrimaryAction;
  busy: boolean;
  /** 科名刚晋阶：给科名印一次落印 */
  stageUp: boolean;
  onPrimary: () => void;
  onGrowth: () => void;
}

export function Hero({ progress, primary, busy, stageUp, onPrimary, onGrowth }: Props) {
  const { stage, wisdom, board, mood, nextStageLine } = progress;
  const { streak } = board;

  let streakText = '今天开始连续';
  if (streak.days > 0) streakText = streak.activeToday ? `连续 ${streak.days} 天` : `连续 ${streak.days} 天 · 今天还没学`;

  return (
    <section className={s.hero} aria-label="小白的近况">
      <div className={s.heroFigure}>
        <div className={s.heroHalo}>
          {/* 小白画在纸上：data-story 让他的底色回到宣纸，深色皮肤里也看得清 */}
          <div className={s.heroPortrait} data-story>
            <XiaobaiAvatar mood={mood} level={stage.stage} size={128} variant="paper" />
          </div>
        </div>
        <span className={s.stageSeal} data-fresh={stageUp || undefined} aria-hidden="true">
          {stage.name}
        </span>
      </div>

      <div className={s.heroBody}>
        <div className={s.heroTop}>
          <p className={s.eyebrow}>小白 · 你的 AI 学生</p>
          <span className={s.streak} data-on={streak.activeToday || undefined}>
            <Flame size={15} strokeWidth={1.75} aria-hidden="true" />
            {streakText}
          </span>
        </div>

        <h1 className={s.heroTitle}>
          {stage.name}
          <span>{stage.description}</span>
        </h1>

        <blockquote className={s.voice}>{primary.line}</blockquote>

        <div className={s.xp}>
          <div className={s.xpHead}>
            <span>学识 · 第 {wisdom.level} 阶</span>
            <span className={s.xpCount}>{wisdom.intoLevel} / {wisdom.forNext}</span>
          </div>
          <Progress value={wisdom.intoLevel} max={wisdom.forNext} label="学识进度" className={s.xpBar} />
          <div className={s.xpFoot}>
            <span>{nextStageLine ?? '已登科进士，学成'}</span>
            {board.xpToday > 0 && <b>今日学识 +{board.xpToday}</b>}
          </div>
        </div>

        <ol className={s.stageRail} aria-label="科名五阶">
          {STAGE_META.map((meta) => (
            <li
              key={meta.stage}
              data-reached={meta.stage <= stage.stage || undefined}
              aria-current={meta.stage === stage.stage ? 'step' : undefined}
              title={meta.description}
            >
              {meta.name}
            </li>
          ))}
        </ol>

        <div className={s.heroActions}>
          <Button
            variant="solid"
            size="lg"
            loading={busy}
            iconRight={<ArrowRight size={17} strokeWidth={1.75} />}
            onClick={onPrimary}
          >
            {primary.cta}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            icon={<NotebookText size={17} strokeWidth={1.75} />}
            onClick={onGrowth}
          >
            成长册
          </Button>
        </div>
      </div>
    </section>
  );
}
