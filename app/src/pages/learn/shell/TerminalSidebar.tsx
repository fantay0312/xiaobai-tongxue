import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import {
  BookOpen, ChevronRight, Ellipsis, MessageSquare, NotebookText, PanelLeftClose, Pencil, Plus, Search, Settings, SquarePen, Trash2,
} from 'lucide-react';
import { IconButton, Kbd, Menu, MenuContent, MenuItem, MenuTrigger } from '../../../components/ui';
import { Seal } from '../../../components/shell/Seal';
import { AccountButton } from '../../../components/shell/AccountButton';
import { useShellActions } from '../../../components/shell/ShellActions';
import { JourneyStatusCard } from '../../../components/story/JourneyStatus';
import type { StudyConversation } from '../../../engine/studyWorkspace';
import type { Topic } from '../../../types';
import { railKey, type View } from './views';
import { partitionCourseGroups } from '../../../lib/courseVisibility';
import t from '../terminal.module.css';

export type CourseGroup = [key: string, group: { title: string; items: Topic[] }];

export interface TerminalSidebarProps {
  /** 小屏抽屉里的侧栏：聚焦课程与对话，并提供账号行。 */
  mobile?: boolean;
  /** 非对话板块时，侧栏整块让给该板块：这里只留品牌行、挂载位和页脚 */
  sectionSlot?: (element: HTMLDivElement | null) => void;
  view: View;
  topicId: string;
  hasTopic: boolean;
  groups: CourseGroup[];
  conversations: StudyConversation[];
  activeChatId: string;
  onCollapse?: () => void;
  onNewChat: () => void;
  onSearch: () => void;
  onOpenTopic: (topicId: string) => void;
  onAddCourse: () => void;
  onSelectChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
  onView: (view: View) => void;
  /** 抽屉里点了账号、设置这类会另开弹窗的入口：先把抽屉收起 */
  onDismiss?: () => void;
}

