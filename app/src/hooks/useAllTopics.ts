import { useMemo } from 'react';
import { TOPICS } from '../data';
import { useAppStore } from '../store/appStore';
import type { Topic } from '../types';

/** 预埋课保持原顺序，自定义课只在当前登录账号的运行时尾部追加。 */
export function useAllTopics(): Topic[] {
  const customTopics = useAppStore((state) => state.customTopics);
  return useMemo(() => [...TOPICS, ...customTopics], [customTopics]);
}
