import { useCallback, useState, type FormEvent } from 'react'
import { BadgePlus, MailPlus, PencilLine, Power, RefreshCw } from 'lucide-react'
import { adminApi } from '../lib/api'
import { can } from '../lib/permissions'
import { formatDate } from '../lib/format'
import { useResource } from '../lib/useResource'
import { useAuthStore } from '../store/auth'
import type { Invitation, Operator, Role } from '../types/admin'
import { Drawer } from '../components/Drawer'
import { InvitationResendDrawer } from '../components/InvitationResendDrawer'
import { RoleEditor } from '../components/RoleEditor'
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

export default function AccessPage() {
  const [roleEditorOpen, setRoleEditorOpen] = useState(false)
  const [selectedRole, setSelectedRole] = useState<Role | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRoles, setInviteRoles] = useState<string[]>([])
  const [inviteReason, setInviteReason] = useState('')
  const [operatorReason, setOperatorReason] = useState('')
  const [operatorTarget, setOperatorTarget] = useState<Operator | null>(null)
  const [operatorRoles, setOperatorRoles] = useState<string[]>([])
  const [resendTarget, setResendTarget] = useState<Invitation | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const session = useAuthStore((state) => state.session)

  const loadAccess = useCallback(async () => {
    const [operators, roles, permissions, invitations] = await Promise.all([
      adminApi.access.operators(),
      adminApi.access.roles(),
      adminApi.access.permissions(),
      adminApi.access.invitations(),
    ])
    return { operators, roles, permissions, invitations }
  }, [])
  const resource = useResource(loadAccess, [loadAccess])
  const roleWritable = Boolean(session?.isOwner && can(session, 'team.roles'))

  function toggleInviteRole(id: string) {
    setInviteRoles((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function sendInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session?.isOwner || inviteRoles.length === 0 || !inviteReason.trim()) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await adminApi.access.invite({
        email: inviteEmail.trim(),
        displayName: inviteName.trim() || undefined,
        roleIds: inviteRoles,
        reason: inviteReason.trim(),
      })
      setMessage('邀请邮件已提交发送。')
      setInviteEmail('')
      setInviteName('')
      setInviteRoles([])
      setInviteReason('')
      await resource.reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '邀请发送失败')
    } finally {
      setSaving(false)
    }
  }

  async function toggleOperator() {
    if (!operatorTarget || !operatorReason.trim()) return
    const shouldSuspend = operatorTarget.status !== 'suspended'
    setSaving(true)
    setError('')
    try {
      await adminApi.access.updateOperator(operatorTarget.id, {
        status: shouldSuspend ? 'suspended' : 'active',
        reason: operatorReason.trim(),
      })
      setOperatorTarget(null)
      setOperatorReason('')
      await resource.reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '席位状态变更失败')
    } finally {
      setSaving(false)
    }
  }

  async function saveOperatorRoles() {
    if (!operatorTarget || !operatorReason.trim()) return
    setSaving(true)
    setError('')
    try {
      const selectedIds = resource.data?.roles.items
        .filter((role) => operatorRoles.includes(role.code))
        .map((role) => role.id) ?? []
      await adminApi.access.assignOperatorRoles(
        operatorTarget.id,
        selectedIds,
        operatorReason.trim(),
      )
      setOperatorTarget(null)
      setOperatorReason('')
      await resource.reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '席位角色变更失败')
    } finally {
      setSaving(false)
    }
  }

  function editRole(role: Role | null) {
    setSelectedRole(role)
    setRoleEditorOpen(true)
  }

  function openOperator(operator: Operator) {
    setOperatorTarget(operator)
    setOperatorRoles(operator.roles)
    setOperatorReason('')
  }

  const accessData = resource.data
  return (
    <div className={uiStyles.page}>
      <PageHeader
        eyebrow="ACCESS GOVERNANCE"
        title="团队与权限"
        description="管理席位与主站账号完全分离。最高管理员创建席位，角色矩阵决定成员能看到和执行什么。"
        actions={roleWritable ? <Button icon={<BadgePlus size={17} />} onClick={() => editRole(null)}>创建角色</Button> : undefined}
      />
      <Notice>
        <span>
          当前会话：<strong>{session?.email}</strong> · {session?.roleName}。
          {session?.isOwner ? '你是唯一可创建管理席位的最高管理员。' : '你不能创建管理席位；如需成员加入，请联系最高管理员。'}
        </span>
      </Notice>
      {resource.loading ? <Feedback kind="loading" /> : null}
      {resource.error ? <Feedback kind="error" detail={resource.error} onRetry={resource.reload} /> : null}
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}
      {message ? <FormMessage kind="success">{message}</FormMessage> : null}
      {accessData ? (
        <>
          <Section title="管理席位" meta={`${accessData.operators.total} 位成员`}>
            <TableWrap label="管理席位">
              <thead><tr><th>成员</th><th>角色 / 有效权限</th><th>状态</th><th>最近活动</th><th>操作</th></tr></thead>
              <tbody>
                {accessData.operators.items.map((operator) => {
                  const assignedRoles = accessData.roles.items.filter((role) => operator.roles.includes(role.code))
                  const effectivePermissions = Array.from(new Set(assignedRoles.flatMap((role) => role.permissions)))
                  return (
                    <tr key={operator.id}>
                      <td className={pageStyles.identityCell}><strong>{operator.displayName}</strong><span>{operator.email}</span></td>
                      <td>
                        <strong>{assignedRoles.map((role) => role.name).join('、') || (operator.isOwner ? 'Owner' : '未分配角色')}</strong>
                        <details><summary>{operator.isOwner ? '全部' : effectivePermissions.length} 项有效权限</summary><div>{effectivePermissions.map((permission) => <span className={pageStyles.code} key={permission}>{permission}</span>)}</div></details>
                      </td>
                      <td><StatusBadge status={operator.status} label={operator.isOwner ? '最高管理员' : undefined} /></td>
                      <td>{formatDate(operator.lastLoginAt)}</td>
                      <td>{session?.isOwner && !operator.isOwner ? (
                        <Button variant="quiet" icon={<Power size={16} />} onClick={() => openOperator(operator)}>
                          管理席位
                        </Button>
                      ) : <span className={uiStyles.muted}>{operator.isOwner ? '不可变更' : '只读'}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </TableWrap>
          </Section>

          <div className={pageStyles.split}>
            <Section title="权限角色" meta={`${accessData.roles.total} 个角色`}>
              <TableWrap label="权限角色">
                <thead><tr><th>角色</th><th>成员</th><th>权限</th><th>操作</th></tr></thead>
                <tbody>
                  {accessData.roles.items.map((role) => (
                    <tr key={role.id}>
                      <td><strong>{role.name}</strong><div className={uiStyles.muted}>{role.description}</div></td>
                      <td>{role.memberCount}</td>
                      <td>{role.permissions.length}</td>
                      <td>{roleWritable && !role.system ? <Button variant="quiet" icon={<PencilLine size={16} />} onClick={() => editRole(role)}>配置</Button> : <span className={uiStyles.muted}>{role.system ? '系统角色' : '只读'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Section>
            <Section title="待激活邀请" meta={`${accessData.invitations.total} 封`}>
              {accessData.invitations.items.length === 0 ? <Feedback kind="empty" /> : (
                <ul className={pageStyles.plainList}>
                  {accessData.invitations.items.map((invitation) => (
                    <li className={pageStyles.plainItem} key={invitation.id}>
                      <strong>{invitation.email}</strong> · {invitation.roleName}
                      <div className={uiStyles.muted}>到期 {formatDate(invitation.expiresAt)} · <StatusBadge status={invitation.status} /></div>
                      {session?.isOwner && invitation.status === 'pending' ? <Button variant="quiet" icon={<RefreshCw size={15} />} onClick={() => setResendTarget(invitation)}>重发激活链接</Button> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>

          {session?.isOwner ? (
            <Section title="创建管理席位" meta="仅最高管理员">
              <form className={formStyles.form} onSubmit={sendInvite}>
                <div className={formStyles.grid}>
                  <Field label="受邀邮箱" htmlFor="inviteEmail" required><input className={formStyles.input} id="inviteEmail" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required /></Field>
                  <Field label="成员姓名" htmlFor="inviteName"><input className={formStyles.input} id="inviteName" value={inviteName} onChange={(event) => setInviteName(event.target.value)} /></Field>
                </div>
                <Field label="预设角色" required>
                  <div className={formStyles.checkGrid}>
                    {accessData.roles.items.filter((role) => !role.system || role.name !== 'Owner').map((role) => (
                      <label className={formStyles.checkItem} key={role.id}><input type="checkbox" checked={inviteRoles.includes(role.id)} onChange={() => toggleInviteRole(role.id)} /><span><strong>{role.name}</strong><small>{role.description}</small></span></label>
                    ))}
                  </div>
                </Field>
                <Field label="邀请理由" htmlFor="inviteReason" required><textarea className={formStyles.textarea} id="inviteReason" value={inviteReason} onChange={(event) => setInviteReason(event.target.value)} /></Field>
                <HighRiskReview summary={`向 ${inviteEmail || '待填邮箱'} 发送激活链接，并预设 ${inviteRoles.length} 个角色`} reason={inviteReason} />
                <Button type="submit" icon={<MailPlus size={17} />} disabled={saving || inviteRoles.length === 0 || !inviteReason.trim()}>发送一次性激活链接</Button>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      <RoleEditor open={roleEditorOpen} role={selectedRole} permissions={resource.data?.permissions.items ?? []} onClose={() => setRoleEditorOpen(false)} onSaved={resource.reload} />
      <InvitationResendDrawer
        invitation={resendTarget}
        onClose={() => setResendTarget(null)}
        onSaved={async () => {
          setMessage('激活邮件已重新发送。')
          await resource.reload()
        }}
      />
      <Drawer open={Boolean(operatorTarget)} title="管理成员席位" subtitle={operatorTarget?.email} onClose={() => setOperatorTarget(null)}>
        <Field label="分配角色" required>
          <div className={formStyles.checkGrid}>
            {accessData?.roles.items.filter((role) => role.code !== 'owner').map((role) => (
              <label className={formStyles.checkItem} key={role.id}>
                <input
                  type="checkbox"
                  checked={operatorRoles.includes(role.code)}
                  onChange={() => setOperatorRoles((current) => current.includes(role.code) ? current.filter((code) => code !== role.code) : [...current, role.code])}
                />
                <span><strong>{role.name}</strong><small>{role.description}</small></span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="操作理由" htmlFor="operatorReason" required><textarea className={formStyles.textarea} id="operatorReason" value={operatorReason} onChange={(event) => setOperatorReason(event.target.value)} /></Field>
        <HighRiskReview summary={`更新 ${operatorTarget?.email ?? ''} 的席位状态或 ${operatorRoles.length} 个角色`} reason={operatorReason} />
        <div className={pageStyles.actionStrip}>
          <Button disabled={saving || !operatorReason.trim()} onClick={saveOperatorRoles}>保存角色</Button>
          <Button variant={operatorTarget?.status === 'suspended' ? 'secondary' : 'danger'} disabled={saving || !operatorReason.trim()} onClick={toggleOperator}>
            {operatorTarget?.status === 'suspended' ? '启用席位' : '停用席位'}
          </Button>
        </div>
      </Drawer>
    </div>
  )
}
