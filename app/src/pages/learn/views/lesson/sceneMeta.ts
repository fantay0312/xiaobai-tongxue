/**
 * 幕类型图标与导出入口：生成器、课程库、侧栏和播放器共用。
 */
import { Boxes, CircleHelp, PenLine, Presentation, Target } from 'lucide-react';
import { toast } from '../../../../components/ui';
import type { Lesson, SceneType } from '../../../../engine/lessonStudio';
import { exportHtml, exportPptx } from './exportLesson';

export const SCENE_ICONS: Record<SceneType, typeof Presentation> = {
  slide: Presentation, whiteboard: PenLine, quiz: CircleHelp, interactive: Boxes, pbl: Target,
};

export function runExport(kind: 'pptx' | 'html', lesson: Lesson) {
  const label = kind === 'pptx' ? 'PPTX' : '交互式 HTML';
  toast.promise(kind === 'pptx' ? exportPptx(lesson) : exportHtml(lesson), {
    loading: `正在生成 ${label}…`,
    success: `已导出 ${label}`,
    error: '导出失败，请重试',
  });
}
