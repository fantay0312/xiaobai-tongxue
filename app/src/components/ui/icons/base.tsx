/**
 * 自绘图标的公共底座。
 * 统一 24×24 画板、1.6 描边、圆头圆角，颜色全部取 currentColor，所以浅色深色皮肤都不用另配。
 * 一枚图标由三层组成：描线（主体）、墨点（小块实色，家族的识别点）、淡墨（只在选中态显出的一层浅填色）。
 */
import type { ComponentType, ReactNode } from 'react';
import s from './icons.module.css';

export interface XbIconProps {
  size?: number;
  /** 选中态：描线之外多一层淡墨 */
  active?: boolean;
  className?: string;
}

/**
 * 导航定义里的图标类型。多收一个 strokeWidth 只为兼容还按线性图标写法传参的地方，
 * 自绘图标的线宽是家族统一的，不会跟着变。
 */
export type XbIconType = ComponentType<XbIconProps & { strokeWidth?: number }>;

export function Svg({ size = 20, active, className, children }: XbIconProps & { children: ReactNode }) {
  return (
    <svg
      className={className ? `${s.icon} ${className}` : s.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-active={active ? '' : undefined}
    >
      {children}
    </svg>
  );
}

/** 墨点：不描边的小块实色 */
export const INK = { fill: 'currentColor', stroke: 'none' } as const;

/**
 * 淡墨层：平时不可见，选中态由样式表显出。
 * opacity 写在属性上，样式表没加载时它也不会变成一块实色。
 */
export function Wash({ d }: { d: string }) {
  return <path className={s.wash} d={d} fill="currentColor" stroke="none" opacity={0} />;
}

type Motion = 'tilt' | 'tiltBack' | 'lift' | 'sway' | 'nudge';

/** 悬停时轻轻动一下的部件；origin 用画板坐标，如 "9px 15px" */
export function Move({ kind, origin, children }: { kind: Motion; origin?: string; children: ReactNode }) {
  return <g className={s[kind]} style={origin ? { transformOrigin: origin } : undefined}>{children}</g>;
}

/** 选中态略加重的关键笔画 */
export const keyStroke = s.key;
