import { useMemo, useRef, useState } from 'react';
import { useStudyData, type WritingDoc } from '../../../store/studyData';
import { SidebarPortal, useSidebarSlot } from '../shell/sidebarSlot';
import type { TerminalViewProps } from './types';
import { KIND_TOOL, type GenKind } from './workbench/actions';
import FlashcardsTool from './workbench/FlashcardsTool';
import MindMapTool from './workbench/MindMapTool';
import NotesTool from './workbench/NotesTool';
import { Overview } from './workbench/Overview';
import QuizTool from './workbench/QuizTool';
import { createItem, isListTool, listEntries, type ListTool } from './workbench/registry';
import { WorkbenchSidebar } from './workbench/Sidebar';
import TodosTool from './workbench/TodosTool';
import WritingTool from './workbench/WritingTool';
import { GenerateDialog, WorkbenchNav, type ToolProps } from './workbench/shared';
import { usePack } from './workbench/usePack';
import { useWorkbenchNav, type ToolId } from './workbench/util';
import s from './workbench/workbench.module.css';

/**
 * 学习工作台：笔记、思维导图、题目集、闪卡、待办、作文与翻译。
 * 地址驱动：?view=workbench&tool=<工具>&id=<条目>；没有 tool 时是概览。
 * 导航放在终端侧栏（SidebarPortal）：工具切换与当前工具的条目都在那里，主区只放概览或编辑器。
 * 侧栏收起或在手机上没有挂载位时，主区自带工具切换与条目列表。
 */
export default function WorkbenchView(props: TerminalViewProps) {
  const { tool, id, go } = useWorkbenchNav();
  const sideNav = useSidebarSlot() !== null;
  const data = useStudyData(props.owner);
  const pack = usePack(props);
  const [gen, setGen] = useState<GenKind | null>(null);
  const todoInputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => (isListTool(tool) ? listEntries(tool, data) : []), [tool, data]);
  // 导航在侧栏时，没有指定条目（或条目已不存在）就打开最近的一个；主区备用列表自己处理选中
  const currentId = isListTool(tool) && sideNav
    ? (id && entries.some((entry) => entry.id === id) ? id : entries[0]?.id ?? null)
    : id;

  const counts: Record<ToolId, number> = {
    notes: data.notes.length,
    mindmap: data.mindmaps.length,
    quiz: data.quizSets.length,
    flashcards: data.decks.length,
    todos: data.todos.filter((todo) => !todo.done).length,
    writing: data.writings.length,
  };
  const toolProps: ToolProps = { ...props, activeId: currentId, sideNav, onGenerate: setGen, todoInputRef };
  const create = (target: ListTool, kind?: WritingDoc['kind']) => go(target, createItem(target, props.owner, props.topic, kind));
  const focusTodo = () => {
    if (tool !== 'todos') go('todos');
    // 切到待办后输入框才挂上，等一帧再聚焦
    setTimeout(() => todoInputRef.current?.focus(), 60);
  };
  const wide = sideNav ? tool === 'notes' || tool === 'mindmap' || tool === 'writing' : tool !== null && tool !== 'todos';

  return (
    <div className={s.root} data-wide={wide}>
      <SidebarPortal fallback={<WorkbenchNav tool={tool} counts={counts} onGo={(next) => go(next)} />}>
        <WorkbenchSidebar
          view={props}
          data={data}
          tool={tool}
          currentId={currentId}
          entries={entries}
          pack={pack}
          onGo={go}
          onCreate={create}
          onGenerate={setGen}
          onFocusTodo={focusTodo}
        />
      </SidebarPortal>

      {tool === null && <Overview view={props} data={data} pack={pack} onGo={go} />}
      {tool === 'notes' && <NotesTool {...toolProps} />}
      {tool === 'mindmap' && <MindMapTool {...toolProps} />}
      {tool === 'quiz' && <QuizTool {...toolProps} />}
      {tool === 'flashcards' && <FlashcardsTool {...toolProps} />}
      {tool === 'todos' && <TodosTool {...toolProps} />}
      {tool === 'writing' && <WritingTool {...toolProps} />}

      {gen && (
        <GenerateDialog
          kind={gen}
          open
          onOpenChange={(open) => { if (!open) setGen(null); }}
          view={props}
          onCreated={(created) => go(KIND_TOOL[created.kind], created.id)}
        />
      )}
    </div>
  );
}
