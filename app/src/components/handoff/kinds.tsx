import { FileText, PenLine } from 'lucide-react';
import type { ArtifactKind } from '../../lib/artifacts';
import { IconAgent, IconClassroom, IconFlashcard, IconMindmap, IconNote, IconQuiz, IconSpark, IconTodo } from '../ui/icons';

/** 各类成果在列表里用的图标 */
export function ArtifactKindIcon({ kind, size = 16 }: { kind: ArtifactKind; size?: number }) {
  switch (kind) {
    case 'note': return <IconNote size={size} />;
    case 'mindmap': return <IconMindmap size={size} />;
    case 'quiz': return <IconQuiz size={size} />;
    case 'deck': return <IconFlashcard size={size} />;
    case 'todo-list': return <IconTodo size={size} />;
    case 'writing': return <PenLine size={size} strokeWidth={1.75} />;
    case 'chat-artifact': return <IconSpark size={size} />;
    case 'lesson': return <IconClassroom size={size} />;
    case 'agent-output': return <IconAgent size={size} />;
    default: return <FileText size={size} strokeWidth={1.75} />;
  }
}

/** 「3 分钟前」「昨天」「10月12日」这样的短时间 */
export function shortTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} 小时前`;
  if (minutes < 48 * 60) return '昨天';
  const date = new Date(at);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
