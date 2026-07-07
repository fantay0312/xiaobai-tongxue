/**
 * 课程知识库注册表。
 * 每个知识点一个文件放在 ./topics/ 下,在此汇总导出。
 */
import type { DemoLine, Topic } from '../types';
import { tokenizationTopic } from './topics/tokenization';
import { gradientDescentTopic } from './topics/gradientDescent';
import { attentionTopic } from './topics/attention';
import { pretrainFinetuneTopic } from './topics/pretrainFinetune';
import { rlhfTopic } from './topics/rlhf';
import { scalingLawsTopic } from './topics/scalingLaws';
import { shallowCopyTopic } from './topics/shallowCopy';
import { mutableDefaultTopic } from './topics/mutableDefault';
import { lockedTopics } from './topics/locked';
import { OS_TOPICS } from './topics/os';
import { DEMO_SCRIPT } from './demoScript';

/** 书架按 course 分组展示;数组顺序即书架陈列顺序(《大模型训练》为主推课程;《操作系统原理》30 讲对齐 jyy 2026 春) */
export const TOPICS: Topic[] = [
  tokenizationTopic, gradientDescentTopic, attentionTopic,
  pretrainFinetuneTopic, rlhfTopic, scalingLawsTopic,
  ...OS_TOPICS,
  shallowCopyTopic, mutableDefaultTopic, ...lockedTopics,
];

export function getTopic(topicId: string): Topic | undefined {
  return TOPICS.find((t) => t.topicId === topicId);
}

export function getDemoScript(topicId: string): DemoLine[] {
  return DEMO_SCRIPT[topicId] ?? [];
}

export { DEMO_SCRIPT };
export { XIAOBAI_LINES } from './xiaobaiLines';
