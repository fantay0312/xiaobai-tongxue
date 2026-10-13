import { useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Bot,
  Brain,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  Flag,
  GitFork,
  Info,
  Languages,
  Layers,
  Library,
  ListChecks,
  ListTodo,
  MessageSquareText,
  Network,
  NotebookPen,
  PenLine,
  Search,
  Target,
  FileText,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Shimmer, Spinner, ThinkingDots } from '../../../../components/ui';
import { CoachMarkdown } from '../../../../components/coach/CoachMarkdown';
import type { AgentEvent, AgentRun, ProducedItem, SubAgentLane } from '../../../../engine/agent';
import { KIND_LABELS, describeCall, describeResult, duration, prettyJson, toolLabel } from './format';
import s from './agent.module.css';

const ICON = { size: 15, strokeWidth: 1.75 } as const;

const TOOL_ICONS: Record<string, LucideIcon> = {
  save_note: NotebookPen,
  create_mindmap: Network,
  create_quiz_set: ListChecks,
  create_flashcards: Layers,
  add_todos: ListTodo,
  review_essay: PenLine,
  translate_text: Languages,
  list_workbench: Library,
  search_materials: Search,
  read_material: FileText,
  spawn_subagents: GitFork,
  schedule_task: CalendarClock,
  update_goal: Target,
};

const KIND_ICONS: Record<ProducedItem['kind'], LucideIcon> = {
  notes: NotebookPen,
  mindmap: Network,
  quiz: ListChecks,
  flashcards: Layers,
  todos: ListTodo,
  writing: PenLine,
  schedule: CalendarClock,
};

type OpenItem = (item: ProducedItem) => void;

/** 成果标签：点击打开工作台里对应的内容 */
export function ProducedChips({ items, onOpen }: { items: ProducedItem[]; onOpen: OpenItem }) {
  if (!items.length) return null;
  return (
    <div className={s.chips}>
      {items.map((item) => {
        const Icon = KIND_ICONS[item.kind];
        return (
          <button key={`${item.kind}:${item.id}`} type="button" className={s.chip} onClick={() => onOpen(item)} title={`打开${KIND_LABELS[item.kind]}：${item.title}`}>
            <span className={s.chipIcon}><Icon size={14} strokeWidth={1.75} /></span>
            <span className={s.chipKind}>{KIND_LABELS[item.kind]}</span>
            <span className={s.chipTitle}>{item.title}</span>
            <ArrowUpRight size={13} strokeWidth={1.75} className={s.chipArrow} />
          </button>
        );
      })}
    </div>
  );
}

function Row({ icon, tone, children }: { icon: ReactNode; tone?: 'accent' | 'ok' | 'bad' | 'warn'; children: ReactNode }) {
  return (
    <li className={s.item}>
      <span className={s.node} data-tone={tone}>{icon}</span>
      <div className={s.itemBody}>{children}</div>
    </li>
  );
}

function ThinkingBlock({ event }: { event: Extract<AgentEvent, { type: 'thinking' }> }) {
  // 流式时默认展开，结束后收起；手动点过就按用户的选择
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? !!event.streaming;
  return (
    <div className={s.thinking}>
      <button type="button" className={s.thinkingHead} aria-expanded={open} onClick={() => setManual(!open)}>
        {event.streaming ? <Shimmer>正在思考…</Shimmer> : <span>思考过程</span>}
        <ChevronRight size={14} strokeWidth={1.75} className={s.chevron} />
      </button>
      {open && <div className={s.thinkingBody} data-streaming={event.streaming || undefined}>{event.text}</div>}
    </div>
  );
}

function LaneCard({ lane, onOpen }: { lane: SubAgentLane; onOpen: OpenItem }) {
  return (
    <div className={s.lane} data-status={lane.status}>
      <div className={s.laneHead}>
        <span className={s.laneIcon}><Bot size={15} strokeWidth={1.75} /></span>
        <strong>{lane.title}</strong>
        {lane.status === 'running' && <Shimmer className={s.laneState}>进行中</Shimmer>}
        {lane.status === 'queued' && <Badge>排队中</Badge>}
        {lane.status === 'done' && <Badge tone="ok" dot>完成</Badge>}
        {lane.status === 'error' && <Badge tone="bad" dot>未完成</Badge>}
      </div>
      <p className={s.laneBrief}>{lane.brief}</p>
      {lane.trail.length > 0 && (
        <ol className={s.trail} aria-label="已调用的工具">
          {lane.trail.map((name, index) => <li key={`${name}-${index}`}>{toolLabel(name)}</li>)}
          {lane.status === 'running' && <li className={s.trailLive}><ThinkingDots label="进行中" /></li>}
        </ol>
      )}
      {lane.result && <p className={s.laneResult}>{lane.result}</p>}
      <ProducedChips items={lane.produced} onOpen={onOpen} />
    </div>
  );
}

