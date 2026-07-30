import { useCallback, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Search } from 'lucide-react'
import { adminApi } from '../lib/api'
import { mutationKeyForDraft, type PendingMutation } from '../lib/idempotency'
import { can } from '../lib/permissions'
import { formatDate, formatInteger } from '../lib/format'
import { useResource } from '../lib/useResource'
import { useAuthStore } from '../store/auth'
import type { AdminUser, LedgerDirection } from '../types/admin'
import { Field, FormMessage, HighRiskReview, formStyles } from '../components/forms'
import {
  Button,
  Feedback,
  Notice,
  PageHeader,
  Pagination,
  Section,
  StatusBadge,
  TableWrap,
  uiStyles,
} from '../components/ui'
import pageStyles from '../styles/Page.module.css'

export default function PointsPage() {
  const pendingAdjustment = useRef<PendingMutation | null>(null)
  const [draftQuery, setDraftQuery] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AdminUser | null>(null)
  const [page, setPage] = useState(1)
  const [direction, setDirection] = useState<LedgerDirection>('credit')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const session = useAuthStore((state) => state.session)
  const userReadable = can(session, 'users.read')

  const loadUsers = useCallback(
    () => userReadable
      ? adminApi.users.list({ query, page: 1, pageSize: 12 })
      : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 12 }),
    [query, userReadable],
  )
  const users = useResource(loadUsers, [loadUsers])
  const loadPoints = useCallback(
    () => selected
      ? adminApi.points.get({ userId: selected.id, page, pageSize: 20 })
      : Promise.resolve({ wallet: null, items: [], total: 0, page: 1, pageSize: 20 }),
    [selected, page],
  )
  const points = useResource(loadPoints, [loadPoints])

  function searchUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQuery(draftQuery.trim())
    setSelected(null)
  }

  async function adjustPoints(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !/^[1-9]\d*$/.test(amount) || !reason.trim()) return
    const normalizedReason = reference.trim()
      ? `${reason.trim()}（凭据：${reference.trim()}）`
      : reason.trim()
    const fingerprint = JSON.stringify({
      userId: selected.id,
      direction,
      amount,
      reason: normalizedReason,
      reference: reference.trim(),
    })
    pendingAdjustment.current = mutationKeyForDraft(pendingAdjustment.current, fingerprint)
    const idempotencyKey = pendingAdjustment.current.key
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await adminApi.points.adjust({
        userId: selected.id,
        direction,
        amount,
        reason: normalizedReason,
        reference: reference.trim() || undefined,
        idempotencyKey,
      })
      pendingAdjustment.current = null
      setMessage('积分变更已写入不可变流水。')
      setAmount('')
      setReason('')
      setReference('')
      await points.reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '积分调整失败')
    } finally {
      setSaving(false)
    }
  }

  const summary = selected
    ? `${direction === 'credit' ? '增加' : '扣减'} ${selected.email ?? selected.username} 的 ${amount || '0'} 积分`
    : '尚未选择用户'
  return (
    <div className={uiStyles.page}>
      <PageHeader
        eyebrow="POINTS GENERAL LEDGER"
        title="积分总账"
        description="积分只通过追加流水变更，不直接覆盖余额。每笔人工调整必须说明理由并带幂等标识。"
      />
      <div className={pageStyles.split}>
        <Section title="定位积分账户" meta={selected ? `已选 ${selected.email ?? selected.username}` : '先查询用户'}>
          {!userReadable ? (
            <Feedback
              kind="denied"
              detail="积分账册不会绕过用户目录权限。需要 users.read 才能查找并选择目标账户。"
            />
          ) : (
            <>
              <form className={formStyles.form} onSubmit={searchUsers}>
                <div className={uiStyles.inline}>
                  <label className="srOnly" htmlFor="pointUserSearch">搜索用户</label>
                  <input
                    className={formStyles.input}
                    id="pointUserSearch"
                    value={draftQuery}
                    onChange={(event) => setDraftQuery(event.target.value)}
                    placeholder="输入用户名或展示名称"
                  />
                  <Button type="submit" icon={<Search size={16} />}>查找</Button>
                </div>
              </form>
              {users.loading ? <Feedback kind="loading" /> : null}
              {users.error ? <Feedback kind="error" detail={users.error} onRetry={users.reload} /> : null}
              {users.data ? (
                <ul className={pageStyles.plainList}>
                  {users.data.items.map((user) => (
                    <li className={pageStyles.plainItem} key={user.id}>
                      <button className={pageStyles.rowButton} onClick={() => { setSelected(user); setPage(1) }}>
                        {user.displayName || '未命名用户'} · {user.username}
                        <span className={uiStyles.muted}>　编号 {user.id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </Section>

        <Section title="人工调整" meta={can(session, 'points.adjust') ? '可写入' : '只读账号'}>
          {!selected ? (
            <Feedback kind="empty" title="先选择积分账户" detail="从左侧用户名册中选择目标用户。" />
          ) : can(session, 'points.adjust') ? (
            <form className={formStyles.form} onSubmit={adjustPoints}>
              <Notice>
                <span>
                  可用余额：<strong>{formatInteger(points.data?.wallet?.available ?? '0')}</strong>。
                  扣减不足时将由服务端拒绝，不产生半笔流水。
                </span>
              </Notice>
              <div className={formStyles.grid}>
                <Field label="方向" htmlFor="pointDirection" required>
                  <select className={formStyles.select} id="pointDirection" value={direction} onChange={(event) => setDirection(event.target.value as LedgerDirection)}>
                    <option value="credit">增加积分</option>
                    <option value="debit">扣减积分</option>
                  </select>
                </Field>
                <Field label="积分数量" htmlFor="pointAmount" required>
                  <input className={formStyles.input} id="pointAmount" inputMode="numeric" pattern="[1-9][0-9]*" value={amount} onChange={(event) => setAmount(event.target.value)} required />
                </Field>
              </div>
              <Field label="凭据编号" htmlFor="pointReference" hint="建议填写工单、活动或退款编号。">
                <input className={formStyles.input} id="pointReference" value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>
              <Field label="调整理由" htmlFor="pointReason" required>
                <textarea className={formStyles.textarea} id="pointReason" value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
              <HighRiskReview summary={summary} reason={reason} />
              {error ? <FormMessage kind="error">{error}</FormMessage> : null}
              {message ? <FormMessage kind="success">{message}</FormMessage> : null}
              <Button
                type="submit"
                variant={direction === 'debit' ? 'danger' : 'primary'}
                icon={direction === 'credit' ? <ArrowDownToLine size={17} /> : <ArrowUpFromLine size={17} />}
                disabled={saving || !/^[1-9]\d*$/.test(amount) || !reason.trim()}
              >
                写入积分流水
              </Button>
            </form>
          ) : <Feedback kind="denied" detail="需要 points.adjust 权限才能人工调整积分。" />}
        </Section>
      </div>

      <Section title="账户流水" meta={selected ? `${selected.email ?? selected.username} · ${points.data?.total ?? 0} 笔` : '未选择账户'}>
        {!selected ? <Feedback kind="empty" detail="选择用户后显示其完整积分流水。" /> : null}
        {selected && points.loading ? <Feedback kind="loading" /> : null}
        {selected && points.error ? <Feedback kind="error" detail={points.error} onRetry={points.reload} /> : null}
        {selected && points.data?.items.length === 0 ? <Feedback kind="empty" detail="该账户尚无积分流水。" /> : null}
        {selected && points.data && points.data.items.length > 0 ? (
          <>
            <TableWrap label="积分流水">
              <thead><tr><th>时间</th><th>方向</th><th>数量</th><th>结余</th><th>来源</th><th>理由 / 操作者</th></tr></thead>
              <tbody>
                {points.data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td className={uiStyles.mono}>{formatDate(entry.createdAt)}</td>
                    <td><StatusBadge status={entry.direction} /></td>
                    <td className={uiStyles.mono}>{entry.direction === 'debit' ? '−' : '+'}{formatInteger(entry.amount.replace(/^-/, ''))}</td>
                    <td className={uiStyles.mono}>{formatInteger(entry.balanceAfter)}</td>
                    <td><span className={pageStyles.code}>{entry.source}</span></td>
                    <td><strong>{entry.reason}</strong><div className={uiStyles.muted}>{entry.operatorEmail ?? '系统'} · {entry.reference ?? '无凭据'}</div></td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination page={points.data.page} pageSize={points.data.pageSize} total={points.data.total} onChange={setPage} />
          </>
        ) : null}
      </Section>
    </div>
  )
}
