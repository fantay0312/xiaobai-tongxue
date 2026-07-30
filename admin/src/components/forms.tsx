import type { PropsWithChildren, ReactNode } from 'react'
import { ShieldAlert } from 'lucide-react'
import styles from '../styles/Forms.module.css'

interface FieldProps extends PropsWithChildren {
  label: string
  htmlFor?: string
  required?: boolean
  hint?: string
  wide?: boolean
}

export function Field({ label, htmlFor, required, hint, wide, children }: FieldProps) {
  return (
    <div className={`${styles.field} ${wide ? styles.fieldWide : ''}`}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label} {required ? <span className={styles.required}>*</span> : null}
      </label>
      {children}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  )
}

interface ReviewProps {
  title?: string
  summary: ReactNode
  reason: string
  extra?: ReactNode
}

export function HighRiskReview({
  title = '提交前复核',
  summary,
  reason,
  extra,
}: ReviewProps) {
  return (
    <section className={styles.review} aria-label={title}>
      <h3 className={styles.reviewTitle}>
        <ShieldAlert size={19} aria-hidden="true" />
        {title}
      </h3>
      <dl>
        <dt>变更摘要</dt>
        <dd>{summary}</dd>
        <dt>操作理由</dt>
        <dd>{reason || '尚未填写'}</dd>
        {extra}
      </dl>
    </section>
  )
}

export function FormMessage({
  kind,
  children,
}: PropsWithChildren<{ kind: 'error' | 'success' }>) {
  return (
    <p className={kind === 'error' ? styles.formError : styles.formSuccess} role="status">
      {children}
    </p>
  )
}

export { styles as formStyles }
