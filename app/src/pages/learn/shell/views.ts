import { useEffect, useState } from 'react';
import {
  BookOpen, Bot, Brain, ClipboardList, FolderOpen, GraduationCap, Layers, LayoutGrid, MessageSquare, Presentation, Route, Users,
  type LucideIcon,
} from 'lucide-react';

export interface TerminalNavItem {
  /** 终端视图 id，对应 /learn?view=<view>；对话为 ask */
  view: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

/** 学习终端的一级入口，导轨、侧栏与命令面板共用同一份 */
export const TERMINAL_NAV: TerminalNavItem[] = [
  { view: 'ask', label: '对话', hint: '和小砚把问题学明白', icon: MessageSquare },
  { view: 'workbench', label: '工作台', hint: '笔记、导图、测验、闪卡', icon: LayoutGrid },
  { view: 'feynman', label: '教小白', hint: '把学懂的讲给小白听', icon: GraduationCap },
  { view: 'classroom', label: 'AI 课堂', hint: '生成一堂可以播放的课', icon: Presentation },
  { view: 'agent', label: '助理任务', hint: '交给小砚去办的事', icon: Bot },
  { view: 'memory', label: '记忆', hint: '小砚记住的你', icon: Brain },
  { view: 'library', label: '资料库', hint: '上传与管理学习资料', icon: FolderOpen },
];

export const terminalViewPath = (view: string) => (view === 'ask' ? '/learn' : `/learn?view=${view}`);

/** 终端主区域可以显示的全部视图 */
export const VIEWS = [
  'ask', 'guided', 'read', 'practice', 'cards', 'prepare',
  'library', 'journey', 'studio', 'source', 'notes',
  'workbench', 'feynman', 'classroom', 'agent', 'memory',
] as const;
export type View = (typeof VIEWS)[number];

export const isView = (value: string | null | undefined): value is View => VIEWS.includes(value as View);

/** 独立的功能视图：不依赖当前课程，由 views/ 下的懒加载组件实现 */
export const TOOL_VIEWS = ['workbench', 'feynman', 'classroom', 'agent', 'memory'] as const;
export type ToolView = (typeof TOOL_VIEWS)[number];
export const isToolView = (view: View): view is ToolView => TOOL_VIEWS.includes(view as ToolView);

/** 课内学习方式：打开课程后显示为一条标签 */
export const STUDY_TABS: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'ask', label: '问小砚', icon: MessageSquare },
  { id: 'guided', label: '带我学', icon: Route },
  { id: 'read', label: '读讲义', icon: BookOpen },
  { id: 'practice', label: '练一练', icon: ClipboardList },
  { id: 'cards', label: '闪卡', icon: Layers },
  { id: 'prepare', label: '备课流程', icon: Users },
];

export const VIEW_LABELS: Record<View, string> = {
  ask: '问小砚', guided: '带我学', read: '读讲义', practice: '练一练', cards: '闪卡', prepare: '备课流程',
  library: '资料库', journey: '师徒旅程', studio: '学习产物', source: '资料原文', notes: '学习便笺',
  workbench: '工作台', feynman: '教小白', classroom: 'AI 课堂', agent: '助理任务', memory: '记忆',
};

/** 当前视图在导轨上点亮哪一项 */
export function railKey(view: View): string {
  if (view === 'library' || isToolView(view)) return view;
  return 'ask';
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}
