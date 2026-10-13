/**
 * 对话 → 成果登记处：各门课（以及不带课程的资料对话）里保存下来的学习产物 —— 报告、导图、课件、表格……
 * 工作区按「账号 + 课程」分开存在浏览器里，这里把当前账号名下的全部工作区扫一遍。
 * 同时给命令面板和开始页提供「全部对话」的目录。
 */
import { getTopic } from '../../data';
import { STUDIO_LABELS, artifactMarkdown, restoreArtifacts, type StudyArtifact } from '../../engine/studyStudio';
import { registerArtifactProvider, type Artifact } from '../artifacts';

/** 不带课程的资料对话用的工作区名（与 pages/learn/index.tsx 一致） */
export const FREE_WORKSPACE = 'library-chat';

export interface ConversationBrief {
  /** 工作区名：课程 id，或 library-chat */
  workspace: string;
  /** 所属课程；资料对话没有 */
  topicId?: string;
  topicTitle?: string;
  id: string;
  title: string;
  messages: number;
  /** 最近一次提问的时间（毫秒）；早先的对话没有记录时为 0 */
  at: number;
}

interface WorkspaceBrief {
  workspace: string;
  topicId?: string;
  topicTitle?: string;
  conversations: ConversationBrief[];
  artifacts: StudyArtifact[];
}

const ownerPart = (owner: string | null) => encodeURIComponent(owner ?? 'local-demo');
const workspacePrefix = (owner: string | null) => `xiaobai-study-v1:${ownerPart(owner)}:`;
const recentsKey = (owner: string | null) => `xiaobai-chat-recents-v1:${ownerPart(owner)}`;

const cache = new Map<string, WorkspaceBrief[]>();
const listeners = new Set<() => void>();

function readRecents(owner: string | null): Record<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(recentsKey(owner)) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function scan(owner: string | null): WorkspaceBrief[] {
  const cacheKey = owner ?? '';
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const result: WorkspaceBrief[] = [];
  try {
    const prefix = workspacePrefix(owner);
    const recents = readRecents(owner);
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      let workspace = '';
      try { workspace = decodeURIComponent(key.slice(prefix.length)); } catch { continue; }
      if (!workspace) continue;
      let raw: { conversations?: unknown; artifacts?: unknown } | null = null;
      try { raw = JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { raw = null; }
      if (!raw || !Array.isArray(raw.conversations)) continue;
      const topic = workspace === FREE_WORKSPACE ? undefined : getTopic(workspace);
      const topicId = workspace === FREE_WORKSPACE ? undefined : workspace;
      const conversations: ConversationBrief[] = [];
      for (const chat of raw.conversations as { id?: unknown; title?: unknown; messages?: unknown }[]) {
        if (!chat || typeof chat.id !== 'string' || !Array.isArray(chat.messages) || !chat.messages.length) continue;
        const started = (chat.messages as { run?: { startedAt?: unknown } }[]).reduce((latest, message) => Math.max(latest, Number(message?.run?.startedAt) || 0), 0);
        conversations.push({
          workspace,
          ...(topicId ? { topicId } : {}),
          ...(topic ? { topicTitle: topic.title } : {}),
          id: chat.id,
          title: String(chat.title ?? '学习对话').slice(0, 80),
          messages: chat.messages.length,
          at: Number(recents[`${workspace}/${chat.id}`]) || started,
        });
      }
      result.push({ workspace, ...(topicId ? { topicId } : {}), ...(topic ? { topicTitle: topic.title } : {}), conversations, artifacts: restoreArtifacts(raw.artifacts) });
    }
  } catch {
    /* 本地存储不可用时当作没有 */
  }
  cache.set(cacheKey, result);
  return result;
}

/** 当前账号名下所有有内容的对话，最近的在前 */
export function listConversations(owner: string | null): ConversationBrief[] {
  return scan(owner).flatMap((item) => item.conversations).sort((a, b) => b.at - a.at);
}

/** 记一次「这段对话刚刚用过」，开始页的最近一行靠它排序 */
export function touchConversation(owner: string | null, workspace: string, chatId: string): void {
  try {
    const entries = Object.entries({ ...readRecents(owner), [`${workspace}/${chatId}`]: Date.now() }).sort((a, b) => b[1] - a[1]).slice(0, 60);
    localStorage.setItem(recentsKey(owner), JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* 记不住只影响排序 */
  }
  chatWorkspaceChanged();
}

/** 终端保存了工作区（新产物、新对话、改名、删除）后调用，让登记处重新读 */
export function chatWorkspaceChanged(): void {
  cache.clear();
  listeners.forEach((listener) => listener());
}

const artifactId = (workspace: string, id: string) => `${workspace}/${id}`;

function toArtifact(item: WorkspaceBrief, artifact: StudyArtifact): Artifact {
  const chat = item.conversations.find((conversation) => conversation.id === artifact.conversationId);
  const id = artifactId(item.workspace, artifact.id);
  const stamp = Number.isFinite(Date.parse(artifact.createdAt)) ? artifact.createdAt : new Date(0).toISOString();
  return {
    key: `chat-artifact:${id}`,
    kind: 'chat-artifact',
    id,
    title: artifact.title,
    summary: `${STUDIO_LABELS[artifact.kind]} · ${artifact.sections.length} 节${artifact.method === 'model' ? '' : ' · 资料摘编'}`,
    ...(item.topicId ? { topicId: item.topicId } : {}),
    ...(item.topicTitle ? { topicTitle: item.topicTitle } : {}),
    createdAt: stamp,
    updatedAt: stamp,
    madeBy: 'ai',
    origin: {
      section: 'chat',
      label: chat ? `对话：${chat.title}` : item.topicTitle ? `对话：${item.topicTitle}` : '资料对话',
      open: { view: 'ask', ...(artifact.conversationId ? { params: { chat: artifact.conversationId } } : {}), ...(item.topicId ? { topicId: item.topicId } : {}) },
    },
    open: { view: 'studio', params: { artifact: artifact.id }, ...(item.topicId ? { topicId: item.topicId } : {}) },
  };
}

registerArtifactProvider('chat', {
  list: (owner) => scan(owner).flatMap((item) => item.artifacts.map((artifact) => toArtifact(item, artifact))),
  content: (owner, id) => {
    for (const item of scan(owner)) {
      const artifact = item.artifacts.find((candidate) => artifactId(item.workspace, candidate.id) === id);
      if (!artifact) continue;
      return { title: artifact.title, text: artifactMarkdown(artifact), filename: `${artifact.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || '学习产物'}.md`, mime: 'text/markdown' };
    }
    return null;
  },
  subscribe: (notify) => {
    listeners.add(notify);
    // 另一个标签页里的改动
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith('xiaobai-study-v1:')) { cache.clear(); notify(); }
    };
    window.addEventListener('storage', onStorage);
    return () => { listeners.delete(notify); window.removeEventListener('storage', onStorage); };
  },
});
