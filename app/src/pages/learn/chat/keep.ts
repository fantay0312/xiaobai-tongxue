/**
 * 「收进工作台」—— 回答里已经是结构化的卡片（小测验、闪卡、学习计划、导图）时，
 * 直接按原样存成题目集、卡组、待办和思维导图，不再让模型重做一遍。
 */
import type { LearningMindNode, LearningUi } from '../../../../../server/shared/learning-ui.mjs';
import type { ArtifactOrigin } from '../../../lib/artifacts';
import { setItemOrigin } from '../views/workbench/origins';
import { mindNode, newCard, newId, studyData, type MindNode, type QuizQuestion } from '../../../store/studyData';

export interface KeptItem {
  /** 「3 道题」「2 张闪卡」这样的一小段 */
  label: string;
  open: { view: string; params: Record<string, string> };
}

function pick(ui: LearningUi) {
  return {
    quizzes: ui.blocks.filter((block) => block.type === 'quiz'),
    cards: ui.blocks.filter((block) => block.type === 'flashcard'),
    plans: ui.blocks.filter((block) => block.type === 'plan'),
    maps: ui.blocks.filter((block) => block.type === 'mindmap'),
  };
}

/** 这条回答里有哪些可以原样收下的东西；没有返回空串 */
export function keepableSummary(ui: LearningUi): string {
  const { quizzes, cards, plans, maps } = pick(ui);
  const steps = plans.reduce((sum, plan) => sum + plan.steps.length, 0);
  return [
    quizzes.length ? `${quizzes.length} 道题` : '',
    cards.length ? `${cards.length} 张闪卡` : '',
    steps ? `${steps} 项计划` : '',
    maps.length ? `${maps.length} 张导图` : '',
  ].filter(Boolean).join('、');
}

function toMindNode(node: LearningMindNode, depth = 0): MindNode {
  const children = depth >= 5 ? [] : (node.children ?? []).slice(0, 12).map((child) => toMindNode(child, depth + 1));
  return mindNode(node.label.slice(0, 80), children, node.note?.slice(0, 300));
}

/** 把结构化卡片写进工作台，返回每一类存到了哪里 */
export function keepStructured(owner: string | null, ui: LearningUi, context: { title: string; topicId?: string; origin?: ArtifactOrigin }): KeptItem[] {
  const mark = (key: string) => { if (context.origin) setItemOrigin(owner, key, context.origin); };
  const { quizzes, cards, plans, maps } = pick(ui);
  const link = context.topicId ? { topicId: context.topicId } : {};
  const name = context.title.trim().slice(0, 40) || '对话里的内容';
  const kept: KeptItem[] = [];

  if (quizzes.length) {
    const questions: QuizQuestion[] = quizzes.map((quiz) => ({
      id: newId(), type: 'single', stem: quiz.question, options: [...quiz.options], answer: [quiz.answerIndex], explanation: quiz.explanation,
    }));
    const set = studyData.saveQuizSet(owner, { title: `${name} · 自测题`, questions, origin: 'chat', ...link });
    mark(`quiz:${set.id}`);
    kept.push({ label: `${questions.length} 道题`, open: { view: 'workbench', params: { tool: 'quiz', id: set.id } } });
  }
  if (cards.length) {
    const deck = studyData.saveDeck(owner, { title: `${name} · 闪卡`, cards: cards.map((card) => newCard(card.front, card.back)), origin: 'chat', ...link });
    mark(`deck:${deck.id}`);
    kept.push({ label: `${cards.length} 张闪卡`, open: { view: 'workbench', params: { tool: 'flashcards', id: deck.id } } });
  }
  const steps = plans.flatMap((plan) => plan.steps);
  if (steps.length) {
    // addTodo 每次插到最前，倒着加才能保持原顺序
    for (const step of [...steps].reverse()) {
      const detail = step.detail.trim() ? `：${step.detail.trim()}` : '';
      const minutes = step.minutes > 0 ? `（约 ${step.minutes} 分钟）` : '';
      const todo = studyData.addTodo(owner, { text: `${step.title}${detail}${minutes}`.slice(0, 200), origin: 'chat', ...link });
      mark(`todo:${todo.id}`);
    }
    kept.push({ label: `${steps.length} 项待办`, open: { view: 'workbench', params: { tool: 'todos' } } });
  }
  for (const map of maps) {
    const saved = studyData.saveMindMap(owner, { title: (map.title || map.root.label || name).slice(0, 80), root: toMindNode(map.root), origin: 'chat', ...link });
    mark(`mindmap:${saved.id}`);
    kept.push({ label: '1 张导图', open: { view: 'workbench', params: { tool: 'mindmap', id: saved.id } } });
  }
  return kept;
}
