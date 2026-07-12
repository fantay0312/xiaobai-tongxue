import type { ComponentProps } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardList,
  ExternalLink,
  Glasses,
  GraduationCap,
  LampDesk,
  Library,
  Lightbulb,
  LogOut,
  MailOpen,
  MapPinned,
  Mic,
  NotebookPen,
  PenLine,
  Play,
  Presentation,
  Route,
  School,
  Send,
  Settings,
  Sparkles,
  Sprout,
  Swords,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import styles from './Icon.module.css';

const ICONS = {
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'book-open': BookOpenText,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'circle-check': CircleCheck,
  'circle-help': CircleHelp,
  'circle-x': CircleX,
  clipboard: ClipboardList,
  external: ExternalLink,
  glasses: Glasses,
  graduation: GraduationCap,
  lamp: LampDesk,
  library: Library,
  lightbulb: Lightbulb,
  logout: LogOut,
  mail: MailOpen,
  map: MapPinned,
  mic: Mic,
  notebook: NotebookPen,
  pen: PenLine,
  play: Play,
  presentation: Presentation,
  route: Route,
  school: School,
  send: Send,
  settings: Settings,
  sparkles: Sparkles,
  sprout: Sprout,
  swords: Swords,
  'users-round': UsersRound,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

interface IconProps extends Omit<ComponentProps<LucideIcon>, 'children' | 'name'> {
  name: IconName;
  label?: string;
}

/** 功能与状态统一走线性图标；印章、卷号等叙事字形继续保留汉字。 */
export function Icon({ name, label, className, size = 18, strokeWidth = 1.8, ...props }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      {...props}
      className={className ? `${styles.icon} ${className}` : styles.icon}
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      focusable="false"
    />
  );
}
