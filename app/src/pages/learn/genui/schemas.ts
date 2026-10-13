/**
 * OpenUI 组件库用的参数结构。与 server/shared/learning-ui.mjs 的校验一一对应：
 * 那边负责「模型输出是否可信」，这里负责「渲染器只接受认识的组件和字段」。
 */
import { z } from 'zod/v4';
import type { LearningUi, LearningUiBlockType } from '../../../../../server/shared/learning-ui.mjs';

const base = { id: z.string(), title: z.string(), sourceIds: z.array(z.string()) };

// 思维导图最多 4 层，逐层写出来，避免递归结构
const leaf = z.object({ label: z.string(), note: z.string().optional() });
const level3 = leaf.extend({ children: z.array(leaf).optional() });
const level2 = leaf.extend({ children: z.array(level3).optional() });
const level1 = leaf.extend({ children: z.array(level2).optional() });

export const blockSchemas = {
  concept: z.object({ ...base, type: z.literal('concept'), body: z.string() }),
  flashcard: z.object({ ...base, type: z.literal('flashcard'), front: z.string(), back: z.string() }),
  quiz: z.object({ ...base, type: z.literal('quiz'), question: z.string(), options: z.array(z.string()), answerIndex: z.number(), explanation: z.string() }),
  comparison: z.object({ ...base, type: z.literal('comparison'), columns: z.array(z.string()), rows: z.array(z.object({ label: z.string(), values: z.array(z.string()) })) }),
  plan: z.object({ ...base, type: z.literal('plan'), steps: z.array(z.object({ title: z.string(), detail: z.string(), minutes: z.number() })) }),
  steps: z.object({ ...base, type: z.literal('steps'), steps: z.array(z.object({ title: z.string(), body: z.string(), latex: z.string().optional() })), result: z.string().optional() }),
  formula: z.object({ ...base, type: z.literal('formula'), latex: z.string(), symbols: z.array(z.object({ symbol: z.string(), meaning: z.string() })), usage: z.string().optional() }),
  code: z.object({ ...base, type: z.literal('code'), language: z.string(), code: z.string(), notes: z.array(z.object({ line: z.number(), text: z.string() })), explanation: z.string().optional() }),
  chart: z.object({ ...base, type: z.literal('chart'), kind: z.enum(['bar', 'line', 'pie']), labels: z.array(z.string()), series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })), unit: z.string().optional(), note: z.string().optional() }),
  mindmap: z.object({ ...base, type: z.literal('mindmap'), root: level1 }),
  timeline: z.object({ ...base, type: z.literal('timeline'), events: z.array(z.object({ time: z.string(), title: z.string(), detail: z.string().optional() })) }),
  callout: z.object({ ...base, type: z.literal('callout'), tone: z.enum(['tip', 'warning', 'misconception']), body: z.string(), fix: z.string().optional() }),
  table: z.object({ ...base, type: z.literal('table'), columns: z.array(z.string()), rows: z.array(z.array(z.string())), caption: z.string().optional() }),
} satisfies Record<LearningUiBlockType, z.ZodObject>;

export const COMPONENT_NAMES: Record<LearningUiBlockType, string> = {
  concept: 'Concept', flashcard: 'Flashcard', quiz: 'Quiz', comparison: 'Comparison', plan: 'Plan', steps: 'Steps', formula: 'Formula',
  code: 'Code', chart: 'Chart', mindmap: 'MindMap', timeline: 'Timeline', callout: 'Callout', table: 'DataTable',
};

export const ROOT_COMPONENT = 'LearningAnswer';

/** 已校验的数据 → OpenUI 程序。参数只有 JSON 字面量，没有可执行内容。 */
export function learningUiProgram(ui: LearningUi) {
  return `root = ${ROOT_COMPONENT}([${ui.blocks.map((block) => `${COMPONENT_NAMES[block.type]}(${JSON.stringify(block)})`).join(',')}])`;
}
