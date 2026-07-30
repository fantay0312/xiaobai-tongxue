import { useCallback, useRef, useState, type FormEvent } from 'react'
import { Download, KeyRound, Plus, ShieldX, Trash2 } from 'lucide-react'
import { adminApi } from '../lib/api'
import {
  cdkCreationKeyForDraft,
  clearPendingCdkCreation,
  loadPendingCdkCreation,
  localDateTimeToIso,
  savePendingCdkCreation,
  type PendingCdkCreation,
} from '../lib/cdk-idempotency'
import { can } from '../lib/permissions'
import { downloadLines, formatDate } from '../lib/format'
import { useResource } from '../lib/useResource'
import { useAuthStore } from '../store/auth'
import type { CdkBenefit, CdkCampaign, CdkCreationResult } from '../types/admin'
import { Drawer } from '../components/Drawer'
import { Field, FormMessage, HighRiskReview, formStyles } from '../components/forms'
import {
  Button,
  Feedback,
  Notice,
  PageHeader,
  Section,
  StatusBadge,
  TableWrap,
  uiStyles,
} from '../components/ui'
import pageStyles from '../styles/Page.module.css'

export default function CdkPage() {
  const session = useAuthStore((state) => state.session)
  const adminId = session?.id ?? ''
  const [restored] = useState(() => loadPendingCdkCreation(adminId))
  const restoredBenefit = restored?.draft.benefits[0]
  const pendingCreation = useRef<PendingCdkCreation | null>(restored?.pending ?? null)
  const [creatorOpen, setCreatorOpen] = useState(Boolean(restored))
  const [name, setName] = useState(restored?.draft.name ?? '')
  const [quantity, setQuantity] = useState(String(restored?.draft.quantity ?? 100))
  const [benefitType, setBenefitType] = useState<CdkBenefit['type']>(
    restoredBenefit?.type ?? 'points',
  )
  const [benefitValue, setBenefitValue] = useState(restoredBenefit?.value ?? '')
  const [durationDays, setDurationDays] = useState(String(restoredBenefit?.durationDays ?? 30))
  const [expiresAt, setExpiresAt] = useState(restored?.draft.expiresAt ?? '')
  const [reason, setReason] = useState(restored?.draft.reason ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [generated, setGenerated] = useState<CdkCreationResult | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<CdkCampaign | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const planReadable = can(session, 'plans.read')
  const entitlementReadable = can(session, 'entitlements.read')

  const loadData = useCallback(async () => {
    const [campaigns, plans, entitlements] = await Promise.all([
      adminApi.cdk.campaigns(),
      planReadable
        ? adminApi.plans.list()
        : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
      entitlementReadable
        ? adminApi.entitlements.list()
        : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
    ])
    return { campaigns, plans, entitlements }
  }, [entitlementReadable, planReadable])
  const resource = useResource(loadData, [loadData])
  const writable = can(session, 'cdk.write')
  const quantityNumber = /^\d+$/.test(quantity) ? Number(quantity) : 0
  const validQuantity = Number.isSafeInteger(quantityNumber) && quantityNumber >= 1 && quantityNumber <= 10_000
  const durationNumber = /^\d+$/.test(durationDays) ? Number(durationDays) : 0
  const validDuration = benefitType !== 'subscription'
    || (Number.isSafeInteger(durationNumber) && durationNumber >= 1 && durationNumber <= 3_650)
  const rewardCatalogReadable = benefitType === 'points'
    || (benefitType === 'subscription' ? planReadable : entitlementReadable)

  function discardPendingCreation() {
    pendingCreation.current = null
    clearPendingCdkCreation(adminId)
  }

  async function createBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!validQuantity || !validDuration || !rewardCatalogReadable
      || !name.trim() || !benefitValue || !expiresAt || !reason.trim()) return
    const expiresAtIso = localDateTimeToIso(expiresAt)
    if (!expiresAtIso) {
      setError('CDK 到期时间格式无效')
      return
    }
    setSaving(true)
    setError('')
    setGenerated(null)
    const draft = {
      name: name.trim(),
      quantity: quantityNumber,
      benefits: [{
        type: benefitType,
        value: benefitValue,
        label: name.trim(),
        durationDays: benefitType === 'subscription' ? durationNumber : undefined,
      }],
      expiresAt: expiresAt || undefined,
      reason: reason.trim(),
    }
    pendingCreation.current = cdkCreationKeyForDraft(pendingCreation.current, draft)
    savePendingCdkCreation(adminId, {
      pending: pendingCreation.current,
      draft,
    })
    try {
      const result = await adminApi.cdk.createCampaign({
        ...draft,
        expiresAt: expiresAtIso,
        idempotencyKey: pendingCreation.current.key,
      })
      discardPendingCreation()
      setGenerated(result)
      await resource.reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'CDK 批次生成失败')
    } finally {
      setSaving(false)
    }
  }

  async function revokeCampaign() {
    if (!revokeTarget || !revokeReason.trim()) return
    setSaving(true)
    setError('')
    try {
      await adminApi.cdk.revoke(revokeTarget.id, { reason: revokeReason.trim() })
      setRevokeTarget(null)
      setRevokeReason('')
      await resource.reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '批次撤销失败')
    } finally {
      setSaving(false)
    }
  }

  function resetCreator() {
    discardPendingCreation()
    setGenerated(null)
    setName('')
    setBenefitValue('')
    setReason('')
    setCreatorOpen(false)
  }

  return (
    <div className={uiStyles.page}>
      <PageHeader
        eyebrow="REDEMPTION VOUCHERS"
        title="CDK 兑换"
        description="按批次分发积分、订阅或单项权益。失败重试会在 15 分钟导出窗口内安全恢复同一批兑换码。"
        actions={writable ? (
          <Button icon={<Plus size={17} />} onClick={() => setCreatorOpen(true)}>新建并生成批次</Button>
        ) : undefined}
      />
      <Notice>
        <KeyRound size={18} aria-hidden="true" />
        <span><strong>短期导出纪律：</strong>兑换码仅以摘要长期保存；加密导出在 15 分钟后销毁。请立即下载并安全交付。</span>
      </Notice>
      <Section title="兑换批次" meta={resource.data ? `${resource.data.campaigns.total} 个批次` : undefined}>
        {resource.loading ? <Feedback kind="loading" /> : null}
        {resource.error ? <Feedback kind="error" detail={resource.error} onRetry={resource.reload} /> : null}
        {resource.data?.campaigns.items.length === 0 ? <Feedback kind="empty" detail="尚未生成 CDK 批次。" /> : null}
        {resource.data && resource.data.campaigns.items.length > 0 ? (
          <TableWrap label="CDK 批次列表">
            <thead><tr><th>批次</th><th>状态</th><th>权益</th><th>生成 / 已兑</th><th>到期时间</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>
              {resource.data.campaigns.items.map((campaign) => (
                <tr key={campaign.id}>
                  <td className={pageStyles.identityCell}><strong>{campaign.name}</strong><span>XB · {campaign.id}</span></td>
                  <td><StatusBadge status={campaign.status} /></td>
                  <td>{campaign.benefits.map((benefit) => <div key={`${benefit.type}-${benefit.value}`}><span className={pageStyles.code}>{benefit.type}</span> {benefit.value}</div>)}</td>
                  <td>{campaign.generatedCount} / {campaign.redeemedCount}</td>
                  <td>{formatDate(campaign.expiresAt)}</td>
                  <td>{formatDate(campaign.createdAt)}</td>
                  <td>{writable && campaign.status === 'active' ? (
                    <Button variant="quiet" icon={<ShieldX size={16} />} onClick={() => setRevokeTarget(campaign)}>撤销</Button>
                  ) : <span className={uiStyles.muted}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : null}
      </Section>

      <Drawer open={creatorOpen} title="新建 CDK 批次" subtitle="CREATE & GENERATE ONCE" onClose={resetCreator}>
        {generated ? (
          <>
            <Notice>
              <span><strong>已生成 {generated.codes.length} 枚兑换码。</strong> 当前页面直接展示明文；服务端加密恢复窗口为 15 分钟，请立即下载并在确认后清除。</span>
            </Notice>
            <div className={pageStyles.codes} aria-label="本次生成的兑换码">
              {generated.codes.map((code) => <code key={code}>{code}</code>)}
            </div>
            <div className={pageStyles.actionStrip}>
              <Button
                icon={<Download size={17} />}
                onClick={() => downloadLines(`cdk-${generated.campaign.id}.txt`, generated.codes)}
              >
                下载 TXT
              </Button>
              <Button variant="danger" icon={<Trash2 size={17} />} onClick={resetCreator}>
                清除当前明文
              </Button>
            </div>
          </>
        ) : (
          <form className={formStyles.form} onSubmit={createBatch}>
            <div className={formStyles.grid}>
              <Field label="批次名称" htmlFor="cdkName" required>
                <input className={formStyles.input} id="cdkName" value={name} onChange={(event) => { discardPendingCreation(); setName(event.target.value) }} required />
              </Field>
              <Field label="兑换码前缀" hint="由服务端固定为 XB，不接受客户端覆盖。">
                <input className={formStyles.input} value="XB" disabled aria-label="兑换码固定前缀" />
              </Field>
              <Field label="生成数量" htmlFor="cdkQuantity" required hint="单批 1–10,000 枚。">
                <input className={formStyles.input} id="cdkQuantity" inputMode="numeric" value={quantity} onChange={(event) => { discardPendingCreation(); setQuantity(event.target.value) }} pattern="[0-9]+" required />
              </Field>
              <Field label="到期时间" htmlFor="cdkExpires" required>
                <input className={formStyles.input} id="cdkExpires" type="datetime-local" value={expiresAt} onChange={(event) => { discardPendingCreation(); setExpiresAt(event.target.value) }} required />
              </Field>
              <Field label="兑换权益类型" htmlFor="cdkBenefitType" required>
                <select className={formStyles.select} id="cdkBenefitType" value={benefitType} onChange={(event) => { discardPendingCreation(); setBenefitType(event.target.value as CdkBenefit['type']); setBenefitValue('') }}>
                  <option value="points">积分</option>
                  <option value="subscription">订阅套餐</option>
                  <option value="entitlement">单项权益</option>
                </select>
              </Field>
              <Field label="权益内容" htmlFor="cdkBenefitValue" required>
                {benefitType === 'points' ? (
                  <input className={formStyles.input} id="cdkBenefitValue" inputMode="numeric" pattern="[1-9][0-9]*" value={benefitValue} onChange={(event) => { discardPendingCreation(); setBenefitValue(event.target.value) }} placeholder="积分数量" required />
                ) : (
                  <select className={formStyles.select} id="cdkBenefitValue" value={benefitValue} onChange={(event) => { discardPendingCreation(); setBenefitValue(event.target.value) }} required>
                    <option value="">选择{benefitType === 'subscription' ? '套餐' : '权益'}</option>
                    {benefitType === 'subscription'
                      ? resource.data?.plans.items.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)
                      : resource.data?.entitlements.items.filter((item) => item.status === 'active' && item.valueType === 'boolean').map((item) => <option key={item.id} value={item.key}>{item.name}</option>)}
                  </select>
                )}
              </Field>
              {!rewardCatalogReadable ? (
                <Feedback
                  kind="denied"
                  detail={benefitType === 'subscription'
                    ? '需要 plans.read 才能选择订阅套餐。'
                    : '需要 entitlements.read 才能选择单项权益。'}
                />
              ) : null}
              {benefitType === 'subscription' ? (
                <Field label="订阅有效天数" htmlFor="cdkDuration" required hint="1–3,650 天。">
                  <input className={formStyles.input} id="cdkDuration" type="number" min="1" max="3650" value={durationDays} onChange={(event) => { discardPendingCreation(); setDurationDays(event.target.value) }} required />
                </Field>
              ) : null}
            </div>
            <Field label="生成理由" htmlFor="cdkReason" required>
              <textarea className={formStyles.textarea} id="cdkReason" value={reason} onChange={(event) => { discardPendingCreation(); setReason(event.target.value) }} />
            </Field>
            <HighRiskReview summary={`生成 ${validQuantity ? quantityNumber : 0} 枚 XB 兑换码，权益为 ${benefitType}:${benefitValue || '待选'}`} reason={reason} />
            {error ? <FormMessage kind="error">{error}</FormMessage> : null}
            <Button type="submit" icon={<KeyRound size={17} />} disabled={saving || !validQuantity || !validDuration || !rewardCatalogReadable || !benefitValue || !reason.trim()}>
              生成一次性明文
            </Button>
          </form>
        )}
      </Drawer>

      <Drawer open={Boolean(revokeTarget)} title="撤销 CDK 批次" subtitle={revokeTarget?.name} onClose={() => setRevokeTarget(null)}>
        <Notice><span>撤销后未兑换的码将立即失效，既有兑换记录不会被回滚。</span></Notice>
        <Field label="撤销理由" htmlFor="revokeReason" required>
          <textarea className={formStyles.textarea} id="revokeReason" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} />
        </Field>
        <HighRiskReview summary={`撤销批次「${revokeTarget?.name ?? ''}」`} reason={revokeReason} />
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Button variant="danger" icon={<ShieldX size={17} />} disabled={saving || !revokeReason.trim()} onClick={revokeCampaign}>确认撤销</Button>
      </Drawer>
    </div>
  )
}
