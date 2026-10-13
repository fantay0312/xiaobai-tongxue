import {
  BookOpenCheck, Bot, FlaskConical, Layers, ListChecks, ListTodo, MessageSquareText, Network, NotebookPen, PenLine, Presentation,
  type LucideIcon,
} from 'lucide-react';
import type { ArtifactKind } from '../../lib/artifacts';
import s from './preview.module.css';

const icons: Record<ArtifactKind, LucideIcon> = {
  note: NotebookPen, mindmap: Network, quiz: ListChecks, deck: Layers, 'todo-list': ListTodo, writing: PenLine,
  'chat-artifact': MessageSquareText, lesson: Presentation, 'agent-output': Bot, 'research-file': FlaskConical,
};

/** 生成的内容用的类型图标块，和文件类型图标同一套形状；未知类型退回通用图标。 */
export function ArtifactTypeIcon({ kind, size = 36, className }: { kind: ArtifactKind; size?: number; className?: string }) {
  const Glyph = icons[kind] ?? BookOpenCheck;
  return (
    <span className={`${s.typeIcon}${className ? ` ${className}` : ''}`} data-tone={`made-${kind}`} data-made="" style={{ width: size, height: size }} aria-hidden="true">
      <Glyph size={Math.round(size * 0.5)} strokeWidth={1.75} />
    </span>
  );
}
