import { useEffect, useState } from 'react';
import { CalendarClock, Info, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Dialog, Empty, Field, IconButton, Input, Segmented, Switch, Textarea, toast } from '../../../../components/ui';
import {
  WEEKDAY_LABELS,
  computeNextRun,
  describeCadence,
  isValidDate,
  isValidTime,
  localDate,
  runSchedule,
  saveSchedule,
  setScheduleEnabled,
  type Cadence,
  type ScheduledTask,
} from '../../../../engine/agent';
import { agentStore } from '../../../../store/agentStore';
import { dayTime, relativeTime } from './format';
import s from './agent.module.css';

/** 新建 / 编辑表单的草稿；id 为空表示新建 */
export interface ScheduleDraft {
  id?: string;
  title: string;
  prompt: string;
  cadence: Cadence;
  time: string;
  date: string;
  weekday: number;
}

type TopicRef = { topicId: string; title: string };

export function emptyScheduleDraft(prompt = ''): ScheduleDraft {
  const soon = new Date(Date.now() + 3_600_000);
  return {
    title: '',
    prompt,
    cadence: 'daily',
    time: `${String(soon.getHours()).padStart(2, '0')}:00`,
    date: localDate(soon),
    weekday: soon.getDay(),
  };
}

const draftFromTask = (task: ScheduledTask): ScheduleDraft => ({
  id: task.id,
  title: task.title,
  prompt: task.prompt,
  cadence: task.cadence,
  time: task.time,
  date: task.date ?? localDate(),
  weekday: task.weekday ?? new Date().getDay(),
});

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: 'once', label: '一次' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
];
// 周一排在最前
const WEEKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((day) => ({ value: String(day), label: WEEKDAY_LABELS[day].slice(1) }));

const RUN_NOTE = '只在这个浏览器打开小白同学时执行，错过的会在下次打开时补跑一次。';

const timingOf = (draft: ScheduleDraft) => ({
  cadence: draft.cadence,
  time: draft.time,
  ...(draft.cadence === 'once' ? { date: draft.date } : {}),
  ...(draft.cadence === 'weekly' ? { weekday: draft.weekday } : {}),
});

/** 表单校验：下一次执行时间、时间错误、能否提交 */
function checkDraft(draft: ScheduleDraft) {
  const next = isValidTime(draft.time) ? computeNextRun(timingOf(draft)) : null;
  const timeError = !isValidTime(draft.time)
    ? '请填写时间'
    : draft.cadence === 'once' && !isValidDate(draft.date)
      ? '请选择日期'
      : draft.cadence === 'once' && next && Date.parse(next) <= Date.now()
        ? '这个时间已经过去了'
        : '';
  return { next, timeError, ready: draft.prompt.trim().length > 0 && !timeError };
}

function submitDraft(owner: string | null, draft: ScheduleDraft, topic: TopicRef | undefined): ScheduledTask {
  const existing = draft.id ? agentStore.get(owner).schedules.find((task) => task.id === draft.id) : undefined;
  const task = saveSchedule(owner, {
    ...timingOf(draft),
    title: draft.title,
    prompt: draft.prompt,
    // 编辑时保留原来绑定的课程；新建时绑定当前打开的课程
    ...(existing
      ? (existing.topicId ? { topicId: existing.topicId, topicTitle: existing.topicTitle } : {})
      : topic ? { topicId: topic.topicId, topicTitle: topic.title } : {}),
  }, draft.id);
  toast.success(draft.id ? '已保存定时任务' : '已创建定时任务', { description: task.nextRunAt ? `下次执行：${dayTime(task.nextRunAt)}` : undefined });
  return task;
}

/** 对话框与主区编辑器共用的表单字段 */
function ScheduleFields({ draft, onChange, topic }: { draft: ScheduleDraft; onChange: (draft: ScheduleDraft) => void; topic?: TopicRef }) {
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  const { next, timeError } = checkDraft(draft);
  return (
    <div className={s.form}>
      <Field label="任务名" htmlFor="agent-schedule-title">
        <Input id="agent-schedule-title" value={draft.title} maxLength={60} placeholder="如：每日复习题" onChange={(event) => set({ title: event.target.value })} />
      </Field>
      <Field label="要做的事" htmlFor="agent-schedule-prompt" hint={topic && !draft.id ? `会以当前课程「${topic.title}」的讲义作为资料。` : undefined}>
        <Textarea
          id="agent-schedule-prompt"
          rows={4}
          value={draft.prompt}
          maxLength={4000}
          placeholder="如：从昨天学的内容里出 5 道复习题，写进题目集，并加一项「完成今日复习题」的待办。"
          onChange={(event) => set({ prompt: event.target.value })}
        />
      </Field>
      <Field label="频率">
        <div className={s.fit}><Segmented value={draft.cadence} onChange={(cadence) => set({ cadence })} options={CADENCE_OPTIONS} label="频率" /></div>
      </Field>
      {draft.cadence === 'weekly' && (
        <Field label="星期">
          <div className={s.fit}><Segmented value={String(draft.weekday)} onChange={(day) => set({ weekday: Number(day) })} options={WEEKDAY_OPTIONS} label="星期" /></div>
        </Field>
      )}
      <div className={s.formRow}>
        {draft.cadence === 'once' && (
          <Field label="日期" htmlFor="agent-schedule-date">
            <Input id="agent-schedule-date" type="date" value={draft.date} min={localDate()} onChange={(event) => set({ date: event.target.value })} />
          </Field>
        )}
        <Field label="时间" htmlFor="agent-schedule-time" error={timeError || undefined}>
          <Input id="agent-schedule-time" type="time" value={draft.time} invalid={!!timeError} onChange={(event) => set({ time: event.target.value })} />
        </Field>
      </div>
      <p className={s.formHint}>{next && !timeError ? `下次执行：${dayTime(next)}。` : ''}{RUN_NOTE}</p>
    </div>
  );
}

