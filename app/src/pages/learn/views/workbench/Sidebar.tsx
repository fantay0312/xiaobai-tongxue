import { useMemo, useState } from 'react';
import { Ellipsis, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button, Dialog, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented } from '../../../../components/ui';
import { IconWorkbench, IconSpark } from '../../../../components/ui/icons';
import { dueCards, type Origin, type StudyData, type WritingDoc } from '../../../../store/studyData';
import { SideAction, SideEmpty, SideGroup, SideNavItem, SidePanel } from '../../shell/sidebarSlot';
import type { TerminalViewProps } from '../types';
import type { GenKind } from './actions';
import { CREATE_LABEL, GEN_OF, isListTool, itemMenu, removeItem, renameItem, type Entry, type ListTool } from './registry';
import { TOOLS } from './shared';
import type { PackState } from './usePack';
import { TOOL_IDS, dayKey, dueDay, matches, type ToolId } from './util';

const ORIGIN_MARK: Record<Origin, string | undefined> = { user: undefined, agent: '助理', chat: '对话' };
const TODO_GROUPS = [
  { id: null, label: '全部' },
  { id: 'today', label: '今天' },
  { id: 'upcoming', label: '接下来' },
  { id: 'done', label: '已完成' },
] as const;

/**
 * 工作台在终端侧栏里的导航：工具（概览 + 六个工具）与当前工具的条目。
 * 行只用外壳提供的侧栏件，不带自己的行样式。
 */
