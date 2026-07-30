import { useCallback, useEffect, useState } from 'react'
import { PencilLine, Plus } from 'lucide-react'
import { adminApi } from '../lib/api'
import { can } from '../lib/permissions'
import { formatDate } from '../lib/format'
import { useResource } from '../lib/useResource'
import { useAuthStore } from '../store/auth'
import type { Entitlement, FeatureFlag } from '../types/admin'
import { CatalogEditor } from '../components/CatalogEditor'
import { Button, Feedback, PageHeader, Section, StatusBadge, TableWrap, uiStyles } from '../components/ui'
import pageStyles from '../styles/Page.module.css'

type Selection =
  | { kind: 'entitlement'; item: Entitlement | null }
  | { kind: 'feature'; item: FeatureFlag }

export default function EntitlementsPage() {
  const [tab, setTab] = useState<'entitlements' | 'features'>('entitlements')
  const [selection, setSelection] = useState<Selection | null>(null)
  const session = useAuthStore((state) => state.session)
  const entitlementReadable = can(session, 'entitlements.read')
  const featureReadable = can(session, 'features.read')
  const loadCatalog = useCallback(
    async () => {
      const [entitlements, features] = await Promise.all([
        entitlementReadable
          ? adminApi.entitlements.list()
          : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
        featureReadable
          ? adminApi.features.list()
          : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
      ])
      return { entitlements, features }
    },
    [entitlementReadable, featureReadable],
  )
  const resource = useResource(loadCatalog, [loadCatalog])
  const entitlementWritable = can(session, 'entitlements.write')
  const featureWritable = can(session, 'features.write')
  const writable = tab === 'entitlements' ? entitlementWritable : featureWritable

  useEffect(() => {
    if (!entitlementReadable && featureReadable) setTab('features')
  }, [entitlementReadable, featureReadable])

  return (
    <div className={uiStyles.page}>
      <PageHeader
        eyebrow="CAPABILITY REGISTRY"
        title="权益与功能"
        description="权益定义“套餐交付什么”，功能开关控制“系统此刻开放什么”。两者分开治理。"
        actions={entitlementWritable && tab === 'entitlements' ? (
          <Button icon={<Plus size={17} />} onClick={() => setSelection({ kind: 'entitlement', item: null })}>
            新增权益
          </Button>
        ) : undefined}
      />
      <div className={pageStyles.tabs} role="tablist" aria-label="配置类型">
        <button
          className={`${pageStyles.tab} ${tab === 'entitlements' ? pageStyles.tabActive : ''}`}
          role="tab"
          aria-selected={tab === 'entitlements'}
          disabled={!entitlementReadable}
          onClick={() => setTab('entitlements')}
        >
          套餐权益
        </button>
        <button
          className={`${pageStyles.tab} ${tab === 'features' ? pageStyles.tabActive : ''}`}
          role="tab"
          aria-selected={tab === 'features'}
          disabled={!featureReadable}
          onClick={() => setTab('features')}
        >
          功能开关
        </button>
      </div>
      {resource.loading ? <Feedback kind="loading" /> : null}
      {resource.error ? <Feedback kind="error" detail={resource.error} onRetry={resource.reload} /> : null}
      {resource.data && tab === 'entitlements' ? (
        <Section title="权益目录" meta={`${resource.data.entitlements.total} 项`}>
          {resource.data.entitlements.items.length === 0 ? <Feedback kind="empty" /> : (
            <TableWrap label="权益目录">
              <thead><tr><th>权益</th><th>类型</th><th>默认值</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
              <tbody>
                {resource.data.entitlements.items.map((item) => (
                  <tr key={item.id}>
                    <td className={pageStyles.identityCell}><strong>{item.name}</strong><span>{item.key}</span></td>
                    <td>{item.valueType}</td>
                    <td><span className={pageStyles.code}>{String(item.defaultValue)}</span></td>
                    <td><StatusBadge status={item.status} /></td>
                    <td>{formatDate(item.updatedAt)}</td>
                    <td>{writable ? (
                      <Button variant="quiet" icon={<PencilLine size={16} />} onClick={() => setSelection({ kind: 'entitlement', item })}>编辑</Button>
                    ) : <span className={uiStyles.muted}>只读</span>}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Section>
      ) : null}
      {resource.data && tab === 'features' ? (
        <Section title="运行时功能" meta={`${resource.data.features.total} 项`}>
          {resource.data.features.items.length === 0 ? <Feedback kind="empty" /> : (
            <TableWrap label="功能开关">
              <thead><tr><th>功能</th><th>状态</th><th>依赖权益</th><th>配置</th><th>更新时间</th><th>操作</th></tr></thead>
              <tbody>
                {resource.data.features.items.map((item) => (
                  <tr key={item.id}>
                    <td className={pageStyles.identityCell}><strong>{item.name}</strong><span>{item.key}</span></td>
                    <td><StatusBadge status={item.enabled ? 'enabled' : 'disabled'} /></td>
                    <td>{item.requiredEntitlementKey ?? <span className={uiStyles.muted}>无门槛</span>}</td>
                    <td><span className={pageStyles.code}>{Object.keys(item.config).length} 个字段</span></td>
                    <td>{formatDate(item.updatedAt)}</td>
                    <td>{writable ? (
                      <Button variant="quiet" icon={<PencilLine size={16} />} onClick={() => setSelection({ kind: 'feature', item })}>配置</Button>
                    ) : <span className={uiStyles.muted}>只读</span>}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Section>
      ) : null}
      <CatalogEditor
        selection={selection}
        entitlements={resource.data?.entitlements.items ?? []}
        onClose={() => setSelection(null)}
        onSaved={resource.reload}
      />
    </div>
  )
}
