/**
 * 小白同学 UI 基础件 —— 基于 Radix 无样式原语 + styles/skins.css 语义令牌。
 * 新界面一律从 components/ui 引用这些件，不再各页手写按钮与弹层。
 */
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import {
  Dialog as RDialog,
  DropdownMenu as RMenu,
  Popover as RPopover,
  Slot,
  Switch as RSwitch,
  Tabs as RTabs,
  Tooltip as RTooltip,
} from 'radix-ui';
import { Check, LoaderCircle, X } from 'lucide-react';
import { Toaster as SonnerToaster, toast } from 'sonner';
import s from './kit.module.css';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/* ── Button ── */
export type ButtonVariant = 'solid' | 'accent' | 'soft' | 'outline' | 'ghost' | 'danger';
export type ControlSize = 'sm' | 'md' | 'lg';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ControlSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  block?: boolean;
  pill?: boolean;
  /** 把样式套到唯一子元素上（如 <Link>） */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'soft', size = 'md', icon, iconRight, loading, block, pill, asChild, className, children, disabled, type, ...rest },
  ref,
) {
  const Comp: ElementType = asChild ? Slot.Root : 'button';
  return (
    <Comp
      ref={ref}
      className={cx(s.btn, s[variant], size !== 'md' && s[size], block && s.block, pill && s.pill, className)}
      {...(asChild ? {} : { type: type ?? 'button', disabled: disabled || loading })}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 13 : 15} /> : icon}
      <Slot.Slottable>{children}</Slot.Slottable>
      {iconRight}
    </Comp>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 无障碍名称，同时作为悬停提示 */
  label: string;
  variant?: 'ghost' | 'soft' | 'solid' | 'outline';
  size?: ControlSize;
  round?: boolean;
  active?: boolean;
  /** false 关闭提示；也可指定方向 */
  tip?: boolean | 'top' | 'bottom' | 'left' | 'right';
  shortcut?: string;
  asChild?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', round, active, tip = true, shortcut, asChild, className, children, type, ...rest },
  ref,
) {
  const Comp: ElementType = asChild ? Slot.Root : 'button';
  const node = (
    <Comp
      ref={ref}
      aria-label={label}
      data-active={active || undefined}
      className={cx(
        s.iconBtn,
        variant === 'soft' && s.iconSoft, variant === 'solid' && s.iconSolid, variant === 'outline' && s.iconOutline,
        size === 'sm' && s.iconSm, size === 'lg' && s.iconLg, round && s.round, className,
      )}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...rest}
    >
      {children}
    </Comp>
  );
  if (tip === false) return node;
  return <Tip label={label} side={tip === true ? 'top' : tip} shortcut={shortcut}>{node}</Tip>;
});

/* ── Tooltip ── */
export function TipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={380} skipDelayDuration={200}>{children}</RTooltip.Provider>;
}

export function Tip({ label, side = 'top', shortcut, children }: {
  label: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; shortcut?: string; children: ReactNode;
}) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className={s.tip} side={side} sideOffset={6} collisionPadding={8}>
          {label}{shortcut && <kbd>{shortcut}</kbd>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/* ── Popover ── */
export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export const PopoverAnchor = RPopover.Anchor;
export const PopoverClose = RPopover.Close;
export const PopoverContent = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<typeof RPopover.Content> & { size?: ControlSize; flush?: boolean }>(
  function PopoverContent({ className, size = 'md', flush, sideOffset = 8, collisionPadding = 12, ...rest }, ref) {
    return (
      <RPopover.Portal>
        <RPopover.Content
          ref={ref}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          className={cx(s.popover, size === 'sm' && s.popSm, size === 'lg' && s.popLg, flush && s.flush, className)}
          {...rest}
        />
      </RPopover.Portal>
    );
  },
);

/* ── Menu（下拉菜单） ── */
export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;
export const MenuGroup = RMenu.Group;
export function MenuContent({ className, sideOffset = 6, align = 'start', collisionPadding = 10, ...rest }: ComponentPropsWithoutRef<typeof RMenu.Content>) {
  return (
    <RMenu.Portal>
      <RMenu.Content className={cx(s.menu, className)} sideOffset={sideOffset} align={align} collisionPadding={collisionPadding} {...rest} />
    </RMenu.Portal>
  );
}
export function MenuItem({ icon, shortcut, hint, danger, checked, className, children, ...rest }: ComponentPropsWithoutRef<typeof RMenu.Item> & {
  icon?: ReactNode; shortcut?: string; hint?: ReactNode; danger?: boolean; checked?: boolean;
}) {
  return (
    <RMenu.Item className={cx(s.menuItem, danger && s.menuDanger, className)} {...rest}>
      {icon && <span className={s.menuIcon}>{icon}</span>}
      <span className={s.menuText}>{children}{hint && <small>{hint}</small>}</span>
      {shortcut && <kbd className={s.menuKbd}>{shortcut}</kbd>}
      {checked && <Check size={15} className={s.menuCheck} />}
    </RMenu.Item>
  );
}
export function MenuLabel({ className, ...rest }: ComponentPropsWithoutRef<typeof RMenu.Label>) {
  return <RMenu.Label className={cx(s.menuLabel, className)} {...rest} />;
}
export function MenuSeparator() {
  return <RMenu.Separator className={s.menuSep} />;
}

/* ── Dialog / Sheet ── */
export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  hideClose?: boolean;
  className?: string;
  children?: ReactNode;
}
const DIALOG_SIZE = { sm: s.dSm, md: s.dMd, lg: s.dLg, xl: s.dXl } as const;

