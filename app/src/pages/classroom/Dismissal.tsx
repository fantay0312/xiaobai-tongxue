/**
 * 下课:一个小小的收场。
 * 老师点「送小白赴考」时先看一眼这堂课讲了什么、小白临走说了什么,再迈出那一步;
 * 被判「备课不足」而提前结束时,讲桌上只落一条收场,主动作改成回去备课。
 * 小结只用课堂明面上的东西:轮次、用时、老师自己讲过的话、记下的金句数、讲退的心魔数。
 */
import { useRef, type ReactNode } from 'react';
import { Dialog as RDialog } from 'radix-ui';
import { ArrowLeft, PenLine, Route, X } from 'lucide-react';
import { Button, IconButton } from '../../components/ui';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import type { SessionMode, XiaobaiMood } from '../../types';
import { spokenDuration, type FollowState } from './lesson';
import s from './classroom.module.css';

export interface LessonSummary {
  mode: SessionMode;
  topicTitle: string;
  rounds: number;
  startedAt: string;
  digest: { lines: string[]; more: number };
  goldenCount: number;
  clearedCount: number;
  follow: FollowState;
  /** 小白临走的一句 */
  parting: string;
  level: 1 | 2 | 3 | 4 | 5;
}

function partingMood(summary: LessonSummary): XiaobaiMood {
  if (summary.rounds === 0) return 'confused';
  if (summary.follow.tone === 'glad') return 'happy';
  // 平常下课:起身作个揖
  return 'shy';
}

function SummaryBody({ summary, title, lead }: {
  summary: LessonSummary;
  title: ReactNode;
  lead: ReactNode;
}) {
  const started = Date.parse(summary.startedAt);
  const seconds = Number.isFinite(started) ? (Date.now() - started) / 1000 : 0;
  const stats: { label: string; value: string }[] = [
    { label: '讲了', value: `${summary.rounds} 轮` },
    { label: '用时', value: spokenDuration(seconds) },
  ];
  if (summary.rounds > 0) stats.push({ label: '小白', value: summary.follow.label });
  if (summary.goldenCount > 0) stats.push({ label: '记下金句', value: `${summary.goldenCount} 句` });
  if (summary.clearedCount > 0) stats.push({ label: '讲退心魔', value: `${summary.clearedCount} 处` });

  return (
    <>
      <div className={s.byeHead}>
        <div className={s.byeFigure}>
          <XiaobaiAvatar mood={partingMood(summary)} level={summary.level} size={136} variant="seat" />
        </div>
        <div className={s.byeIntro}>
          {title}
          {lead}
          <p className={s.byeSay}>{summary.parting}</p>
        </div>
      </div>
      <dl className={s.byeStats}>
        {stats.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      {summary.digest.lines.length > 0 ? (
        <div className={s.byeTaught}>
          <p>这堂课你讲了</p>
          <ol>
            {summary.digest.lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ol>
          {summary.digest.more > 0 ? <small>还有 {summary.digest.more} 段</small> : null}
        </div>
      ) : null}
    </>
  );
}

/** 老师主动下课:送考前的收场 */
export function DismissalDialog({ open, onOpenChange, container, summary, onFinish, onBackToPrep }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 挂在教室里,沿用黑板配色 */
  container: HTMLElement | null;
  summary: LessonSummary;
  onFinish: () => void;
  onBackToPrep: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const review = summary.mode === 'review';
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal container={container}>
        <RDialog.Overlay className={s.byeOverlay} />
        <RDialog.Content
          className={s.bye}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            primaryRef.current?.focus();
          }}
        >
          <RDialog.Close asChild>
            <IconButton label="再讲一会儿" tip={false} round className={s.byeClose}>
              <X size={16} strokeWidth={1.75} />
            </IconButton>
          </RDialog.Close>
          <SummaryBody
            summary={summary}
            title={<RDialog.Title className={s.byeTitle}>{review ? '温故到这儿' : '下课'}</RDialog.Title>}
            lead={(
              <RDialog.Description className={s.byeLead}>
                {summary.topicTitle}
                {review ? ' · 温故' : summary.mode === 'reteach' ? ' · 重讲验证' : ''}
              </RDialog.Description>
            )}
          />
          <footer className={s.byeActions}>
            <Button
              variant="ghost"
              pill
              className={s.byePrep}
              icon={<ArrowLeft size={16} strokeWidth={1.75} />}
              onClick={onBackToPrep}
            >
              回去备课
            </Button>
            <RDialog.Close asChild>
              <Button variant="outline" pill>再讲一会儿</Button>
            </RDialog.Close>
            <Button
              ref={primaryRef}
              variant="solid"
              size="lg"
              pill
              className={s.byePrimary}
              icon={review ? <PenLine size={17} strokeWidth={1.75} /> : <Route size={17} strokeWidth={1.75} />}
              onClick={onFinish}
            >
              {review ? '完成温故，看记录' : '送小白赴考'}
            </Button>
          </footer>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** 本轮被提前结束(备课不足):讲桌上一条收场——小白作揖,一句交代,主动作是回去备课。
    小白的收场话已经在黑板上说过,这里不再让他重复一遍。 */
export function EndedPanel({ summary, onFinish, onBackToPrep }: {
  summary: LessonSummary;
  onFinish: () => void;
  onBackToPrep: () => void;
}) {
  const review = summary.mode === 'review';
  const started = Date.parse(summary.startedAt);
  const seconds = Number.isFinite(started) ? (Date.now() - started) / 1000 : 0;
  return (
    <section className={s.endedPanel} aria-label="本轮讲解已结束">
      <div className={s.endedFigure}>
        <XiaobaiAvatar mood="shy" level={summary.level} size={96} variant="seat" />
      </div>
      <div className={s.endedText}>
        <h2 className={s.endedTitle}>这一轮先到这里</h2>
        <p className={s.endedNote}>
          卡住的地方已经记下，备好课再来一次。这堂课讲了 {summary.rounds} 轮，{spokenDuration(seconds)}。
        </p>
      </div>
      <footer className={s.endedActions}>
        <Button variant="outline" pill onClick={onFinish}>
          {review ? '查看温故记录' : '仍然送小白赴考'}
        </Button>
        <Button
          variant="solid"
          size="lg"
          pill
          className={s.byePrimary}
          icon={<ArrowLeft size={17} strokeWidth={1.75} />}
          onClick={onBackToPrep}
        >
          回去备课
        </Button>
      </footer>
    </section>
  );
}
