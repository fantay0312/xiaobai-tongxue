import type { ReactNode } from 'react';
import { ArrowRight, FileUp } from 'lucide-react';
import { IconClassroom, IconJourney, IconRead, IconTeach } from '../../../components/ui/icons';
import { XiaobaiAvatar } from '../../../components/xiaobai/XiaobaiAvatar';
import { JourneyStatusCard } from '../../../components/story/JourneyStatus';
import { RecentWork } from '../../../components/handoff/RecentWork';
import type { Artifact } from '../../../lib/artifacts';
import type { ConversationBrief } from '../../../lib/artifactProviders/chat';
import { useAppStore } from '../../../store/appStore';
import type { LearningIdentity } from '../../../engine/learningIdentity';
import type { Topic } from '../../../types';
import { Apprenticeship } from '../StudyWelcome';
import { greeting } from './views';
import w from '../welcome.module.css';

interface Suggestion {
  key: string;
  title: string;
  detail: string;
  icon: ReactNode;
  onSelect: () => void;
}

/** 没有打开课程、对话也是空的时候：一段开场，而不是一块空白的聊天区 */
export function TerminalWelcome({
  topics, identity, onAccept, onSelectCourse, onUpload, onTeach, onClassroom, onJourney,
  owner = null, conversations = [], onOpenConversation, onOpenArtifact, onSearchAll,
}: {
  topics: Topic[];
  identity: LearningIdentity;
  onAccept: () => void;
  /** 传入课程 id 直接打开；不传则让用户挑一门 */
  onSelectCourse: (topicId?: string) => void;
  onUpload: () => void;
  onTeach: () => void;
  onClassroom: () => void;
  onJourney: () => void;
  /** 「最近」一行：各门课里的对话，加上各板块做出来的东西 */
  owner?: string | null;
  conversations?: ConversationBrief[];
  onOpenConversation?: (chat: ConversationBrief) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
  onSearchAll?: () => void;
}) {
  const level = useAppStore((state) => state.global.learningLevel);
  const lastTopic = topics.find((topic) => topic.topicId === identity.lastTopicId && !topic.locked);
  const accepted = Boolean(identity.acceptedAt);

  const suggestions: Suggestion[] = [
    {
      key: 'continue',
      title: lastTopic ? '继续上次的课' : '选一门课开始',
      detail: lastTopic ? `${lastTopic.course} · ${lastTopic.title}` : '从课程里挑一个知识点，跟小砚学懂它',
      icon: <IconRead size={18} />,
      onSelect: () => onSelectCourse(lastTopic?.topicId),
    },
    {
      key: 'upload',
      title: '上传资料开始学',
      detail: '讲义、课件、笔记都可以，小砚会依据资料回答',
      icon: <FileUp size={18} strokeWidth={1.75} />,
      onSelect: onUpload,
    },
    {
      key: 'teach',
      title: '给小白上一课',
      detail: '把学懂的讲出来，小白会追问到你讲清楚',
      icon: <IconTeach size={18} />,
      onSelect: onTeach,
    },
    {
      key: 'classroom',
      title: '生成一堂 AI 课',
      detail: '给一个主题，排出一堂可以播放的课',
      icon: <IconClassroom size={18} />,
      onSelect: onClassroom,
    },
  ];

  return (
    <div className={w.welcome}>
      <header className={w.hero}>
        <div className={w.heroText}>
          <p className={w.kicker}>{accepted ? '师徒旅程 · 进行中' : '师徒旅程 · 序章'}</p>
          <h1>{greeting()}，先生。</h1>
          <p className={w.lead}>先跟小砚把一件事学明白，再讲给小白听。讲得清楚，才算真的懂了。</p>
        </div>
        <div className={w.heroCast} aria-hidden="true">
          <div className={w.bubble}>{accepted ? '先生，今天我们学点什么？' : '先生，我给你留了一封拜师帖。'}</div>
          <XiaobaiAvatar mood={accepted ? 'happy' : 'curious'} level={level} size={112} variant="paper" />
        </div>
      </header>

      {!accepted && <Apprenticeship identity={identity} onAccept={onAccept} />}

      <div className={w.suggestions}>
        {suggestions.map((item) => (
          <button key={item.key} type="button" className={w.suggestion} onClick={item.onSelect}>
            <span className={w.suggestionIcon}>{item.icon}</span>
            <span className={w.suggestionText}>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </span>
            <ArrowRight size={16} strokeWidth={1.75} className={w.suggestionArrow} />
          </button>
        ))}
      </div>

      {onOpenConversation && onOpenArtifact && (
        <RecentWork owner={owner} conversations={conversations} onOpenConversation={onOpenConversation} onOpenArtifact={onOpenArtifact} onAll={onSearchAll} />
      )}

      <JourneyStatusCard onOpen={onTeach} />

      <button type="button" className={w.journeyLink} onClick={onJourney}>
        <IconJourney size={15} />
        <span>{accepted ? '看看完整的师徒旅程' : '这段旅程会怎样展开'}</span>
        <ArrowRight size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}
