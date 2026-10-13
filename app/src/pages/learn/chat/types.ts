import type { FormEvent, ReactNode, RefObject } from 'react';
import type { StudyConversation, StudyMode, StudySource } from '../../../engine/studyWorkspace';
import type { LearningInteraction } from '../../../../../server/shared/learning-ui.mjs';

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
}

export interface ComposerAttachment { id: string; title: string }

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
  /** 打开本课资料侧面板 */
  onOpenSources: () => void;
  placeholder?: string;
}
