import { useCallback, useState, type FormEvent } from 'react'
import { Search } from 'lucide-react'
import { adminApi } from '../lib/api'
import { formatDate, formatInteger } from '../lib/format'
import { useResource } from '../lib/useResource'
import type { AdminUser } from '../types/admin'
import { UserDrawer } from '../components/UserDrawer'
import {
  Button,
  Feedback,
  PageHeader,
  Pagination,
  Section,
  StatusBadge,
  TableWrap,
  uiStyles,
} from '../components/ui'
import { formStyles } from '../components/forms'
import pageStyles from '../styles/Page.module.css'

export default function UsersPage() {
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<AdminUser | null>(null)
  const loadUsers = useCallback(
    () => adminApi.users.list({ query, status, page, pageSize: 20 }),
    [query, status, page],
  )
  const users = useResource(loadUsers, [loadUsers])
  const loadPlans = useCallback(() => adminApi.plans.list(), [])
  const plans = useResource(loadPlans, [loadPlans])

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setQuery(draftQuery.trim())
  }

  return (
    <div className={uiStyles.page}>
      <PageHeader
        eyebrow="USER REGISTRY"
        title="用户管理"
        description="查询用户档案，控制服务状态，并以可审计方式人工配置订阅。"
      />
      <Section title="用户名册" meta={users.data ? `${users.data.total} 位用户` : undefined}>
        <form className={formStyles.filters} onSubmit={applySearch}>
          <label className="srOnly" htmlFor="userSearch">搜索用户</label>
          <input
            className={formStyles.input}
            id="userSearch"
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="用户名或展示名称"
          />
          <label className="srOnly" htmlFor="userStatus">账户状态</label>
          <select
            className={formStyles.select}
            id="userStatus"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
            }}
          >
            <option value="">全部状态</option>
            <option value="active">正常</option>
            <option value="banned">已封禁</option>
          </select>
          <Button type="submit" icon={<Search size={16} />}>查询</Button>
        </form>
        {users.loading ? <Feedback kind="loading" /> : null}
        {users.error ? <Feedback kind="error" detail={users.error} onRetry={users.reload} /> : null}
        {users.data && users.data.items.length === 0 ? (
          <Feedback kind="empty" detail="没有符合当前筛选条件的用户。" />
        ) : null}
        {users.data && users.data.items.length > 0 ? (
          <>
            <TableWrap label="用户列表">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>状态</th>
                  <th>积分</th>
                  <th>当前订阅</th>
                  <th>最近活动</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((user) => (
                  <tr key={user.id}>
                    <td className={pageStyles.identityCell}>
                      <strong>{user.displayName || '未命名用户'}</strong>
                      <span>{user.username} · {user.id}</span>
                    </td>
                    <td><StatusBadge status={user.status} /></td>
                    <td className={uiStyles.mono}>{user.pointsBalance ? formatInteger(user.pointsBalance) : <span className={uiStyles.muted}>总账查询</span>}</td>
                    <td>{user.subscription?.planName ?? <span className={uiStyles.muted}>详情中配置</span>}</td>
                    <td>{formatDate(user.lastActiveAt)}</td>
                    <td>
                      <button className={pageStyles.rowButton} onClick={() => setSelected(user)}>
                        查看与管理
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination
              page={users.data.page}
              pageSize={users.data.pageSize}
              total={users.data.total}
              onChange={setPage}
            />
          </>
        ) : null}
      </Section>
      <UserDrawer
        user={selected}
        plans={plans.data?.items ?? []}
        onClose={() => setSelected(null)}
        onCommitted={users.reload}
      />
    </div>
  )
}
