/**
 * 课程知识库注册表。
 * 每个知识点一个文件放在 ./topics/ 下,在此汇总导出。
 */
import type { DemoLine, Topic } from '../types';
import { shallowCopyTopic } from './topics/shallowCopy';
import { mutableDefaultTopic } from './topics/mutableDefault';
import { lockedTopics } from './topics/locked';
import { DEMO_SCRIPT } from './demoScript';

export const TOPICS: Topic[] = [shallowCopyTopic, mutableDefaultTopic, ...lockedTopics];

export function getTopic(topicId: string): Topic | undefined {
  return TOPICS.find((t) => t.topicId === topicId);
}

export function getDemoScript(topicId: string): DemoLine[] {
  return DEMO_SCRIPT[topicId] ?? [];
}

export { DEMO_SCRIPT };
export { XIAOBAI_LINES } from './xiaobaiLines';