export function Dialog({ open, onOpenChange, title, description, size = 'md', footer, hideClose, className, children }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className={s.overlay} />
        <RDialog.Content className={cx(s.dialog, DIALOG_SIZE[size], className)} {...(description ? {} : { 'aria-describedby': undefined })}>
          <header className={s.dialogHead}>
            <div>
              <RDialog.Title className={s.dialogTitle}>{title}</RDialog.Title>
              {description && <RDialog.Description className={s.dialogDesc}>{description}</RDialog.Description>}
            </div>
            {!hideClose && <RDialog.Close asChild><button type="button" className={s.dialogClose} aria-label="关闭"><X size={16} /></button></RDialog.Close>}
          </header>
          <div className={s.dialogBody}>{children}</div>
          {footer && <footer className={s.dialogFoot}>{footer}</footer>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Sheet({ open, onOpenChange, title, side = 'right', width = 420, children, className }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; side?: 'left' | 'right'; width?: number; children?: ReactNode; className?: string;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className={s.overlay} />
        <RDialog.Content className={cx(s.sheet, className)} data-side={side} style={{ '--w': `${width}px` } as CSSProperties} aria-describedby={undefined}>
          <header className={s.dialogHead}>
            <div><RDialog.Title className={s.dialogTitle}>{title}</RDialog.Title></div>
            <RDialog.Close asChild><button type="button" className={s.dialogClose} aria-label="关闭"><X size={16} /></button></RDialog.Close>
          </header>
          <div className={s.dialogBody}>{children}</div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* ── Tabs / Segmented ── */
export interface TabItem { value: string; label: ReactNode; icon?: ReactNode; count?: number; disabled?: boolean }
export function Tabs({ value, onValueChange, items, variant = 'underline', className, children, label }: {
  value: string; onValueChange: (value: string) => void; items: TabItem[]; variant?: 'underline' | 'pill'; className?: string; children?: ReactNode; label?: string;
}) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List aria-label={label} className={cx(s.tabs, variant === 'underline' ? s.tabsUnderline : s.tabsPill, className)}>
        {items.map((item) => (
          <RTabs.Trigger key={item.value} value={item.value} disabled={item.disabled} className={s.tab}>
            {item.icon}{item.label}{item.count !== undefined && <span className={s.tabCount}>{item.count}</span>}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {children}
    </RTabs.Root>
  );
}
export const TabPanel = RTabs.Content;

export interface SegmentOption<T extends string> { value: T; label: ReactNode; icon?: ReactNode; title?: string; disabled?: boolean }
export function Segmented<T extends string>({ value, onChange, options, size = 'md', label, block, className }: {
  value: T; onChange: (value: T) => void; options: SegmentOption<T>[]; size?: 'sm' | 'md'; label?: string; block?: boolean; className?: string;
}) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const enabled = options.filter((option) => !option.disabled);
    const next = enabled[(enabled.findIndex((option) => option.value === value) + step + enabled.length) % enabled.length];
    if (next) onChange(next.value);
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx(s.seg, size === 'sm' && s.segSm, block && s.segBlock, className)} onKeyDown={move}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          disabled={option.disabled}
          title={option.title}
          className={s.segItem}
          onClick={() => onChange(option.value)}
        >
          {option.icon}{option.label}
        </button>
      ))}
    </div>
  );
}