/** 每分钟重绘一次，让「下次执行」「上次执行」的相对时间保持新鲜 */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
}

function LastRun({ owner, task, onOpenRun }: { owner: string | null; task: ScheduledTask; onOpenRun: (runId: string) => void }) {
  if (!task.lastRunAt) return null;
  const runId = task.lastRunId && agentStore.getRun(owner, task.lastRunId) ? task.lastRunId : null;
  return runId
    ? <button type="button" className={s.linkButton} onClick={() => onOpenRun(runId)}>上次执行：{relativeTime(task.lastRunAt)}</button>
    : <span>上次执行：{relativeTime(task.lastRunAt)}</span>;
}

const nextRunText = (task: ScheduledTask) =>
  task.enabled && task.nextRunAt ? `下次执行：${dayTime(task.nextRunAt)}` : task.cadence === 'once' && task.lastRunAt ? '已执行，不再重复' : '已停用';

/* ── 主区编辑器：侧栏选中一条定时任务（或「新建定时」）时，主区只显示这一件事 ── */
interface EditorProps {
  owner: string | null;
  /** 为空表示新建 */
  task?: ScheduledTask;
  /** 新建时的初始草稿（如从目标输入框带过来的指令） */
  initial?: ScheduleDraft;
  topic?: TopicRef;
  onSaved: (task: ScheduledTask) => void;
  onDeleted: () => void;
  onCancel: () => void;
  onOpenRun: (runId: string) => void;
}

export function ScheduleEditor({ owner, task, initial, topic, onSaved, onDeleted, onCancel, onOpenRun }: EditorProps) {
  useMinuteTick();
  const [draft, setDraft] = useState<ScheduleDraft>(() => (task ? draftFromTask(task) : initial ?? emptyScheduleDraft()));
  const { ready } = checkDraft(draft);
  const saved = task ? draftFromTask(task) : null;
  const dirty = !saved || (['title', 'prompt', 'cadence', 'time', 'date', 'weekday'] as const).some((key) => draft[key] !== saved[key]);

  const save = () => {
    if (!ready) return;
    const next = submitDraft(owner, draft, topic);
    setDraft(draftFromTask(next));
    onSaved(next);
  };
  const remove = () => {
    if (!task) return;
    agentStore.removeSchedule(owner, task.id);
    toast('已删除定时任务', { description: task.title });
    onDeleted();
  };
  const runNow = () => {
    if (!task) return;
    const runId = runSchedule(owner, task.id, true);
    if (runId) onOpenRun(runId);
  };

  return (
    <article className={s.detail} aria-label={task ? task.title : '新建定时任务'}>
      <header className={s.detailHead}>
        <div className={s.detailHeading}>
          <div className={s.detailBadges}>
            <Badge tone="outline">定时任务</Badge>
            {task && <Badge tone={task.enabled ? 'ok' : 'neutral'} dot>{task.enabled ? '已启用' : '已停用'}</Badge>}
            {task && <Badge tone="outline">{describeCadence(task)}</Badge>}
            {task?.topicTitle && <Badge>{task.topicTitle}</Badge>}
          </div>
          <h2 className={s.detailTitle}>{task ? task.title : '新建定时任务'}</h2>
          <p className={s.detailMeta}>
            {task ? (
              <>
                <span>{nextRunText(task)}</span>
                <LastRun owner={owner} task={task} onOpenRun={onOpenRun} />
              </>
            ) : (
              <span>到点后由助理按这段指令执行一次任务，成果写进学习工作台。</span>
            )}
          </p>
        </div>
        {task && (
          <div className={s.actions}>
            <label className={s.option}>
              <Switch checked={task.enabled} onCheckedChange={(enabled) => setScheduleEnabled(owner, task.id, enabled)} label="启用" />
              <span>启用</span>
            </label>
            <Button variant="outline" icon={<Play size={14} strokeWidth={1.75} />} onClick={runNow}>立即运行</Button>
            <IconButton label="删除这条定时任务" onClick={remove}><Trash2 size={16} strokeWidth={1.75} /></IconButton>
          </div>
        )}
      </header>

      <section className={s.editorCard}>
        <ScheduleFields draft={draft} onChange={setDraft} topic={topic} />
        <div className={s.editorFoot}>
          {task
            ? dirty && <Button variant="ghost" onClick={() => setDraft(draftFromTask(task))}>撤销修改</Button>
            : <Button variant="ghost" onClick={onCancel}>取消</Button>}
          <Button variant="solid" disabled={!ready || !dirty} onClick={save}>{task ? '保存修改' : '创建'}</Button>
        </div>
      </section>
    </article>
  );
}

