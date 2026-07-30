import { useEffect, useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { adminApi } from '../lib/api'
import type { ManagedSubscription } from '../types/admin'
import { Drawer } from './Drawer'
import { Field, FormMessage, HighRiskReview, formStyles } from './forms'
import { Button, Notice } from './ui'

interface SubscriptionEditorProps {
  subscription: ManagedSubscription | null
  onClose: () => void
  onSaved: () => Promise<void>
}

export function SubscriptionEditor({
  subscription,
  onClose,
  onSaved,
}: SubscriptionEditorProps) {
  const [status, setStatus] = useState<ManagedSubscription['status']>('active')
  const [endsAt, setEndsAt] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setStatus(subscription?.status ?? 'active')
    setEndsAt(subscription?.endsAt?.slice(0, 10) ?? '')
    setReason('')
    setError('')
  }, [subscription])

  if (!subscription) return null
  const summary = `将 ${subscription.username} 的「${subscription.planName}」订阅改为 ${status}`

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!subscription || !reason.trim()) return
    setSaving(true)
    setError('')
    try {
      await adminApi.subscriptions.update(subscription.id, {
        status,
        endsAt: endsAt || undefined,
        reason: reason.trim(),
      })
      await onSaved()
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '订阅状态更新失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer open title="管理用户订阅" subtitle={`${subscription.username} · ${subscription.planCode}`} onClose={onClose}>
      <Notice>
        <span><strong>状态更新不会删除订阅快照。</strong> 撤销或取消后，历史套餐版本仍可审计。</span>
      </Notice>
      <form className={formStyles.form} onSubmit={save}>
        <Field label="订阅状态" htmlFor="subscriptionStatus" required>
          <select className={formStyles.select} id="subscriptionStatus" value={status} onChange={(event) => setStatus(event.target.value as ManagedSubscription['status'])}>
            <option value="trialing">试用中</option>
            <option value="active">有效</option>
            <option value="past_due">逾期</option>
            <option value="cancelled">已取消</option>
            <option value="expired">已过期</option>
            <option value="revoked">已撤销</option>
          </select>
        </Field>
        <Field label="到期日期" htmlFor="subscriptionEnds" hint="留空时保持原到期日。">
          <input className={formStyles.input} id="subscriptionEnds" type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </Field>
        <Field label="变更理由" htmlFor="subscriptionReason" required>
          <textarea className={formStyles.textarea} id="subscriptionReason" value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <HighRiskReview summary={summary} reason={reason} />
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Button type="submit" icon={<Save size={17} />} disabled={saving || !reason.trim()}>保存订阅状态</Button>
      </form>
    </Drawer>
  )
}
