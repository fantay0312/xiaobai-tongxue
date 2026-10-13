/**
 * OpenUI 组件库：一种卡片 = 一个受限组件，渲染器只认这里登记的名字和参数。
 * 模型给的是数据，经服务器与浏览器两次校验后才拼成程序交给渲染器。
 */
import { Component, type ComponentType, type ReactNode } from 'react';
import { createLibrary, createParser, defineComponent } from '@openuidev/react-lang';
import { z } from 'zod/v4';
import { learningUiText, type LearningUiBlock, type LearningUiBlockOf, type LearningUiBlockType } from '../../../../../server/shared/learning-ui.mjs';
import { ChartBlock } from './ChartBlock';
import { CodeBlockView } from './CodeBlock';
import { FormulaBlock, StepsBlock } from './MathBlocks';
import { MindMapBlock } from './MindMapBlock';
import { CalloutBlock, ComparisonBlock, ConceptBlock, DataTableBlock, TimelineBlock } from './ReadingBlocks';
import { FlashcardBlock, PlanBlock, QuizBlock } from './StudyBlocks';
import { Md } from './parts';
import { COMPONENT_NAMES, ROOT_COMPONENT, blockSchemas, learningUiProgram } from './schemas';
import styles from './genui.module.css';

/** 单张卡片渲染出错时退回它的文字版，其余卡片不受影响。 */
class BlockBoundary extends Component<{ item: LearningUiBlock; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className={styles.fallback} role="status">
        <p className={styles.fallbackNote}>这张卡片暂时无法显示，以下是它的文字内容。</p>
        <Md text={learningUiText({ version: 1, summary: '', blocks: [this.props.item], followUps: [] }).trim()} />
      </section>
    );
  }
}

function define<T extends LearningUiBlockType>(type: T, description: string, View: ComponentType<{ item: LearningUiBlockOf<T> }>) {
  return defineComponent({
    name: COMPONENT_NAMES[type],
    description,
    props: z.object({ item: blockSchemas[type] as z.ZodObject }),
    component: ({ props }) => {
      // 参数来自已通过 validateLearningUi 的数据，结构与 LearningUiBlockOf<T> 一致
      const item = props.item as unknown as LearningUiBlockOf<T>;
      return (
        <BlockBoundary item={item}>
          <View item={item} />
        </BlockBoundary>
      );
    },
  });
}

const components = [
  define('concept', '讲解一个概念', ConceptBlock),
  define('steps', '分步推导或解题过程，可逐步展开', StepsBlock),
  define('formula', '公式、符号含义与适用条件', FormulaBlock),
  define('code', '带逐行讲解的代码', CodeBlockView),
  define('comparison', '并排对比两到四个对象', ComparisonBlock),
  define('table', '可排序的数据表', DataTableBlock),
  define('chart', '柱状图、折线图或占比图', ChartBlock),
  define('mindmap', '可折叠的知识结构图', MindMapBlock),
  define('timeline', '按顺序排列的事件或流程', TimelineBlock),
  define('callout', '窍门、注意事项或易错点', CalloutBlock),
  define('quiz', '单选自测题', QuizBlock),
  define('flashcard', '可翻面的记忆卡', FlashcardBlock),
  define('plan', '可勾选的学习安排', PlanBlock),
];

const LearningAnswer = defineComponent({
  name: ROOT_COMPONENT,
  description: '带来源的交互式学习回答',
  props: z.object({ children: z.array(z.union(components.map((component) => component.ref))) }),
  component: ({ props, renderNode }) => (
    <div className={styles.blocks}>
      {(props.children as unknown[]).map((child, index) => (
        <div key={index} className={styles.blockSlot} style={{ animationDelay: `${Math.min(index, 5) * 60}ms` }}>
          {renderNode(child)}
        </div>
      ))}
    </div>
  ),
});

export const learningUiLibrary = createLibrary({ root: ROOT_COMPONENT, components: [LearningAnswer, ...components] });

const parser = createParser(learningUiLibrary.toJSONSchema(), ROOT_COMPONENT);

/** 程序能被渲染器完整解析才交给它，否则调用方显示文字版。 */
export function isRenderable(program: string) {
  try {
    const parsed = parser.parse(program);
    return Boolean(parsed.root) && !parsed.meta.errors?.length && !parsed.meta.unresolved?.length;
  } catch {
    return false;
  }
}

export { learningUiProgram };
