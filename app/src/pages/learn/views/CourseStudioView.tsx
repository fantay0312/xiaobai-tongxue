/**
 * AI 课堂 —— 一键生成课程，然后进到有老师、有同学的课堂里上课。
 * 入口：/learn?view=classroom（可带 &lesson=<id> 直接进某堂课）。
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Dialog } from '../../../components/ui';
import { XiaobaiAvatar } from '../../../components/xiaobai/XiaobaiAvatar';
import type { Lesson } from '../../../engine/lessonStudio';
import { useAppStore } from '../../../store/appStore';
import { lessonStore, useLessons } from '../../../store/lessonStore';
import { ClassroomPlayer } from './lesson/ClassroomPlayer';
import { LessonComposer } from './lesson/LessonComposer';
import { LessonLibrary } from './lesson/LessonLibrary';
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
  const [searchParams] = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(() => searchParams.get('lesson'));
  const [pendingDelete, setPendingDelete] = useState<Lesson | null>(null);
  const xiaobaiLevel = useAppStore((state) => state.global.learningLevel);
  const active = activeId ? lessons.find((lesson) => lesson.id === activeId) : undefined;

  const confirmDelete = () => {
    if (!pendingDelete) return;
    lessonStore.remove(owner, pendingDelete.id);
    if (pendingDelete.id === activeId) setActiveId(null);
    setPendingDelete(null);
  };

  const deleteDialog = (
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
  );

  if (active) {
    return (
      <>
        <ClassroomPlayer
          key={active.id}
          lesson={active}
          owner={owner}
          topic={props.topic}
          topics={props.topics}
          selectedSources={props.selectedSources}
          onView={props.onView}
          onExit={() => setActiveId(null)}
          onDelete={() => setPendingDelete(active)}
        />
        {deleteDialog}
      </>
    );
  }

  return (
    <div className={st.root}>
      <header className={st.hero}>
        <div className={st.heroText}>
          <h1>AI 课堂</h1>
          <p>说一个主题，几分钟生成一堂完整的课：老师讲、同学问、你随时举手。</p>
        </div>
        <div className={st.cast} aria-hidden="true">
          <span className={st.castFace} data-who="teacher">砚</span>
          <span className={st.castAvatar}><XiaobaiAvatar mood="curious" level={xiaobaiLevel} size={44} /></span>
          <span className={st.castFace} data-who="acheng">澄</span>
        </div>
      </header>

      <LessonComposer owner={owner} topic={props.topic} selectedSources={props.selectedSources} onCreated={(lesson) => setActiveId(lesson.id)} />

      <ul className={st.features}>
        {FEATURES.map((item) => (
          <li key={item.title}><strong>{item.title}</strong><span>{item.text}</span></li>
        ))}
      </ul>

      <LessonLibrary lessons={lessons} onOpen={(lesson) => setActiveId(lesson.id)} onDelete={setPendingDelete} />
      {deleteDialog}
    </div>
  );
}
