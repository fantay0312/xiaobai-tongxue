import type { Topic } from '../../../types';
import type { NotebookSource } from '../../../engine/notebookSources';

/** 学习终端各视图共用的入参。终端外壳（pages/learn/index.tsx）负责传入。 */
export interface TerminalViewProps {
  /** 当前账号；未登录或本地演示为 null */
  owner: string | null;
  /** 当前打开的课程知识点；未选课时为空 */
  topic?: Topic;
  topics: Topic[];
  /** 当前对话已勾选的资料 */
  selectedSources: NotebookSource[];
  /** 把一句话放进输入框并回到对话 */
  onAsk: (text: string) => void;
  onOpenTopic: (topicId: string) => void;
  /** 切换终端视图，如 onView('workbench', { tool: 'flashcards' }) */
  onView: (view: string, params?: Record<string, string>) => void;
  /** 在终端顶部显示一条提示 */
  onNotice: (text: string) => void;
}
