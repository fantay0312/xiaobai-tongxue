import type { ModelKey } from "./models";

/** Highlighter colours. */
export type Marker = "yellow" | "green" | "blue" | "pink";
export const MARKERS: { key: Marker; label: string; color: string }[] = [
  { key: "yellow", label: "黄色", color: "#f2c438" },
  { key: "green", label: "绿色", color: "#7cc66f" },
  { key: "blue", label: "蓝色", color: "#6aa8f0" },
  { key: "pink", label: "粉色", color: "#f084ac" },
];

/** Reading faces. Literata and Atkinson load only when picked. */
export const FACES: { key: Settings["face"]; label: string; css: string }[] = [
  { key: "serif", label: "衬线", css: "var(--font-serif)" },
  { key: "book", label: "书卷", css: "var(--font-book)" },
  { key: "sans", label: "无衬线", css: "var(--font-sans)" },
  { key: "legible", label: "易读", css: "var(--font-legible)" },
];

/** Everything a reader can tune. Applied to <html> as data attributes and CSS variables. */
export type Settings = {
  theme: "auto" | "paper" | "sepia" | "snow" | "night" | "ink";
  pen: "vermilion" | "cobalt" | "moss" | "graphite";
  face: "serif" | "book" | "sans" | "legible";
  size: number;
  leading: "tight" | "normal" | "loose";
  width: "narrow" | "normal" | "wide";
  align: "left" | "justify";
  paras: "spaced" | "indented";
  marker: Marker;
  length: "short" | "normal" | "long";
  model: ModelKey;
  /**
   * Let answers look things up on the web: the model gets a search tool and decides when to use it.
   * On by default. (It replaced "web", an opt-in toggle, so older saved settings start on.)
   */
  search: boolean;
  numbers: boolean;
  rail: boolean;
  /** Read aloud. Off by default: when on, a listen button joins the reader's top bar. */
  listen: boolean;
  /** Pinned: opening a text opens its notebook too. */
  notebook: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "auto",
  pen: "vermilion",
  face: "serif",
  size: 20,
  leading: "normal",
  width: "normal",
  align: "left",
  paras: "spaced",
  marker: "yellow",
  length: "normal",
  model: "flash",
  search: true,
  numbers: false,
  rail: true,
  listen: false,
  notebook: true,
};

/** Swatch colours for the settings panel. The real palettes live in globals.css. */
export const THEMES: { key: Settings["theme"]; label: string; bg: string; fg: string; dark: boolean }[] = [
  { key: "auto", label: "自动", bg: "#f6f3ec", fg: "#1d1b18", dark: false },
  { key: "paper", label: "纸白", bg: "#f6f3ec", fg: "#1d1b18", dark: false },
  { key: "sepia", label: "旧纸", bg: "#f1e6cf", fg: "#33281b", dark: false },
  { key: "snow", label: "雪白", bg: "#ffffff", fg: "#141518", dark: false },
  { key: "night", label: "夜读", bg: "#151412", fg: "#e9e3d6", dark: true },
  { key: "ink", label: "墨蓝", bg: "#0f1319", fg: "#e3e8f0", dark: true },
];

export const PENS: { key: Settings["pen"]; label: string; light: string; dark: string }[] = [
  { key: "vermilion", label: "朱红", light: "#c1401b", dark: "#ef7a50" },
  { key: "cobalt", label: "钴蓝", light: "#2c58c9", dark: "#86a8ff" },
  { key: "moss", label: "苔绿", light: "#3b7a3d", dark: "#8fc68c" },
  { key: "graphite", label: "石墨", light: "#4b4a47", dark: "#cfc9bd" },
];

export const LEADING: Record<Settings["leading"], number> = { tight: 1.5, normal: 1.64, loose: 1.82 };
export const MEASURE: Record<Settings["width"], number> = { narrow: 28, normal: 32, wide: 37 };
export const LENGTH_WORDS: Record<Settings["length"], number> = { short: 50, normal: 90, long: 180 };

export const SETTINGS_KEY = "gloss:settings";

export function resolveTheme(theme: Settings["theme"]): Exclude<Settings["theme"], "auto"> {
  if (theme !== "auto") return theme;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "paper";
}

export function applySettings(s: Settings) {
  const el = document.documentElement;
  el.dataset.theme = resolveTheme(s.theme);
  el.dataset.pen = s.pen;
  el.dataset.face = s.face;
  el.dataset.align = s.align;
  el.dataset.paras = s.paras;
  el.style.setProperty("--read-size", `${s.size}px`);
  el.style.setProperty("--leading", String(LEADING[s.leading]));
  el.style.setProperty("--measure-k", String(MEASURE[s.width]));
}

/**
 * The same thing as applySettings, as an inline script for <head>, so the
 * first paint already has the reader's theme, pen and type. Kept in sync by hand.
 */
export const BOOT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem("${SETTINGS_KEY}")||"{}"),e=document.documentElement,t=s.theme||"auto";if(t==="auto")t=matchMedia("(prefers-color-scheme: dark)").matches?"night":"paper";e.dataset.theme=t;e.dataset.pen=s.pen||"vermilion";e.dataset.face=s.face||"serif";e.dataset.align=s.align||"left";e.dataset.paras=s.paras||"spaced";if(s.size)e.style.setProperty("--read-size",s.size+"px");var L={tight:1.5,normal:1.64,loose:1.82},M={narrow:28,normal:32,wide:37};if(s.leading)e.style.setProperty("--leading",L[s.leading]);if(s.width)e.style.setProperty("--measure-k",M[s.width])}catch(x){}`;
