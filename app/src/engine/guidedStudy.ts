import type { Topic } from '../types';
import { getSelfTest } from '../data/selfTest';
import { lectureSections } from './studyWorkspace';

export type StudyScene =
  | { id: string; kind: 'explain' | 'example'; title: string; body: string }
  | { id: string; kind: 'quiz'; title: string; body: string; options: string[]; answer: number; explanation: string; questionId: string }
  | { id: string; kind: 'reflect'; title: string; body: string };

export interface GuidedProgress {
  materialKey: string;
  activeId: string;
  completed: string[];
  skipped: string[];
  reflection: string;
  answers: Record<string, number>;
  returnId?: string;
}

/** IDs include a content version so edited material never inherits old completion. */
function fingerprint(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

export function studyScenes(topic: Topic, includeSelfTests = true): StudyScene[] {
  const scene = (kind: 'explain' | 'example', title: string, body: string, index: number): StudyScene => ({ kind, title, body, id: `${kind}:${index}:${fingerprint(title + body)}` });
  const scenes: StudyScene[] = lectureSections(topic).map((part, index) => scene('explain', part.title, part.text, index));
  topic.prep.examples.forEach((example, index) => scenes.push(scene('example', example.title, `${example.code ? `\`\`\`\n${example.code}\n\`\`\`\n\n` : ''}${example.walkthrough}`, index)));
  const questions = [
    ...topic.misconceptions.map((item) => ({ id: item.mcId, body: item.probe.statement, options: ['正确', '不正确'], answer: item.probe.isTrue ? 0 : 1, explanation: item.probe.explanation })),
    ...(includeSelfTests ? getSelfTest(topic.topicId) : []).map((item) => ({ id: item.id, body: `${item.question}${item.code ? `\n\n\`\`\`\n${item.code}\n\`\`\`` : ''}`, options: item.options, answer: item.answerIndex, explanation: item.explanation })),
  ];
  questions.slice(0, 3).forEach((q, index) => scenes.push({ kind: 'quiz', id: `quiz:${fingerprint(JSON.stringify(q))}`, title: `检查理解 ${index + 1}`, body: q.body, options: q.options, answer: q.answer, explanation: q.explanation, questionId: q.id }));
  scenes.push({ kind: 'reflect', id: 'reflect', title: '用自己的话讲清楚', body: `不看讲义，用一个例子解释「${topic.title}」。还有哪一点你暂时讲不清？` });
  return scenes;
}

export function restoreGuidedProgress(scenes: StudyScene[], raw?: Partial<GuidedProgress> | null): GuidedProgress {
  const materialKey = fingerprint(scenes.map((scene) => scene.id).join('|'));
  const ids = new Set(scenes.map((scene) => scene.id));
  if (raw?.materialKey !== materialKey) return { materialKey, activeId: scenes[0]?.id ?? '', completed: [], skipped: [], reflection: '', answers: {} };
  const filterIds = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && ids.has(id)))] : [];
  const answers: Record<string, number> = {};
  for (const scene of scenes) {
    const value = raw.answers?.[scene.id];
    if (scene.kind === 'quiz' && Number.isInteger(value) && value! >= 0 && value! < scene.options.length) answers[scene.id] = value!;
  }
  return { materialKey, activeId: ids.has(raw.activeId ?? '') ? raw.activeId! : scenes[0]?.id ?? '', completed: filterIds(raw.completed), skipped: filterIds(raw.skipped), reflection: typeof raw.reflection === 'string' ? raw.reflection.slice(0, 2000) : '', answers, ...(ids.has(raw.returnId ?? '') ? { returnId: raw.returnId } : {}) };
}

export function completeStudyScene(progress: GuidedProgress, scenes: StudyScene[], skipped = false): GuidedProgress {
  const index = scenes.findIndex((scene) => scene.id === progress.activeId);
  if (index < 0) return progress;
  const active = scenes[index];
  if (active.kind === 'reflect' && (skipped || !progress.reflection.trim())) return progress;
  if (active.kind === 'quiz' && !skipped && progress.answers[active.id] === undefined) return progress;
  return { ...progress, activeId: scenes[index + 1]?.id ?? progress.activeId, returnId: undefined,
    completed: skipped ? progress.completed.filter((id) => id !== progress.activeId) : [...new Set([...progress.completed, progress.activeId])],
    skipped: skipped ? [...new Set([...progress.skipped, progress.activeId])] : progress.skipped.filter((id) => id !== progress.activeId) };
}

export function sceneQuestionContext(scene: StudyScene): string {
  return `我正在学「${scene.title}」。请围绕这一段帮我理解：\n${scene.body.slice(0, 1500)}`;
}
