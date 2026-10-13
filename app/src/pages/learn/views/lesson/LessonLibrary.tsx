/**
 * 课程库：已生成的课，卡片上能看到幕类型构成和预计时长。
 */
import { Clock, FileCode2, MoreHorizontal, Play, Presentation, Trash2 } from 'lucide-react';
import { Badge, Empty, IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../../../components/ui';
import { SCENE_LABELS, estimateMinutes, sceneTypeMix, type Lesson } from '../../../../engine/lessonStudio';
import { LESSON_CAP } from '../../../../store/lessonStore';
import { SCENE_ICONS, runExport } from './ClassroomPlayer';
import st from './studio.module.css';

const dayLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}月${date.getDate()}日`;
};

export function LessonLibrary({ lessons, onOpen, onDelete }: {
  lessons: Lesson[];
  onOpen: (lesson: Lesson) => void;
  onDelete: (lesson: Lesson) => void;
}) {
  return (
    <section className={st.library} aria-label="我的课程">
      <header className={st.sectionHead}>
        <h2>我的课程</h2>
        <span>{lessons.length} / {LESSON_CAP} · 保存在这台设备的浏览器里</span>
      </header>
      {lessons.length === 0 ? (
        <Empty
          className={st.empty}
          icon={<Presentation size={22} strokeWidth={1.5} />}
          title="还没有课程"
          description="在上面写一个主题，或者直接用正在学的课生成第一堂课。"
        />
      ) : (
        <ul className={st.grid}>
          {lessons.map((lesson) => (
            <li key={lesson.id} className={st.card}>
              <button type="button" className={st.cardOpen} onClick={() => onOpen(lesson)} aria-label={`进入课堂：${lesson.title}`}>
                <span className={st.cover} aria-hidden="true">
                  {lesson.scenes.slice(0, 12).map((scene) => {
                    const Icon = SCENE_ICONS[scene.type];
                    return <i key={scene.id} data-type={scene.type}><Icon size={13} strokeWidth={1.75} /></i>;
                  })}
                  <span className={st.coverPlay}><Play size={15} strokeWidth={2} /></span>
                </span>
                <span className={st.cardTitle}>{lesson.title}</span>
                {lesson.summary && <span className={st.cardSummary}>{lesson.summary}</span>}
                <span className={st.cardMix}>
                  {sceneTypeMix(lesson).map((item) => <span key={item.type}>{SCENE_LABELS[item.type]} {item.count}</span>)}
                </span>
              </button>
              <footer className={st.cardFoot}>
                <span className={st.cardMeta}><Clock size={13} strokeWidth={1.75} />约 {estimateMinutes(lesson)} 分钟 · {dayLabel(lesson.createdAt)}</span>
                {lesson.origin === 'local' && <Badge tone="warn">本地演示</Badge>}
                <Menu>
                  <MenuTrigger asChild><IconButton label="更多操作" size="sm" tip={false}><MoreHorizontal size={16} strokeWidth={1.75} /></IconButton></MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem icon={<Play size={16} strokeWidth={1.75} />} onSelect={() => onOpen(lesson)}>进入课堂</MenuItem>
                    <MenuItem icon={<Presentation size={16} strokeWidth={1.75} />} onSelect={() => runExport('pptx', lesson)}>导出 PPTX</MenuItem>
                    <MenuItem icon={<FileCode2 size={16} strokeWidth={1.75} />} onSelect={() => runExport('html', lesson)}>导出交互式 HTML</MenuItem>
                    <MenuSeparator />
                    <MenuItem danger icon={<Trash2 size={16} strokeWidth={1.75} />} onSelect={() => onDelete(lesson)}>删除</MenuItem>
                  </MenuContent>
                </Menu>
              </footer>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
