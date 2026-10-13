/**
 * 各工具的条目清单与增删改：侧栏导航（Sidebar.tsx）和主区的备用列表（SplitLayout）共用这一份，
 * 两处看到的顺序、摘要和操作完全一致。待办没有「条目-详情」结构，不在这里。
 */
import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import { MenuItem, toast } from '../../../../components/ui';
import { dueCards, mindNode, studyData, type MindNode, type Origin, type StudyData, type StudyNote, type WritingDoc } from '../../../../store/studyData';
import type { Topic } from '../../../../types';
import type { GenKind } from './actions';
import { ago, clip, countWords, download, safeName, type ToolId } from './util';

export type ListTool = Exclude<ToolId, 'todos'>;
export const isListTool = (tool: ToolId | null): tool is ListTool => tool !== null && tool !== 'todos';

export interface Entry {
  id: string;
  title: string;
  /** 一行摘要：时间、数量、得分 */
  meta: string;
  origin: Origin;
  topicId?: string;
  /** 参与搜索的正文 */
  text?: string;
}

export const CREATE_LABEL: Record<ListTool, string> = {
  notes: '新建笔记',
  mindmap: '新建导图',
  quiz: '新建题目集',
  flashcards: '新建卡组',
  writing: '作文批改',
};
/** 每个工具对应的「AI 生成」种类；作文与翻译的批改在编辑器里发起 */
export const GEN_OF: Partial<Record<ToolId, GenKind>> = { notes: 'note', mindmap: 'mindmap', quiz: 'quiz', flashcards: 'deck', todos: 'todos' };

