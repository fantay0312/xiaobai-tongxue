/**
 * 环形铅字盘 —— 票据风的旋转邮戳:一圈打字机小字沿圆周慢转。
 * 用法:<RoundStamp text="小白同学 · 教然后知困 · 学伴书斋 · " size={96} dur={60} />
 * 文案末尾自带间隔符号(· 或 •)才能首尾相接。
 * 颜色随 currentColor;装饰性元素,默认 aria-hidden。
 * 旋转关键帧 global(spinslow) 唯一定义在 index.css,reduced-motion 全局兜底压停。
 */
import { useId, type CSSProperties } from 'react';
import styles from './RoundStamp.module.css';

export function RoundStamp({
  text,
  size = 96,
  dur = 60,
  className,
}: {
  text: string;
  size?: number;
  dur?: number;
  className?: string;
}) {
  const pathId = useId();
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className ? `${styles.spin} ${className}` : styles.spin}
      style={{ '--stamp-dur': `${dur}s` } as CSSProperties}
      aria-hidden="true"
      focusable="false"
    >
      <path
        id={pathId}
        d="M 50, 50 m -40, 0 a 40,40 0 1,1 80,0 a 40,40 0 1,1 -80,0"
        fill="none"
      />
      <text className={styles.ring}>
        <textPath href={`#${pathId}`}>{text}</textPath>
      </text>
    </svg>
  );
}
