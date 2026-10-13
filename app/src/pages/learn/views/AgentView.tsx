import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowUp,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  CirclePause,
  CircleStop,
  Files,
  Layers,
  ListChecks,
  NotebookPen,
  Search,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Button, Empty, Segmented, Spinner, Switch, TabPanel, Tabs, Tip, toast } from '../../../components/ui';
import {
  DEFAULT_RUN_OPTIONS,
  STEP_BUDGETS,
  continueRun,
  deleteRun,
  reconcileRuns,
  rerun,
  startAgentScheduler,
  startRun,
  stopRun,
  type AgentRun,
  type ProducedItem,
  type RunContext,
  type RunOptions,
  type RunStatus,
} from '../../../engine/agent';
import { loadModelCatalog } from '../../../lib/modelGateway';
import { useAgentData } from '../../../store/agentStore';
import { RunDetail } from './agent/RunDetail';
import { SchedulePanel, emptyScheduleDraft, type ScheduleDraft } from './agent/SchedulePanel';
import { goalProgress, relativeTime } from './agent/format';
import s from './agent/agent.module.css';
import type { TerminalViewProps } from './types';

type TabId = 'runs' | 'schedules';

interface Template {
  id: string;
  label: string;
  icon: LucideIcon;
  /** 这类任务适合分轮推进 */
  goalMode?: boolean;
  build: (subject: string) => string;
}

const TEMPLATES: Template[] = [
  { id: 'research', label: '调研', icon: Search, goalMode: true, build: (subject) => `调研「${subject}」：梳理核心概念、关键机制和常见误区，写成一篇结构清晰的笔记，再配一张思维导图。` },
  { id: 'notes', label: '整理笔记', icon: NotebookPen, build: (subject) => `把「${subject}」的资料整理成一篇可以直接复习的笔记：分小节列要点，配必要的例子，结尾留 3 个自测问题。` },
  { id: 'quiz', label: '出一套题', icon: ListChecks, build: (subject) => `围绕「${subject}」出一套 8 道练习题：单选、判断、填空和简答都要有，难度由浅入深，每题附解析。` },
  { id: 'cards', label: '做闪卡', icon: Layers, build: (subject) => `把「${subject}」里需要记住的概念和结论做成 12 张左右的闪卡，一卡一问。` },
  { id: 'plan', label: '复习计划', icon: CalendarDays, goalMode: true, build: (subject) => `为「${subject}」排一份 7 天复习计划：每天的任务写进待办并标上日期，同时准备配套的闪卡和一套自测题。` },
];

const OPTIONS_KEY = 'xiaobai-agent-options-v1';

function loadOptions(): RunOptions {
  try {
    const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Partial<RunOptions>;
    return {
      ...DEFAULT_RUN_OPTIONS,
      goalMode: stored.goalMode === true,
      subagents: stored.subagents !== false,
      autoContinue: stored.autoContinue !== false,
      stepBudget: STEP_BUDGETS.find((budget) => budget === stored.stepBudget) ?? DEFAULT_RUN_OPTIONS.stepBudget,
    };
  } catch {
    return DEFAULT_RUN_OPTIONS;
  }
}

const BUDGET_OPTIONS = STEP_BUDGETS.map((budget) => ({ value: String(budget), label: `${budget} 步` }));

function StatusIcon({ status }: { status: RunStatus }) {
  if (status === 'running') return <Spinner size={15} className={s.statusRunning} />;
  if (status === 'done') return <CircleCheck size={15} strokeWidth={1.75} className={s.statusDone} />;
  if (status === 'paused') return <CirclePause size={15} strokeWidth={1.75} className={s.statusPaused} />;
  if (status === 'error') return <CircleAlert size={15} strokeWidth={1.75} className={s.statusError} />;
  return <CircleStop size={15} strokeWidth={1.75} className={s.statusStopped} />;
}

function runCaption(run: AgentRun): string {
  const progress = goalProgress(run);
  const parts = [relativeTime(run.createdAt)];
  if (progress.total && run.status !== 'done') parts.push(`清单 ${progress.done}/${progress.total}`);
  else if (run.produced.length) parts.push(`${run.produced.length} 项成果`);
  return parts.join(' · ');
}

