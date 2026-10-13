/**
 * 助理任务（Agent）的数据契约：一次运行 = 一条事件日志 + 状态 + 写进工作台的成果引用。
 * 运行与定时任务按账号保存在当前浏览器（store/agentStore.ts）。
 */
import type { ChatMessage } from '../../lib/modelGateway';

/** 工作台里的工具页签 id，与 onView('workbench', { tool, id }) 对应 */
export type WorkbenchTool = 'notes' | 'mindmap' | 'quiz' | 'flashcards' | 'todos' | 'writing';

/** 一次工具调用写出的成果引用；schedule 指向「定时任务」页签 */
export interface ProducedItem {
  kind: WorkbenchTool | 'schedule';
  id: string;
  title: string;
}

export type StepStatus = 'running' | 'done' | 'error';

/** 子代理的一条泳道 */
export interface SubAgentLane {
  id: string;
  title: string;
  brief: string;
  /** 这条泳道可用的工具名 */
  tools: string[];
  status: 'queued' | StepStatus;
  steps: number;
  /** 依次调用过的工具名 */
  trail: string[];
  result?: string;
  produced: ProducedItem[];
}

interface EventBase {
  id: string;
  at: string;
}

export type AgentEvent =
  | (EventBase & { type: 'user'; text: string })
  | (EventBase & { type: 'thinking'; text: string; streaming?: boolean })
  | (EventBase & { type: 'text'; text: string; streaming?: boolean })
  | (EventBase & {
      type: 'tool';
      callId: string;
      name: string;
      /** 参数 JSON（长字符串已截短，仅用于展示） */
      args: string;
      status: StepStatus;
      result?: string;
      produced?: ProducedItem[];
      lanes?: SubAgentLane[];
      ms?: number;
    })
  | (EventBase & { type: 'notice'; tone: 'info' | 'warn' | 'bad'; text: string })
  | (EventBase & { type: 'summary'; text: string });

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type AgentEventInput = DistributiveOmit<AgentEvent, 'id' | 'at'>;

/** 对已有事件的增量修改（流式文本、工具结果、泳道进度） */
export interface AgentEventPatch {
  text?: string;
  streaming?: boolean;
  status?: StepStatus;
  result?: string;
  produced?: ProducedItem[];
  lanes?: SubAgentLane[];
  ms?: number;
}

export interface GoalItem {
  id: string;
  text: string;
  done: boolean;
}

/** paused = 步数用完或被刷新打断，可以继续；stopped = 用户手动停止 */
export type RunStatus = 'running' | 'paused' | 'done' | 'stopped' | 'error';

export interface RunOptions {
  /** 目标模式：模型维护一份清单，未完成可跨轮续跑 */
  goalMode: boolean;
  /** 允许派出子代理并行处理 */
  subagents: boolean;
  /** 每一轮最多走多少步（一次模型调用算一步） */
  stepBudget: number;
  /** 目标模式下步数用完后自动续跑 */
  autoContinue: boolean;
  /** 自动续跑的总轮数上限 */
  maxRounds: number;
}

export interface AgentRun {
  id: string;
  title: string;
  goal: string;
  status: RunStatus;
  /** demo = 没有可用模型时的本地演示 */
  mode: 'model' | 'demo';
  options: RunOptions;
  topicId?: string;
  topicTitle?: string;
  sourceTitles: string[];
  events: AgentEvent[];
  produced: ProducedItem[];
  checklist: GoalItem[];
  rounds: number;
  steps: number;
  /** 对话记录（已截短），用于刷新后续跑；完成后清掉 */
  messages?: ChatMessage[];
  summary?: string;
  error?: string;
  model?: string;
  tokens?: number;
  scheduleId?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export type Cadence = 'once' | 'daily' | 'weekly';

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  cadence: Cadence;
  /** HH:mm，本地时间 */
  time: string;
  /** cadence=once 时的日期 YYYY-MM-DD */
  date?: string;
  /** cadence=weekly 时的星期，0=周日 … 6=周六 */
  weekday?: number;
  /** 下一次执行时间（ISO）；一次性任务执行后为 null */
  nextRunAt: string | null;
  lastRunAt?: string;
  lastRunId?: string;
  enabled: boolean;
  topicId?: string;
  topicTitle?: string;
  createdAt: string;
}

export interface AgentData {
  runs: AgentRun[];
  schedules: ScheduledTask[];
}