export function WorkbenchSidebar({ view, data, tool, currentId, entries, pack, onGo, onCreate, onGenerate, onFocusTodo }: {
  view: TerminalViewProps;
  data: StudyData;
  tool: ToolId | null;
  /** 列表工具：主区正在显示的条目；待办：分组（today / upcoming / done） */
  currentId: string | null;
  entries: Entry[];
  pack: PackState;
  onGo: (tool: ToolId | null, id?: string | null) => void;
  onCreate: (tool: ListTool, kind?: WritingDoc['kind']) => void;
  onGenerate: (kind: GenKind) => void;
  onFocusTodo: () => void;
}) {
  const { owner, topic } = view;
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'course'>('all');
  const [renaming, setRenaming] = useState<{ tool: ListTool; id: string; title: string } | null>(null);
  const [filterTool, setFilterTool] = useState(tool);
  // 换工具时清掉上一个工具的搜索与筛选
  if (filterTool !== tool) {
    setFilterTool(tool);
    setQuery('');
    setScope('all');
  }

  const today = dayKey();
  const dueTotal = data.decks.reduce((sum, deck) => sum + dueCards(deck).length, 0);
  const openTodos = data.todos.filter((todo) => !todo.done);
  const todayTodos = openTodos.filter((todo) => { const day = dueDay(todo.due); return day !== null && day <= today; });
  const toolMeta: Record<ToolId, string | number | undefined> = {
    notes: data.notes.length || undefined,
    mindmap: data.mindmaps.length || undefined,
    quiz: data.quizSets.length || undefined,
    flashcards: dueTotal ? `${dueTotal} 到期` : data.decks.length || undefined,
    todos: todayTodos.length ? `今天 ${todayTodos.length}` : openTodos.length || undefined,
    writing: data.writings.length || undefined,
  };
  const todoCounts: Record<'all' | 'today' | 'upcoming' | 'done', number> = {
    all: openTodos.length,
    today: todayTodos.length,
    upcoming: openTodos.length - todayTodos.length,
    done: data.todos.length - openTodos.length,
  };

  const canFilterCourse = Boolean(topic) && tool !== 'writing';
  const shown = useMemo(
    () => entries.filter((entry) => (scope === 'all' || !topic || !canFilterCourse || entry.topicId === topic.topicId) && matches(query, entry.title, entry.text)),
    [entries, scope, topic, canFilterCourse, query],
  );
  const kind = tool ? GEN_OF[tool] : undefined;
  const plus = <Plus size={16} strokeWidth={1.75} />;

  const action = tool === null ? (
    pack.can
      ? <SideAction icon={<IconSpark size={16} />} disabled={pack.running} onClick={pack.start}>{pack.running ? `正在生成 ${pack.done} / ${pack.total}` : '生成学习包'}</SideAction>
      : <SideAction icon={plus} onClick={() => onCreate('notes')}>新建笔记</SideAction>
  ) : tool === 'todos' ? (
    <SideAction icon={plus} onClick={onFocusTodo}>新建待办</SideAction>
  ) : tool === 'writing' ? (
    <>
      <SideAction icon={plus} onClick={() => onCreate('writing', 'essay')}>作文批改</SideAction>
      <SideAction icon={plus} onClick={() => onCreate('writing', 'translation')}>翻译练习</SideAction>
    </>
  ) : (
    <SideAction icon={plus} onClick={() => onCreate(tool)}>{CREATE_LABEL[tool]}</SideAction>
  );

  const generate = kind && (
    <Button variant="ghost" size="sm" icon={<IconSpark size={14} />} onClick={() => onGenerate(kind)}>AI 生成</Button>
  );
  const submitRename = () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (title) renameItem(renaming.tool, owner, renaming.id, title);
    setRenaming(null);
  };

  return (
    <SidePanel title="工作台" action={action} footer="工作台的内容保存在当前浏览器。">
      <SideGroup label="工具">
        <SideNavItem icon={<IconWorkbench size={18} active={tool === null} />} label="概览" active={tool === null} onClick={() => onGo(null)} />
        {TOOL_IDS.map((id) => {
          const Icon = TOOLS[id].icon;
          return (
            <SideNavItem
              key={id}
              icon={<Icon size={18} active={tool === id} />}
              label={TOOLS[id].name}
              meta={toolMeta[id]}
              active={tool === id}
              title={TOOLS[id].hint}
              onClick={() => onGo(id)}
            />
          );
        })}
      </SideGroup>

      {tool === 'todos' && (
        <SideGroup label="待办" action={generate}>
          {TODO_GROUPS.map((group) => (
            <SideNavItem
              key={group.label}
              label={group.label}
              meta={todoCounts[group.id ?? 'all'] || undefined}
              active={(currentId ?? null) === group.id || (group.id === null && !TODO_GROUPS.some((item) => item.id === currentId))}
              onClick={() => onGo('todos', group.id)}
            />
          ))}
        </SideGroup>
      )}

      {isListTool(tool) && (
        <SideGroup label={TOOLS[tool].name} action={generate}>
          {(entries.length > 5 || canFilterCourse) && entries.length > 0 && (
            <div style={{ display: 'grid', gap: 6, padding: '2px 0 6px' }}>
              {entries.length > 5 && (
                <Input
                  size="sm"
                  leading={<Search size={15} strokeWidth={1.75} />}
                  placeholder={`搜索${TOOLS[tool].name}`}
                  aria-label={`搜索${TOOLS[tool].name}`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
              {canFilterCourse && topic && (
                <Segmented
                  size="sm"
                  block
                  label="按课程筛选"
                  value={scope}
                  onChange={setScope}
                  options={[{ value: 'all', label: '全部' }, { value: 'course', label: '本课', title: topic.title }]}
                />
              )}
            </div>
          )}
          {shown.map((entry) => (
            <SideNavItem
              key={entry.id}
              label={entry.title || '未命名'}
              sub={entry.meta}
              meta={ORIGIN_MARK[entry.origin]}
              active={entry.id === currentId}
              title={entry.title || '未命名'}
              onClick={() => onGo(tool, entry.id)}
              trailing={(
                // 非模态菜单 + 关闭时不把焦点还给触发钮：这样从菜单里打开重命名对话框时，焦点留在输入框，页面也不会被锁住
                <Menu modal={false}>
                  <MenuTrigger asChild>
                    <IconButton label="更多操作" size="sm" tip={false}><Ellipsis size={16} strokeWidth={1.75} /></IconButton>
                  </MenuTrigger>
                  <MenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                    <MenuItem icon={<Pencil size={15} strokeWidth={1.75} />} onSelect={() => setRenaming({ tool, id: entry.id, title: entry.title })}>重命名</MenuItem>
                    {itemMenu(tool, owner, entry.id)}
                    <MenuSeparator />
                    <MenuItem
                      danger
                      icon={<Trash2 size={15} strokeWidth={1.75} />}
                      onSelect={() => {
                        removeItem(tool, owner, entry.id);
                        if (entry.id === currentId) onGo(tool, null);
                      }}
                    >
                      删除
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
            />
          ))}
          {entries.length === 0 && <SideEmpty>还没有{TOOLS[tool].name}。{kind ? '新建一个，或者点「AI 生成」。' : '点上面的按钮开始。'}</SideEmpty>}
          {entries.length > 0 && shown.length === 0 && <SideEmpty>没有符合条件的{TOOLS[tool].name}。</SideEmpty>}
        </SideGroup>
      )}

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => { if (!open) setRenaming(null); }}
        title="重命名"
        size="sm"
        footer={(
          <>
            <Button variant="soft" onClick={() => setRenaming(null)}>取消</Button>
            <Button variant="solid" disabled={!renaming?.title.trim()} onClick={submitRename}>保存</Button>
          </>
        )}
      >
        <Input
          value={renaming?.title ?? ''}
          autoFocus
          placeholder="标题"
          aria-label="标题"
          // 这是条目标题，不是账号信息：不让浏览器和密码管理器来填
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          onChange={(event) => setRenaming((current) => (current ? { ...current, title: event.target.value } : current))}
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) submitRename(); }}
        />
      </Dialog>
    </SidePanel>
  );
}
