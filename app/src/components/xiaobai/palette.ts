/**
 * three.js 场景内使用的颜色常量。
 * WebGL 材质无法读取 CSS 变量,故此处硬编码 tokens.css 对应令牌的 sRGB 近似值,
 * 全部由 oklch → sRGB 精确换算得出,注释标明来源令牌;禁止在此新造语义。
 */

/** ≈ var(--paper) oklch(0.972 0.011 92) —— 宣纸暖白 */
export const PAPER = '#f8f6ee';
/** ≈ var(--paper-edge) oklch(0.91 0.025 88) —— 纸边 */
export const PAPER_EDGE = '#e8e1cf';
/** 团子本体:比 --paper 再亮半档的暖白(oklch(0.985 0.008 95)),麻薯底色 */
export const BODY_WHITE = '#fcfaf4';

/** ≈ var(--ink) oklch(0.27 0.028 255) —— 眉眼嘴的墨色 */
export const INK = '#1d2734';
/** ≈ var(--ink-soft) oklch(0.44 0.024 250) —— 次级线条 */
export const INK_SOFT = '#495460';

/** ≈ var(--azure) oklch(0.42 0.075 235) —— 墨青(主动作色) */
export const AZURE = '#1a5370';
/** ≈ var(--azure-deep) oklch(0.33 0.06 240) —— 学士帽墨青 */
export const AZURE_DEEP = '#133951';
/** --azure 同色相提亮的青,黑板场景 rim light 专用(oklch(0.75 0.09 215)) */
export const AZURE_RIM = '#64bdd2';

/** ≈ var(--cinnabar) oklch(0.55 0.165 32) —— 朱砂,仅腮红点缀 */
export const CINNABAR = '#bf412c';

/** ≈ var(--jade) oklch(0.56 0.10 158) —— 黛绿,嫩芽叶片 */
export const JADE = '#38865e';
/** --jade 加深一档(oklch(0.45 0.09 158)),嫩芽茎部 */
export const JADE_DEEP = '#1d6442';

/** ≈ var(--amber) oklch(0.72 0.12 80) —— 藤黄,灯泡/流苏 */
export const AMBER = '#cc9c42';

/** ≈ var(--dust) oklch(0.72 0.012 90) —— 灰,灯泡金属底座 */
export const DUST = '#a7a49c';

/** ≈ var(--board-deep) oklch(0.205 0.018 210) —— 黑板接触阴影色 */
export const BOARD_DEEP = '#0d191c';

/** ≈ var(--chalk) oklch(0.93 0.012 95) —— 粉笔白(星尘/气泡) */
export const CHALK = '#eae8df';
/** ≈ var(--chalk-amber) oklch(0.85 0.09 85) —— 暖粉笔黄,黑板顶光 */
export const CHALK_AMBER = '#e9ca89';
