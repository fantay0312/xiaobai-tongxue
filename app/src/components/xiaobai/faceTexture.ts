/**
 * 用 Canvas 2D 动态绘制小白的脸(眉眼嘴),生成 CanvasTexture 贴在团子正面。
 * 表情语义对照占位实现:
 *   idle '· ᴗ ·' | curious '◕ ᴗ ◕' | confused '@ _ @' | thinking '– ᴗ –'
 *   aha '✧ ▽ ✧' | happy '≧ ▽ ≦' | proud '¯ ▽ ¯' | shy '> _ <'
 * mood 切换时由调用方对两个 mood 各画一遍并按 alpha 交叉淡入(crossfade)。
 * 2026-07-12 形象润色:睁眼表情(idle/curious)支持 blink 闭睑变体(场景层排期),
 * 圆点眼加高光,多数表情带常驻淡腮红 —— 只动脸部纹理,Props 契约不变。
 */
import type { XiaobaiMood } from '../../types';
import { AZURE, CINNABAR, INK } from './palette';

export const FACE_CANVAS_SIZE = 256;

/* 归一化布局:画布 256px,眼睛中心 y≈0.42,嘴 y≈0.62,左右眼距中心 ±0.21 */
const EYE_Y = 0.42;
const EYE_DX = 0.21;
const MOUTH_Y = 0.63;

type Ctx = CanvasRenderingContext2D;

function stroke(ctx: Ctx, w: number) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** 圆点眼 '·'(带一粒偏左上的高光,墨点才有"湿润"神采) */
function dotEye(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.34, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; // 眼内高光,非界面色
  ctx.fill();
}

/** 闭睑 '⌣':下弯小弧,眨眼瞬间用(比直线多一点软) */
function lidEye(ctx: Ctx, x: number, y: number, r: number, w: number) {
  ctx.beginPath();
  ctx.arc(x, y - r * 0.35, r, Math.PI * 0.2, Math.PI * 0.8);
  stroke(ctx, w);
}

/** 大圆眼 '◕':实心圆 + 高光(dotEye 自带高光,这里独立画底避免叠两粒) */
function roundEye(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.32, y - r * 0.35, r * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; // 眼内高光,非界面色
  ctx.fill();
}

/** 蚊香眼 '@':阿基米德螺线 */
function spiralEye(ctx: Ctx, x: number, y: number, r: number, w: number) {
  ctx.beginPath();
  const turns = 2.4;
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = t * turns * Math.PI * 2;
    const rad = r * t;
    const px = x + Math.cos(ang) * rad;
    const py = y + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  stroke(ctx, w);
}

/** 闭眼横线 '–' */
function lineEye(ctx: Ctx, x: number, y: number, half: number, w: number) {
  ctx.beginPath();
  ctx.moveTo(x - half, y);
  ctx.lineTo(x + half, y);
  stroke(ctx, w);
}

/** 星星眼 '✧':四角星 */
function starEye(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  const inner = r * 0.38;
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? r : inner;
    const px = x + Math.cos(ang) * rad;
    const py = y + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
}

/** 眯眯笑眼 '≧':上拱弧 */
function archEye(ctx: Ctx, x: number, y: number, r: number, w: number) {
  ctx.beginPath();
  ctx.arc(x, y + r * 0.55, r, Math.PI * 1.15, Math.PI * 1.85);
  stroke(ctx, w);
}

/** 紧闭眼 '>' '<':两道折线,open 指向内侧 */
function squeezeEye(ctx: Ctx, x: number, y: number, r: number, w: number, dir: 1 | -1) {
  ctx.beginPath();
  ctx.moveTo(x - r * dir, y - r * 0.8);
  ctx.lineTo(x + r * dir * 0.7, y);
  ctx.lineTo(x - r * dir, y + r * 0.8);
  stroke(ctx, w);
}

/** ᴗ 小笑嘴(下弧) */
function smileMouth(ctx: Ctx, x: number, y: number, r: number, w: number) {
  ctx.beginPath();
  ctx.arc(x, y - r * 0.35, r, Math.PI * 0.2, Math.PI * 0.8);
  stroke(ctx, w);
}

/** ▽ 张嘴(圆角三角) */
function openMouth(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r * 0.6);
  ctx.quadraticCurveTo(x, y - r * 0.75, x + r, y - r * 0.6);
  ctx.quadraticCurveTo(x + r * 0.35, y + r * 0.9, x, y + r);
  ctx.quadraticCurveTo(x - r * 0.35, y + r * 0.9, x - r, y - r * 0.6);
  ctx.closePath();
  ctx.fillStyle = INK;
  ctx.fill();
}

/** '_' 扁嘴 */
function flatMouth(ctx: Ctx, x: number, y: number, half: number, w: number) {
  ctx.beginPath();
  ctx.moveTo(x - half, y);
  ctx.lineTo(x + half, y);
  stroke(ctx, w);
}

/** 波浪嘴(confused 专用) */
function wavyMouth(ctx: Ctx, x: number, y: number, half: number, w: number) {
  ctx.beginPath();
  ctx.moveTo(x - half, y);
  ctx.quadraticCurveTo(x - half * 0.5, y - half * 0.5, x, y);
  ctx.quadraticCurveTo(x + half * 0.5, y + half * 0.5, x + half, y);
  stroke(ctx, w);
}

