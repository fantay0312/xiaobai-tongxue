import { CalendarClock, CircleAlert, CircleCheck, CirclePause, CircleStop, Ellipsis, Plus, RotateCw, Trash2 } from 'lucide-react';
import { IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Spinner } from '../../../../components/ui';
import type { AgentRun, RunStatus, ScheduledTask } from '../../../../engine/agent';
import { SideAction, SideEmpty, SideGroup, SideNavItem, SidePanel } from '../../shell/sidebarSlot';
import { dayTime, goalProgress, relativeTime } from './format';

/** 主区当前显示的那一件事；schedule 的 id 为 null 表示「新建定时」 */
export type AgentSelection =
  | { kind: 'new' }
  | { kind: 'run'; id: string }
  | { kind: 'schedule'; id: string | null };

const ICON = { size: 16, strokeWidth: 1.75 } as const;

function RunIcon({ status }: { status: RunStatus }) {
  if (status === 'running') return <Spinner size={16} />;
  if (status === 'done') return <CircleCheck {...ICON} />;
  if (status === 'paused') return <CirclePause {...ICON} />;
  if (status === 'error') return <CircleAlert {...ICON} />;
  return <CircleStop {...ICON} />;
}

const HISTORY_SUB: Partial<Record<RunStatus, string>> = { stopped: '已停止', error: '出错' };

interface Props {
  runs: AgentRun[];
  schedules: ScheduledTask[];
  selection: AgentSelection;
  onSelect: (selection: AgentSelection) => void;
  onNewSchedule: () => void;
  onRerun: (run: AgentRun) => void;
  onDelete: (run: AgentRun) => void;
}

/** 助理任务板块的侧栏导航：进行中 / 历史 / 定时任务。只用外壳提供的共享侧栏件。 */
export function AgentSidebar({ runs, schedules, selection, onSelect, onNewSchedule, onRerun, onDelete }: Props) {
  const live = runs.filter((run) => run.status === 'running' || run.status === 'paused');
  const history = runs.filter((run) => run.status !== 'running' && run.status !== 'paused');
  const isRun = (id: string) => selection.kind === 'run' && selection.id === id;

  return (
    <SidePanel
      title="助理任务"
      action={<SideAction icon={<Plus {...ICON} />} onClick={() => onSelect({ kind: 'new' })}>新建任务</SideAction>}
      footer="定时任务在应用打开时执行"
    >
      <SideGroup label="进行中">
        {live.length === 0 && <SideEmpty>没有正在进行的任务</SideEmpty>}
        {live.map((run) => {
          const progress = goalProgress(run);
          return (
            <SideNavItem
              key={run.id}
              icon={<RunIcon status={run.status} />}
              label={run.title}
              sub={run.status === 'paused' ? '已暂停，可以继续推进' : progress.total ? `清单 ${progress.done}/${progress.total}` : undefined}
              meta={run.status === 'paused' ? '暂停' : `${run.steps} 步`}
              active={isRun(run.id)}
              title={run.goal}
              onClick={() => onSelect({ kind: 'run', id: run.id })}
            />
          );
        })}
      </SideGroup>

      <SideGroup label="历史">
        {history.length === 0 && <SideEmpty>完成的任务会留在这里</SideEmpty>}
        {history.map((run) => (
          <SideNavItem
            key={run.id}
            icon={<RunIcon status={run.status} />}
            label={run.title}
            sub={[relativeTime(run.finishedAt ?? run.updatedAt), HISTORY_SUB[run.status] ?? (run.produced.length ? `${run.produced.length} 项成果` : '')].filter(Boolean).join(' · ')}
            active={isRun(run.id)}
            title={run.goal}
            onClick={() => onSelect({ kind: 'run', id: run.id })}
            trailing={(
              <Menu>
                <MenuTrigger asChild>
                  <IconButton label="更多操作" size="sm" tip={false}><Ellipsis size={15} strokeWidth={1.75} /></IconButton>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem icon={<RotateCw size={15} strokeWidth={1.75} />} onSelect={() => onRerun(run)}>重跑</MenuItem>
                  <MenuItem icon={<Trash2 size={15} strokeWidth={1.75} />} danger onSelect={() => onDelete(run)}>删除</MenuItem>
                </MenuContent>
              </Menu>
            )}
          />
        ))}
      </SideGroup>

      <SideGroup
        label="定时任务"
        action={<IconButton label="新建定时" size="sm" onClick={onNewSchedule}><Plus size={15} strokeWidth={1.75} /></IconButton>}
      >
        {schedules.length === 0 && <SideEmpty>还没有定时任务</SideEmpty>}
        {schedules.map((task) => (
          <SideNavItem
            key={task.id}
            icon={<CalendarClock {...ICON} />}
            label={task.title}
            sub={task.enabled && task.nextRunAt ? `下次 ${dayTime(task.nextRunAt)}` : task.cadence === 'once' && task.lastRunAt ? '已执行' : '已停用'}
            meta={task.enabled ? '开' : '停'}
            active={selection.kind === 'schedule' && selection.id === task.id}
            title={task.prompt}
            onClick={() => onSelect({ kind: 'schedule', id: task.id })}
          />
        ))}
      </SideGroup>
    </SidePanel>
  );
}
