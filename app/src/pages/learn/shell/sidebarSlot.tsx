/**
 * 板块侧栏：图标栏选中哪个板块，终端侧栏就整块换成那个板块自己的导航。
 * 外壳在侧栏里留一个挂载位；各板块用 <SidebarPortal> 把导航渲染进去，状态仍留在板块自己手里。
 * 侧栏收起、或手机上没有常驻侧栏时没有挂载位，这时渲染 fallback（板块自己在主区放一份简版导航）。
 */
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import s from './sideNav.module.css';

const SidebarSlotContext = createContext<HTMLElement | null>(null);
export const SidebarSlotProvider = SidebarSlotContext.Provider;
/** 当前是否有侧栏挂载位；为 null 时板块应在主区自带导航 */
export const useSidebarSlot = () => useContext(SidebarSlotContext);

export function SidebarPortal({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const slot = useSidebarSlot();
  return slot ? createPortal(children, slot) : <>{fallback}</>;
}

/** 板块侧栏的外框：标题、可选的主动作（如「新建任务」）、滚动区、可选页脚说明 */
export function SidePanel({ title, hint, action, footer, children }: {
  title: string; hint?: ReactNode; action?: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  return (
    <div className={s.panel}>
      <header className={s.panelHead}><h2>{title}</h2>{hint && <p>{hint}</p>}</header>
      {action}
      <div className={s.panelScroll}>{children}</div>
      {footer && <footer className={s.panelFoot}>{footer}</footer>}
    </div>
  );
}

/** 侧栏顶部的主动作按钮，样式同「新建对话」 */
export function SideAction({ icon, children, onClick, disabled }: { icon?: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className={s.action} onClick={onClick} disabled={disabled}>{icon}<span>{children}</span></button>;
}

/** 行与分组的状态色：图标、小字和分组圆点跟着变；muted 让整行退后一档 */
export type SideTone = 'accent' | 'ok' | 'warn' | 'bad' | 'muted';

export function SideGroup({ label, hint, tone, action, children }: {
  label?: string;
  /** 标题右侧的一句灰字，说明这一组该怎么处理 */
  hint?: string;
  tone?: SideTone;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={s.group} data-tone={tone}>
      {label && (
        <h3 className={s.groupHead}>
          <span>{label}</span>
          {hint && <small className={s.groupHint}>{hint}</small>}
          {action}
        </h3>
      )}
      {children}
    </section>
  );
}

/** 行尾的小进度条，配合 SideNavItem 的 meta 使用 */
export function SideMeter({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span className={s.meter} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped}>
      <i style={{ width: `${clamped}%` }} />
    </span>
  );
}

export function SideNavItem({ icon, label, sub, meta, active, indent, trailing, title, disabled, tone, onClick }: {
  icon?: ReactNode;
  label: ReactNode;
  /** 第二行小字，如时间、状态 */
  sub?: ReactNode;
  /** 右侧小数字或状态 */
  meta?: ReactNode;
  active?: boolean;
  indent?: 1 | 2;
  /** 悬停时出现的操作，如菜单触发器 */
  trailing?: ReactNode;
  title?: string;
  disabled?: boolean;
  tone?: SideTone;
  onClick: () => void;
}) {
  return (
    <div className={s.row} data-active={active || undefined} data-tone={tone}>
      <button
        type="button"
        className={s.item}
        aria-current={active ? 'page' : undefined}
        data-indent={indent}
        data-two-line={sub ? '' : undefined}
        title={title}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
        <span className={s.label}>{sub ? <><span>{label}</span><span className={s.sub}>{sub}</span></> : label}</span>
        {meta !== undefined && meta !== null && <span className={s.meta}>{meta}</span>}
      </button>
      {trailing && <span className={s.trailing}>{trailing}</span>}
    </div>
  );
}

export function SideEmpty({ children }: { children: ReactNode }) {
  return <p className={s.empty}>{children}</p>;
}
