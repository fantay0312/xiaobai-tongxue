import { ArrowRight, FileUp } from 'lucide-react';
import { Button } from '../../../components/ui';
import { IconJourney } from '../../../components/ui/icons';
import { XiaobaiAvatar } from '../../../components/xiaobai/XiaobaiAvatar';
import { RecentWork } from '../../../components/handoff/RecentWork';
import type { Artifact } from '../../../lib/artifacts';
import type { ConversationBrief } from '../../../lib/artifactProviders/chat';
import { useAppStore } from '../../../store/appStore';
import type { LearningIdentity } from '../../../engine/learningIdentity';
import type { Topic } from '../../../types';
import { Apprenticeship } from '../StudyWelcome';
import { greeting } from './views';
import { homeContinuation } from './homeContinuation';
import w from '../welcome.module.css';

/** A single next step, with recent work and the story available when needed. */
export function TerminalWelcome({
  topics, identity, onAccept, onReadLetter, onSelectCourse, onUpload, onJourney,
  owner = null, conversations = [], onOpenConversation, onOpenArtifact, onSearchAll,
}: {
  topics: Topic[];
  identity: LearningIdentity;
  onAccept: () => void;
  onReadLetter: () => void;
  onSelectCourse: (topicId?: string) => void;
  onUpload: () => void;
  onJourney: () => void;
  owner?: string | null;
  conversations?: ConversationBrief[];
  onOpenConversation?: (chat: ConversationBrief) => void;
  onOpenArtifact?: (artifact: Artifact) => void;
  onSearchAll?: () => void;
}) {
  const level = useAppStore((state) => state.global.learningLevel);
  const continuation = homeContinuation(topics, identity, conversations);
  const chat = continuation?.conversation;
  const topic = continuation?.topic;
  const title = topic?.title ?? chat?.title ?? '选一门感兴趣的课程';
  const detail = topic
    ? [topic.course, chat ? `接着「${chat.title}」学习` : '从上次的课程继续'].filter(Boolean).join(' · ')
    : chat ? chat.topicTitle ?? '继续上次的学习对话' : '从左侧课程开始，也可以上传自己的资料。';
  const resume = () => {
    if (chat && onOpenConversation) onOpenConversation(chat);
    else onSelectCourse(topic?.topicId);
  };

  return (
    <section className={w.welcome} aria-label="学习首页">
      <header className={w.hero}>
        <div className={w.heroText}>
          <h1>{greeting()}，先生。</h1>
          <p className={w.lead}>{continuation ? '接着上次的进度，学明白一件事。' : '选一门课，或带上自己的资料。'}</p>
        </div>
        <div className={w.heroCast} aria-hidden="true"><XiaobaiAvatar mood="happy" level={level} size={72} variant="paper" /></div>
      </header>

      <section className={w.continuation} aria-labelledby="home-continuation-title">
        <div className={w.continuationText}>
          <h2 id="home-continuation-title">{continuation ? '继续上次学习' : '开始你的学习'}</h2>
          <p className={w.continuationTitle}>{title}</p>
          <p className={w.continuationDetail}>{detail}</p>
        </div>
        <Button variant="solid" size="lg" onClick={resume} iconRight={<ArrowRight size={17} />}>
          {continuation ? '继续学习' : '选择课程'}
        </Button>
      </section>

      <div className={w.secondaryActions}>
        <button type="button" onClick={onUpload}><FileUp size={16} />上传资料</button>
        {continuation && <button type="button" onClick={() => onSelectCourse()}>换一门课</button>}
      </div>

      {onOpenConversation && onOpenArtifact && <RecentWork owner={owner} conversations={conversations} onOpenConversation={onOpenConversation} onOpenArtifact={onOpenArtifact} onAll={onSearchAll} limit={3} layout="list" excludeConversation={chat} />}

      <div className={w.welcomeExtras}>
        <Apprenticeship identity={identity} onAccept={onAccept} onRead={onReadLetter} compact />
        <button type="button" className={w.journeyLink} onClick={onJourney}><IconJourney size={15} /><span>师徒旅程</span></button>
      </div>
    </section>
  );
}
