/**
 * 成果登记处 —— 把各板块「生成的东西」汇到一处，让它们不再各管各的。
 * 笔记、导图、题目集、闪卡、作文批改、对话里保存的产物、AI 课、助理任务成果、科研台文件……
 * 每个板块注册一个提供者；资料库、来源选择器、全局搜索、记忆都从这里取。
 * 登记处本身不存内容，只汇总；内容仍在各板块自己的存储里。
 */
import { useSyncExternalStore } from 'react';

export type ArtifactKind =
  | 'note' | 'mindmap' | 'quiz' | 'deck' | 'todo-list' | 'writing'
  | 'chat-artifact' | 'lesson' | 'agent-output' | 'research-file';

export const ARTIFACT_LABELS: Record<ArtifactKind, string> = {
  note: '笔记', mindmap: '思维导图', quiz: '题目集', deck: '闪卡', 'todo-list': '待办', writing: '作文与翻译',
  'chat-artifact': '对话产物', lesson: 'AI 课', 'agent-output': '助理成果', 'research-file': '科研文件',
};

/** 这份成果是从哪儿来的 */
export interface ArtifactOrigin {
  /** 来源板块 */
  section: 'chat' | 'workbench' | 'lesson' | 'agent' | 'research' | 'teach';
  /** 一句话说明，如「对话：学习率太大会怎样」「助理任务：整理这一课」 */
  label?: string;
  /** 能跳回来源的终端位置 */
  open?: { view: string; params?: Record<string, string>; topicId?: string };
}

export interface Artifact {
  /** 全局唯一：`${kind}:${id}` */
  key: string;
  kind: ArtifactKind;
  id: string;
  title: string;
  /** 一行摘要，列表里显示 */
  summary?: string;
  topicId?: string;
  topicTitle?: string;
  createdAt: string;
  updatedAt: string;
  /** user=自己写的 ai=模型生成的 */
  madeBy: 'user' | 'ai';
  origin: ArtifactOrigin;
  /** 在终端里打开它的位置 */
  open: { view: string; params?: Record<string, string>; topicId?: string };
}

/** 成果的可携带内容：用作对话来源、存入资料库、导出 */
export interface ArtifactContent {
  title: string;
  /** Markdown 正文（题目集、闪卡等结构化内容转写成可读文本） */
  text: string;
  /** 存成文件时的文件名与类型 */
  filename: string;
  mime: string;
}

export interface ArtifactProvider {
  list: (owner: string | null) => Artifact[];
  content: (owner: string | null, id: string) => Promise<ArtifactContent | null> | ArtifactContent | null;
  /** 提供者自己的数据变了就调用 notify，登记处会通知订阅方 */
  subscribe?: (notify: () => void) => () => void;
}

const providers = new Map<string, ArtifactProvider>();
const listeners = new Set<() => void>();
const unsubscribers = new Map<string, () => void>();
let version = 0;
const snapshots = new Map<string, { version: number; items: Artifact[] }>();
const notify = () => { version += 1; listeners.forEach((listener) => listener()); };

/** 板块在模块加载时注册自己的提供者；同名重复注册会替换旧的。 */
export function registerArtifactProvider(name: string, provider: ArtifactProvider): void {
  unsubscribers.get(name)?.();
  providers.set(name, provider);
  const off = provider.subscribe?.(notify);
  if (off) unsubscribers.set(name, off); else unsubscribers.delete(name);
  notify();
}

/** 汇总当前账号的全部成果，最近更新的在前。单个提供者出错不影响其他。 */
export function listArtifacts(owner: string | null): Artifact[] {
  const cacheKey = owner ?? '';
  const cached = snapshots.get(cacheKey);
  if (cached && cached.version === version) return cached.items;
  const items: Artifact[] = [];
  for (const provider of providers.values()) {
    try { items.push(...provider.list(owner)); } catch { /* 跳过出错的提供者 */ }
  }
  items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  snapshots.set(cacheKey, { version, items });
  return items;
}

export function findArtifact(owner: string | null, key: string): Artifact | undefined {
  return listArtifacts(owner).find((item) => item.key === key);
}

/** 取一份成果的可携带内容；找不到返回 null。 */
export async function artifactContent(owner: string | null, key: string): Promise<ArtifactContent | null> {
  const artifact = findArtifact(owner, key);
  if (!artifact) return null;
  for (const provider of providers.values()) {
    try {
      if (!provider.list(owner).some((item) => item.key === key)) continue;
      return await provider.content(owner, artifact.id);
    } catch { /* 换下一个 */ }
  }
  return null;
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/** 订阅当前账号的成果列表 */
export function useArtifacts(owner: string | null): Artifact[] {
  return useSyncExternalStore(subscribe, () => listArtifacts(owner), () => listArtifacts(owner));
}

/** 提供者数据变化但没有 subscribe 能力时，手动通知一次 */
export const notifyArtifactsChanged = notify;
