import type { LearningIdentity } from '../../../engine/learningIdentity';
import type { ConversationBrief } from '../../../lib/artifactProviders/chat';
import type { Topic } from '../../../types';

export interface HomeContinuation { topic?: Topic; conversation?: ConversationBrief }

/** Continue the last available course, restoring its conversation when one exists. */
export function homeContinuation(topics: Topic[], identity: LearningIdentity, conversations: ConversationBrief[]): HomeContinuation | null {
  const available = topics.filter((topic) => !topic.locked);
  const lastTopic = available.find((topic) => topic.topicId === identity.lastTopicId);
  const recent = conversations.filter((chat) => chat.messages > 0)
    .slice().sort((a, b) => (Number.isFinite(b.at) ? b.at : 0) - (Number.isFinite(a.at) ? a.at : 0));
  if (lastTopic) return { topic: lastTopic, conversation: recent.find((chat) => (chat.topicId ?? chat.workspace) === lastTopic.topicId) };
  const conversation = recent.find((chat) => !chat.topicId || available.some((topic) => topic.topicId === chat.topicId));
  return conversation ? { conversation } : null;
}
