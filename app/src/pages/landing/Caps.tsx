import type { ComponentType, ReactNode } from 'react';
import s from './landing.module.css';

export interface Cap {
  /** lucide 图标或 components/ui/icons 的自绘图标，都接受 size */
  icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  text: ReactNode;
}

/**
 * 功能清单：每章末尾把这一章的能力列齐，一项一个短标题 + 一句话。
 * 桌面多栏、手机一栏；只是陈列，不可点。
 */
export function Caps({ items, label }: { items: readonly Cap[]; label: string }) {
  return (
    <ul className={s.caps} aria-label={label} data-reveal>
      {items.map(({ icon: Icon, title, text }) => (
        <li key={title}>
          <Icon size={20} strokeWidth={1.75} className={s.capIcon} />
          <strong>{title}</strong>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}
