/** 「最近」—— 最近的对话和最近做出来的东西混排成一行，开始页一眼看到手头的全部工作。 */
import { ARTIFACT_LABELS, useArtifacts, type Artifact } from '../../lib/artifacts';
import type { ConversationBrief } from '../../lib/artifactProviders/chat';
import { IconChat } from '../ui/icons';
import { ArtifactKindIcon, shortTime } from './kinds';
import s from './handoff.module.css';

type Item =
  | { type: 'chat'; at: number; chat: ConversationBrief }
  | { type: 'artifact'; at: number; artifact: Artifact };

export function RecentWork({ owner, conversations, onOpenConversation, onOpenArtifact, onAll, limit = 6 }: {
  owner: string | null;
  conversations: ConversationBrief[];
  onOpenConversation: (chat: ConversationBrief) => void;
  onOpenArtifact: (artifact: Artifact) => void;
  /** 「全部」：打开搜索 */
  onAll?: () => void;
  limit?: number;
}) {
  const artifacts = useArtifacts(owner);
  const items: Item[] = [
    ...conversations.map((chat): Item => ({ type: 'chat', at: chat.at, chat })),
    ...artifacts.map((artifact): Item => ({ type: 'artifact', at: Date.parse(artifact.updatedAt) || 0, artifact })),
  ].sort((a, b) => b.at - a.at).slice(0, limit);

  if (!items.length) return null;

  return (
    <section className={s.recent} aria-label="最近">
      <header className={s.recentHead}>
        <h2>最近</h2>
        {onAll && <button type="button" onClick={onAll}>搜索全部</button>}
      </header>
      <ul className={s.recentRow}>
        {items.map((item) => (item.type === 'chat' ? (
          <li key={`chat:${item.chat.workspace}/${item.chat.id}`}>
            <button type="button" className={s.recentCard} onClick={() => onOpenConversation(item.chat)}>
              <span className={s.recentIcon}><IconChat size={16} /></span>
              <span className={s.recentText}>
                <strong>{item.chat.title}</strong>
                <small>{['对话', item.chat.topicTitle, item.at ? shortTime(new Date(item.at).toISOString()) : `${item.chat.messages} 条`].filter(Boolean).join(' · ')}</small>
              </span>
            </button>
          </li>
        ) : (
          <li key={item.artifact.key}>
            <button type="button" className={s.recentCard} onClick={() => onOpenArtifact(item.artifact)}>
              <span className={s.recentIcon}><ArtifactKindIcon kind={item.artifact.kind} /></span>
              <span className={s.recentText}>
                <strong>{item.artifact.title || '未命名'}</strong>
                <small>{[ARTIFACT_LABELS[item.artifact.kind], item.artifact.topicTitle, shortTime(item.artifact.updatedAt)].filter(Boolean).join(' · ')}</small>
              </span>
            </button>
          </li>
        )))}
      </ul>
    </section>
  );
}
