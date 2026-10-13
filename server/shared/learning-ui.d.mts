export interface LearningUiBase { id: string; title: string; sourceIds: string[]; }
export interface LearningMindNode { label: string; note?: string; children?: LearningMindNode[]; }
export type LearningUiBlock = LearningUiBase & (
  | { type: 'concept'; body: string }
  | { type: 'flashcard'; front: string; back: string }
  | { type: 'quiz'; question: string; options: string[]; answerIndex: number; explanation: string }
  | { type: 'comparison'; columns: string[]; rows: { label: string; values: string[] }[] }
  | { type: 'plan'; steps: { title: string; detail: string; minutes: number }[] }
  | { type: 'steps'; steps: { title: string; body: string; latex?: string }[]; result?: string }
  | { type: 'formula'; latex: string; symbols: { symbol: string; meaning: string }[]; usage?: string }
  | { type: 'code'; language: string; code: string; notes: { line: number; text: string }[]; explanation?: string }
  | { type: 'chart'; kind: 'bar' | 'line' | 'pie'; labels: string[]; series: { name: string; values: number[] }[]; unit?: string; note?: string }
  | { type: 'mindmap'; root: LearningMindNode }
  | { type: 'timeline'; events: { time: string; title: string; detail?: string }[] }
  | { type: 'callout'; tone: 'tip' | 'warning' | 'misconception'; body: string; fix?: string }
  | { type: 'table'; columns: string[]; rows: string[][]; caption?: string }
);
export type LearningUiBlockType = LearningUiBlock['type'];
export type LearningUiBlockOf<T extends LearningUiBlockType> = Extract<LearningUiBlock, { type: T }>;
export interface LearningUi { version: 1; summary: string; blocks: LearningUiBlock[]; followUps: string[]; }
/** 每个卡片的可保存交互状态：quiz 用 choice/revealed，flashcard 用 revealed，plan 用 checked，steps 用 step（已展开到第几步）。 */
export type LearningInteraction = Record<string, { choice?: number; revealed?: boolean; checked?: number[]; step?: number }>;
export const LEARNING_BLOCK_LIMIT: number;
export const LEARNING_BLOCK_TYPES: LearningUiBlockType[];
export function parseLearningUiJson(raw: string): unknown;
export function validateLearningUi(value: unknown, sources: { id: string }[], options?: { salvage?: boolean }): LearningUi;
export function learningUiText(ui: LearningUi): string;
export function partialLearningSummary(raw: string): string;
export function restoreLearningInteraction(ui: LearningUi, raw: unknown): LearningInteraction;
