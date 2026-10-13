/**
 * 助理任务 → 成果登记处：每次跑完的任务，它的最终小结是一份成果。
 * 任务过程中写进工作台的笔记、导图、题目等由工作台自己登记；这里另外提供按成果反查「是哪次任务做的」。
 */
import type { AgentRun, ProducedItem } from '../../engine/agent/types';
import { agentStore } from '../../store/agentStore';
import { registerArtifactProvider, type Artifact, type ArtifactOrigin } from '../artifacts';

const TOOL_LABELS: Record<ProducedItem['kind'], string> = {
  notes: '笔记', mindmap: '思维导图', quiz: '题目集', flashcards: '闪卡', todos: '待办', writing: '作文与翻译', schedule: '定时任务',
};

const finished = (owner: string | null): AgentRun[] => agentStore.get(owner).runs.filter((run) => run.status === 'done' && !!run.summary?.trim());
const openRun = (run: AgentRun) => ({ view: 'agent', params: { run: run.id } });

function toArtifact(run: AgentRun): Artifact {
  const open = openRun(run);
  const at = run.finishedAt ?? run.updatedAt;
  return {
    key: `agent-output:${run.id}`,
    kind: 'agent-output',
    id: run.id,
    title: run.title,
    summary: [run.produced.length ? `${run.produced.length} 项成果` : '', run.mode === 'demo' ? '本地演示' : ''].filter(Boolean).join(' · ') || run.summary?.replace(/\s+/g, ' ').slice(0, 60),
    ...(run.topicId ? { topicId: run.topicId } : {}),
    ...(run.topicTitle ? { topicTitle: run.topicTitle } : {}),
    createdAt: run.createdAt,
    updatedAt: at,
    madeBy: 'ai',
    origin: { section: 'agent', label: `助理任务：${run.title}`, open },
    open,
  };
}

function runMarkdown(run: AgentRun): string {
  return [
    `# ${run.title}`,
    `## 目标\n\n${run.goal.trim()}`,
    `## 小结\n\n${run.summary?.trim() ?? ''}`,
    run.produced.length ? `## 写进工作台的成果\n\n${run.produced.map((item) => `- ${TOOL_LABELS[item.kind]}：${item.title}`).join('\n')}` : '',
    run.checklist.length ? `## 清单\n\n${run.checklist.map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

/**
 * 工作台里的一份成果是不是某次助理任务做的：是的话返回它的来源（可跳回那次任务）。
 * tool 是工作台工具页签 id（notes / mindmap / quiz / flashcards / todos / writing）。
 */
export function agentOriginOf(owner: string | null, tool: string, id: string): ArtifactOrigin | undefined {
  const run = agentStore.get(owner).runs.find((item) => item.produced.some((produced) => produced.kind === tool && produced.id === id));
  return run ? { section: 'agent', label: `助理任务：${run.title}`, open: openRun(run) } : undefined;
}

/** 登记处问过的账号；指纹只比对这些账号下已完成的任务 */
const knownOwners = new Set<string | null>();
const fingerprint = () => [...knownOwners]
  .map((owner) => `${owner ?? ''}=${finished(owner).map((run) => `${run.id}:${run.finishedAt ?? ''}:${run.produced.length}`).join(',')}`)
  .join('|');

registerArtifactProvider('agent', {
  list: (owner) => {
    knownOwners.add(owner);
    return finished(owner).map(toArtifact);
  },
  content: (owner, id) => {
    const run = finished(owner).find((item) => item.id === id);
    if (!run) return null;
    return { title: run.title, text: runMarkdown(run), filename: `${run.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || '助理成果'}.md`, mime: 'text/markdown' };
  },
  // 任务运行时事件日志每秒变很多次：只在「已完成的任务」这份名单变了才通知
  subscribe: (notify) => {
    let last = fingerprint();
    return agentStore.subscribe(() => {
      const next = fingerprint();
      if (next === last) return;
      last = next;
      notify();
    });
  },
});
