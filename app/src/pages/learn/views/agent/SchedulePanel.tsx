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

interface Props {
  owner: string | null;
  schedules: ScheduledTask[];
  topic?: { topicId: string; title: string };
  draft: ScheduleDraft | null;
  onDraft: (draft: ScheduleDraft | null) => void;
  onOpenRun: (runId: string) => void;
}

export function SchedulePanel({ owner, schedules, topic, draft, onDraft, onOpenRun }: Props) {
  // 每分钟刷新一次「下次执行」的相对时间
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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
                  <span>{task.enabled && task.nextRunAt ? `下次执行：${dayTime(task.nextRunAt)}` : task.cadence === 'once' && task.lastRunAt ? '已执行，不再重复' : '已停用'}</span>
                  {task.lastRunAt && (
                    task.lastRunId && agentStore.getRun(owner, task.lastRunId)
                      ? <button type="button" className={s.linkButton} onClick={() => onOpenRun(task.lastRunId as string)}>上次执行：{relativeTime(task.lastRunAt)}</button>
                      : <span>上次执行：{relativeTime(task.lastRunAt)}</span>
                  )}
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

function ScheduleDialog({ owner, topic, draft, onDraft }: Pick<Props, 'owner' | 'topic'> & { draft: ScheduleDraft; onDraft: (draft: ScheduleDraft | null) => void }) {
  const set = (patch: Partial<ScheduleDraft>) => onDraft({ ...draft, ...patch });
  const timing = {
    cadence: draft.cadence,
    time: draft.time,
    ...(draft.cadence === 'once' ? { date: draft.date } : {}),
    ...(draft.cadence === 'weekly' ? { weekday: draft.weekday } : {}),
  };
  const next = isValidTime(draft.time) ? computeNextRun(timing) : null;
  const timeError = !isValidTime(draft.time)
    ? '请填写时间'
    : draft.cadence === 'once' && !isValidDate(draft.date)
      ? '请选择日期'
      : draft.cadence === 'once' && next && Date.parse(next) <= Date.now()
        ? '这个时间已经过去了'
        : '';
  const ready = draft.prompt.trim().length > 0 && !timeError;

  const submit = () => {
    if (!ready) return;
    const existing = draft.id ? agentStore.get(owner).schedules.find((task) => task.id === draft.id) : undefined;
    const task = saveSchedule(owner, {
      ...timing,
      title: draft.title,
      prompt: draft.prompt,
      // 编辑时保留原来绑定的课程；新建时绑定当前打开的课程
      ...(existing
        ? (existing.topicId ? { topicId: existing.topicId, topicTitle: existing.topicTitle } : {})
        : topic ? { topicId: topic.topicId, topicTitle: topic.title } : {}),
    }, draft.id);
    toast.success(draft.id ? '已保存定时任务' : '已创建定时任务', { description: task.nextRunAt ? `下次执行：${dayTime(task.nextRunAt)}` : undefined });
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
        <p className={s.formHint}>
          {next && !timeError ? `下次执行：${dayTime(next)}。` : ''}只在这个浏览器打开小白同学时执行，错过的会在下次打开时补跑一次。
        </p>
      </div>
    </Dialog>
  );
}
