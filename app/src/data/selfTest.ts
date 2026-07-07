/**
 * 备课「摸底快测」第二波:多维自测选择题。
 * 模式与 demoScript 同款:每题库随 topic 文件导出,在此聚合(topicId → 题组)。
 * 出题纪律:
 *  - 题干/选项用生活语言,不裸露未教术语;explanation 一句话收束
 *  - checklistRef 挂讲课路线图要点;mcRef 挂误区(答错时备课页据此自动展开相关材料)
 *  - 备课页是学习面,但 groundTruth / lookupCard 永不引用到这里
 *  - dimension 覆盖多方位:同一主题的题组至少横跨 4 个维度
 */
import type { PredictionQuizItem } from '../types';
import { OS_SELF_TESTS } from './topics/os';
import { tokenizationSelfTest } from './topics/tokenization';
import { gradientDescentSelfTest } from './topics/gradientDescent';
import { attentionSelfTest } from './topics/attention';
import { pretrainFinetuneSelfTest } from './topics/pretrainFinetune';
import { rlhfSelfTest } from './topics/rlhf';
import { scalingLawsSelfTest } from './topics/scalingLaws';

/** 考查维度:概念画面 / 情景推演 / 边界情况 / 生活应用 / 常识辨析 */
export type SelfTestDimension = '概念' | '推演' | '边界' | '应用' | '辨析';

export interface SelfTestItem extends PredictionQuizItem {
  dimension: SelfTestDimension;
}

export const SELF_TESTS: Record<string, SelfTestItem[]> = {
  tokenization: tokenizationSelfTest,
  'gradient-descent': gradientDescentSelfTest,
  attention: attentionSelfTest,
  'pretrain-finetune': pretrainFinetuneSelfTest,
  rlhf: rlhfSelfTest,
  'scaling-laws': scalingLawsSelfTest,
  ...OS_SELF_TESTS,
};

export function getSelfTest(topicId: string): SelfTestItem[] {
  return SELF_TESTS[topicId] ?? [];
}
