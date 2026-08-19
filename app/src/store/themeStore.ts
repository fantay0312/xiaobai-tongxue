/**
 * 界面主题 —— 仅本机外观偏好,不进学习存档、不同步账号。
 * paper = 现行老学堂票据风;anime = 克制的日系现代动漫风。
 * 动漫主题可再分白天/黑夜;背景乐开关独立记忆。
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const UI_THEMES = ['paper', 'anime'] as const;
export type UiTheme = (typeof UI_THEMES)[number];

export const UI_TONES = ['day', 'night'] as const;
export type UiTone = (typeof UI_TONES)[number];

export const THEME_STORAGE_KEY = 'xiaobai-ui-theme-v1';

export function isUiTheme(value: unknown): value is UiTheme {
  return value === 'paper' || value === 'anime';
}

export function isUiTone(value: unknown): value is UiTone {
  return value === 'day' || value === 'night';
}

export function soundUrl(file: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}sounds/${file}`;
}

export function playUiSound(file: 'lightmode.mp3' | 'darkmode.mp3' | 'click_sfx.mp3', volume = 0.28) {
  if (typeof Audio === 'undefined') return;
  const audio = new Audio(soundUrl(file));
  audio.volume = volume;
  void audio.play().catch(() => {});
}

export function applyUiTheme(theme: UiTheme, tone: UiTone = 'day') {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  if (theme === 'anime') root.dataset.tone = tone;
  else delete root.dataset.tone;
}

interface StoredPrefs {
  theme?: unknown;
  tone?: unknown;
  musicOn?: unknown;
}

function readStoredPrefs(): { theme: UiTheme; tone: UiTone; musicOn: boolean } {
  const fallback = { theme: 'paper' as const, tone: 'day' as const, musicOn: false };
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { state?: StoredPrefs };
    const state = parsed.state ?? {};
    return {
      theme: isUiTheme(state.theme) ? state.theme : fallback.theme,
      tone: isUiTone(state.tone) ? state.tone : fallback.tone,
      musicOn: typeof state.musicOn === 'boolean' ? state.musicOn : fallback.musicOn,
    };
  } catch {
    return fallback;
  }
}

const initialPrefs = readStoredPrefs();

export const useThemeStore = create<{
  theme: UiTheme;
  tone: UiTone;
  musicOn: boolean;
  setTheme: (theme: UiTheme) => void;
  setTone: (tone: UiTone) => void;
  setMusicOn: (musicOn: boolean) => void;
}>()(
  persist(
    (set, get) => ({
      ...initialPrefs,
      setTheme: (theme) => {
        applyUiTheme(theme, get().tone);
        set({ theme });
      },
      setTone: (tone) => {
        const { theme } = get();
        applyUiTheme(theme, tone);
        if (theme === 'anime') {
          playUiSound(tone === 'night' ? 'darkmode.mp3' : 'lightmode.mp3', 0.22);
        }
        set({ tone });
      },
      setMusicOn: (musicOn) => {
        if (musicOn) playUiSound('click_sfx.mp3', 0.35);
        set({ musicOn });
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        theme: state.theme,
        tone: state.tone,
        musicOn: state.musicOn,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as StoredPrefs;
        return {
          ...current,
          theme: isUiTheme(stored.theme) ? stored.theme : current.theme,
          tone: isUiTone(stored.tone) ? stored.tone : current.tone,
          musicOn: typeof stored.musicOn === 'boolean' ? stored.musicOn : current.musicOn,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyUiTheme(state.theme, state.tone);
      },
    },
  ),
);

applyUiTheme(initialPrefs.theme, initialPrefs.tone);
