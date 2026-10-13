import { useStudyData } from '../../../store/studyData';
import type { TerminalViewProps } from './types';
import FlashcardsTool from './workbench/FlashcardsTool';
import MindMapTool from './workbench/MindMapTool';
import NotesTool from './workbench/NotesTool';
import { Overview } from './workbench/Overview';
import QuizTool from './workbench/QuizTool';
import TodosTool from './workbench/TodosTool';
import WritingTool from './workbench/WritingTool';
import { WorkbenchNav, type ToolProps } from './workbench/shared';
import { useWorkbenchNav, type ToolId } from './workbench/util';
import s from './workbench/workbench.module.css';

/**
 * 学习工作台：笔记、思维导图、题目集、闪卡、待办、作文与翻译。
 * 地址驱动：?view=workbench&tool=<工具>&id=<条目>；没有 tool 时是概览。
 */
export default function WorkbenchView(props: TerminalViewProps) {
  const { tool, id, go } = useWorkbenchNav();
  const data = useStudyData(props.owner);
  const counts: Record<ToolId, number> = {
    notes: data.notes.length,
    mindmap: data.mindmaps.length,
    quiz: data.quizSets.length,
    flashcards: data.decks.length,
    todos: data.todos.filter((todo) => !todo.done).length,
    writing: data.writings.length,
  };
  const toolProps: ToolProps = { ...props, activeId: id };

  return (
    <div className={s.root} data-wide={tool !== null && tool !== 'todos'}>
      <WorkbenchNav tool={tool} counts={counts} onGo={(next) => go(next)} />
      {tool === null && <Overview view={props} data={data} onGo={go} />}
      {tool === 'notes' && <NotesTool {...toolProps} />}
      {tool === 'mindmap' && <MindMapTool {...toolProps} />}
      {tool === 'quiz' && <QuizTool {...toolProps} />}
      {tool === 'flashcards' && <FlashcardsTool {...toolProps} />}
      {tool === 'todos' && <TodosTool {...toolProps} />}
      {tool === 'writing' && <WritingTool {...toolProps} />}
    </div>
  );
}
