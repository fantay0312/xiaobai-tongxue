/**
 * three.js 场景内使用的颜色常量。
 * WebGL 材质无法读取 CSS 变量,故此处硬编码 tokens.css 对应令牌的 sRGB 近似值,
 * 全部由 oklch → sRGB 精确换算得出,注释标明来源令牌;禁止在此新造语义。
 * 2026-07-07 月白瓷青换色:纸/青/绿系随 tokens 重换算,墨/朱砂/黑板场景不变。
 */

/** ≈ var(--paper) oklch(0.972 0.008 225) —— 月白 */
export const PAPER = '#f0f7fa';
/** ≈ var(--paper-edge) oklch(0.91 0.02 220) —— 瓷边 */
export const PAPER_EDGE = '#d4e5eb';
/** 团子本体:比 --paper 再亮半档的冷白(oklch(0.985 0.005 225)),麻薯底色 */
export const BODY_WHITE = '#f7fbfd';

/** ≈ var(--ink) oklch(0.27 0.028 255) —— 眉眼嘴的墨色 */
export const INK = '#1d2734';
/** ≈ var(--ink-soft) oklch(0.44 0.024 250) —— 次级线条 */
export const INK_SOFT = '#495460';

/** ≈ var(--azure) oklch(0.42 0.095 255) —— 靛青(主动作色) */
export const AZURE = '#264e80';
/** ≈ var(--azure-deep) oklch(0.33 0.075 257) —— 学士帽靛青 */
export const AZURE_DEEP = '#1a355b';
/** --azure 同色相提亮的青,黑板场景 rim light 专用(黑板场景未换色,保持旧值) */
export const AZURE_RIM = '#64bdd2';

/** ≈ var(--cinnabar) oklch(0.55 0.165 32) —— 朱砂,仅腮红点缀 */
export const CINNABAR = '#bf412c';

/** ≈ var(--jade) oklch(0.56 0.10 165) —— 黛绿,嫩芽叶片 */
export const JADE = '#2c8766';
/** --jade 加深一档(oklch(0.45 0.09 165)),嫩芽茎部 */
export const JADE_DEEP = '#0d6549';

/** ≈ var(--amber) oklch(0.72 0.12 80) —— 藤黄,灯泡/流苏 */
export const AMBER = '#cc9c42';

/** ≈ var(--dust) oklch(0.72 0.01 225) —— 冷灰,灯泡金属底座 */
export const DUST = '#9ea6a9';

/** ≈ var(--board-deep) oklch(0.205 0.018 210) —— 黑板接触阴影色 */
export const BOARD_DEEP = '#0d191c';

/** ≈ var(--chalk) oklch(0.93 0.012 95) —— 粉笔白(星尘/气泡) */
export const CHALK = '#eae8df';
/** ≈ var(--chalk-amber) oklch(0.85 0.09 85) —— 暖粉笔黄,黑板顶光 */
export const CHALK_AMBER = '#e9ca89';
