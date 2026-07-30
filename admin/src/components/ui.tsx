import type {
  ButtonHTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from 'react'
import { forwardRef } from 'react'
import { AlertTriangle, Inbox, LoaderCircle, RotateCw, ShieldX } from 'lucide-react'
import styles from '../styles/UI.module.css'
import stateStyles from '../styles/State.module.css'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'quiet'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: ReactNode
  iconOnly?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    icon,
    iconOnly = false,
    className = '',
    children,
    ...props
  },
  ref,
) {
  const variantClass = variant === 'primary' ? '' : styles[variant]
  return (
    <button
      ref={ref}
      className={`${styles.button} ${variantClass} ${iconOnly ? styles.iconOnly : ''} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
})

interface PageHeaderProps {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}

interface SectionProps extends PropsWithChildren {
  title: string
  meta?: string
  action?: ReactNode
  bodyClassName?: string
}

export function Section({ title, meta, action, children, bodyClassName = '' }: SectionProps) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {meta ? <span className={styles.sectionMeta}>{meta}</span> : null}
        </div>
        {action}
      </header>
      <div className={`${styles.sectionBody} ${bodyClassName}`}>{children}</div>
    </section>
  )
}

const statusTone: Record<string, string> = {
  active: stateStyles.positive,
  enabled: stateStyles.positive,
  published: stateStyles.positive,
  activated: stateStyles.positive,
  credit: stateStyles.positive,
  banned: stateStyles.negative,
  disabled: stateStyles.negative,
  expired: stateStyles.negative,
  deleted: stateStyles.negative,
  debit: stateStyles.negative,
  pending: stateStyles.warning,
  draft: stateStyles.warning,
  paused: stateStyles.warning,
  scheduled: stateStyles.warning,
  retired: stateStyles.neutral,
  archived: stateStyles.neutral,
  cancelled: stateStyles.neutral,
  revoked: stateStyles.neutral,
  suspended: stateStyles.negative,
  completed: stateStyles.neutral,
  trialing: stateStyles.warning,
  past_due: stateStyles.negative,
}

const statusLabel: Record<string, string> = {
  active: '正常',
  enabled: '已启用',
  published: '已发布',
  activated: '已激活',
  credit: '入账',
  banned: '已封禁',
  disabled: '已停用',
  expired: '已过期',
  deleted: '已删除',
  debit: '扣减',
  pending: '待处理',
  draft: '草稿',
  paused: '已暂停',
  scheduled: '已排期',
  retired: '已下架',
  archived: '已归档',
  cancelled: '已取消',
  revoked: '已撤销',
  suspended: '已停用',
  completed: '已完成',
  trialing: '试用中',
  past_due: '已逾期',
  exhausted: '已兑完',
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`${stateStyles.badge} ${statusTone[status] ?? stateStyles.neutral}`}>
      {label ?? statusLabel[status] ?? status}
    </span>
  )
}

export function TableWrap({ children, label }: PropsWithChildren<{ label: string }>) {
  return (
    <div className={styles.tableWrap} role="region" aria-label={label} tabIndex={0}>
      <table className={styles.table}>{children}</table>
    </div>
  )
}

interface FeedbackProps {
  kind: 'loading' | 'error' | 'empty' | 'denied'
  title?: string
  detail?: string
  onRetry?: () => void
}

export function Feedback({ kind, title, detail, onRetry }: FeedbackProps) {
  const icons = {
    loading: <LoaderCircle className={stateStyles.feedbackIcon} aria-hidden="true" />,
    error: <AlertTriangle className={stateStyles.feedbackIcon} aria-hidden="true" />,
    empty: <Inbox className={stateStyles.feedbackIcon} aria-hidden="true" />,
    denied: <ShieldX className={stateStyles.feedbackIcon} aria-hidden="true" />,
  }
  const titles = {
    loading: '正在核对账册',
    error: '数据读取失败',
    empty: '目前没有记录',
    denied: '当前账号无此权限',
  }
  return (
    <div className={stateStyles.feedback} aria-live="polite" aria-busy={kind === 'loading'}>
      <div className={stateStyles.feedbackInner}>
        {icons[kind]}
        <h3>{title ?? titles[kind]}</h3>
        {detail ? <p>{detail}</p> : null}
        {onRetry ? (
          <Button variant="secondary" icon={<RotateCw size={16} />} onClick={onRetry}>
            重新读取
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function Notice({ children }: PropsWithChildren) {
  return <div className={stateStyles.notice}>{children}</div>
}

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)))
  return (
    <nav className={stateStyles.pagination} aria-label="分页">
      <span className={styles.muted}>第 {page} / {pages} 页，共 {total} 条</span>
      <Button variant="secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </Button>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        下一页
      </Button>
    </nav>
  )
}

export { styles as uiStyles }
