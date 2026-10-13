/** 模型与思考强度偏好 —— 仅本机，按浏览器保存。目录由 lib/modelGateway.ts 的 loadModelCatalog 提供。 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const EFFORTS = ['none', 'low', 'medium', 'high', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const EFFORT_LABELS: Record<Effort, string> = { none: '极速', low: '轻度', medium: '均衡', high: '深入', max: '最高' };
export const EFFORT_HINTS: Record<Effort, string> = {
  none: '不思考，立即作答',
  low: '简单想一下再答',
  medium: '速度与深度兼顾',
  high: '多想几步，适合推导与难题',
  max: '尽可能深入，耗时最长',
};

const isEffort = (value: unknown): value is Effort => EFFORTS.includes(value as Effort);

export const useModelPrefs = create<{
  /** null = 使用目录默认模型 */
  model: string | null;
  effort: Effort;
  setModel: (model: string | null) => void;
  setEffort: (effort: Effort) => void;
  reset: () => void;
}>()(
  persist(
    (set) => ({
      model: null,
      effort: 'low',
      setModel: (model) => set({ model }),
      setEffort: (effort) => set({ effort }),
      reset: () => set({ model: null, effort: 'low' }),
    }),
    {
      name: 'xiaobai-model-prefs-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: ({ model, effort }) => ({ model, effort }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as { model?: unknown; effort?: unknown };
        return {
          ...current,
          model: typeof stored.model === 'string' && stored.model.length <= 120 ? stored.model : null,
          effort: isEffort(stored.effort) ? stored.effort : current.effort,
        };
      },
    },
  ),
);
