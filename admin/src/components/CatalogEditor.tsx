import { useEffect, useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { adminApi } from '../lib/api'
import type { Entitlement, FeatureFlag } from '../types/admin'
import { Drawer } from './Drawer'
import { Field, FormMessage, HighRiskReview, formStyles } from './forms'
import { Button, Notice } from './ui'

type Selection =
  | { kind: 'entitlement'; item: Entitlement | null }
  | { kind: 'feature'; item: FeatureFlag }

interface CatalogEditorProps {
  selection: Selection | null
  entitlements: Entitlement[]
  onClose: () => void
  onSaved: () => Promise<void>
}

export function CatalogEditor({
  selection,
  entitlements,
  onClose,
  onSaved,
}: CatalogEditorProps) {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [valueType, setValueType] = useState<Entitlement['valueType']>('boolean')
  const [defaultValue, setDefaultValue] = useState('true')
  const [catalogStatus, setCatalogStatus] = useState<Entitlement['status']>('active')
  const [enabled, setEnabled] = useState(false)
  const [requiredKey, setRequiredKey] = useState('')
  const [configText, setConfigText] = useState('{}')
  const [reason, setReason] = useState('')
  const [publicReason, setPublicReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const item = selection?.item
    setKey(item?.key ?? '')
    setName(item?.name ?? '')
    setDescription(item?.description ?? '')
    if (selection?.kind === 'entitlement') {
      setValueType(selection.item?.valueType ?? 'boolean')
      setDefaultValue(String(selection.item?.defaultValue ?? true))
      setCatalogStatus(selection.item?.status ?? 'active')
    } else if (selection?.kind === 'feature') {
      setEnabled(selection.item.enabled)
      setRequiredKey(selection.item.requiredEntitlementKey ?? '')
      setConfigText(JSON.stringify(selection.item.config, null, 2))
      setPublicReason(selection.item.publicReason)
    }
    setReason('')
    if (selection?.kind !== 'feature') setPublicReason('')
    setError('')
    setMessage('')
  }, [selection])

  const current = selection
  if (!current) return null
  const isEntitlement = current.kind === 'entitlement'
  const isNew = isEntitlement && current.item === null
  const summary = isEntitlement
    ? `${isNew ? '创建' : '更新'}权益「${name || key || '未命名'}」`
    : `${enabled ? '启用' : '停用'}功能「${name || key}」并更新运行配置`

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!current || !reason.trim()) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      if (current.kind === 'entitlement') {
        const input = {
          key: key.trim(),
          name: name.trim(),
          description: description.trim(),
          valueType,
          defaultValue: valueType === 'boolean' ? defaultValue === 'true' : defaultValue,
          status: catalogStatus,
          version: current.item?.version ?? 1,
          reason: reason.trim(),
          summary,
        }
        if (current.item) await adminApi.entitlements.update(current.item.id, input)
        else await adminApi.entitlements.create(input)
      } else {
        let config: Record<string, unknown>
        try {
          const parsed = JSON.parse(configText)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
          config = parsed as Record<string, unknown>
        } catch {
          throw new Error('功能配置必须是 JSON 对象。')
        }
        await adminApi.features.update(current.item.key, {
          name: name.trim(),
          description: description.trim(),
          enabled,
          requiredEntitlementKey: requiredKey || undefined,
          changeReason: reason.trim(),
          publicReason: publicReason.trim(),
          config,
          version: current.item.version,
        })
      }
      setMessage('配置已写入。')
      await onSaved()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '配置保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open
      title={isEntitlement ? (isNew ? '新增权益' : `编辑 ${current.item?.name}`) : `配置 ${current.item.name}`}
      subtitle={isEntitlement ? 'ENTITLEMENT CATALOG' : 'FEATURE CONTROL'}
      onClose={onClose}
    >
      {!isEntitlement ? (
        <Notice>
          <span><strong>功能开关影响运行时能力。</strong> 依赖权益和 JSON 配置由服务端统一判定。</span>
        </Notice>
      ) : null}
      <form className={formStyles.form} onSubmit={handleSubmit}>
        <div className={formStyles.grid}>
          <Field label="稳定标识" htmlFor="catalogKey" required>
            <input
              className={formStyles.input}
              id="catalogKey"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              disabled={!isNew}
              pattern="[a-z][a-z0-9._-]+"
              required
            />
          </Field>
          <Field label="展示名称" htmlFor="catalogName" required>
            <input
              className={formStyles.input}
              id="catalogName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field label="说明" htmlFor="catalogDescription" required wide>
            <textarea
              className={formStyles.textarea}
              id="catalogDescription"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              required
            />
          </Field>
        </div>

        {isEntitlement ? (
          <div className={formStyles.grid}>
            <Field label="值类型" htmlFor="entitlementType" required>
              <select className={formStyles.select} id="entitlementType" value={valueType} onChange={(event) => setValueType(event.target.value as Entitlement['valueType'])}>
                <option value="boolean">布尔开关</option>
                <option value="integer">安全整数</option>
                <option value="string">文本</option>
                <option value="json">JSON</option>
              </select>
            </Field>
            <Field label="目录状态" htmlFor="entitlementStatus" required>
              <select className={formStyles.select} id="entitlementStatus" value={catalogStatus} onChange={(event) => setCatalogStatus(event.target.value as Entitlement['status'])}>
                <option value="active">可用于套餐</option>
                <option value="archived">归档</option>
              </select>
            </Field>
            <Field label="默认值" htmlFor="defaultValue" required wide>
              {valueType === 'boolean' ? (
                <select className={formStyles.select} id="defaultValue" value={defaultValue} onChange={(event) => setDefaultValue(event.target.value)}>
                  <option value="true">启用</option>
                  <option value="false">不启用</option>
                </select>
              ) : (
                <textarea className={formStyles.textarea} id="defaultValue" value={defaultValue} onChange={(event) => setDefaultValue(event.target.value)} required />
              )}
            </Field>
          </div>
        ) : (
          <div className={formStyles.grid}>
            <Field label="运行状态">
              <label className={formStyles.checkItem}>
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                <span><strong>{enabled ? '功能已启用' : '功能已停用'}</strong><small>服务端仍会校验所需权益</small></span>
              </label>
            </Field>
            <Field label="依赖权益" htmlFor="requiredEntitlement">
              <select className={formStyles.select} id="requiredEntitlement" value={requiredKey} onChange={(event) => setRequiredKey(event.target.value)}>
                <option value="">无权益门槛</option>
                {entitlements.filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.key}>{item.name} · {item.key}</option>)}
              </select>
            </Field>
            <Field label="运行配置（JSON）" htmlFor="featureConfig" required wide>
              <textarea className={formStyles.textarea} id="featureConfig" value={configText} onChange={(event) => setConfigText(event.target.value)} spellCheck={false} required />
            </Field>
          </div>
        )}
        {!isEntitlement ? (
          <Field
            label="用户可见提示"
            htmlFor="featurePublicReason"
            hint="可选；停用或缺少权益时会展示给用户，请勿填写内部工单或敏感信息。"
          >
            <textarea
              className={formStyles.textarea}
              id="featurePublicReason"
              value={publicReason}
              onChange={(event) => setPublicReason(event.target.value)}
              maxLength={500}
            />
          </Field>
        ) : null}
        <Field
          label={isEntitlement ? '变更理由' : '内部变更理由'}
          htmlFor="catalogReason"
          hint={isEntitlement ? undefined : '仅写入管理员审计日志，不会展示给主站用户。'}
          required
        >
          <textarea className={formStyles.textarea} id="catalogReason" value={reason} onChange={(event) => setReason(event.target.value)} required />
        </Field>
        <HighRiskReview summary={summary} reason={reason} />
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        {message ? <FormMessage kind="success">{message}</FormMessage> : null}
        <Button type="submit" icon={<Save size={17} />} disabled={saving || !reason.trim()}>
          保存配置
        </Button>
      </form>
    </Drawer>
  )
}
