import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Command } from 'cmdk';
import { ClipboardList, FileUp, Search, Settings, SquarePen } from 'lucide-react';
import { ArtifactKindIcon, shortTime } from '../../../components/handoff/kinds';
import { FileTypeIcon } from '../../../components/preview';
import { IconChat, IconGrowth, IconJourney, IconNote, IconRead, IconTeach } from '../../../components/ui/icons';
import type { StudyConversation } from '../../../engine/studyWorkspace';
import { ARTIFACT_LABELS, useArtifacts, type Artifact, type ArtifactKind } from '../../../lib/artifacts';
import type { ConversationBrief } from '../../../lib/artifactProviders/chat';
import { listLibrary, type LibraryEntry } from '../../../lib/fileLibrary';
import { isValidationCourse } from '../../../lib/courseVisibility';
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
  /** 以下用于「搜全部」：当前账号、当前工作区名、所有课程里的对话、打开成果 */
  owner?: string | null;
  workspace?: string;
  allConversations?: ConversationBrief[];
  onOpenConversation?: (chat: ConversationBrief) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
}

const KIND_ORDER: ArtifactKind[] = ['note', 'mindmap', 'quiz', 'deck', 'todo-list', 'writing', 'chat-artifact', 'lesson', 'agent-output', 'research-file'];
/** 资料库文件名单：面板打开时取一次，之后复用；连不上就当作没有 */
let libraryCache: { owner: string | null; files: LibraryEntry[] } | null = null;

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
  const { open, onOpenChange, topics, topic, conversations, owner = null, workspace, allConversations = [] } = props;
  const [query, setQuery] = useState('');
  const regularTopics = topics.filter((item) => !isValidationCourse(item.course));
  const validationTopics = topics.filter((item) => isValidationCourse(item.course));
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  const artifacts = useArtifacts(owner);
  const artifactGroups = useMemo(() => {
    if (!open) return [];
    return KIND_ORDER.flatMap((kind) => {
      const items = artifacts.filter((item) => item.kind === kind).slice(0, 40);
      return items.length ? [{ kind, items }] : [];
    });
  }, [open, artifacts]);
  // 别的课程里的对话；本课（或当前资料对话）的那些已经单独列出
  const otherConversations = allConversations.filter((chat) => chat.workspace !== workspace).slice(0, 60);

  const [files, setFiles] = useState<LibraryEntry[]>(() => (libraryCache?.owner === owner ? libraryCache.files : []));
  useEffect(() => {
    if (!open || !owner) return;
    if (libraryCache?.owner === owner) setFiles(libraryCache.files);
    const controller = new AbortController();
    void listLibrary(controller.signal).then((snapshot) => {
      const list = snapshot.entries.filter((entry) => entry.kind === 'file' && !entry.deletedAt).slice(0, 200);
      libraryCache = { owner, files: list };
      setFiles(list);
    }).catch(() => { /* 资料库连不上：不列文件 */ });
    return () => controller.abort();
  }, [open, owner]);

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
  const topicRow = (item: Topic) => (
    <Row key={item.topicId} value={`${item.course} ${item.title} ${item.topicId}`} hint={item.course}
      icon={<IconRead size={16} />} onSelect={run(() => props.onOpenTopic(item.topicId))}>
      {item.title}
    </Row>
  );

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
        <Command.Input className={p.input} value={query} onValueChange={setQuery} placeholder="搜索课程、对话、资料和做出来的内容，或输入要做的事" />
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

        {regularTopics.length > 0 && (
          <Command.Group heading="课程与知识点" className={p.group}>
            {regularTopics.map(topicRow)}
          </Command.Group>
        )}
        {query.trim() && validationTopics.length > 0 && (
          <Command.Group heading="测试与验收课程" className={p.group}>
            {validationTopics.map(topicRow)}
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

        {props.onOpenConversation && otherConversations.length > 0 && (
          <Command.Group heading="其他课程的对话" className={p.group}>
            {otherConversations.map((chat) => (
              <Row
                key={`${chat.workspace}/${chat.id}`}
                value={`${chat.title} ${chat.topicTitle ?? '资料对话'} ${chat.workspace}/${chat.id}`}
                hint={chat.topicTitle ?? '资料对话'}
                icon={<IconChat size={16} />}
                onSelect={run(() => props.onOpenConversation?.(chat))}
              >
                {chat.title}
              </Row>
            ))}
          </Command.Group>
        )}

        {props.onOpenArtifact && artifactGroups.map((group) => (
          <Command.Group key={group.kind} heading={ARTIFACT_LABELS[group.kind]} className={p.group}>
            {group.items.map((item) => (
              <Row
                key={item.key}
                value={`${item.title} ${ARTIFACT_LABELS[item.kind]} ${item.topicTitle ?? ''} ${item.origin.label ?? ''} ${item.key}`}
                hint={[item.topicTitle, shortTime(item.updatedAt)].filter(Boolean).join(' · ')}
                icon={<ArtifactKindIcon kind={item.kind} />}
                onSelect={run(() => props.onOpenArtifact?.(item))}
              >
                {item.title || '未命名'}
              </Row>
            ))}
          </Command.Group>
        ))}

        {files.length > 0 && (
          <Command.Group heading="资料库文件" className={p.group}>
            {files.map((entry) => (
              <Row
                key={entry.id}
                value={`${entry.name} 资料库 ${entry.id}`}
                hint="资料库"
                icon={<FileTypeIcon name={entry.name} mimeType={entry.contentType} size={18} />}
                onSelect={run(() => props.onView('library'))}
              >
                {entry.name}
              </Row>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
