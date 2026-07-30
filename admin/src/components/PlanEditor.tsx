import { useEffect, useState, type FormEvent } from 'react'
import { Save, Send } from 'lucide-react'
import { adminApi } from '../lib/api'
import type {
  Entitlement,
  PlanPrice,
  SubscriptionPlan,
} from '../types/admin'
import { Drawer } from './Drawer'
import { Field, FormMessage, HighRiskReview, formStyles } from './forms'
import { emptyPrice, PriceEditor } from './PriceEditor'
import { Button, Notice } from './ui'
import pageStyles from '../styles/Page.module.css'

interface PlanEditorProps {
  plan: SubscriptionPlan | null
  open: boolean
  entitlements: Entitlement[]
  onClose: () => void
  onSaved: () => Promise<void>
}

function planEntitlementValue(entitlement: Entitlement): unknown {
  if (entitlement.valueType === 'boolean') return entitlement.defaultValue === true
  if (entitlement.valueType === 'integer') {
    const value = Number(entitlement.defaultValue)
    return Number.isSafeInteger(value) ? value : 0
  }
  if (entitlement.valueType === 'json') {
    try {
      return JSON.parse(String(entitlement.defaultValue))
    } catch {
      return {}
    }
  }
  return String(entitlement.defaultValue)
}

export function PlanEditor({ plan, open, entitlements, onClose, onSaved }: PlanEditorProps) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [tagline, setTagline] = useState('')
  const [description, setDescription] = useState('')
  const [prices, setPrices] = useState<PlanPrice[]>([emptyPrice])
  const [entitlementKeys, setEntitlementKeys] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setCode(plan?.code ?? '')
    setName(plan?.name ?? '')
    setTagline(plan?.tagline ?? '')
    setDescription(plan?.description ?? '')
    setPrices(plan?.prices.length ? plan.prices : [emptyPrice])
    setEntitlementKeys(plan?.entitlementKeys ?? [])
    setReason('')
    setError('')
    setMessage('')
  }, [plan, open])

  function toggleEntitlement(id: string) {
    setEntitlementKeys((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason.trim()) return
    setSaving(true)
    setError('')
    setMessage('')
    const input = {
      code: code.trim(),
      name: name.trim(),
      tagline: tagline.trim(),
      description: description.trim(),
      prices,
      entitlements: entitlementKeys.flatMap((key) => {
        const entitlement = entitlements.find((item) => item.key === key)
        return entitlement ? [{ key, value: planEntitlementValue(entitlement) }] : []
      }),
      reason: reason.trim(),
      summary: plan ? `更新套餐「${name}」并产生新版本` : `创建套餐草稿「${name}」`,
    }
    try {
      if (plan) {
        await adminApi.plans.update(plan.id, {
          ...input,
          version: plan.version,
          status: plan.status,
        })
      }
      else await adminApi.plans.create(input)
      setMessage(plan ? '套餐版本已更新。' : '套餐草稿已创建。')
      await onSaved()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '套餐保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function publishPlan() {
    if (!plan || !reason.trim()) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const entitlementsInput = entitlementKeys.flatMap((key) => {
        const entitlement = entitlements.find((item) => item.key === key)
        return entitlement ? [{ key, value: planEntitlementValue(entitlement) }] : []
      })
      await adminApi.plans.publish(plan.id, {
        code: code.trim(),
        name: name.trim(),
        tagline: tagline.trim(),
        description: description.trim(),
        prices,
        entitlements: entitlementsInput,
        version: plan.version,
        reason: reason.trim(),
        summary: `发布套餐「${plan.name}」v${plan.versionNumber}`,
      })
      setMessage('套餐已发布。')
      await onSaved()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '套餐发布失败')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  const summary = plan ? `更新「${name || plan.name}」并保留旧版本` : `新建套餐「${name || '未命名'}」`
  return (
    <Drawer
      open
      title={plan ? `编辑 ${plan.name}` : '新增订阅套餐'}
      subtitle={plan ? `${plan.code} · VERSION ${plan.versionNumber}` : 'DRAFT PLAN'}
      onClose={onClose}
    >
      {plan?.status === 'active' ? (
        <Notice>
          <span><strong>已发布版本不会被原地覆盖。</strong> 保存将由服务端生成可追溯的新版本。</span>
        </Notice>
      ) : null}
      <form className={formStyles.form} onSubmit={savePlan}>
        <div className={formStyles.grid}>
          <Field label="套餐编码" htmlFor="planCode" required hint="发布后应保持稳定，例如 PRO_MONTHLY。">
            <input
              className={formStyles.input}
              id="planCode"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              pattern="[A-Z0-9_-]+"
              required
            />
          </Field>
          <Field label="展示名称" htmlFor="planName" required>
            <input
              className={formStyles.input}
              id="planName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field label="套餐短语" htmlFor="planTagline" required wide>
            <input
              className={formStyles.input}
              id="planTagline"
              value={tagline}
              onChange={(event) => setTagline(event.target.value)}
              placeholder="一句话说明套餐适合谁"
              required
            />
          </Field>
          <Field label="详细说明" htmlFor="planDescription" required wide>
            <textarea
              className={formStyles.textarea}
              id="planDescription"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
            />
          </Field>
        </div>

        <PriceEditor prices={prices} onChange={setPrices} />

        <section className={pageStyles.drawerSection}>
          <h3>套餐权益</h3>
          <div className={formStyles.checkGrid}>
            {entitlements.filter((item) => item.status === 'active').map((entitlement) => (
              <label className={formStyles.checkItem} key={entitlement.id}>
                <input
                  type="checkbox"
                  checked={entitlementKeys.includes(entitlement.key)}
                  onChange={() => toggleEntitlement(entitlement.key)}
                />
                <span>
                  <strong>{entitlement.name}</strong>
                  <small>{entitlement.key} · {entitlement.description}</small>
                </span>
              </label>
            ))}
          </div>
        </section>
        <Field label="变更理由" htmlFor="planReason" required>
          <textarea
            className={formStyles.textarea}
            id="planReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="说明定价、权益或发布依据"
          />
        </Field>
        <HighRiskReview summary={summary} reason={reason} />
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        {message ? <FormMessage kind="success">{message}</FormMessage> : null}
        <div className={pageStyles.actionStrip}>
          <Button type="submit" icon={<Save size={17} />} disabled={saving || !reason.trim()}>
            保存版本
          </Button>
          {plan && plan.status !== 'active' ? (
            <Button
              type="button"
              variant="secondary"
              icon={<Send size={17} />}
              disabled={saving || !reason.trim()}
              onClick={publishPlan}
            >
              发布套餐
            </Button>
          ) : null}
        </div>
      </form>
    </Drawer>
  )
}
