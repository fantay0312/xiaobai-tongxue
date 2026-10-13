/**
 * 科研台的数据契约：课题 → 会话（事件日志）+ 课题文件 + 文献列表。
 * 全部按账号保存在当前浏览器：元数据在 store/researchStore.ts，文件内容在 IndexedDB（workspace.ts）。
 */
import type { ChatMessage } from '../../lib/modelGateway';
import type { Paper } from '../../lib/researchConnectors';

/** ask = 每步询问；risky = 仅高风险询问；auto = 全自动 */
export type PermissionMode = 'ask' | 'risky' | 'auto';

export interface ProjectGoal {
  objective: string;
  /** 验收标准 */
  criteria: string[];
  updatedAt: string;
}

export interface ResearchProject {
  id: string;
  title: string;
  goal?: ProjectGoal;
  permission: PermissionMode;
  createdAt: string;
  updatedAt: string;
}

/** 文件的一条来历：谁、在哪次会话的第几轮、用什么工具写的 */
export interface Provenance {
  at: string;
  actor: 'agent' | 'worker' | 'python' | 'user';
  action: 'create' | 'update';
  tool?: string;
  sessionId?: string;
  sessionTitle?: string;
  turn?: number;
  note?: string;
}

export interface FileMeta {
  path: string;
  /** utf8 = 文本；dataurl = 小体积二进制（图、表格文件等），内容是 data URL */
  encoding: 'utf8' | 'dataurl';
  mime: string;
  /** 字节数（文本按 UTF-8 估算） */
  size: number;
  createdAt: string;
  updatedAt: string;
  provenance: Provenance[];
}

export interface SavedPaper extends Paper {
  savedAt: string;
  note?: string;
  sessionId?: string;
}

export type PlanStatus = 'pending' | 'active' | 'done' | 'skipped';
export interface PlanItem {
  id: string;
  text: string;
  status: PlanStatus;
}

/** /plan 产出的计划书 */
export interface PlanProposal {
  objective: string;
  steps: string[];
  sources: string[];
  outputs: string[];
  risks: string[];
  /** 模型没有按结构给出时的原文 */
  raw?: string;
}

export type StepStatus = 'running' | 'done' | 'error' | 'denied';

/** 并行助手的一条泳道 */
export interface WorkerLane {
  id: string;
  title: string;
  brief: string;
  status: 'queued' | 'running' | 'done' | 'error';
  steps: number;
  /** 依次做过的事，如「检索 graph neural network」 */
  trail: string[];
  summary?: string;
  sources?: string[];
}

/** 展示用的文献行（摘要已截短） */
export interface PaperRow {
  id: string;
  source: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url: string;
  openAccessUrl?: string;
  citedBy?: number;
  abstract?: string;
}

/** 工具卡片展开后看到的内容（随事件日志保存，长内容已截短） */
export type ToolView =
  | { kind: 'papers'; query: string; papers: PaperRow[]; total: number }
  | { kind: 'paper'; paper: PaperRow; chars: number; fullText: boolean; truncated: boolean }
  | { kind: 'saved'; paper: PaperRow; total: number }
  | {
      kind: 'python';
      code: string;
      ok: boolean;
      stdout: string;
      stderr: string;
      error?: string;
      result?: string;
      /** 存进课题文件的图的路径 */
      figures: string[];
      files: string[];
      durationMs: number;
      savedAs?: string;
    }
  | { kind: 'write'; path: string; created: boolean; before?: string; after: string; chars: number }
  | { kind: 'edit'; path: string; oldText: string; newText: string; count: number }
  | { kind: 'read'; path: string; excerpt: string; chars: number; truncated: boolean }
  | { kind: 'files'; files: { path: string; size: number }[] }
  | { kind: 'delete'; path: string }
  | { kind: 'library'; title: string; excerpt: string; chars: number; truncated: boolean }
  | { kind: 'libraryList'; files: { id: string; name: string; status: string }[] };

export type ApprovalStatus = 'pending' | 'allowed' | 'allowed_session' | 'denied' | 'expired';

interface EventBase {
  id: string;
  at: string;
}

export type ResearchEvent =
  | (EventBase & { type: 'user'; text: string; command?: string; attachments?: string[] })
  | (EventBase & { type: 'thinking'; text: string; streaming?: boolean })
  | (EventBase & { type: 'text'; text: string; streaming?: boolean })
  | (EventBase & {
      type: 'tool';
      callId: string;
      name: string;
      /** 参数 JSON（长字符串已截短，仅用于展示） */
      args: string;
      status: StepStatus;
      /** 回给模型的结果（已截短） */
      result?: string;
      view?: ToolView;
      /** 运行中的实时输出（Python 标准输出） */
      live?: string;
      lanes?: WorkerLane[];
      ms?: number;
    })
  | (EventBase & {
      type: 'approval';
      tool: string;
      title: string;
      detail: string;
      /** 高风险动作用警示色 */
      risk: boolean;
      status: ApprovalStatus;
      reason?: string;
    })
  | (EventBase & { type: 'question'; question: string; options: string[]; status: 'pending' | 'answered' | 'expired'; answer?: string })
  | (EventBase & { type: 'plan'; plan: PlanProposal; task: string; status: 'pending' | 'approved' | 'dismissed' })
  | (EventBase & { type: 'notice'; tone: 'info' | 'warn' | 'bad'; text: string })
  | (EventBase & {
      type: 'final';
      text: string;
      files: { path: string; exists: boolean }[];
      sources: { label: string; verified: boolean; url?: string }[];
    });

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ResearchEventInput = DistributiveOmit<ResearchEvent, 'id' | 'at'>;
export type ResearchEventPatch = Partial<{
  text: string;
  streaming: boolean;
  status: string;
  result: string;
  view: ToolView;
  live: string;
  lanes: WorkerLane[];
  ms: number;
  reason: string;
  answer: string;
}>;

/** idle = 等用户下一句；waiting = 等批准或回答；paused = 被刷新打断或步数用完，可以继续 */
export type SessionStatus = 'idle' | 'running' | 'waiting' | 'paused' | 'error';

export interface ResearchSession {
  id: string;
  projectId: string;
  title: string;
  status: SessionStatus;
  events: ResearchEvent[];
  /** 置顶的计划清单 */
  plan: PlanItem[];
  /** 对话记录（已截短），用于下一轮与刷新后续跑 */
  messages?: ChatMessage[];
  /** 「本次会话都允许」的权限键 */
  allow: string[];
  turns: number;
  steps: number;
  model?: string;
  tokens?: number;
  /** 最近一轮的运行方式；被打断后续跑时沿用 */
  lastMode?: TurnMode;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchData {
  projects: ResearchProject[];
  sessions: ResearchSession[];
  /** projectId → 文件元数据 */
  files: Record<string, FileMeta[]>;
  /** projectId → 已保存的文献 */
  papers: Record<string, SavedPaper[]>;
}

/** 一轮对话的运行方式 */
export type TurnMode = 'normal' | 'plan' | 'goal';

/** 随一轮对话附带的内容：课题文件、别的板块的成果、资料库文档 */
export type Attachment =
  | { kind: 'file'; path: string }
  | { kind: 'artifact'; key: string; title: string }
  | { kind: 'library'; id: string; name: string };
