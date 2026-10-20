/**
 * AI 课堂的板块侧栏：新建一堂课、我的课程、打开着的课的场景列表。
 * 渲染进终端侧栏的挂载位；侧栏收起或在手机上没有挂载位时不渲染，主区自带课程库和幕导航。
 */
import { useEffect, useState } from 'react';
import { FileCode2, MessageSquare, MoreHorizontal, Plus, Presentation, Trash2 } from 'lucide-react';
import { IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../../../components/ui';
import { IconClassroom } from '../../../../components/ui/icons';
import { estimateMinutes, type GenerateProgress, type Lesson, type SceneProgress } from '../../../../engine/lessonStudio';
import { LESSON_CAP } from '../../../../store/lessonStore';
import { SideAction, SideEmpty, SideGroup, SideNavItem, SidePanel, SidebarPortal, useSidebarSlot } from '../../shell/sidebarSlot';
import { LESSON_PROMPT_RECORDS } from './LessonComposer';
import { SCENE_ICONS, runExport } from './sceneMeta';

const PROGRESS_LABELS: Record<SceneProgress['status'], string> = { pending: '排队', running: '生成中', done: '完成', fallback: '本地补位' };

/**
 * 侧栏导航此刻是否真的看得见。
 * 没有挂载位（手机）算看不见；挂载位还在、但侧栏被收起（display: none）也算看不见 ——
 * 这两种情况主区都要自带课程库和幕导航。
 */
export function useSidebarNavVisible(): boolean {
  const slot = useSidebarSlot();
  const [visible, setVisible] = useState(() => !!slot && slot.getClientRects().length > 0);
  useEffect(() => {
    if (!slot) {
      setVisible(false);
      return;
    }
    const update = () => setVisible(slot.getClientRects().length > 0);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot]);
  return visible;
}

export interface LessonSidebarProps {
  lessons: Lesson[];
  /** 打开着的课；在「新建一堂课」时为 null */
  activeId: string | null;
  onOpen: (lesson: Lesson) => void;
  onNew: () => void;
  onDelete: (lesson: Lesson) => void;
  /** 正在生成的新课 */
  progress?: GenerateProgress | null;
  /** 把一条对话记录填进「新建一堂课」的主题框 */
  onPickPrompt: (text: string) => void;
  /** 打开着的课的场景导航 */
  scenes?: {
    lesson: Lesson;
    sceneIndex: number;
    /** 正在重新生成的那一幕 */
    busyIndex: number | null;
    onJump: (index: number) => void;
  };
}

export function LessonSidebar({ lessons, activeId, onOpen, onNew, onDelete, onPickPrompt, progress, scenes }: LessonSidebarProps) {
  return (
    <SidebarPortal>
      <SidePanel
        title="AI 课堂"
        action={<SideAction icon={<Plus size={16} strokeWidth={1.75} />} onClick={onNew}>新建一堂课</SideAction>}
        footer={`${lessons.length} / ${LESSON_CAP} 堂 · 保存在这台设备的浏览器里`}
      >
        <SideGroup label="对话记录">
          {LESSON_PROMPT_RECORDS.map((text) => (
            <SideNavItem
              key={text}
              icon={<MessageSquare size={15} strokeWidth={1.75} />}
              label={text}
              title={text}
              disabled={!!progress}
              onClick={() => onPickPrompt(text)}
            />
          ))}
        </SideGroup>

        {progress && (
          <SideGroup label={progress.title ? `正在生成 · ${progress.title}` : '正在生成'}>
            {progress.scenes.length === 0 && <SideEmpty>正在设计课程大纲…</SideEmpty>}
            {progress.scenes.map((scene, index) => {
              const Icon = SCENE_ICONS[scene.type];
              return (
                <SideNavItem
                  key={index}
                  icon={<Icon size={15} strokeWidth={1.75} />}
                  label={scene.title}
                  meta={PROGRESS_LABELS[scene.status]}
                  active={scene.status === 'running'}
                  onClick={onNew}
                />
              );
            })}
          </SideGroup>
        )}

        <SideGroup label="我的课程">
          {lessons.length === 0 && <SideEmpty>还没有课程。点「新建一堂课」，写一个主题就能生成。</SideEmpty>}
          {lessons.map((lesson) => (
            <SideNavItem
              key={lesson.id}
              icon={<IconClassroom size={16} active={lesson.id === activeId} />}
              label={lesson.title}
              sub={`${lesson.scenes.length} 幕 · 约 ${estimateMinutes(lesson)} 分钟${lesson.origin === 'local' ? ' · 本地演示' : ''}`}
              title={lesson.title}
              active={lesson.id === activeId}
              onClick={() => onOpen(lesson)}
              trailing={(
                <Menu>
                  <MenuTrigger asChild><IconButton label={`「${lesson.title}」的更多操作`} size="sm" tip={false}><MoreHorizontal size={15} strokeWidth={1.75} /></IconButton></MenuTrigger>
                  <MenuContent align="start">
                    <MenuItem icon={<Presentation size={16} strokeWidth={1.75} />} onSelect={() => runExport('pptx', lesson)}>导出 PPTX</MenuItem>
                    <MenuItem icon={<FileCode2 size={16} strokeWidth={1.75} />} onSelect={() => runExport('html', lesson)}>导出 HTML</MenuItem>
                    <MenuSeparator />
                    <MenuItem danger icon={<Trash2 size={16} strokeWidth={1.75} />} onSelect={() => onDelete(lesson)}>删除</MenuItem>
                  </MenuContent>
                </Menu>
              )}
            />
          ))}
        </SideGroup>

        {scenes && (
          <SideGroup label="本课场景">
            {scenes.lesson.scenes.map((scene, index) => {
              const Icon = SCENE_ICONS[scene.type];
              return (
                <SideNavItem
                  key={scene.id}
                  icon={<Icon size={15} strokeWidth={1.75} />}
                  label={scene.title}
                  title={scene.title}
                  meta={scenes.busyIndex === index ? '生成中' : index + 1}
                  active={index === scenes.sceneIndex}
                  onClick={() => scenes.onJump(index)}
                />
              );
            })}
          </SideGroup>
        )}
      </SidePanel>
    </SidebarPortal>
  );
}
