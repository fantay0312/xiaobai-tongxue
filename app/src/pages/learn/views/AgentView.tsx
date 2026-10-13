import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, ChevronRight, CircleAlert, CircleCheck, CirclePause, CircleStop, Forward } from 'lucide-react';
import { AttachBar, NO_ATTACHMENTS, attachmentCount, type Attachments } from '../../../components/handoff/AttachBar';
import { handoffSource, resolveAttachments } from '../../../components/handoff/materials';
import { SendTo } from '../../../components/handoff/SendTo';
import { Badge, Empty, IconButton, Spinner, TabPanel, Tabs, Tip, toast } from '../../../components/ui';
import { IconAgent, IconSpark } from '../../../components/ui/icons';
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
import { useArtifacts } from '../../../lib/artifacts';
import { loadModelCatalog } from '../../../lib/modelGateway';
import { useAgentData } from '../../../store/agentStore';
import { SidebarPortal, useSidebarSlot } from '../shell/sidebarSlot';
import { useMediaQuery } from '../shell/views';
import { AgentSidebar, type AgentSelection } from './agent/AgentSidebar';
import { GoalComposer } from './agent/GoalComposer';
import { RunDetail } from './agent/RunDetail';
import { ScheduleEditor, SchedulePanel, emptyScheduleDraft, type ScheduleDraft } from './agent/SchedulePanel';
import { goalProgress, relativeTime } from './agent/format';
import s from './agent/agent.module.css';
import type { TerminalViewProps } from './types';

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
  // 有侧栏挂载位时，导航在侧栏、主区只显示选中的那一件事；没有时（手机、侧栏收起）主区自带页签和列表
  const hasSidebar = useSidebarSlot() !== null;
  // 手机：任务列表与运行详情分成两屏，详情带返回
  const phone = useMediaQuery('(max-width: 760px)') && !hasSidebar;
  // 别处带着目标或内容过来：?goal=<目标> 预填，?handoff=<短号> / ?from=<成果登记键> 作为附加内容，?run=<任务> 直接打开那次任务
  const [searchParams] = useSearchParams();
  const goalParam = searchParams.get('goal');
  const handoffParam = searchParams.get('handoff');
  const fromParam = searchParams.get('from');
  const runParam = searchParams.get('run');
  const artifacts = useArtifacts(owner);
  const fromKey = fromParam ? artifacts.find((item) => item.key === fromParam)?.key : undefined;
  const [selection, setSelection] = useState<AgentSelection>(() => (runParam && !goalParam ? { kind: 'run', id: runParam } : { kind: 'new' }));
  const [draft, setDraft] = useState(() => goalParam?.slice(0, 6000) ?? '');
  const [attachments, setAttachments] = useState<Attachments>(NO_ATTACHMENTS);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (goalParam) { setDraft(goalParam.slice(0, 6000)); setSelection({ kind: 'new' }); }
  }, [goalParam]);
  useEffect(() => {
    const carried = handoffSource(handoffParam);
    if (!carried && !fromKey) return;
    setAttachments((current) => ({
      ...current,
      carried: carried && !current.carried.some((item) => item.id === carried.id) ? [...current.carried, carried] : current.carried,
      selection: fromKey && !current.selection.artifactKeys.includes(fromKey)
        ? { ...current.selection, artifactKeys: [...current.selection.artifactKeys, fromKey] }
        : current.selection,
    }));
    setSelection({ kind: 'new' });
  }, [handoffParam, fromKey]);
  useEffect(() => {
    if (runParam && !goalParam) setSelection({ kind: 'run', id: runParam });
  }, [runParam, goalParam]);
  const [options, setOptions] = useState<RunOptions>(loadOptions);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft | null>(null);
  const [modelReady, setModelReady] = useState<boolean | null>(null);

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

  const liveContext: RunContext = { topic, sources: selectedSources };
  /** 只有任务属于当前打开的课程时，才把此刻勾选的资料交给它 */
  const contextFor = (run: AgentRun) => ((run.topicId ?? null) === (topic?.topicId ?? null) ? liveContext : undefined);
  const topicRef = topic ? { topicId: topic.topicId, title: topic.title } : undefined;

  const start = async () => {
    const goal = draft.trim();
    if (!goal || starting) return;
    setStarting(true);
    try {
      // 附加的资料库文件和「我的内容」读成正文，和已勾选资料一起交给助理检索
      const extra = [...attachments.carried];
      if (attachments.selection.fileIds.length || attachments.selection.artifactKeys.length) {
        const resolved = await resolveAttachments(owner, attachments.selection);
        resolved.problems.forEach((message) => toast(message));
        extra.push(...resolved.sources);
      }
      const runId = startRun(owner, { goal, options, context: { topic, sources: [...selectedSources, ...extra] } });
      setDraft('');
      setAttachments(NO_ATTACHMENTS);
      setSelection({ kind: 'run', id: runId });
    } finally {
      setStarting(false);
    }
  };

  const openRun = (runId: string) => setSelection({ kind: 'run', id: runId });

  const newSchedule = (prompt = '') => {
    setScheduleDraft(emptyScheduleDraft(prompt));
    setSelection({ kind: 'schedule', id: null });
  };

  const openItem = (item: ProducedItem) => {
    if (item.kind === 'schedule') setSelection({ kind: 'schedule', id: item.id });
    else onView('workbench', { tool: item.kind, id: item.id });
  };

  const removeRun = (run: AgentRun) => {
    deleteRun(owner, run.id);
    if (selection.kind === 'run' && selection.id === run.id) setSelection({ kind: 'new' });
    toast('已删除这次任务记录', { description: run.produced.length ? '已经写进工作台的成果不受影响。' : undefined });
  };

  const restart = (run: AgentRun) => {
    const runId = rerun(owner, run.id, contextFor(run));
    if (runId) openRun(runId);
  };

  const head = (
    <header className={s.head}>
      <div className={s.headMain}>
        <span className={s.mark}><IconAgent size={22} /></span>
        <div>
          <h1>助理任务</h1>
          <p>把调研、整理、出题交给小砚。它会查资料、调用工具，一步步把笔记、导图、题目和闪卡写进学习工作台。</p>
        </div>
      </div>
      {modelReady === false && (
        <Tip label="没有可用的模型时，任务按课程资料走固定步骤，成果同样写进工作台。">
          <span className={s.modeBadge}><Badge tone="warn" dot>本地演示</Badge></span>
        </Tip>
      )}
    </header>
  );

  const composer = (
    <GoalComposer
      draft={draft}
      onDraft={setDraft}
      options={options}
      onOptions={(patch) => setOptions((current) => ({ ...current, ...patch }))}
      topicTitle={topic?.title}
      sourceTitles={selectedSources.map((source) => source.title)}
      onStart={() => void start()}
      onSchedule={() => newSchedule(draft.trim())}
      compact={phone}
      starting={starting}
      attachedCount={attachmentCount(attachments)}
      attach={<AttachBar owner={owner} value={attachments} onChange={setAttachments} disabled={starting} onManage={() => onView('library')} addLabel="附上资料或我的内容" initialTab="artifacts" />}
    />
  );

  const detailOf = (run: AgentRun) => (
    <RunDetail
      key={run.id}
      compact={phone}
      run={run}
      onStop={() => stopRun(owner, run.id)}
      onContinue={() => continueRun(owner, run.id, contextFor(run))}
      onRerun={() => restart(run)}
      onDelete={() => removeRun(run)}
      onOpen={openItem}
      sendTo={run.status === 'done' && run.summary?.trim() ? (
        <SendTo
          owner={owner}
          text={`# ${run.title}\n\n${run.summary}`}
          title={run.title}
          topicId={run.topicId}
          topicTitle={run.topicTitle}
          actions={['save-note', 'add-todos', 'make-flashcards']}
          routes={['lesson']}
          origin={{ section: 'agent', label: `助理任务：${run.title}`, open: { view: 'agent', params: { run: run.id } } }}
          label="把小结发送到"
          align="end"
        >
          <IconButton label="把这次任务的小结发送到…"><Forward size={16} strokeWidth={1.75} /></IconButton>
        </SendTo>
      ) : undefined}
    />
  );

  /* ── 有侧栏：导航进侧栏，主区只放一件事 ── */
  if (hasSidebar) {
    const run = selection.kind === 'run' ? data.runs.find((item) => item.id === selection.id) : undefined;
    const task = selection.kind === 'schedule' && selection.id ? data.schedules.find((item) => item.id === selection.id) : undefined;
    const creatingSchedule = selection.kind === 'schedule' && selection.id === null;
    return (
      <div className={s.root}>
        <SidebarPortal>
          <AgentSidebar
            runs={data.runs}
            schedules={data.schedules}
            selection={selection}
            onSelect={setSelection}
            onNewSchedule={() => newSchedule()}
            onRerun={restart}
            onDelete={removeRun}
          />
        </SidebarPortal>
        <div className={s.inner}>
          {run ? detailOf(run) : task || creatingSchedule ? (
            <ScheduleEditor
              key={task?.id ?? 'new'}
              owner={owner}
              task={task}
              initial={scheduleDraft ?? undefined}
              topic={topicRef}
              onSaved={(saved) => { setScheduleDraft(null); setSelection({ kind: 'schedule', id: saved.id }); }}
              onDeleted={() => setSelection({ kind: 'new' })}
              onCancel={() => { setScheduleDraft(null); setSelection({ kind: 'new' }); }}
              onOpenRun={openRun}
            />
          ) : (
            <>
              {head}
              {composer}
            </>
          )}
        </div>
      </div>
    );
  }

  /* ── 手机：选中一次运行时，整屏只显示它 ── */
  const opened = phone && selection.kind === 'run' ? data.runs.find((run) => run.id === selection.id) : undefined;
  if (opened) {
    return (
      <div className={s.root} data-phone>
        <div className={s.inner} data-screen="run">
          <button type="button" className={s.back} onClick={() => setSelection({ kind: 'new' })}>
            <ArrowLeft size={18} strokeWidth={1.75} aria-hidden="true" />
            全部任务
          </button>
          {detailOf(opened)}
        </div>
      </div>
    );
  }

  /* ── 没有侧栏：主区自带页签与任务列表 ── */
  const tab = selection.kind === 'schedule' ? 'schedules' : 'runs';
  const selected = (selection.kind === 'run' ? data.runs.find((run) => run.id === selection.id) : undefined) ?? data.runs[0];
  const activeCount = data.runs.filter((run) => run.status === 'running').length;

  return (
    <div className={s.root} data-phone={phone || undefined}>
      <div className={s.inner}>
        {head}
        {composer}
        <Tabs
          value={tab}
          onValueChange={(value) => setSelection(value === 'schedules' ? { kind: 'schedule', id: data.schedules[0]?.id ?? null } : selected && !phone ? { kind: 'run', id: selected.id } : { kind: 'new' })}
          label="助理任务"
          items={[
            { value: 'runs', label: '进行中与历史', ...(activeCount ? { count: activeCount } : {}) },
            { value: 'schedules', label: '定时任务', ...(data.schedules.length ? { count: data.schedules.length } : {}) },
          ]}
        >
          <TabPanel value="runs" className={s.panel}>
            {!selected ? (
              <Empty
                icon={<IconSpark size={22} />}
                title="还没有任务"
                description="写下目标，或从上面选一个模板。执行过程和写进工作台的成果都会留在这里。"
              />
            ) : phone ? (
              <nav className={s.runRows} aria-label="任务记录">
                {data.runs.map((run) => (
                  <button key={run.id} type="button" className={s.runRow} onClick={() => openRun(run.id)}>
                    <StatusIcon status={run.status} />
                    <span className={s.runText}>
                      <span className={s.runTitle}>{run.title}</span>
                      <span className={s.runMeta}>{runCaption(run)}</span>
                    </span>
                    <ChevronRight size={16} strokeWidth={1.75} className={s.runGo} aria-hidden="true" />
                  </button>
                ))}
              </nav>
            ) : (
              <div className={s.board}>
                <nav className={s.runList} aria-label="任务记录">
                  {data.runs.map((run) => (
                    <button
                      key={run.id}
                      type="button"
                      className={s.runItem}
                      aria-current={run.id === selected.id ? 'true' : undefined}
                      onClick={() => openRun(run.id)}
                    >
                      <StatusIcon status={run.status} />
                      <span className={s.runText}>
                        <span className={s.runTitle}>{run.title}</span>
                        <span className={s.runMeta}>{runCaption(run)}</span>
                      </span>
                    </button>
                  ))}
                </nav>
                {detailOf(selected)}
              </div>
            )}
          </TabPanel>
          <TabPanel value="schedules" className={s.panel}>
            <SchedulePanel
              owner={owner}
              schedules={data.schedules}
              topic={topicRef}
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