/** 腮红(cinnabar 低透明,唯一允许的朱砂点缀) */
function blush(ctx: Ctx, s: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = CINNABAR;
  for (const dx of [-0.3, 0.3]) {
    ctx.beginPath();
    ctx.ellipse(s * (0.5 + dx), s * 0.57, s * 0.06, s * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 汗滴(confused,azure 系) */
function sweatDrop(ctx: Ctx, s: number) {
  ctx.save();
  ctx.globalAlpha *= 0.6;
  ctx.fillStyle = AZURE;
  const x = s * 0.82, y = s * 0.3;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.05);
  ctx.quadraticCurveTo(x + s * 0.045, y + s * 0.03, x, y + s * 0.05);
  ctx.quadraticCurveTo(x - s * 0.045, y + s * 0.03, x, y - s * 0.05);
  ctx.fill();
  ctx.restore();
}

/** 眉毛:angle>0 内高外低(担忧),<0 挑眉 */
function brow(ctx: Ctx, x: number, y: number, half: number, angle: number, w: number) {
  ctx.beginPath();
  ctx.moveTo(x - half, y + Math.sin(angle) * half);
  ctx.quadraticCurveTo(x, y - half * 0.35, x + half, y - Math.sin(angle) * half);
  stroke(ctx, w);
}

/** 睁眼待机表情:场景层只对这些 mood 排眨眼(星星眼/蚊香眼眨起来只会诡异) */
export const BLINK_MOODS: ReadonlySet<XiaobaiMood> = new Set(['idle', 'curious']);

/**
 * 把指定 mood 的表情画到 ctx 上(不清屏,由调用方控制 globalAlpha 实现 crossfade)。
 * blink=true 时把睁眼换成闭睑弧(仅 BLINK_MOODS 生效),眉/嘴/腮红照常。
 */
export function drawFace(
  ctx: Ctx,
  mood: XiaobaiMood,
  s: number = FACE_CANVAS_SIZE,
  blink = false,
) {
  const cx = s * 0.5;
  const lx = s * (0.5 - EYE_DX);
  const rx = s * (0.5 + EYE_DX);
  const ey = s * EYE_Y;
  const my = s * MOUTH_Y;
  const w = s * 0.03;
  const shut = blink && BLINK_MOODS.has(mood);

  switch (mood) {
    case 'idle': // · ᴗ ·
      if (shut) {
        lidEye(ctx, lx, ey, s * 0.042, w);
        lidEye(ctx, rx, ey, s * 0.042, w);
      } else {
        dotEye(ctx, lx, ey, s * 0.034);
        dotEye(ctx, rx, ey, s * 0.034);
      }
      smileMouth(ctx, cx, my, s * 0.055, w);
      blush(ctx, s, 0.16);
      break;
    case 'curious': // ◕ ᴗ ◕
      if (shut) {
        lidEye(ctx, lx, ey, s * 0.052, w);
        lidEye(ctx, rx, ey, s * 0.052, w);
      } else {
        roundEye(ctx, lx, ey, s * 0.056);
        roundEye(ctx, rx, ey, s * 0.056);
      }
      brow(ctx, lx, ey - s * 0.115, s * 0.05, -0.5, w * 0.85);
      brow(ctx, rx, ey - s * 0.115, s * 0.05, -0.5, w * 0.85);
      smileMouth(ctx, cx, my, s * 0.06, w);
      blush(ctx, s, 0.18);
      break;
    case 'confused': // @ _ @
      spiralEye(ctx, lx, ey, s * 0.052, w * 0.8);
      spiralEye(ctx, rx, ey, s * 0.052, w * 0.8);
      wavyMouth(ctx, cx, my, s * 0.07, w);
      sweatDrop(ctx, s);
      break;
    case 'thinking': // – ᴗ –
      lineEye(ctx, lx, ey, s * 0.05, w);
      lineEye(ctx, rx, ey, s * 0.05, w);
      smileMouth(ctx, cx, my, s * 0.04, w * 0.9);
      blush(ctx, s, 0.12);
      break;
    case 'aha': // ✧ ▽ ✧
      starEye(ctx, lx, ey, s * 0.062);
      starEye(ctx, rx, ey, s * 0.062);
      brow(ctx, lx, ey - s * 0.125, s * 0.05, -0.6, w * 0.85);
      brow(ctx, rx, ey - s * 0.125, s * 0.05, -0.6, w * 0.85);
      openMouth(ctx, cx, my, s * 0.05);
      blush(ctx, s, 0.28);
      break;
    case 'happy': // ≧ ▽ ≦
      archEye(ctx, lx, ey, s * 0.06, w);
      archEye(ctx, rx, ey, s * 0.06, w);
      openMouth(ctx, cx, my, s * 0.055);
      blush(ctx, s, 0.35);
      break;
    case 'proud': // ¯ ▽ ¯
      lineEye(ctx, lx, ey - s * 0.015, s * 0.05, w);
      lineEye(ctx, rx, ey - s * 0.015, s * 0.05, w);
      openMouth(ctx, cx, my, 0.045 * s);
      blush(ctx, s, 0.2);
      break;
    case 'shy': // > _ < (左眼尖朝内即朝右,右眼朝左)
      squeezeEye(ctx, lx, ey, s * 0.045, w, 1);
      squeezeEye(ctx, rx, ey, s * 0.045, w, -1);
      flatMouth(ctx, cx, my, s * 0.045, w);
      blush(ctx, s, 0.5);
      break;
  }
}