export function TerminalSidebar(props: TerminalSidebarProps) {
  const { mobile, view, topicId, hasTopic, groups, conversations, activeChatId } = props;
  const { openSettings } = useShellActions();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const { regular, validation } = useMemo(() => partitionCourseGroups(groups), [groups]);
  const [showValidation, setShowValidation] = useState(false);
  const validationId = useId();
  const validationActive = validation.some(([, group]) => group.items.some((item) => item.topicId === topicId));
  useEffect(() => { if (validationActive) setShowValidation(true); }, [topicId, validationActive]);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  // 选了「重命名」先记下，等菜单完全收起再换成输入框：否则菜单归还焦点时输入框会立刻失焦
  const pendingRename = useRef<StudyConversation | null>(null);
  const shortcut = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';

  const commitRename = () => {
    if (renaming?.title.trim()) props.onRenameChat(renaming.id, renaming.title.trim());
    setRenaming(null);
  };
  const renameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); commitRename(); }
    if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); }
  };

  const renderGroup = ([key, group]: CourseGroup, index: number) => {
    const containsActive = group.items.some((item) => item.topicId === topicId);
    const open = openGroups[key] ?? (containsActive || (!topicId && index === 0));
    return <div key={key} className={t.group} data-open={open || undefined}>
      <button type="button" className={t.groupToggle} aria-expanded={open} onClick={() => setOpenGroups((current) => ({ ...current, [key]: !open }))}>
        <ChevronRight size={14} strokeWidth={2} className={t.groupChevron} />
        <BookOpen size={15} strokeWidth={1.75} /><span>{group.title}</span><small>{group.items.length}</small>
      </button>
      {open && <div className={t.groupItems}>{group.items.map((item) => <button key={item.topicId} type="button" className={t.topicItem} aria-current={item.topicId === topicId ? 'page' : undefined} title={item.title} onClick={() => props.onOpenTopic(item.topicId)}><span>{item.title}</span></button>)}</div>}
    </div>;
  };

  const brandRow = (
    <div className={t.brandRow}>
      <Link to="/learn" className={t.brand} aria-label="小白同学">
        <Seal />
        <span>小白同学</span>
      </Link>
      {props.onCollapse && (
        <IconButton label="收起侧栏" size="sm" tip="bottom" onClick={props.onCollapse}>
          <PanelLeftClose size={17} strokeWidth={1.75} />
        </IconButton>
      )}
    </div>
  );

  if (!mobile && props.sectionSlot && railKey(view) !== 'ask') {
    return (
      <div className={t.sidebarInner}>
        {brandRow}
        <div className={t.sectionSlot} ref={props.sectionSlot} />
        <footer className={t.sidebarFooter}>
          <JourneyStatusCard compact onOpen={() => props.onView('feynman')} />
        </footer>
      </div>
    );
  }

  return (
    <div className={t.sidebarInner}>
      {!mobile && brandRow}

      <button type="button" className={t.newChat} onClick={props.onNewChat}>
        <SquarePen size={16} strokeWidth={1.75} />
        <span>新建对话</span>
      </button>
      <button type="button" className={t.searchTrigger} onClick={props.onSearch}>
        <Search size={15} strokeWidth={1.75} />
        <span>搜索课程、对话、功能</span>
        <Kbd>{shortcut}</Kbd>
      </button>

      <div className={t.sidebarScroll}>
        <section className={t.sideSection}>
          <h3 className={t.sideHeading}>
            <span>课程项目</span>
            <IconButton label="添加课程资料" size="sm" tip="right" onClick={props.onAddCourse}>
              <Plus size={15} strokeWidth={1.75} />
            </IconButton>
          </h3>
          {regular.map(renderGroup)}
          {!groups.length && <p className={t.sideEmpty}>还没有课程。上传资料后，课程会出现在这里。</p>}
          {!regular.length && validation.length > 0 && <p className={t.sideEmpty}>暂无正常课程，测试与验收项目已收起。</p>}
          {validation.length > 0 && <div className={t.validationCourses}>
            <button type="button" className={`${t.groupToggle} ${t.validationToggle}`} aria-expanded={showValidation} aria-controls={validationId} aria-label={`${showValidation ? '收起' : '显示'}测试与验收课程（${validation.length} 个项目）`} onClick={() => setShowValidation((current) => !current)}>
              <ChevronRight size={14} strokeWidth={2} data-open={showValidation || undefined} /><span>测试与验收</span><small>{validation.length}</small>
            </button>
            <div id={validationId} hidden={!showValidation}>{showValidation && validation.map((group) => renderGroup(group, -1))}</div>
          </div>}
        </section>

        <section className={t.sideSection}>
          <h3 className={t.sideHeading}><span>{hasTopic ? '本课对话' : '对话记录'}</span></h3>
          {[...conversations].reverse().map((chat) => (
            <div key={chat.id} className={t.chatRow} data-active={chat.id === activeChatId || undefined}>
              {renaming?.id === chat.id ? (
                <input
                  className={t.renameInput}
                  aria-label="对话名称"
                  autoFocus
                  maxLength={80}
                  value={renaming.title}
                  onChange={(event) => setRenaming({ id: chat.id, title: event.target.value })}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={commitRename}
                  onKeyDown={renameKey}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className={t.chatItem}
                    aria-current={chat.id === activeChatId ? 'true' : undefined}
                    title={chat.title}
                    onClick={() => props.onSelectChat(chat.id)}
                  >
                    <MessageSquare size={15} strokeWidth={1.75} />
                    <span>{chat.title}</span>
                  </button>
                  <Menu>
                    <MenuTrigger asChild>
                      <button type="button" className={t.chatMenu} aria-label={`对话操作：${chat.title}`}>
                        <Ellipsis size={16} strokeWidth={1.75} />
                      </button>
                    </MenuTrigger>
                    <MenuContent
                      align="start"
                      side="bottom"
                      onCloseAutoFocus={(event) => {
                        const target = pendingRename.current;
                        if (!target) return;
                        pendingRename.current = null;
                        event.preventDefault();
                        setRenaming({ id: target.id, title: target.title });
                      }}
                    >
                      <MenuItem icon={<Pencil size={15} strokeWidth={1.75} />} onSelect={() => { pendingRename.current = chat; }}>
                        重命名
                      </MenuItem>
                      <MenuItem danger icon={<Trash2 size={15} strokeWidth={1.75} />} onSelect={() => props.onDeleteChat(chat.id)}>
                        删除
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </>
              )}
            </div>
          ))}
        </section>
      </div>

      <footer className={t.sidebarFooter}>
        <JourneyStatusCard compact onOpen={() => props.onView('feynman')} />
        {mobile && (
          <div className={t.mobileAccountRow} onClick={props.onDismiss}>
            <AccountButton />
            <IconButton asChild label="成长册" tip={false}>
              <Link to="/growth"><NotebookText size={17} strokeWidth={1.75} /></Link>
            </IconButton>
            <IconButton label="设置" tip={false} onClick={openSettings}>
              <Settings size={17} strokeWidth={1.75} />
            </IconButton>
          </div>
        )}
      </footer>
    </div>
  );
}
