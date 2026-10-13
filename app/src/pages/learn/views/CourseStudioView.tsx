/**
 * AI 课堂 —— 一键生成课程，然后进到有老师、有同学的课堂里上课。
 * 入口：/learn?view=classroom（可带 &lesson=<id> 直接进某堂课）。
 * 导航在终端侧栏（新建一堂课 / 我的课程 / 本课场景），主区只放一样东西：生成器，或打开着的课堂。
 * 侧栏收起或在手机上看不到侧栏时，主区自带课程库和幕导航。
 */
import { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Dialog, Segmented, toast } from '../../../components/ui';
import { XiaobaiAvatar } from '../../../components/xiaobai/XiaobaiAvatar';
import type { GenerateProgress, Lesson } from '../../../engine/lessonStudio';
import { useAppStore } from '../../../store/appStore';
import { lessonStore, useLessons } from '../../../store/lessonStore';
import { ClassroomPlayer } from './lesson/ClassroomPlayer';
import { LessonComposer } from './lesson/LessonComposer';
import { LessonLibrary } from './lesson/LessonLibrary';
import { LessonSidebar, useSidebarNavVisible, type LessonSidebarProps } from './lesson/LessonSidebar';
import { useMediaQuery } from '../shell/views';
import st from './lesson/studio.module.css';
import type { TerminalViewProps } from './types';

const FEATURES = [
  { title: '一键生成', text: '写一个主题，或用正在学的课和资料' },
  { title: '多人课堂', text: '小砚主讲，小白和阿澄会插话、抢答' },
  { title: '五种幕', text: '幻灯片、白板、测验、互动模拟、项目实践' },
  { title: '随处导出', text: '可编辑的 PPTX，或单文件交互式 HTML' },
];

export default function CourseStudioView(props: TerminalViewProps) {
  const { owner } = props;
  const lessons = useLessons(owner);
  const sidebarSlot = useSidebarNavVisible();
  // 手机：「新建」和「我的课程」用顶部分段切换，课程库不再压在生成器下面
  const phone = useMediaQuery('(max-width: 760px)') && !sidebarSlot;
  const [pane, setPane] = useState<'new' | 'library'>('new');
  const [searchParams] = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get('lesson'));
  const [pendingDelete, setPendingDelete] = useState<Lesson | null>(null);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const xiaobaiLevel = useAppStore((state) => state.global.learningLevel);
  const active = activeId ? lessons.find((lesson) => lesson.id === activeId) : undefined;
  const watchingRef = useRef(false);
  watchingRef.current = !!active;

  const openLesson = useCallback((lesson: Lesson) => setActiveId(lesson.id), []);
  const newLesson = useCallback(() => setActiveId(null), []);
  /** 手机上课堂的返回键写的是「返回课程库」，就回到课程库那一页 */
  const exitLesson = useCallback(() => {
    setActiveId(null);
    setPane('library');
  }, []);

  // 生成期间去看了别的课：不打断，生成好了提示一声
  const onCreated = useCallback((lesson: Lesson) => {
    if (!watchingRef.current) {
      setActiveId(lesson.id);
      return;
    }
    toast.success(`「${lesson.title}」生成好了`, { action: { label: '进入课堂', onClick: () => setActiveId(lesson.id) } });
  }, []);

  const confirmDelete = () => {
    if (!pendingDelete) return;
    lessonStore.remove(owner, pendingDelete.id);
    if (pendingDelete.id === activeId) setActiveId(null);
    setPendingDelete(null);
  };

  const sidebar: Omit<LessonSidebarProps, 'scenes'> = {
    lessons,
    activeId: active?.id ?? null,
    onOpen: openLesson,
    onNew: newLesson,
    onDelete: setPendingDelete,
    progress,
  };

  return (
    <>
      {active ? (
        <ClassroomPlayer
          key={active.id}
          lesson={active}
          sidebar={sidebar}
          owner={owner}
          topic={props.topic}
          topics={props.topics}
          selectedSources={props.selectedSources}
          onView={props.onView}
          onExit={phone ? exitLesson : newLesson}
          onDelete={() => setPendingDelete(active)}
        />
      ) : (
        <LessonSidebar {...sidebar} />
      )}

      {/* 生成器一直挂着：生成中途去看别的课也不会中断 */}
      <div className={st.root} hidden={!!active}>
        <header className={st.hero}>
          <div className={st.heroText}>
            <h1>{sidebarSlot ? '新建一堂课' : 'AI 课堂'}</h1>
            <p>说一个主题，几分钟生成一堂完整的课：老师讲、同学问、你随时举手。</p>
          </div>
          <div className={st.cast} aria-hidden="true">
            <span className={st.castFace} data-who="teacher">砚</span>
            <span className={st.castAvatar}><XiaobaiAvatar mood="curious" level={xiaobaiLevel} size={44} /></span>
            <span className={st.castFace} data-who="acheng">澄</span>
          </div>
        </header>

        {phone && (
          <Segmented
            block
            label="AI 课堂"
            value={pane}
            onChange={setPane}
            options={[
              { value: 'new', label: '新建一堂课' },
              { value: 'library', label: lessons.length ? `我的课程 ${lessons.length}` : '我的课程' },
            ]}
          />
        )}

        {/* 切到课程库时生成器只是藏起来，生成不中断 */}
        <div className={st.pane} hidden={phone && pane !== 'new'}>
          <LessonComposer owner={owner} topic={props.topic} selectedSources={props.selectedSources} onCreated={onCreated} onProgress={setProgress} compact={phone} />

          <ul className={st.features}>
            {FEATURES.map((item) => (
              <li key={item.title}><strong>{item.title}</strong><span>{item.text}</span></li>
            ))}
          </ul>
        </div>

        {/* 有侧栏时课程列表在侧栏里，主区不再重复 */}
        {!sidebarSlot && (!phone || pane === 'library') && <LessonLibrary lessons={lessons} onOpen={openLesson} onDelete={setPendingDelete} />}
      </div>

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        size="sm"
        title="删除这堂课？"
        description={pendingDelete ? `「${pendingDelete.title}」会从这台设备的课程库里移除，无法恢复。已导出的文件不受影响。` : undefined}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>取消</Button>
            <Button variant="danger" onClick={confirmDelete}>删除</Button>
          </>
        )}
      />
    </>
  );
}