const recent = <T extends { updatedAt: string }>(items: T[]) => [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
// 外部写入的导图节点可能缺 children，统计与取字都按「可能不完整」处理
const kids = (node: MindNode | undefined): MindNode[] => (node && Array.isArray(node.children) ? node.children : []);
const nodeCount = (node: MindNode | undefined): number => 1 + kids(node).reduce((sum, child) => sum + nodeCount(child), 0);
const nodeText = (node: MindNode | undefined): string => [typeof node?.text === 'string' ? node.text : '', ...kids(node).map(nodeText)].join(' ');

export function listEntries(tool: ListTool, data: StudyData): Entry[] {
  switch (tool) {
    case 'notes':
      return recent(data.notes).map((note) => ({
        id: note.id,
        title: note.title,
        origin: note.origin,
        topicId: note.topicId,
        text: `${note.body} ${note.tags.join(' ')}`,
        meta: `${ago(note.updatedAt)} · ${countWords(note.body)} 字`,
      }));
    case 'mindmap':
      return recent(data.mindmaps).map((map) => ({
        id: map.id,
        title: map.title,
        origin: map.origin,
        topicId: map.topicId,
        text: nodeText(map.root),
        meta: `${ago(map.updatedAt)} · ${nodeCount(map.root)} 个节点`,
      }));
    case 'quiz':
      return recent(data.quizSets).map((set) => {
        const last = set.attempts[set.attempts.length - 1];
        const score = last && last.total ? ` · 上次 ${Math.round((last.correct / last.total) * 100)}%` : '';
        return {
          id: set.id,
          title: set.title,
          origin: set.origin,
          topicId: set.topicId,
          text: set.questions.map((question) => question.stem).join(' '),
          meta: `${set.questions.length} 题${score}${set.wrongIds.length ? ` · 错题 ${set.wrongIds.length}` : ''}`,
        };
      });
    case 'flashcards':
      return recent(data.decks).map((deck) => {
        const due = dueCards(deck).length;
        return {
          id: deck.id,
          title: deck.title,
          origin: deck.origin,
          topicId: deck.topicId,
          text: deck.cards.map((card) => `${card.front} ${card.back}`).join(' '),
          meta: `${deck.cards.length} 张${due ? ` · 待复习 ${due}` : deck.cards.length ? ' · 今天已复习完' : ''}`,
        };
      });
    case 'writing':
      return recent(data.writings).map((doc) => ({
        id: doc.id,
        title: doc.title,
        origin: doc.origin,
        text: `${doc.source ?? ''} ${doc.draft ?? ''}`,
        meta: `${doc.kind === 'translation' ? '翻译' : '作文'}${typeof doc.score === 'number' ? ` · ${Math.round(doc.score)} 分` : ''} · ${ago(doc.updatedAt)}`,
      }));
  }
}

/** 新建一个空条目，返回 id */
export function createItem(tool: ListTool, owner: string | null, topic?: Topic, kind: WritingDoc['kind'] = 'essay'): string {
  const link = topic ? { topicId: topic.topicId } : {};
  switch (tool) {
    case 'notes':
      return studyData.saveNote(owner, { title: '', body: '', ...link }).id;
    case 'mindmap':
      return studyData.saveMindMap(owner, {
        title: topic ? `${topic.title} · 思维导图` : '',
        root: mindNode(topic?.title ?? '中心主题', [mindNode('分支一'), mindNode('分支二'), mindNode('分支三')]),
        ...link,
      }).id;
    case 'quiz':
      return studyData.saveQuizSet(owner, { title: topic ? `${topic.title} · 练习题` : '', questions: [], ...link }).id;
    case 'flashcards':
      return studyData.saveDeck(owner, { title: topic ? `${topic.title} · 闪卡` : '', cards: [], ...link }).id;
    case 'writing':
      return studyData.saveWriting(owner, { kind, title: '', source: '', draft: '' }).id;
  }
}

export function renameItem(tool: ListTool, owner: string | null, id: string, title: string) {
  const data = studyData.get(owner);
  switch (tool) {
    case 'notes': { const item = data.notes.find((entry) => entry.id === id); if (item) studyData.saveNote(owner, { ...item, title }); break; }
    case 'mindmap': { const item = data.mindmaps.find((entry) => entry.id === id); if (item) studyData.saveMindMap(owner, { ...item, title }); break; }
    case 'quiz': { const item = data.quizSets.find((entry) => entry.id === id); if (item) studyData.saveQuizSet(owner, { ...item, title }); break; }
    case 'flashcards': { const item = data.decks.find((entry) => entry.id === id); if (item) studyData.saveDeck(owner, { ...item, title }); break; }
    case 'writing': { const item = data.writings.find((entry) => entry.id === id); if (item) studyData.saveWriting(owner, { ...item, title }); break; }
  }
}

/** 删除并给出可撤销的提示 */
export function removeItem(tool: ListTool, owner: string | null, id: string) {
  const data = studyData.get(owner);
  let title = '';
  let restore: () => void = () => {};
  switch (tool) {
    case 'notes': { const item = data.notes.find((entry) => entry.id === id); if (!item) return; title = item.title; studyData.removeNote(owner, id); restore = () => { studyData.saveNote(owner, item); }; break; }
    case 'mindmap': { const item = data.mindmaps.find((entry) => entry.id === id); if (!item) return; title = item.title; studyData.removeMindMap(owner, id); restore = () => { studyData.saveMindMap(owner, item); }; break; }
    case 'quiz': { const item = data.quizSets.find((entry) => entry.id === id); if (!item) return; title = item.title; studyData.removeQuizSet(owner, id); restore = () => { studyData.saveQuizSet(owner, item); }; break; }
    case 'flashcards': { const item = data.decks.find((entry) => entry.id === id); if (!item) return; title = item.title; studyData.removeDeck(owner, id); restore = () => { studyData.saveDeck(owner, item); }; break; }
    case 'writing': { const item = data.writings.find((entry) => entry.id === id); if (!item) return; title = item.title; studyData.removeWriting(owner, id); restore = () => { studyData.saveWriting(owner, item); }; break; }
  }
  toast(`已删除「${clip(title || '未命名', 16)}」`, { action: { label: '撤销', onClick: restore } });
}

export const exportNote = (note: Pick<StudyNote, 'title' | 'body'>) => {
  const body = /^#\s/.test(note.body.trimStart()) ? note.body : `# ${note.title || '未命名笔记'}\n\n${note.body}`;
  download(`${safeName(note.title)}.md`, body, 'text/markdown');
};

/** 条目菜单里各工具自己的额外项 */
export function itemMenu(tool: ListTool, owner: string | null, id: string): ReactNode {
  if (tool !== 'notes') return null;
  return (
    <MenuItem
      icon={<Download size={15} strokeWidth={1.75} />}
      onSelect={() => {
        const note = studyData.get(owner).notes.find((entry) => entry.id === id);
        if (note) exportNote(note);
      }}
    >
      导出 Markdown
    </MenuItem>
  );
}
