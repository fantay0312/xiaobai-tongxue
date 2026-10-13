import type { FormEvent, ReactNode, RefObject } from 'react';
import type { StudyConversation, StudyMode, StudySource } from '../../../engine/studyWorkspace';
import type { LearningInteraction } from '../../../../../server/shared/learning-ui.mjs';

/** 把回答交给别的板块时要带上的上下文：谁的、哪门课、能不能讲给小白 */
export interface ChatHandoff {
  owner: string | null;
  topicId?: string;
  topicTitle?: string;
  /** 这门课可以讲给小白时给出课程 id */
  teachTopicId?: string;
}

/** 对话流：终端外壳（index.tsx）传入，chat/ChatFeed.tsx 实现。 */
export interface ChatFeedProps {
  conversation: StudyConversation;
  /** 正在生成回答（含资料准备） */
  busy: boolean;
  /** busy 且没有流式消息时的进度文字，如「小砚正在整理解释…」 */
  phase: string;
  /** 正在流式写入的助手消息 id；没有则为 null */
  streamingId: string | null;
  /** 空对话时显示的欢迎区 */
  empty: ReactNode;
  onAsk: (text: string) => void;
  onSource: (source: StudySource) => void;
  onSaveNote: (text: string, sources: StudySource[]) => void;
  onInteraction: (messageId: string, blockId: string, state: LearningInteraction[string]) => void;
  /** 重新生成这条助手回答 */
  onRegenerate: (messageId: string) => void;
  /** 给了才显示「发送到」和「收进工作台」 */
  handoff?: ChatHandoff;
}

/** kind=artifact 是从「我的内容」带进来的成果，其余是资料库文件 */
export interface ComposerAttachment { id: string; title: string; kind?: 'file' | 'artifact' }

/** 输入框：chat/Composer.tsx 实现。模型与思考强度由 Composer 自己读写 store/modelPrefs。 */
export interface ComposerProps {
  input: string;
  onInput: (value: string) => void;
  mode: StudyMode;
  onMode: (mode: StudyMode) => void;
  answerFormat: 'auto' | 'text';
  onAnswerFormat: (format: 'auto' | 'text') => void;
  busy: boolean;
  onStop: () => void;
  onSubmit: (event?: FormEvent) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  deepAvailable: boolean;
  intelligentAvailable: boolean;
  /** settings.mode === 'mock'：本地演示，没有模型 */
  demo: boolean;
  sourceCount: number;
  /** 当前没有任何资料可选：可以不带资料直接问模型（有资料但一份没勾时仍要先勾选） */
  freeChat?: boolean;
  attachments: ComposerAttachment[];
  onRemoveAttachment: (id: string) => void;
  /** 打开资料库选择文件 */
  onAttach: () => void;
  /** 打开「我的内容」挑一份生成的成果（笔记、导图、题目……）；输入 @ 也走这里 */
  onAttachContent?: () => void;
  /** 打开本课资料侧面板 */
  onOpenSources: () => void;
  placeholder?: string;
}
