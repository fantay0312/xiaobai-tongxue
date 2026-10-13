import { createContext, useContext } from 'react';
import type { LearningInteraction } from '../../../../../server/shared/learning-ui.mjs';
import type { StudySource } from '../../../engine/studyWorkspace';

export type BlockState = LearningInteraction[string];

export interface AnswerContextValue {
  sources: StudySource[];
  interaction: LearningInteraction;
  /** 保存某个卡片的交互状态（随对话存在本机） */
  onChange: (id: string, state: BlockState) => void;
  onAsk: (text: string) => void;
  onSource: (source: StudySource) => void;
  onSave: (text: string) => void;
}

export const AnswerContext = createContext<AnswerContextValue>({
  sources: [],
  interaction: {},
  onChange: () => {},
  onAsk: () => {},
  onSource: () => {},
  onSave: () => {},
});

export const useAnswer = () => useContext(AnswerContext);

const EMPTY: BlockState = {};

/** 读写单个卡片的交互状态。 */
export function useBlockState(id: string): [BlockState, (state: BlockState) => void] {
  const { interaction, onChange } = useAnswer();
  return [interaction[id] ?? EMPTY, (state) => onChange(id, state)];
}
