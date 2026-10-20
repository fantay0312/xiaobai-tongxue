import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Button, Dialog } from '../../../components/ui';
import { IconSpark } from '../../../components/ui/icons';
import { useStudyData, type WritingDoc } from '../../../store/studyData';
import { SidebarPortal, useSidebarSlot } from '../shell/sidebarSlot';
import type { TerminalViewProps } from './types';
import { KIND_TOOL, type GenKind } from './workbench/actions';
import { AskPanel, useAskSession } from './workbench/AskPanel';
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
import { useNarrow, useWorkbenchNav, type ToolId } from './workbench/util';
import s from './workbench/workbench.module.css';

const PANEL_KEY = 'xiaobai-workbench-ai-panel-v1';
const readPanelPref = () => { try { return localStorage.getItem(PANEL_KEY) === 'open'; } catch { return false; } };
const savePanelPref = (open: boolean) => { try { localStorage.setItem(PANEL_KEY, open ? 'open' : 'closed'); } catch { /* 记不住也不影响使用 */ } };

/**
 * 学习工作台：笔记、思维导图、题目集、闪卡、待办、作文与翻译。
 * 地址驱动：?view=workbench&tool=<工具>&id=<条目>；没有 tool 时是概览；带 &ai=1 时打开右侧的「问小砚」。
 * 导航放在终端侧栏（SidebarPortal）：工具切换与当前工具的条目都在那里，主区只放概览或编辑器。
 * 侧栏收起或在手机上没有挂载位时，主区自带工具切换与条目列表。
 * 「问小砚」常驻在主区右侧（窄屏是底部面板），各工具把正在看的条目报给它。
 */
export default function WorkbenchView(props: TerminalViewProps) {
  const { tool, id, go } = useWorkbenchNav();
  const [params, setParams] = useSearchParams();
  const sideNav = useSidebarSlot() !== null;
  const data = useStudyData(props.owner);
  const pack = usePack(props);
  const [gen, setGen] = useState<GenKind | null>(null);
  const todoInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  /* ── 问小砚 ── */
  // 宽度不够并排时，面板改成盖在上面的面板（手机是从底部升起）
  const overlayPanel = useNarrow('(max-width: 1180px)');
  const aiParam = params.get('ai') === '1';
  const session = useAskSession(props);
  const [panelOpen, setPanelOpen] = useState(() => aiParam || (readPanelPref() && typeof window !== 'undefined' && window.innerWidth > 1180));
  useEffect(() => { if (aiParam) setPanelOpen(true); }, [aiParam]);
  const { send } = session;
  const askHere = useCallback((question?: string) => {
    setPanelOpen(true);
    savePanelPref(true);
    if (question?.trim()) void send(question);
  }, [send]);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    savePanelPref(false);
    if (aiParam) setParams((prev) => { const next = new URLSearchParams(prev); next.delete('ai'); return next; }, { replace: true });
  }, [aiParam, setParams]);

  // 右侧面板要占满可视高度：量一下所在滚动区的高度，写成变量给样式用
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') return undefined;
    let scroller: HTMLElement | null = shell.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const target = scroller ?? document.documentElement;
    const apply = () => shell.style.setProperty('--wb-view-h', `${target.clientHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

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
  const toolProps: ToolProps = { ...props, activeId: currentId, sideNav, onGenerate: setGen, askHere, todoInputRef };
  const create = (target: ListTool, kind?: WritingDoc['kind']) => go(target, createItem(target, props.owner, props.topic, kind));
  const focusTodo = () => {
    if (tool !== 'todos') go('todos');
    // 切到待办后输入框才挂上，等一帧再聚焦
    setTimeout(() => todoInputRef.current?.focus(), 60);
  };
  const wide = sideNav ? tool === 'notes' || tool === 'mindmap' || tool === 'writing' : tool !== null && tool !== 'todos';
  const docked = panelOpen && !overlayPanel;

  return (
    <div className={s.shell} ref={shellRef} data-ai={docked ? 'open' : undefined}>
      <div className={s.root} data-wide={wide}>
        {tool !== null && (
          <div className={s.backRow}>
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} strokeWidth={1.75} />} onClick={() => go(null)}>返回工作台</Button>
          </div>
        )}
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

      {docked && (
        <aside className={s.aiPane} aria-label="问小砚">
          <AskPanel view={props} session={session} onClose={closePanel} />
        </aside>
      )}
      {overlayPanel && (
        <Dialog open={panelOpen} onOpenChange={(open) => { if (!open) closePanel(); }} title="问小砚" size="md" className={s.aiSheet}>
          <AskPanel view={props} session={session} onClose={closePanel} sheet />
        </Dialog>
      )}
      {!panelOpen && (
        <span className={s.aiFabSlot}>
          <button type="button" className={s.aiFab} onClick={() => askHere()}>
            <IconSpark size={18} />问小砚
          </button>
        </span>
      )}
    </div>
  );
}
