/**
 * 回答的「过程」折叠件：思考与步骤合成一个可展开单元。
 * 进行中显示流光文字和计时；结束后显示「已思考 12 秒」/「已完成 · 3 个步骤」。
 * 展开内容是步骤时间线和（若有）思考过程。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronRight, CircleSlash, Lightbulb, ListChecks, TriangleAlert, X } from 'lucide-react';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { Shimmer, Spinner } from '../../components/ui';
import type { LearningRun, LearningStep } from '../../lib/learningAnswer';
import s from './chat/process.module.css';

export interface LearningActivityProps {
  run?: LearningRun;
  /** 模型的思考过程（Markdown） */
  reasoning?: string;
  /** 思考耗时（毫秒） */
  thinkingMs?: number;
  /** 这条回答仍在生成；有 run 时以 run.status 为准 */
  live?: boolean;
  /** 正文已经开始输出：进行中也默认收起 */
  answerStarted?: boolean;
  /** 没有 run 时的计时起点 */
  startedAt?: number;
}

type ProcessState = 'running' | 'complete' | 'stopped' | 'failed';

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 1) return '不到 1 秒';
  if (seconds < 60) return `${seconds} 秒`;
  const rest = seconds % 60;
  return rest ? `${Math.floor(seconds / 60)} 分 ${rest} 秒` : `${Math.floor(seconds / 60)} 分钟`;
}

/** 进行中每秒走一次的时钟 */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function StepIcon({ status }: { status: LearningStep['status'] }) {
  if (status === 'running') return <Spinner size={13} />;
  if (status === 'done') return <Check size={13} strokeWidth={2.25} />;
  if (status === 'error') return <X size={13} strokeWidth={2.25} />;
  return <CircleSlash size={12} strokeWidth={2} />;
}

const STEP_NOTE: Record<LearningStep['status'], string> = { running: '进行中', done: '', stopped: '已停止', error: '未完成' };

export function LearningActivity({ run, reasoning, thinkingMs, live, answerStarted, startedAt }: LearningActivityProps) {
  const panelId = useId();
  const mountedAt = useRef(Date.now());
  const reasoningRef = useRef<HTMLDivElement>(null);
  /** null = 跟随默认（未出正文时展开，出正文后收起） */
  const [manual, setManual] = useState<boolean | null>(null);

  const state: ProcessState = run ? (run.status === 'running' ? 'running' : run.status) : live ? 'running' : 'complete';
  const running = state === 'running';
  const now = useTicker(running);
  const steps = run?.steps ?? [];
  const thought = reasoning?.trim() ?? '';
  const expandable = steps.length > 0 || thought.length > 0;
  const open = expandable && (manual ?? (running && !answerStarted));

  const elapsed = running
    ? now - (run?.startedAt || startedAt || mountedAt.current)
    : thinkingMs ?? run?.elapsedMs ?? 0;

  // 思考过程在流式写入时保持看到最新一行
  useLayoutEffect(() => {
    const node = reasoningRef.current;
    if (node && running && open) node.scrollTop = node.scrollHeight;
  }, [thought, running, open]);

  let label: string;
  if (running) {
    label = steps.find((step) => step.status === 'running')?.label || (answerStarted ? '正在组织回答…' : '正在思考…');
  } else if (state === 'stopped') {
    label = '已停止';
  } else if (state === 'failed') {
    label = '本次回答未完成';
  } else if (thinkingMs !== undefined || (thought && !steps.length)) {
    label = thinkingMs !== undefined ? `已思考 ${formatDuration(thinkingMs)}` : '已思考';
    if (steps.length) label += ` · ${steps.length} 个步骤`;
  } else {
    label = steps.length ? `已完成 · ${steps.length} 个步骤` : '已完成';
  }
  const showClock = running || (thinkingMs === undefined && elapsed >= 1000);

  const mark = running ? <Spinner size={14} />
    : state === 'failed' ? <TriangleAlert size={14} strokeWidth={1.75} />
      : state === 'stopped' ? <CircleSlash size={14} strokeWidth={1.75} />
        : thought ? <Lightbulb size={14} strokeWidth={1.75} /> : <ListChecks size={14} strokeWidth={1.75} />;

  const summary = (
    <>
      <span className={s.mark}>{mark}</span>
      {running ? <Shimmer className={s.label}>{label}</Shimmer> : <span className={s.label}>{label}</span>}
      {showClock && <time className={s.clock}>{running ? formatDuration(Math.max(1000, elapsed)) : `用时 ${formatDuration(elapsed)}`}</time>}
    </>
  );

  if (!expandable) {
    return <div className={s.process} data-state={state}><div className={s.summary} role="status">{summary}</div></div>;
  }

  return (
    <div className={s.process} data-state={state} data-open={open || undefined}>
      <button
        type="button"
        className={s.summary}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setManual(!open)}
      >
        {summary}
        <ChevronRight size={14} strokeWidth={2} className={s.chevron} aria-hidden="true" />
      </button>
      <div className={s.panel} id={panelId} role="region" aria-label="回答过程">
        <div className={s.panelInner}>
          <div className={s.panelBody}>
            {steps.length > 0 && (
              <ol className={s.steps}>
                {steps.map((step, index) => (
                  <li key={`${step.id}:${index}`} className={s.step} data-state={step.status}>
                    <span className={s.stepIcon}><StepIcon status={step.status} /></span>
                    <span className={s.stepLabel}>{step.label}</span>
                    {STEP_NOTE[step.status] && <span className={s.stepNote}>{STEP_NOTE[step.status]}</span>}
                  </li>
                ))}
              </ol>
            )}
            {thought && (
              <div className={s.reasoning} ref={reasoningRef} tabIndex={open ? 0 : -1} aria-label="思考过程">
                {steps.length > 0 && <p className={s.reasoningTitle}>思考过程</p>}
                <CoachMarkdown text={thought} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
