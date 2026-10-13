import { useEffect, useRef, useState } from 'react';
import { toast } from '../../../../components/ui';
import type { TerminalViewProps } from '../types';
import { createFromAI, isAbort, type GenKind } from './actions';
import { hasMaterial } from './generate';

const PACK: GenKind[] = ['note', 'mindmap', 'quiz', 'deck', 'todos'];

export interface PackState {
  /** 有课程或已选资料才能生成 */
  can: boolean;
  running: boolean;
  done: number;
  total: number;
  sourceCount: number;
  start: () => void;
  cancel: () => void;
}

/** 「生成学习包」：概览卡片和侧栏主动作共用一份进度 */
export function usePack(view: Pick<TerminalViewProps, 'owner' | 'topic' | 'selectedSources'>): PackState {
  const { owner, topic, selectedSources } = view;
  const [done, setDone] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const sources = selectedSources.filter((source) => source.content.trim());
  const can = hasMaterial({ topic, sources });

  /** 五种材料同时生成，各自成功各自入库；某一项模型没给出可用结果时，这一项改用本地演示 */
  const run = async () => {
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    setDone(0);
    const options = { quizCount: 8, deckCount: 12 };
    const results = await Promise.allSettled(PACK.map((kind) => createFromAI(kind, owner, { topic, sources, signal: controller.signal }, options)
      .catch((reason: unknown) => {
        if (controller.signal.aborted || isAbort(reason)) throw reason;
        return createFromAI(kind, owner, { topic, sources, local: true }, options);
      })
      .finally(() => setDone((current) => (current === null ? current : current + 1)))));
    if (controller.signal.aborted) return;
    setDone(null);
    const ok = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected' && !isAbort(result.reason)).length;
    const local = ok.some((result) => result.status === 'fulfilled' && result.value.local);
    if (!ok.length) { toast.error('这次没有生成成功，稍后再试，或到各个工具里单独生成。'); return; }
    toast.success(`学习包已生成：${ok.length} 项${failed ? `，${failed} 项没有成功` : ''}`, local ? { description: '当前没有可用模型，内容取自课程资料（本地演示）。' } : undefined);
  };

  return {
    can,
    running: done !== null,
    done: done ?? 0,
    total: PACK.length,
    sourceCount: sources.length,
    start: () => { if (can && done === null) void run(); },
    cancel: () => { abort.current?.abort(); setDone(null); },
  };
}
