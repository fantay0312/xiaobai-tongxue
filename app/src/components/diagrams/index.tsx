/**
 * 教学示意图注册表 —— 备课材料按 topicId 取「手绘水墨线稿」SVG 图。
 * 纪律:每张图的口径必须与 data/topics/*.ts 的 microLecture 一致(改口径先改图);
 * caption 用小白式生活语言一句话讲图;朱砂只出现在「坑」标注上。
 * 未收录的 topicId(如 locked 卡)返回空数组,调用方按无图降级,不要兜底假图。
 */
import type { ComponentType } from 'react';
import { TokPipelineSvg, TokGranularitySvg } from './TokenizationFigs';
import { GdContourSvg, GdLearningRateSvg } from './GradientDescentFigs';
import { AttnLinksSvg } from './AttentionFigs';
import { PfTwoStageSvg } from './PretrainFinetuneFigs';
import { RlhfLoopSvg } from './RlhfFigs';
import { SlLogLogSvg, SlChinchillaSvg } from './ScalingLawsFigs';
import { ScPointerSvg } from './ShallowCopyFigs';
import { MdTimelineSvg } from './MutableDefaultFigs';
import { OS_TOPIC_FIGURES } from './os';

export interface TopicFigure {
  id: string;
  title: string;
  caption: string;
  Svg: ComponentType<{ className?: string }>;
}

export const TOPIC_FIGURES: Record<string, TopicFigure[]> = {
  tokenization: [
    {
      id: 'tok-pipeline',
      title: '一句话怎么变成编号',
      caption: '你发的一句话,先照词表切成积木块,再把每块换成编号——模型从头到尾只看到这串编号。',
      Svg: TokPipelineSvg,
    },
    {
      id: 'tok-granularity',
      title: '常见的整,生僻的碎',
      caption: '常见词在词表里有现成整块,一刀一块;生僻词只能拆碎兜底——所以数字数猜不出块数。',
      Svg: TokGranularitySvg,
    },
  ],
  'gradient-descent': [
    {
      id: 'gd-contour',
      title: '摸黑下山:等高线上的小步',
      caption: '训练像摸黑下山:看不见全景,每步用脚感受哪边是下坡,就朝那边挪一小步。',
      Svg: GdContourSvg,
    },
    {
      id: 'gd-learning-rate',
      title: '步子合适 vs 步子太大',
      caption: '同一座山谷,步子合适就稳稳到底;步子太大,每步都跨过谷底落到对面更高处,越甩越远。',
      Svg: GdLearningRateSvg,
    },
  ],
  attention: [
    {
      id: 'attn-links',
      title: '「它」在偷看谁',
      caption: '「它」拿着问题问遍全句,和谁对得上就从谁那里多取一点内容——分量人人有份,不是只盯一个词。',
      Svg: AttnLinksSvg,
    },
  ],
  'pretrain-finetune': [
    {
      id: 'pf-two-stage',
      title: '两阶段:博览群书 → 学规矩说话',
      caption: '先在海量杂书里自学猜下一个词攒本事,再用少量专书点拨规矩——本事是先天读出来的,规矩是后天教的。',
      Svg: PfTwoStageSvg,
    },
  ],
  rlhf: [
    {
      id: 'rlhf-loop',
      title: '三步调教:示范 → 品味打分器 → 反复练',
      caption: '人先给示范,再教出一个懂人类口味的打分器,最后让模型照这份品味反复练——练时拴根缰绳,防它跑偏。',
      Svg: RlhfLoopSvg,
    },
  ],
  'scaling-laws': [
    {
      id: 'sl-loglog',
      title: '双对数坐标上的一条直线',
      caption: '双对数坐标下,损失随规模近似沿直线下降——每翻一倍只降固定比例;至于一直外推下去还灵不灵,学界仍有争议。',
      Svg: SlLogLogSvg,
    },
    {
      id: 'sl-chinchilla',
      title: '同一笔算力的两种花法',
      caption: '同一笔算力,吃饱的 70B 反而全面胜过饿着的 280B——参数和数据要配平着花。',
      Svg: SlChinchillaSvg,
    },
  ],
  'shallow-copy': [
    {
      id: 'sc-pointer',
      title: '新外壳,同一份里层',
      caption: 'copy() 只换了个新外壳,里层的子列表还是同一份——改一边,另一边跟着变。',
      Svg: ScPointerSvg,
    },
  ],
  'mutable-default': [
    {
      id: 'md-timeline',
      title: '默认值只求值一次的时间线',
      caption: '等号后面的空列表只在 def 执行那一刻做一次,之后每次不传参用的都是它——上次放的东西还在。',
      Svg: MdTimelineSvg,
    },
  ],
  ...OS_TOPIC_FIGURES,
};

/** 按 topicId 取图;未收录返回空数组,调用方按无图降级 */
export function getFigures(topicId: string): TopicFigure[] {
  return TOPIC_FIGURES[topicId] ?? [];
}
