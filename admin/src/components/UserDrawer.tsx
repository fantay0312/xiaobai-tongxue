import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Ban, CalendarPlus, RotateCcw } from 'lucide-react'
import { adminApi } from '../lib/api'
import { mutationKeyForDraft, type PendingMutation } from '../lib/idempotency'
import { can } from '../lib/permissions'
import { formatDate, formatInteger } from '../lib/format'
import { useAuthStore } from '../store/auth'
import type { AdminUser, SubscriptionPlan } from '../types/admin'
import { Drawer } from './Drawer'
import { Field, FormMessage, HighRiskReview, formStyles } from './forms'
import { Button, Notice, StatusBadge } from './ui'
import styles from '../styles/Page.module.css'

interface UserDrawerProps {
  user: AdminUser | null
  plans: SubscriptionPlan[]
  onClose: () => void
  onCommitted: () => Promise<void>
}

export function UserDrawer({ user, plans, onClose, onCommitted }: UserDrawerProps) {
  const pendingSubscription = useRef<PendingMutation | null>(null)
  const [statusReason, setStatusReason] = useState('')
  const [planId, setPlanId] = useState('')
  const [priceId, setPriceId] = useState('')
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [expiresAt, setExpiresAt] = useState('')
  const [subscriptionReason, setSubscriptionReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const session = useAuthStore((state) => state.session)

  useEffect(() => {
    setStatusReason('')
    setPlanId('')
    setPriceId('')
    setExpiresAt('')
    setSubscriptionReason('')
    setError('')
    setMessage('')
  }, [user?.id])

  const currentUser = user
  if (!currentUser) return null
  const userLabel = currentUser.email ?? currentUser.username
  const targetStatus = currentUser.status === 'banned' ? 'active' : 'banned'
  const statusSummary =
    targetStatus === 'banned'
      ? `封禁用户 ${userLabel}，停止其继续使用服务`
      : `解除 ${userLabel} 的封禁状态`

  async function changeStatus() {
    if (!currentUser) return
    if (!statusReason.trim()) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await adminApi.users.status(currentUser.id, {
        status: targetStatus,
        reason: statusReason.trim(),
        summary: statusSummary,
      })
      setMessage(targetStatus === 'banned' ? '用户已封禁。' : '用户已恢复。')
      setStatusReason('')
      await onCommitted()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '状态变更失败')
    } finally {
      setSaving(false)
    }
  }

  async function assignSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!currentUser) return
    if (!planId || !subscriptionReason.trim()) return
    const plan = plans.find((item) => item.id === planId)
    const fingerprint = JSON.stringify({
      userId: currentUser.id,
      planId,
      priceId,
      startsAt,
      expiresAt,
      reason: subscriptionReason.trim(),
    })
    pendingSubscription.current = mutationKeyForDraft(pendingSubscription.current, fingerprint)
    const idempotencyKey = pendingSubscription.current.key
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await adminApi.users.assignSubscription(currentUser.id, {
        planId,
        priceId: priceId || undefined,
        startsAt,
        expiresAt: expiresAt || undefined,
        reason: subscriptionReason.trim(),
        idempotencyKey,
        summary: `为 ${userLabel} 配置套餐「${plan?.name ?? planId}」`,
      })
      pendingSubscription.current = null
      setMessage('订阅已配置，账册正在刷新。')
      setSubscriptionReason('')
      await onCommitted()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '订阅配置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      title={user.displayName || '未命名用户'}
      subtitle={`${user.username} · ${user.id}`}
      onClose={onClose}
    >
      <section className={styles.drawerSection}>
        <h3>账户档案</h3>
        <dl className={styles.definition}>
          <dt>账户状态</dt>
          <dd><StatusBadge status={user.status} /></dd>
          <dt>积分余额</dt>
          <dd>{user.pointsBalance ? formatInteger(user.pointsBalance) : '前往积分总账查询'}</dd>
          <dt>当前订阅</dt>
          <dd>{user.subscription?.planName ?? '名册接口未附订阅；可在下方配置'}</dd>
          <dt>注册时间</dt>
          <dd>{formatDate(user.createdAt)}</dd>
          <dt>最近活动</dt>
          <dd>{formatDate(user.lastActiveAt)}</dd>
        </dl>
      </section>

      {can(session, 'users.restrict') ? (
        <section className={styles.drawerSection}>
          <h3>{targetStatus === 'banned' ? '封禁账户' : '解除封禁'}</h3>
          <div className={formStyles.form}>
            <Field label="操作理由" htmlFor="statusReason" required>
              <textarea
                className={formStyles.textarea}
                id="statusReason"
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
                placeholder="写明触发规则、证据或工单编号"
              />
            </Field>
            <HighRiskReview summary={statusSummary} reason={statusReason} />
            <Button
              variant={targetStatus === 'banned' ? 'danger' : 'secondary'}
              icon={targetStatus === 'banned' ? <Ban size={17} /> : <RotateCcw size={17} />}
              disabled={saving || !statusReason.trim()}
              onClick={changeStatus}
            >
              {targetStatus === 'banned' ? '确认封禁' : '确认恢复'}
            </Button>
          </div>
        </section>
      ) : null}

      {can(session, 'subscriptions.write') ? (
        <section className={styles.drawerSection}>
          <h3>配置订阅</h3>
          <form className={formStyles.form} onSubmit={assignSubscription}>
            <Notice>
              <span><strong>人工配置会进入审计。</strong> 已发布套餐的权益按其当前版本生效。</span>
            </Notice>
            <Field label="订阅套餐" htmlFor="userPlan" required>
              <select
                className={formStyles.select}
                id="userPlan"
                value={planId}
                onChange={(event) => {
                  setPlanId(event.target.value)
                  setPriceId('')
                }}
                required
              >
                <option value="">选择已发布套餐</option>
                {plans.filter((plan) => plan.status === 'active').map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name} · v{plan.versionNumber}</option>
                ))}
              </select>
            </Field>
            {planId ? (
              <Field label="价格周期" htmlFor="userPrice" required>
                <select
                  className={formStyles.select}
                  id="userPrice"
                  value={priceId}
                  onChange={(event) => setPriceId(event.target.value)}
                  required
                >
                  <option value="">选择价格周期</option>
                  {plans.find((plan) => plan.id === planId)?.prices.map((price) => (
                    <option key={price.id ?? `${price.billingPeriod}-${price.currency}`} value={price.id}>
                      {price.billingPeriod} · {price.currency} {price.amountMinor} · {price.durationDays ? `${price.durationDays} 天` : '无预设天数'}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <div className={formStyles.grid}>
              <Field label="开始日期" htmlFor="startsAt" required>
                <input
                  className={formStyles.input}
                  id="startsAt"
                  type="date"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  required
                />
              </Field>
              <Field label="到期日期" htmlFor="expiresAt" hint="留空时按套餐周期计算。">
                <input
                  className={formStyles.input}
                  id="expiresAt"
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </Field>
            </div>
            <Field label="配置理由" htmlFor="subscriptionReason" required>
              <textarea
                className={formStyles.textarea}
                id="subscriptionReason"
                value={subscriptionReason}
                onChange={(event) => setSubscriptionReason(event.target.value)}
              />
            </Field>
            <HighRiskReview
              summary={`为 ${userLabel} 配置「${plans.find((plan) => plan.id === planId)?.name ?? '待选套餐'}」`}
              reason={subscriptionReason}
            />
            <Button
              type="submit"
              icon={<CalendarPlus size={17} />}
              disabled={saving || !planId || !priceId || !subscriptionReason.trim()}
            >
              写入订阅
            </Button>
          </form>
        </section>
      ) : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {message ? <FormMessage kind="success">{message}</FormMessage> : null}
    </Drawer>
  )
}