export default function AgentView({ owner, topic, selectedSources, onView }: TerminalViewProps) {
  const data = useAgentData(owner);
  const [tab, setTab] = useState<TabId>('runs');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [options, setOptions] = useState<RunOptions>(loadOptions);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [modelReady, setModelReady] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 打开视图时接管被刷新打断的运行，并保证定时调度在跑（与终端外壳的启动共用计数，不会重复执行）
  useEffect(() => {
    reconcileRuns(owner);
    return startAgentScheduler(owner);
  }, [owner]);

  useEffect(() => {
    let alive = true;
    loadModelCatalog()
      .then((catalog) => { if (alive) setModelReady(catalog.available); })
      .catch(() => { if (alive) setModelReady(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    } catch {
      /* 存不下就只在本次会话生效 */
    }
  }, [options]);

  // 输入框随内容长高
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(280, input.scrollHeight)}px`;
  }, [draft]);

  const selected = data.runs.find((run) => run.id === selectedId) ?? data.runs[0];
  const subject = topic?.title ?? (selectedSources.length ? '已选资料' : '我想学的主题');
  const liveContext: RunContext = { topic, sources: selectedSources };
  /** 只有任务属于当前打开的课程时，才把此刻勾选的资料交给它 */
  const contextFor = (run: AgentRun) => ((run.topicId ?? null) === (topic?.topicId ?? null) ? liveContext : undefined);
  const setOption = (patch: Partial<RunOptions>) => setOptions((current) => ({ ...current, ...patch }));

  const start = () => {
    const goal = draft.trim();
    if (!goal) {
      inputRef.current?.focus();
      return;
    }
    const runId = startRun(owner, { goal, options, context: liveContext });
    setDraft('');
    setSelectedId(runId);
    setTab('runs');
  };

  const applyTemplate = (template: Template) => {
    setDraft(template.build(subject));
    if (template.goalMode && !options.goalMode) setOption({ goalMode: true });
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      start();
    }
  };

  const openItem = (item: ProducedItem) => {
    if (item.kind === 'schedule') setTab('schedules');
    else onView('workbench', { tool: item.kind, id: item.id });
  };

  const openRun = (runId: string) => {
    setSelectedId(runId);
    setTab('runs');
  };

  const removeRun = (run: AgentRun) => {
    deleteRun(owner, run.id);
    setSelectedId(null);
    toast('已删除这次任务记录', { description: run.produced.length ? '已经写进工作台的成果不受影响。' : undefined });
  };

  const restart = (run: AgentRun) => {
    const runId = rerun(owner, run.id, contextFor(run));
    if (runId) setSelectedId(runId);
  };

  const activeCount = data.runs.filter((run) => run.status === 'running').length;

  return (
    <div className={s.root}>
      <div className={s.inner}>
        <header className={s.head}>
          <div>
            <h1>助理任务</h1>
            <p>把调研、整理、出题交给小砚。它会查资料、调用工具，一步步把笔记、导图、题目和闪卡写进学习工作台。</p>
          </div>
          {modelReady === false && (
            <Tip label="没有可用的模型时，任务按课程资料走固定步骤，成果同样写进工作台。">
              <span className={s.modeBadge}><Badge tone="warn" dot>本地演示</Badge></span>
            </Tip>
          )}
        </header>

        <section className={s.composer} aria-label="新任务">
          <textarea
            ref={inputRef}
            className={s.composerInput}
            value={draft}
            rows={2}
            maxLength={6000}
            placeholder="写下想交给助理的事，比如：把这一讲整理成笔记，再出 8 道题…"
            aria-label="任务目标"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className={s.contextRow}>
            {topic ? (
              <span className={s.contextChip}><BookOpen size={13} strokeWidth={1.75} /><span>{topic.title}</span></span>
            ) : (
              <span className={s.contextChip} data-muted="true"><BookOpen size={13} strokeWidth={1.75} /><span>未打开课程</span></span>
            )}
            {selectedSources.length > 0 && (
              <Tip label={selectedSources.slice(0, 8).map((source) => source.title).join('、')}>
                <span className={s.contextChip}><Files size={13} strokeWidth={1.75} /><span>{selectedSources.length} 份已选资料</span></span>
              </Tip>
            )}
            {!topic && selectedSources.length === 0 && <span className={s.contextHint}>没有资料时助理只能用通用知识，建议先打开一门课。</span>}
          </div>
          <div className={s.composerBar}>
            <div className={s.options}>
              <Tip label="列出清单逐项推进，步数用完可以跨轮续跑">
                <label className={s.option}>
                  <Switch checked={options.goalMode} onCheckedChange={(goalMode) => setOption({ goalMode })} label="目标模式" />
                  <span>目标模式</span>
                </label>
              </Tip>
              {options.goalMode && (
                <Tip label={`步数用完后自动续跑，最多 ${options.maxRounds} 轮`}>
                  <label className={s.option}>
                    <Switch checked={options.autoContinue} onCheckedChange={(autoContinue) => setOption({ autoContinue })} label="自动续跑" />
                    <span>自动续跑</span>
                  </label>
                </Tip>
              )}
              <Tip label="把互不依赖的子任务交给子代理并行处理">
                <label className={s.option}>
                  <Switch checked={options.subagents} onCheckedChange={(subagents) => setOption({ subagents })} label="允许子代理" />
                  <span>允许子代理</span>
                </label>
              </Tip>
              <div className={s.option}>
                <span>每轮</span>
                <Segmented
                  size="sm"
                  label="每轮步数"
                  value={String(options.stepBudget)}
                  onChange={(value) => setOption({ stepBudget: Number(value) })}
                  options={BUDGET_OPTIONS}
                />
              </div>
            </div>
            <div className={s.composerActions}>
              <Button
                variant="ghost"
                icon={<CalendarClock size={15} strokeWidth={1.75} />}
                onClick={() => { setScheduleDraft(emptyScheduleDraft(draft.trim())); setTab('schedules'); }}
              >
                定时
              </Button>
              <Button variant="solid" icon={<ArrowUp size={15} strokeWidth={2} />} disabled={!draft.trim()} onClick={start}>开始</Button>
            </div>
          </div>
        </section>

        <div className={s.templates} role="group" aria-label="任务模板">
          {TEMPLATES.map((template) => (
            <button key={template.id} type="button" className={s.template} onClick={() => applyTemplate(template)}>
              <template.icon size={14} strokeWidth={1.75} />
              {template.label}
            </button>
          ))}
        </div>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as TabId)}
          label="助理任务"
          items={[
            { value: 'runs', label: '进行中与历史', ...(activeCount ? { count: activeCount } : {}) },
            { value: 'schedules', label: '定时任务', ...(data.schedules.length ? { count: data.schedules.length } : {}) },
          ]}
        >
          <TabPanel value="runs" className={s.panel}>
            {!selected ? (
              <Empty
                icon={<Sparkles size={22} strokeWidth={1.75} />}
                title="还没有任务"
                description="写下目标，或从上面选一个模板。执行过程和写进工作台的成果都会留在这里。"
              />
            ) : (
              <div className={s.board}>
                <nav className={s.runList} aria-label="任务记录">
                  {data.runs.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      className={s.runItem}
                      aria-current={run.id === selected.id ? 'true' : undefined}
                      onClick={() => setSelectedId(run.id)}
                    >
                      <StatusIcon status={run.status} />
                      <span className={s.runText}>
                        <span className={s.runTitle}>{run.title}</span>
                        <span className={s.runMeta}>{runCaption(run)}</span>
                      </span>
                    </button>
                  ))}
                </nav>
                <RunDetail
                  key={selected.id}
                  run={selected}
                  onStop={() => stopRun(owner, selected.id)}
                  onContinue={() => continueRun(owner, selected.id, contextFor(selected))}
                  onRerun={() => restart(selected)}
                  onDelete={() => removeRun(selected)}
                  onOpen={openItem}
                />
              </div>
            )}
          </TabPanel>
          <TabPanel value="schedules" className={s.panel}>
            <SchedulePanel
              owner={owner}
              schedules={data.schedules}
              topic={topic ? { topicId: topic.topicId, title: topic.title } : undefined}
              draft={scheduleDraft}
              onDraft={setScheduleDraft}
              onOpenRun={openRun}
            />
          </TabPanel>
        </Tabs>
      </div>
    </div>
  );
}
