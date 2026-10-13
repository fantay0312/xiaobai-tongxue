/**
 * 备课流程的版式件：五步进度条 + 备课度、步骤题头、上一步/下一步、出口、可翻开的册子、
 * 薄弱点小结、记忆回执。全部只渲染，状态由备课页持有。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronRight, GraduationCap, Lock, TriangleAlert,
} from 'lucide-react';
import { Badge, Button, Progress, cx } from '../../components/ui';
import type { TopicRecall } from '../../engine/recall';
import s from './prep.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export interface StepDef {
  id: string;
  name: string;
}

export interface StepState {
  done: boolean;
  reachable: boolean;
}

/** 吸顶进度条：五步（做完打勾、当前高亮、没解锁上锁）+ 备课度 */
export function JourneyBar({
  steps, states, currentId, onJump, progress, note, ready,
}: {
  steps: readonly StepDef[];
  states: readonly StepState[];
  currentId: string;
  onJump: (id: string) => void;
  progress: number;
  note: string;
  /** 摸完底：可以去上课了 */
  ready: boolean;
}) {
  return (
    <div className={s.journey}>
      <nav className={s.stepper} aria-label="备课五步" data-tour="prep-steps">
        <ol className={s.stepList}>
          {steps.map((step, i) => {
            const st = states[i];
            const current = currentId === step.id && st.reachable;
            return (
              <li
                key={step.id}
                className={s.stepItem}
                data-done={st.done || undefined}
                data-current={current || undefined}
                data-locked={!st.reachable || undefined}
                data-linked={(i > 0 && states[i - 1].done) || undefined}
              >
                {st.reachable ? (
                  <button
                    type="button"
                    className={s.step}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => onJump(step.id)}
                  >
                    <span className={s.stepDot} aria-hidden="true">
                      {st.done ? <Check size={13} strokeWidth={2.6} /> : i + 1}
                    </span>
                    <span className={s.stepName}>{step.name}</span>
                    {st.done && <span className={s.srOnly}>（已完成）</span>}
                  </button>
                ) : (
                  <span className={s.step} title="做完摸底快测后解锁">
                    <span className={s.stepDot} aria-hidden="true"><Lock size={11} strokeWidth={2} /></span>
                    <span className={s.stepName}>{step.name}</span>
                    <span className={s.srOnly}>（未解锁）</span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className={s.meter} role="group" aria-label="备课进度" data-ready={ready || undefined}>
        <div className={s.meterTop}>
          <span className={s.meterLabel}>备课度<b className={s.meterPct}>{progress}%</b></span>
          <span className={s.meterNote}>{note}</span>
        </div>
        <Progress value={progress} tone={ready ? 'ok' : 'accent'} label="备课度" />
      </div>
    </div>
  );
}

/** 步骤题头：第几步 + 标题 + 一句说明；标题可被程序聚焦（跳步后读屏从这里读起） */
export function StepHead({
  index, total, headingId, title, hint, aside,
}: {
  index: number;
  total: number;
  headingId: string;
  title: string;
  hint?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className={s.stepHead}>
      <div className={s.stepHeadText}>
        <p className={s.eyebrow}>第 {index + 1} 步 · 共 {total} 步</p>
        <h2 id={headingId} className={s.sectionTitle} tabIndex={-1}>{title}</h2>
        {hint ? <p className={s.sectionHint}>{hint}</p> : null}
      </div>
      {aside ? <div className={s.stepHeadAside}>{aside}</div> : null}
    </header>
  );
}

export interface StepLink {
  label: string;
  onClick: () => void;
}

/** 每一步底部只有一个主动作：下一步 */
export function StepNav({ prev, next }: { prev?: StepLink; next?: StepLink }) {
  if (!prev && !next) return null;
  return (
    <div className={s.stepNav}>
      {prev ? (
        <Button variant="ghost" icon={<ArrowLeft {...ICON} />} onClick={prev.onClick}>
          {prev.label}
        </Button>
      ) : <span />}
      {next ? (
        <Button variant="solid" size="lg" iconRight={<ArrowRight {...ICON} />} onClick={next.onClick}>
          {next.label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * 出口。摸完底才放行（去上课、只备课都一样）。
 * strong：流程走到头时的终点卡，一枚实心主按钮；否则是一条安静的备选行，不抢「下一步」。
 */
export function PrepExits({
  canLeave, prepDone, ready, strong, onStay, onTeach,
}: {
  canLeave: boolean;
  prepDone: boolean;
  /** 自检全勾：主按钮轻呼吸 */
  ready: boolean;
  strong: boolean;
  onStay: () => void;
  onTeach: () => void;
}) {
  const stayLabel = prepDone ? '合上这课，回学习终端' : '只备课，回学习终端';
  if (strong) {
    return (
      <div className={s.finale} data-ready={ready || undefined}>
        <span className={s.finaleIcon} aria-hidden="true"><GraduationCap size={22} strokeWidth={1.75} /></span>
        <div className={s.finaleText}>
          <h3 className={s.finaleTitle}>{ready ? '备好了，去讲给小白听' : '可以去上课了'}</h3>
          <p className={s.lockHint}>
            {canLeave ? '只备课也算数。讲解舱想去的时候再进。' : '做完摸底快测，才能去上课或收工。'}
          </p>
        </div>
        <div className={s.finaleBtns}>
          <Button
            variant="solid"
            size="lg"
            className={ready ? s.ctaReady : undefined}
            iconRight={<ArrowRight {...ICON} />}
            disabled={!canLeave}
            onClick={onTeach}
          >
            去给小白上课
          </Button>
          <Button variant="ghost" size="lg" disabled={!canLeave} onClick={onStay}>
            {stayLabel}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={s.exits}>
      <p className={s.exitsNote}>
        {canLeave ? <GraduationCap {...ICON} /> : <Lock {...ICON} />}
        <span className={s.lockHint}>
          {canLeave ? '摸底已经做完，想走随时可以走。' : '做完摸底快测，才能去上课或收工。'}
        </span>
      </p>
      <div className={s.exitsBtns}>
        <Button variant="outline" disabled={!canLeave} iconRight={<ArrowRight {...ICON} />} onClick={onTeach}>
          去给小白上课
        </Button>
        <Button variant="ghost" disabled={!canLeave} onClick={onStay}>
          {stayLabel}
        </Button>
      </div>
    </div>
  );
}

/** 材料包里的一册：鼠标移上或点击翻开，再点标题收起 */
export function Collapse({ title, tag, tagTone, onOpen, children }: {
  title: string;
  tag?: string;
  tagTone?: 'warn' | 'plain';
  /** 首次翻开时通知页面（翻开几册，进度与小砚都要知道） */
  onOpen?: (title: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const onOpenRef = useRef(onOpen);
  const openRef = useRef(false);
  const hoverOpenedAt = useRef(0);
  onOpenRef.current = onOpen;
  useEffect(() => {
    if (open) onOpenRef.current?.(title);
  }, [open, title]);
  return (
    <section
      className={cx(s.collapse, open && s.collapseOn)}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse' || !window.matchMedia('(hover: hover)').matches) return;
        if (!openRef.current) hoverOpenedAt.current = Date.now();
        openRef.current = true;
        setOpen(true);
      }}
    >
      <button
        type="button"
        className={s.collapseHead}
        aria-expanded={open}
        onClick={() => {
          // 悬停刚打开时，同一次点击会紧跟着到来，不能把册子又合上
          if (Date.now() - hoverOpenedAt.current < 500) {
            hoverOpenedAt.current = 0;
            return;
          }
          hoverOpenedAt.current = 0;
          openRef.current = !openRef.current;
          setOpen(openRef.current);
        }}
      >
        <ChevronRight className={s.collapseChev} {...ICON} aria-hidden="true" />
        <span className={s.collapseTitle}>{title}</span>
        {tag ? <Badge tone={tagTone === 'warn' ? 'warn' : 'neutral'}>{tag}</Badge> : null}
      </button>
      {/* inert：收起态把子树（外链、横滚容器）整体移出 Tab 序，0fr 高度动画不受影响 */}
      <div className={cx(s.collapseBody, open && s.collapseOpen)} inert={!open}>
        <div className={s.collapseInner}>{children}</div>
      </div>
    </section>
  );
}

/** 摸底暴露的薄弱点：答错的误区 + 没答稳的角度 */
export function WeakPoints({ beliefs, dims }: {
  beliefs: { id: string; text: string }[];
  dims: { id: string; dimension: string; point: string }[];
}) {
  if (beliefs.length === 0 && dims.length === 0) return null;
  return (
    <div className={s.weak}>
      <h3 className={s.weakTitle}>
        <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" />
        摸底暴露的薄弱点
      </h3>
      <ul className={s.weakList}>
        {beliefs.map((item) => (
          <li key={item.id} className={s.weakItem}>
            <Badge tone="bad">误区</Badge>
            <span>{item.text}</span>
          </li>
        ))}
        {dims.map((item) => (
          <li key={item.id} className={s.weakItem}>
            <Badge tone="warn">{item.dimension}</Badge>
            <span>{item.point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 「接着上次讲」记忆回执：小白对这门课的记忆（故事物件，称「先生」）。
 * 只在有可显示内容时露面，首学该课不渲染。
 * 只展示要点名、金句原文、心魔策展名与真实衰减数，不泄露评估细节。
 */
export function RecallCard({ recall, memoryLines }: { recall: TopicRecall; memoryLines: string[] }) {
  const hasContent =
    !!recall.lastOutcome ||
    recall.rememberedPoints.length > 0 ||
    recall.goldenQuotes.length > 0 ||
    recall.clearedDemons.length > 0 ||
    recall.retention != null ||
    memoryLines.length > 0;
  if (!hasContent) return null;

  const daysAgo =
    recall.lastStudiedAt != null
      ? Math.max(0, Math.round((Date.now() - recall.lastStudiedAt) / 86400000))
      : null;
  const whenLabel = daysAgo == null ? null : daysAgo === 0 ? '就在今天' : `${daysAgo} 天前`;
  const pct = recall.retention != null ? Math.round(recall.retention * 100) : null;
  const fogged = recall.daysToFog != null && recall.daysToFog <= 0;

  return (
    <aside className={s.recall} data-story aria-label="小白对这门课的记忆">
      <div className={s.recallHead}>
        <span className={s.recallLabel}>接着上次讲</span>
        {whenLabel && <span className={s.recallWhen}>上次温书 · {whenLabel}</span>}
      </div>
      {recall.lastOutcome && <p className={s.recallOutcome}>{recall.lastOutcome}</p>}

      {memoryLines.length > 0 && (
        <div className={s.recallField}>
          <span className={s.recallFieldLabel}>小白记得</span>
          <ul className={s.recallMemory}>
            {memoryLines.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      )}

      {recall.rememberedPoints.length > 0 && (
        <div className={s.recallField}>
          <span className={s.recallFieldLabel}>还记得</span>
          <ul className={s.recallChips}>
            {recall.rememberedPoints.map((point, i) => (
              <li key={i} className={s.recallChip}>{point}</li>
            ))}
          </ul>
        </div>
      )}

      {recall.clearedDemons.length > 0 && (
        <div className={s.recallField}>
          <span className={s.recallFieldLabel}>清掉的心魔</span>
          <ul className={s.recallChips}>
            {recall.clearedDemons.map((demon, i) => (
              <li key={i} className={cx(s.recallChip, s.recallChipDemon)}>{demon}</li>
            ))}
          </ul>
        </div>
      )}

      {recall.goldenQuotes.length > 0 && (
        <ul className={s.recallQuotes}>
          {/* 金句为原文逐字，可能重复出现，用索引作 key */}
          {recall.goldenQuotes.map((quote, i) => (
            <li key={i} className={s.recallQuote}>「{quote}」</li>
          ))}
        </ul>
      )}

      {pct != null && (
        <div className={s.recallRet}>
          <div className={s.recallRetHead}>
            <span className={s.recallFieldLabel}>保持度</span>
            <span className={s.recallRetNote}>
              {pct}% ·{' '}
              {recall.daysToFog == null
                ? '暂稳'
                : recall.daysToFog === 0
                  ? '今日起雾'
                  : fogged
                    ? `已起雾 ${Math.abs(recall.daysToFog)} 天`
                    : `再 ${recall.daysToFog} 天起雾`}
            </span>
          </div>
          <div className={s.recallRetTrack} aria-hidden="true">
            <span
              className={cx(s.recallRetFill, fogged && s.recallRetFillFog)}
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
        </div>
      )}
    </aside>
  );
}
