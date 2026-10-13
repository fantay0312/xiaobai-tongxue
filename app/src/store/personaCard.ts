/**
 * 小白的角色卡 —— 用文字自定义他的性格和说话方式，像写一张角色设定。
 * 只决定「怎么说话」，不改变课堂纪律（只问不教、不说没学过的词）。按账号保存在当前浏览器。
 * 说话的活泼程度仍用 appStore.settings.temperature（0–1）这一个数。
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const PERSONA_CARD_MAX = 600;

export interface PersonaCard {
  /** preset=用内置三型（好奇型 / 严谨型 / 杠精型）；custom=用下面这张角色卡 */
  mode: 'preset' | 'custom';
  /** 角色卡正文：性格、说话方式、口头禅、兴趣、对老师的态度……自由文字 */
  text: string;
  /** 他怎么称呼你，如 先生 / 老师 / 师父；空则用默认 */
  addressTeacherAs: string;
}

export const DEFAULT_PERSONA_CARD: PersonaCard = { mode: 'preset', text: '', addressTeacherAs: '' };

/** 起稿用的几张示例卡，用户可以点一下填入再改 */
export const PERSONA_CARD_TEMPLATES: { name: string; text: string }[] = [
  { name: '好奇宝宝', text: '十二三岁的样子，对什么都好奇，听到新词眼睛会亮。说话短、快，喜欢打破砂锅问到底，常拿身边的事打比方。听懂了会很开心地复述一遍，没听懂就直接说「等等，我没跟上」。' },
  { name: '慢热书呆', text: '话不多，想清楚了才开口。说话慢条斯理，爱用「我想确认一下」开头。不轻易说懂了，会把老师的话拆成一步一步核对。偶尔冒出一句冷幽默。' },
  { name: '抬杠小能手', text: '嘴硬心软，听到结论先找反例，口头禅是「那要是……呢」。被讲服了会不太情愿地承认「行吧，这回算你对」。不阴阳怪气，只是较真。' },
  { name: '活泼话痨', text: '元气很足，想到哪说到哪，喜欢用拟声词和夸张的比喻。会把知识点编成小故事。兴奋的时候句子会变短、连着问两个问题。' },
  { name: '江湖少年', text: '半文半白的口气，称老师为「先生」，把学习说成练功、过招。听懂一处说「这一招我接住了」，没懂说「这一式我还看不破」。讲义气，记得上回的课。' },
];

const ownerKey = (owner: string | null) => owner ?? 'local';

function sanitize(raw: unknown): PersonaCard {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PersonaCard, unknown>>;
  const text = typeof value.text === 'string' ? value.text.slice(0, PERSONA_CARD_MAX) : '';
  return {
    mode: value.mode === 'custom' && text.trim() ? 'custom' : 'preset',
    text,
    addressTeacherAs: typeof value.addressTeacherAs === 'string' ? value.addressTeacherAs.trim().slice(0, 6) : '',
  };
}

const useStore = create<{ byOwner: Record<string, PersonaCard> }>()(
  persist(() => ({ byOwner: {} as Record<string, PersonaCard> }), {
    name: 'xiaobai-persona-card-v1',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    merge: (persisted, current) => {
      const stored = (persisted ?? {}) as { byOwner?: Record<string, unknown> };
      return { ...current, byOwner: Object.fromEntries(Object.entries(stored.byOwner ?? {}).map(([key, value]) => [key, sanitize(value)])) };
    },
  }),
);

/** 非 Hook 读写：引擎在开课时读，设置界面保存时写 */
export const personaCard = {
  get: (owner: string | null): PersonaCard => useStore.getState().byOwner[ownerKey(owner)] ?? DEFAULT_PERSONA_CARD,
  save: (owner: string | null, patch: Partial<PersonaCard>): PersonaCard => {
    const key = ownerKey(owner);
    const next = sanitize({ ...(useStore.getState().byOwner[key] ?? DEFAULT_PERSONA_CARD), ...patch });
    useStore.setState((state) => ({ byOwner: { ...state.byOwner, [key]: next } }));
    return next;
  },
};

export function usePersonaCard(owner: string | null): PersonaCard {
  return useStore((state) => state.byOwner[ownerKey(owner)] ?? DEFAULT_PERSONA_CARD);
}
