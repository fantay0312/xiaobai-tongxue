/**
 * 终端皮肤与个性化 —— 仅本机外观偏好，不进学习存档、不同步账号。
 * 皮肤预设见 styles/skins.css（html[data-skin]）；用户自定义项写到 <html> 内联变量。
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const SKINS = [
  { id: 'light', name: '素白', hint: '默认 · 干净的灰白工作台', dark: false, swatch: ['#ffffff', '#f7f7f8', '#3b72e6'] },
  { id: 'dark', name: '墨夜', hint: '深色 · 夜间长时间学习', dark: true, swatch: ['#17181b', '#111214', '#6f9dff'] },
  { id: 'paper', name: '暖纸', hint: '初版老学堂的纸色与赭陶', dark: false, swatch: ['#fbf8f1', '#f3eee2', '#a8502c'] },
  { id: 'sage', name: '青瓷', hint: '低饱和的青绿，护眼', dark: false, swatch: ['#fbfcfa', '#eff3ee', '#2f8562'] },
  { id: 'ocean', name: '晴蓝', hint: '清爽的浅蓝', dark: false, swatch: ['#fbfcfe', '#eef3fa', '#2a6fdb'] },
  { id: 'sakura', name: '樱粉', hint: '柔和的粉', dark: false, swatch: ['#fffbfb', '#fbeff1', '#cf4d77'] },
  { id: 'midnight', name: '深海', hint: '深蓝夜色', dark: true, swatch: ['#0f1626', '#0b111e', '#5eb0ff'] },
  { id: 'terminal', name: '终端', hint: '黑底绿字的等宽终端', dark: true, swatch: ['#0b0f0c', '#070a08', '#3ddc84'] },
] as const;
export type SkinId = (typeof SKINS)[number]['id'];

export type SkinRadius = 'sharp' | 'default' | 'round';
export type SkinDensity = 'compact' | 'comfortable';
export type SkinFont = 'system' | 'wenkai' | 'serif' | 'mono';
export type ChatStyle = 'document' | 'bubble';

export interface SkinPrefs {
  skin: SkinId;
  /** 自定义强调色（#rrggbb）；null 表示跟随皮肤 */
  accent: string | null;
  radius: SkinRadius;
  density: SkinDensity;
  font: SkinFont;
  /** 0.9 – 1.15 */
  fontScale: number;
  /** 终端背景图：data URL 或 https 地址；null 为无 */
  wallpaper: string | null;
  /** 壁纸上的面板遮罩强度 0.2 – 0.9（越大越不透） */
  wallpaperDim: number;
  chatStyle: ChatStyle;
  /** 是否显示常驻伙伴（小白 / 小砚） */
  companion: boolean;
}

export const DEFAULT_SKIN: SkinPrefs = {
  skin: 'light', accent: null, radius: 'default', density: 'comfortable', font: 'system',
  fontScale: 1, wallpaper: null, wallpaperDim: 0.82, chatStyle: 'document', companion: true,
};

export const SKIN_STORAGE_KEY = 'xiaobai-skin-v1';
const RADIUS_SCALE: Record<SkinRadius, number> = { sharp: 0.55, default: 1, round: 1.4 };
const DENSITY_SCALE: Record<SkinDensity, number> = { compact: 0.9, comfortable: 1 };
const FONT_STACK: Record<SkinFont, string | null> = {
  system: null,
  wenkai: "'LXGW WenKai Screen', 'Kaiti SC', 'STKaiti', -apple-system, 'PingFang SC', sans-serif",
  serif: "'Cormorant Garamond', 'Songti SC', 'STSong', 'Noto Serif SC', 'SimSun', serif",
  mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, 'PingFang SC', monospace",
};

const isSkin = (value: unknown): value is SkinId => SKINS.some((skin) => skin.id === value);
const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function sanitizeSkin(raw: unknown): SkinPrefs {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof SkinPrefs, unknown>>;
  return {
    skin: isSkin(value.skin) ? value.skin : DEFAULT_SKIN.skin,
    accent: isHex(value.accent) ? value.accent : null,
    radius: value.radius === 'sharp' || value.radius === 'round' ? value.radius : 'default',
    density: value.density === 'compact' ? 'compact' : 'comfortable',
    font: value.font === 'wenkai' || value.font === 'serif' || value.font === 'mono' ? value.font : 'system',
    fontScale: clamp(value.fontScale, 0.9, 1.15, 1),
    wallpaper: typeof value.wallpaper === 'string' && /^(data:image\/|https:\/\/)/.test(value.wallpaper) ? value.wallpaper : null,
    wallpaperDim: clamp(value.wallpaperDim, 0.2, 0.95, DEFAULT_SKIN.wallpaperDim),
    chatStyle: value.chatStyle === 'bubble' ? 'bubble' : 'document',
    companion: value.companion !== false,
  };
}

/** 把偏好写到 <html>：data-skin / data-wallpaper / data-chat + 内联变量。 */
export function applySkin(prefs: SkinPrefs) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.skin = prefs.skin;
  root.dataset.chat = prefs.chatStyle;
  // 旧主题系统（anime / tech）已退役，统一回到默认，避免与皮肤令牌打架
  root.dataset.theme = 'paper';
  delete root.dataset.tone;
  const style = root.style;
  if (prefs.accent) style.setProperty('--accent', prefs.accent); else style.removeProperty('--accent');
  style.setProperty('--radius-scale', String(RADIUS_SCALE[prefs.radius]));
  style.setProperty('--density', String(DENSITY_SCALE[prefs.density]));
  style.setProperty('--font-scale', String(prefs.fontScale));
  const font = FONT_STACK[prefs.font];
  if (font) style.setProperty('--ui-font', font); else style.removeProperty('--ui-font');
  if (prefs.wallpaper) {
    root.dataset.wallpaper = 'on';
    style.setProperty('--wallpaper', `url("${prefs.wallpaper.replace(/"/g, '%22')}")`);
    style.setProperty('--wallpaper-dim', String(prefs.wallpaperDim));
  } else {
    delete root.dataset.wallpaper;
    style.removeProperty('--wallpaper');
    style.removeProperty('--wallpaper-dim');
  }
}

function readStored(): SkinPrefs {
  if (typeof localStorage === 'undefined') return DEFAULT_SKIN;
  try {
    const raw = localStorage.getItem(SKIN_STORAGE_KEY);
    return raw ? sanitizeSkin((JSON.parse(raw) as { state?: unknown }).state) : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

const initial = readStored();

export const useSkinStore = create<SkinPrefs & {
  update: (patch: Partial<SkinPrefs>) => void;
  reset: () => void;
}>()(
  persist(
    (set, get) => ({
      ...initial,
      update: (patch) => {
        const next = sanitizeSkin({ ...get(), ...patch });
        applySkin(next);
        set(next);
      },
      reset: () => {
        applySkin(DEFAULT_SKIN);
        set(DEFAULT_SKIN);
      },
    }),
    {
      name: SKIN_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ update: _update, reset: _reset, ...prefs }) => prefs,
      merge: (persisted, current) => ({ ...current, ...sanitizeSkin(persisted) }),
      onRehydrateStorage: () => (state) => { if (state) applySkin(sanitizeSkin(state)); },
    },
  ),
);

applySkin(initial);