function ToolCard({ event, onOpen }: { event: Extract<AgentEvent, { type: 'tool' }>; onOpen: OpenItem }) {
  const [open, setOpen] = useState(false);
  const summary = describeCall(event.name, event.args);
  const result = event.status === 'running' ? '' : describeResult(event.name, event.result);
  const lanes = event.lanes ?? [];
  // 子代理的成果显示在各自泳道里，这里不再重复
  const produced = lanes.length ? [] : event.produced ?? [];
  const hasFoot = !!result || lanes.length > 0 || produced.length > 0;
  return (
    <div className={s.tool} data-status={event.status}>
      <button type="button" className={s.toolHead} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className={s.toolName}>{toolLabel(event.name)}</span>
        <span className={s.toolArgs}>{summary}</span>
        <span className={s.toolState}>
          {event.status === 'running' && <><Spinner size={14} /><Shimmer>执行中</Shimmer></>}
          {event.status === 'done' && <>{event.ms !== undefined && <span>{duration(event.ms)}</span>}<Check size={14} strokeWidth={2} className={s.okMark} /></>}
          {event.status === 'error' && <><span>失败</span><CircleAlert size={14} strokeWidth={1.75} className={s.badMark} /></>}
        </span>
        <ChevronRight size={14} strokeWidth={1.75} className={s.chevron} />
      </button>
      {hasFoot && (
        <div className={s.toolFoot}>
          {result && <p className={s.toolResult} data-error={event.status === 'error' || undefined}>{result}</p>}
          {lanes.length > 0 && <div className={s.lanes}>{lanes.map((lane) => <LaneCard key={lane.id} lane={lane} onOpen={onOpen} />)}</div>}
          <ProducedChips items={produced} onOpen={onOpen} />
        </div>
      )}
      {open && (
        <div className={s.toolBody}>
          <div>
            <span className={s.codeLabel}>参数</span>
            <pre className={s.code}>{prettyJson(event.args) || '（无）'}</pre>
          </div>
          {event.result && (
            <div>
              <span className={s.codeLabel}>结果</span>
              <pre className={s.code}>{prettyJson(event.result)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ event, onOpen }: { event: AgentEvent; onOpen: OpenItem }) {
  switch (event.type) {
    case 'user':
      return (
        <Row icon={<Target {...ICON} />} tone="accent">
          <p className={s.goalText}>{event.text}</p>
        </Row>
      );
    case 'thinking':
      return (
        <Row icon={<Brain {...ICON} />}>
          <ThinkingBlock event={event} />
        </Row>
      );
    case 'text':
      return (
        <Row icon={<MessageSquareText {...ICON} />}>
          <div className={s.prose}><CoachMarkdown text={event.text} /></div>
        </Row>
      );
    case 'tool': {
      // 清单本身显示在上方，这里只留一行记录，避免时间线被重复的卡片占满
      if (event.name === 'update_goal' && event.status === 'done') {
        return (
          <Row icon={<Target {...ICON} />}>
            <p className={s.notice}>更新目标清单 · {describeCall(event.name, event.args)}</p>
          </Row>
        );
      }
      const Icon = TOOL_ICONS[event.name] ?? Wrench;
      return (
        <Row icon={<Icon {...ICON} />} tone={event.status === 'running' ? 'accent' : event.status === 'error' ? 'bad' : undefined}>
          <ToolCard event={event} onOpen={onOpen} />
        </Row>
      );
    }
    case 'notice':
      return (
        <Row icon={event.tone === 'info' ? <Info {...ICON} /> : <CircleAlert {...ICON} />} tone={event.tone === 'bad' ? 'bad' : event.tone === 'warn' ? 'warn' : undefined}>
          <p className={s.notice} data-tone={event.tone}>{event.text}</p>
        </Row>
      );
    case 'summary':
      return (
        <Row icon={<Flag {...ICON} />} tone="ok">
          <div className={s.summary}>
            <span className={s.summaryLabel}>任务小结</span>
            <CoachMarkdown text={event.text} />
          </div>
        </Row>
      );
    default:
      return null;
  }
}

export function Timeline({ run, onOpen }: { run: AgentRun; onOpen: OpenItem }) {
  const last = run.events[run.events.length - 1];
  // 两步之间（上一个事件已收尾、下一次模型调用还没出字）给一个进行中的提示
  const waiting = run.status === 'running'
    && !(last && ((last.type === 'thinking' || last.type === 'text') && last.streaming))
    && !(last && last.type === 'tool' && last.status === 'running');
  return (
    <ol className={s.timeline} aria-label="执行过程">
      {run.events.map((event) => <EventRow key={event.id} event={event} onOpen={onOpen} />)}
      {waiting && (
        <li className={s.item} aria-live="polite">
          <span className={s.node} data-tone="accent"><Spinner size={14} /></span>
          <div className={s.itemBody}><p className={s.waiting}><Shimmer>正在推进…</Shimmer></p></div>
        </li>
      )}
    </ol>
  );
}
