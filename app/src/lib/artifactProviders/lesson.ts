/** AI 课堂 → 成果登记处：每堂保存下来的课都是一份成果，正文是大纲加逐幕讲稿。 */
import { SCENE_LABELS, estimateMinutes, lessonMarkdown, sceneTypeMix, type Lesson } from '../../engine/lessonStudio';
import { lessonStore } from '../../store/lessonStore';
import { registerArtifactProvider, type Artifact } from '../artifacts';

function toArtifact(lesson: Lesson): Artifact {
  const mix = sceneTypeMix(lesson).map((item) => `${SCENE_LABELS[item.type]} ${item.count}`).join('、');
  const open = { view: 'classroom', params: { lesson: lesson.id } };
  return {
    key: `lesson:${lesson.id}`,
    kind: 'lesson',
    id: lesson.id,
    title: lesson.title,
    summary: `${lesson.scenes.length} 幕 · 约 ${estimateMinutes(lesson)} 分钟${mix ? ` · ${mix}` : ''}`,
    ...(lesson.topicId ? { topicId: lesson.topicId } : {}),
    ...(lesson.topicTitle ? { topicTitle: lesson.topicTitle } : {}),
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt || lesson.createdAt,
    madeBy: 'ai',
    origin: {
      section: 'lesson',
      label: lesson.prompt.trim() ? `AI 课堂：${lesson.prompt.trim().slice(0, 40)}` : 'AI 课堂',
      open,
    },
    open,
  };
}

registerArtifactProvider('lesson', {
  list: (owner) => lessonStore.list(owner).map(toArtifact),
  content: (owner, id) => {
    const lesson = lessonStore.get(owner, id);
    if (!lesson) return null;
    return { title: lesson.title, text: lessonMarkdown(lesson), filename: `${lesson.title.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'AI 课'}.md`, mime: 'text/markdown' };
  },
  subscribe: (notify) => lessonStore.subscribe(notify),
});
