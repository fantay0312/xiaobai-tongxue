import { useEffect, useRef } from 'react';
import { Check, Circle, Play, RotateCw, Square, Trash2 } from 'lucide-react';
import { Badge, Button, IconButton, Progress } from '../../../../components/ui';
import { hasPendingAutoContinue, type AgentRun, type ProducedItem } from '../../../../engine/agent';
import { ProducedChips, Timeline } from './Timeline';
import { STATUS_META, clockTime, dayTime, goalProgress, tokenText } from './format';
import s from './agent.module.css';

interface Props {
  run: AgentRun;
  onStop: () => void;
  onContinue: () => void;
  onRerun: () => void;
  onDelete: () => void;
  onOpen: (item: ProducedItem) => void;
}

export function RunDetail({ run, onStop, onContinue, onRerun, onDelete, onOpen }: Props) {
  const status = STATUS_META[run.status];
  const progress = goalProgress(run);
  const running = run.status === 'running';
  const autoPending = run.status === 'paused' && hasPendingAutoContinue(run.id);
  const canContinue = run.mode === 'model' && (run.status === 'paused' || run.status === 'stopped' || run.status === 'error');

  // 运行中且用户停在底部时，跟随最新一步
  const endRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const end = endRef.current;
    if (!end || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => { pinned.current = entry.isIntersecting; }, { rootMargin: '0px 0px 120px 0px' });
    observer.observe(end);
    return () => observer.disconnect();
  }, [run.id]);
  useEffect(() => {
    if (running && pinned.current) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [running, run.events]);

  return (
    <article className={s.detail} aria-label={run.title}>
      <header className={s.detailHead}>
        <div className={s.detailHeading}>
          <div className={s.detailBadges}>
            <Badge tone={status.tone} dot>{status.label}</Badge>
            {run.mode === 'demo' && <Badge tone="outline">本地演示</Badge>}
            {run.options.goalMode && <Badge tone="outline">目标模式</Badge>}
            {run.scheduleId && <Badge tone="outline">定时任务</Badge>}
          </div>
          <h2 className={s.detailTitle}>{run.title}</h2>
          <p className={s.detailMeta}>
            <span>{dayTime(run.createdAt)} 开始</span>
            {run.finishedAt && <span>{clockTime(run.finishedAt)} 结束</span>}
            <span>第 {Math.max(1, run.rounds)} 轮 · {run.steps} 步</span>
            {run.mode === 'model' && run.model && <span>{run.model}</span>}
            {!!run.tokens && <span>{tokenText(run.tokens)}</span>}
            {run.topicTitle && <span>课程：{run.topicTitle}</span>}
            {run.sourceTitles.length > 0 && <span>{run.sourceTitles.length} 份资料</span>}
          </p>
        </div>
        <div className={s.actions}>
          {(running || autoPending) && (
            <Button variant="outline" icon={<Square size={13} strokeWidth={2} />} onClick={onStop}>
              {autoPending ? '取消续跑' : '停止'}
            </Button>
          )}
          {canContinue && !autoPending && (
            <Button variant="solid" icon={<Play size={14} strokeWidth={2} />} onClick={onContinue}>继续推进</Button>
          )}
          {!running && (
            <Button variant={canContinue ? 'ghost' : 'soft'} icon={<RotateCw size={14} strokeWidth={1.75} />} onClick={onRerun}>重新运行</Button>
          )}
          <IconButton label="删除这次记录" onClick={onDelete}><Trash2 size={16} strokeWidth={1.75} /></IconButton>
        </div>
      </header>

      {progress.total > 0 && (
        <section className={s.goal} aria-label="目标清单">
          <div className={s.goalHead}>
            <span>目标清单</span>
            <span className={s.goalCount}>{progress.done} / {progress.total}</span>
          </div>
          <Progress value={progress.done} max={progress.total} tone={progress.done === progress.total ? 'ok' : 'accent'} label="目标进度" />
          <ul className={s.goalList}>
            {run.checklist.map((item) => (
              <li key={item.id} className={s.goalItem} data-done={item.done || undefined}>
                <span className={s.goalMark}>{item.done ? <Check size={13} strokeWidth={2.5} /> : <Circle size={13} strokeWidth={1.75} />}</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Timeline run={run} onOpen={onOpen} />
      <div ref={endRef} aria-hidden="true" />

      {run.produced.length > 0 && (
        <section className={s.produced} aria-label="已写入工作台">
          <h3>已写入工作台 <span>{run.produced.length} 项</span></h3>
          <ProducedChips items={run.produced} onOpen={onOpen} />
        </section>
      )}
    </article>
  );
}