/* ── Switch ── */
export function Switch({ checked, onCheckedChange, label, disabled, id }: {
  checked: boolean; onCheckedChange: (checked: boolean) => void; label?: string; disabled?: boolean; id?: string;
}) {
  return (
    <RSwitch.Root id={id} className={s.switch} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label}>
      <RSwitch.Thumb className={s.switchThumb} />
    </RSwitch.Root>
  );
}

/* ── Field / Input / Textarea ── */
export function Field({ label, hint, error, htmlFor, action, children, className }: {
  label?: ReactNode; hint?: ReactNode; error?: ReactNode; htmlFor?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={cx(s.field, className)}>
      {label && <label className={s.fieldLabel} htmlFor={htmlFor}><span>{label}</span>{action}</label>}
      {children}
      {error ? <span className={s.fieldError} role="alert">{error}</span> : hint ? <span className={s.fieldHint}>{hint}</span> : null}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  invalid?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  size?: 'sm' | 'md';
  wrapClassName?: string;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, leading, trailing, size = 'md', wrapClassName, className, ...rest }, ref,
) {
  return (
    <span className={cx(s.inputWrap, size === 'sm' && s.inputSm, wrapClassName)} data-invalid={invalid || undefined}>
      {leading}
      <input ref={ref} className={className} aria-invalid={invalid || undefined} {...rest} />
      {trailing}
    </span>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(s.textarea, className)} {...rest} />;
});

/* ── 小件 ── */
export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'outline';
const BADGE_TONE: Record<Tone, string | undefined> = { neutral: undefined, accent: s.badgeAccent, ok: s.badgeOk, warn: s.badgeWarn, bad: s.badgeBad, outline: s.badgeOutline };
export function Badge({ tone = 'neutral', dot, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return <span className={cx(s.badge, BADGE_TONE[tone], className)} {...rest}>{dot && <i />}{children}</span>;
}
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>;
}
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cx(s.spinner, className)} aria-hidden="true" />;
}
export function Skeleton({ width = '100%', height = 14, radius, className }: { width?: number | string; height?: number | string; radius?: number | string; className?: string }) {
  return <span className={cx(s.skeleton, className)} style={{ width, height, ...(radius !== undefined ? { borderRadius: radius } : {}) }} aria-hidden="true" />;
}
/** 流光文字：用于「正在思考」「正在检索」一类进行中状态 */
export function Shimmer({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(s.shimmer, className)}>{children}</span>;
}
export function ThinkingDots({ label = '正在思考' }: { label?: string }) {
  return <span className={s.dots} role="status" aria-label={label}><i /><i /><i /></span>;
}
export function Empty({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx(s.empty, className)}>
      {icon && <span className={s.emptyIcon}>{icon}</span>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className={s.emptyAction}>{action}</div>}
    </div>
  );
}
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { padded?: boolean; interactive?: boolean }>(function Card(
  { padded = true, interactive, className, ...rest }, ref,
) {
  return <div ref={ref} className={cx(s.card, padded && s.cardPad, interactive && s.cardInteractive, className)} {...rest} />;
});
export function Progress({ value, max = 100, tone = 'accent', label, className }: { value: number; max?: number; tone?: 'accent' | 'ok' | 'warn'; label?: string; className?: string }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className={cx(s.progress, tone === 'ok' && s.progressOk, tone === 'warn' && s.progressWarn, className)} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}>
      <i style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
export function Divider({ className }: { className?: string }) {
  return <hr className={cx(s.divider, className)} />;
}

/* ── Toast ── */
export function Toaster() {
  return (
    <SonnerToaster
      position="top-center"
      offset={16}
      toastOptions={{
        classNames: { description: s.toastDesc },
        style: {
          background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-3)', borderRadius: 'var(--r-lg)', fontFamily: 'var(--ui-font)', fontSize: 'var(--fz-sm)',
        },
      }}
    />
  );
}
export { toast };