/* ── 主区列表 + 对话框：没有侧栏挂载位（手机、侧栏收起）时使用 ── */
interface PanelProps {
  owner: string | null;
  schedules: ScheduledTask[];
  topic?: TopicRef;
  draft: ScheduleDraft | null;
  onDraft: (draft: ScheduleDraft | null) => void;
  onOpenRun: (runId: string) => void;
}

export function SchedulePanel({ owner, schedules, topic, draft, onDraft, onOpenRun }: PanelProps) {
  useMinuteTick();

  const runNow = (task: ScheduledTask) => {
    const runId = runSchedule(owner, task.id, true);
    if (runId) onOpenRun(runId);
  };
  const remove = (task: ScheduledTask) => {
    agentStore.removeSchedule(owner, task.id);
    toast('已删除定时任务', { description: task.title });
  };

  return (
    <div className={s.schedules}>
      <div className={s.scheduleNote}>
        <Info size={16} strokeWidth={1.75} />
        <p>定时任务只在这个浏览器打开小白同学时执行。关着的时候不会运行；错过的任务会在下次打开时补跑一次。</p>
        <Button variant="solid" size="sm" icon={<Plus size={14} strokeWidth={2} />} onClick={() => onDraft(emptyScheduleDraft())}>新建</Button>
      </div>

      {schedules.length === 0 ? (
        <Empty
          icon={<CalendarClock size={22} strokeWidth={1.75} />}
          title="还没有定时任务"
          description="比如每天早上出 5 道昨天内容的复习题，或每周日晚上整理一周的错题。"
          action={<Button variant="soft" icon={<Plus size={14} strokeWidth={2} />} onClick={() => onDraft(emptyScheduleDraft())}>新建定时任务</Button>}
        />
      ) : (
        <ul className={s.scheduleList}>
          {schedules.map((task) => (
            <li key={task.id} className={s.scheduleRow} data-off={!task.enabled || undefined}>
              <Switch checked={task.enabled} onCheckedChange={(enabled) => setScheduleEnabled(owner, task.id, enabled)} label={`启用 ${task.title}`} />
              <div className={s.scheduleMain}>
                <div className={s.scheduleTitle}>
                  <strong>{task.title}</strong>
                  <Badge tone="outline">{describeCadence(task)}</Badge>
                  {task.topicTitle && <Badge>{task.topicTitle}</Badge>}
                </div>
                <p className={s.schedulePrompt}>{task.prompt}</p>
                <p className={s.scheduleMeta}>
                  <span>{nextRunText(task)}</span>
                  <LastRun owner={owner} task={task} onOpenRun={onOpenRun} />
                </p>
              </div>
              <div className={s.scheduleActions}>
                <IconButton label="立即运行一次" onClick={() => runNow(task)}><Play size={15} strokeWidth={1.75} /></IconButton>
                <IconButton label="编辑" onClick={() => onDraft(draftFromTask(task))}><Pencil size={15} strokeWidth={1.75} /></IconButton>
                <IconButton label="删除" onClick={() => remove(task)}><Trash2 size={15} strokeWidth={1.75} /></IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && <ScheduleDialog owner={owner} topic={topic} draft={draft} onDraft={onDraft} />}
    </div>
  );
}

function ScheduleDialog({ owner, topic, draft, onDraft }: Pick<PanelProps, 'owner' | 'topic'> & { draft: ScheduleDraft; onDraft: (draft: ScheduleDraft | null) => void }) {
  const { ready } = checkDraft(draft);
  const submit = () => {
    if (!ready) return;
    submitDraft(owner, draft, topic);
    onDraft(null);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open) onDraft(null); }}
      title={draft.id ? '编辑定时任务' : '新建定时任务'}
      description="到点后由助理按这段指令执行一次任务，成果写进学习工作台。"
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={() => onDraft(null)}>取消</Button>
          <Button variant="solid" disabled={!ready} onClick={submit}>{draft.id ? '保存' : '创建'}</Button>
        </>
      )}
    >
      <ScheduleFields draft={draft} onChange={onDraft} topic={topic} />
    </Dialog>
  );
}
