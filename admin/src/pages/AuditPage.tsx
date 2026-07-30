import { useCallback, useState, type FormEvent } from 'react'
import { Filter } from 'lucide-react'
import { adminApi } from '../lib/api'
import { formatDate } from '../lib/format'
import { useResource } from '../lib/useResource'
import { Button, Feedback, PageHeader, Pagination, Section, TableWrap, uiStyles } from '../components/ui'
import { formStyles } from '../components/forms'
import pageStyles from '../styles/Page.module.css'

interface Filters {
  actor: string
  action: string
  targetType: string
  from: string
  to: string
}

const emptyFilters: Filters = { actor: '', action: '', targetType: '', from: '', to: '' }

export default function AuditPage() {
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [page, setPage] = useState(1)
  const loadAudit = useCallback(
    () => adminApi.audit({ ...filters, page, pageSize: 30 }),
    [filters, page],
  )
  const resource = useResource(loadAudit, [loadAudit])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setFilters(draft)
  }

  function updateFilter(key: keyof Filters, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className={uiStyles.page}>
      <PageHeader
        eyebrow="IMMUTABLE AUDIT TRAIL"
        title="审计日志"
        description="检索关键变更的操作者、对象、摘要与理由。审计记录只读，不提供删除或覆盖入口。"
      />
      <Section title="操作留痕" meta={resource.data ? `${resource.data.total} 条记录` : undefined}>
        <form className={formStyles.filters} onSubmit={applyFilters}>
          <label className="srOnly" htmlFor="auditActor">操作者</label>
          <input className={formStyles.input} id="auditActor" value={draft.actor} onChange={(event) => updateFilter('actor', event.target.value)} placeholder="操作者邮箱" />
          <label className="srOnly" htmlFor="auditAction">操作类型</label>
          <input className={formStyles.input} id="auditAction" value={draft.action} onChange={(event) => updateFilter('action', event.target.value)} placeholder="操作类型" />
          <label className="srOnly" htmlFor="auditTarget">对象类型</label>
          <select className={formStyles.select} id="auditTarget" value={draft.targetType} onChange={(event) => updateFilter('targetType', event.target.value)}>
            <option value="">全部对象</option>
            <option value="user">用户</option>
            <option value="plan">套餐</option>
            <option value="points">积分</option>
            <option value="cdk">CDK</option>
            <option value="operator">管理席位</option>
            <option value="role">角色</option>
          </select>
          <Button type="submit" icon={<Filter size={16} />}>应用筛选</Button>
          <label className="srOnly" htmlFor="auditFrom">开始日期</label>
          <input className={formStyles.input} id="auditFrom" type="date" value={draft.from} onChange={(event) => updateFilter('from', event.target.value)} />
          <label className="srOnly" htmlFor="auditTo">结束日期</label>
          <input className={formStyles.input} id="auditTo" type="date" value={draft.to} onChange={(event) => updateFilter('to', event.target.value)} />
        </form>
        {resource.loading ? <Feedback kind="loading" /> : null}
        {resource.error ? <Feedback kind="error" detail={resource.error} onRetry={resource.reload} /> : null}
        {resource.data?.items.length === 0 ? <Feedback kind="empty" detail="当前筛选范围没有审计记录。" /> : null}
        {resource.data && resource.data.items.length > 0 ? (
          <>
            <TableWrap label="审计日志">
              <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>变更摘要</th><th>理由 / 来源</th></tr></thead>
              <tbody>
                {resource.data.items.map((event) => (
                  <tr key={event.id}>
                    <td className={uiStyles.mono}>{formatDate(event.createdAt)}</td>
                    <td>{event.actorEmail}</td>
                    <td><span className={pageStyles.code}>{event.action}</span></td>
                    <td><strong>{event.targetType}</strong><div className={uiStyles.muted}>{event.targetId ?? '—'}</div></td>
                    <td>{event.summary}</td>
                    <td><strong>{event.reason ?? '未提供'}</strong><div className={uiStyles.muted}>{event.ipAddress ?? '服务端任务'}</div></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={resource.data.page} pageSize={resource.data.pageSize} total={resource.data.total} onChange={setPage} />
          </>
        ) : null}
      </Section>
    </div>
  )
}
