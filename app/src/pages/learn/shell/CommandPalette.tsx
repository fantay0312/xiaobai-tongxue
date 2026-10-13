import { useEffect, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { ClipboardList, FileUp, Search, Settings, SquarePen } from 'lucide-react';
import { IconChat, IconGrowth, IconJourney, IconNote, IconRead, IconTeach } from '../../../components/ui/icons';
import type { StudyConversation } from '../../../engine/studyWorkspace';
import type { Topic } from '../../../types';
import { STUDY_TABS, TERMINAL_NAV, type View } from './views';
import p from './palette.module.css';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topics: Topic[];
  topic?: Topic;
  conversations: StudyConversation[];
  onOpenTopic: (topicId: string) => void;
  onSelectChat: (id: string) => void;
  onView: (view: View) => void;
  onNewChat: () => void;
  onAttach: () => void;
  onTeach: () => void;
  onSettings: () => void;
  onNavigate: (to: string) => void;
}

function Row({ icon, hint, children, ...rest }: { icon: ReactNode; hint?: string; children: ReactNode; value: string; keywords?: string[]; onSelect: () => void }) {
  return (
    <Command.Item className={p.item} {...rest}>
      <span className={p.itemIcon}>{icon}</span>
      <span className={p.itemText}>{children}</span>
      {hint && <span className={p.itemHint}>{hint}</span>}
    </Command.Item>
  );
}

/** ⌘K 命令面板：搜课程与知识点、对话、视图和常用操作 */
export function CommandPalette(props: CommandPaletteProps) {
  const { open, onOpenChange, topics, topic, conversations } = props;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const run = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="搜索与命令"
      overlayClassName={p.overlay}
      contentClassName={p.dialog}
      className={p.root}
    >
      <div className={p.inputRow}>
        <Search size={17} strokeWidth={1.75} />
        <Command.Input className={p.input} placeholder="搜索课程、知识点、对话，或输入要做的事" />
        <kbd className={p.esc}>Esc</kbd>
      </div>
      <Command.List className={p.list}>
        <Command.Empty className={p.empty}>没有找到。换个词试试，或上传资料生成新的课程。</Command.Empty>

        <Command.Group heading="操作" className={p.group}>
          <Row value="新建对话" keywords={['new', 'chat']} icon={<SquarePen size={16} strokeWidth={1.75} />} onSelect={run(props.onNewChat)}>新建对话</Row>
          <Row value="上传资料开始学" keywords={['upload', '文件', '资料库']} icon={<FileUp size={16} strokeWidth={1.75} />} onSelect={run(props.onAttach)}>从资料库选择文件</Row>
          {topic && (
            <Row value={`教小白 讲给小白听 ${topic.title}`} keywords={['teach']} hint={topic.title} icon={<IconTeach size={16} />} onSelect={run(props.onTeach)}>
              把这一课讲给小白听
            </Row>
          )}
          <Row value="学习便笺" keywords={['note', '笔记']} icon={<IconNote size={16} />} onSelect={run(() => props.onView('notes'))}>打开学习便笺</Row>
          <Row value="师徒旅程 拜师帖" keywords={['journey']} icon={<IconJourney size={16} />} onSelect={run(() => props.onView('journey'))}>师徒旅程与拜师帖</Row>
          <Row value="成长册" keywords={['growth']} icon={<IconGrowth size={16} />} onSelect={run(() => props.onNavigate('/growth'))}>成长册</Row>
          <Row value="教师看板" keywords={['teacher']} icon={<ClipboardList size={16} strokeWidth={1.75} />} onSelect={run(() => props.onNavigate('/teacher'))}>教师看板</Row>
          <Row value="设置 外观 皮肤 模型" keywords={['settings']} icon={<Settings size={16} strokeWidth={1.75} />} onSelect={run(props.onSettings)}>设置</Row>
        </Command.Group>

        <Command.Group heading="功能" className={p.group}>
          {TERMINAL_NAV.map(({ view, label, hint, icon: ItemIcon }) => (
            <Row key={view} value={`${label} ${hint}`} hint={hint} icon={<ItemIcon size={16} />} onSelect={run(() => props.onView(view as View))}>
              {label}
            </Row>
          ))}
          {topic && STUDY_TABS.filter((tab) => tab.id !== 'ask').map(({ id, label, icon: ItemIcon }) => (
            <Row key={id} value={`${label} ${topic.title}`} hint={topic.title} icon={<ItemIcon size={16} />} onSelect={run(() => props.onView(id))}>
              {label}
            </Row>
          ))}
        </Command.Group>

        {topics.length > 0 && (
          <Command.Group heading="课程与知识点" className={p.group}>
            {topics.map((item) => (
              <Row
                key={item.topicId}
                value={`${item.course} ${item.title} ${item.topicId}`}
                hint={item.course}
                icon={<IconRead size={16} />}
                onSelect={run(() => props.onOpenTopic(item.topicId))}
              >
                {item.title}
              </Row>
            ))}
          </Command.Group>
        )}

        <Command.Group heading={topic ? '本课对话' : '对话记录'} className={p.group}>
          {[...conversations].reverse().map((chat) => (
            <Row
              key={chat.id}
              value={`${chat.title} ${chat.id}`}
              hint={chat.messages.length ? `${chat.messages.length} 条` : '空白'}
              icon={<IconChat size={16} />}
              onSelect={run(() => props.onSelectChat(chat.id))}
            >
              {chat.title}
            </Row>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
