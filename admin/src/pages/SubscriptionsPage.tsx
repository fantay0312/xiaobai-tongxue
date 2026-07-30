import { useCallback, useState } from 'react'
import { Plus, PencilLine } from 'lucide-react'
import { adminApi } from '../lib/api'
import { can } from '../lib/permissions'
import { formatDate, formatMoney } from '../lib/format'
import { useResource } from '../lib/useResource'
import { useAuthStore } from '../store/auth'
import type { ManagedSubscription, SubscriptionPlan } from '../types/admin'
import { PlanEditor } from '../components/PlanEditor'
import { SubscriptionEditor } from '../components/SubscriptionEditor'
import {
  Button,
  Feedback,
  PageHeader,
  Section,
  StatusBadge,
  TableWrap,
  uiStyles,
} from '../components/ui'
import pageStyles from '../styles/Page.module.css'

export default function SubscriptionsPage() {
  const [editorOpen, setEditorOpen] = useState(false)
  const [selected, setSelected] = useState<SubscriptionPlan | null>(null)
  const [selectedSubscription, setSelectedSubscription] = useState<ManagedSubscription | null>(null)
  const session = useAuthStore((state) => state.session)
  const planReadable = can(session, 'plans.read')
  const subscriptionReadable = can(session, 'subscriptions.read')
  const loadPlans = useCallback(
    () => planReadable
      ? adminApi.plans.list()
      : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
    [planReadable],
  )
  const plans = useResource(loadPlans, [loadPlans])
  const loadEntitlements = useCallback(
    () => can(session, 'entitlements.read')
      ? adminApi.entitlements.list()
      : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
    [session],
  )
  const entitlements = useResource(loadEntitlements, [loadEntitlements])
  const loadSubscriptions = useCallback(
    () => subscriptionReadable
      ? adminApi.subscriptions.list({ page: 1, pageSize: 50 })
      : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 50 }),
    [subscriptionReadable],
  )
  const subscriptions = useResource(loadSubscriptions, [loadSubscriptions])

  function openEditor(plan: SubscriptionPlan | null) {
    setSelected(plan)
    setEditorOpen(true)
  }

  return (
    <div className={uiStyles.page}>
      <PageHeader
        eyebrow="SUBSCRIPTION CATALOG"
        title="订阅套餐"
        description="版本化管理价格与权益。已发布套餐的历史版本继续服务既有订阅，不被静默改写。"
        actions={
          can(session, 'plans.write') ? (
            <Button icon={<Plus size={17} />} onClick={() => openEditor(null)}>新增套餐</Button>
          ) : undefined
        }
      />
      {planReadable ? <Section title="套餐目录" meta={plans.data ? `${plans.data.total} 个套餐版本` : undefined}>
        {plans.loading ? <Feedback kind="loading" /> : null}
        {plans.error ? <Feedback kind="error" detail={plans.error} onRetry={plans.reload} /> : null}
        {plans.data?.items.length === 0 ? (
          <Feedback kind="empty" detail="尚未配置订阅套餐。可先创建草稿并挂接权益。" />
        ) : null}
        {plans.data && plans.data.items.length > 0 ? (
          <TableWrap label="订阅套餐列表">
            <thead>
              <tr>
                <th>套餐</th>
                <th>状态</th>
                <th>价格</th>
                <th>权益</th>
                <th>订阅人数</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {plans.data.items.map((plan) => (
                <tr key={plan.id}>
                  <td className={pageStyles.identityCell}>
                    <strong>{plan.name} · v{plan.versionNumber}</strong>
                    <span>{plan.code}</span>
                  </td>
                  <td><StatusBadge status={plan.status} /></td>
                  <td>
                    {plan.prices.map((price) => (
                      <div key={`${price.currency}-${price.billingPeriod}`}>
                        {formatMoney(price.amountMinor, price.currency)} / {price.billingPeriod}
                      </div>
                    ))}
                  </td>
                  <td>{plan.entitlementKeys.length} 项</td>
                  <td>{plan.subscriberCount ?? '—'}</td>
                  <td>{formatDate(plan.updatedAt)}</td>
                  <td>
                    {can(session, 'plans.write') ? (
                      <Button
                        variant="quiet"
                        icon={<PencilLine size={16} />}
                        onClick={() => openEditor(plan)}
                      >
                        编辑
                      </Button>
                    ) : <span className={uiStyles.muted}>只读</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : null}
      </Section> : null}
      {subscriptionReadable ? (
        <Section title="用户订阅台账" meta={subscriptions.data ? `${subscriptions.data.total} 条订阅` : undefined}>
          {subscriptions.loading ? <Feedback kind="loading" /> : null}
          {subscriptions.error ? <Feedback kind="error" detail={subscriptions.error} onRetry={subscriptions.reload} /> : null}
          {subscriptions.data?.items.length === 0 ? <Feedback kind="empty" detail="当前没有用户订阅记录。" /> : null}
          {subscriptions.data && subscriptions.data.items.length > 0 ? (
            <TableWrap label="用户订阅台账">
              <thead><tr><th>用户</th><th>套餐</th><th>状态</th><th>来源</th><th>有效期</th><th>操作</th></tr></thead>
              <tbody>
                {subscriptions.data.items.map((subscription) => (
                  <tr key={subscription.id}>
                    <td className={pageStyles.identityCell}><strong>{subscription.username}</strong><span>{subscription.userId}</span></td>
                    <td><strong>{subscription.planName}</strong><div className={uiStyles.muted}>{subscription.planCode}</div></td>
                    <td><StatusBadge status={subscription.status} /></td>
                    <td><span className={pageStyles.code}>{subscription.source}</span></td>
                    <td>{formatDate(subscription.startsAt)} — {formatDate(subscription.endsAt)}</td>
                    <td>{can(session, 'subscriptions.write') ? (
                      <Button variant="quiet" icon={<PencilLine size={16} />} onClick={() => setSelectedSubscription(subscription)}>管理</Button>
                    ) : <span className={uiStyles.muted}>只读</span>}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : null}
        </Section>
      ) : null}
      <PlanEditor
        open={editorOpen}
        plan={selected}
        entitlements={entitlements.data?.items ?? []}
        onClose={() => setEditorOpen(false)}
        onSaved={plans.reload}
      />
      <SubscriptionEditor
        subscription={selectedSubscription}
        onClose={() => setSelectedSubscription(null)}
        onSaved={subscriptions.reload}
      />
    </div>
  )
}
