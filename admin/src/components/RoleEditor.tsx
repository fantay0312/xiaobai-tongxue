import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { adminApi } from '../lib/api'
import type { PermissionDefinition, Role } from '../types/admin'
import { Drawer } from './Drawer'
import { Field, FormMessage, HighRiskReview, formStyles } from './forms'
import { Button, Notice, uiStyles } from './ui'
import pageStyles from '../styles/Page.module.css'

interface RoleEditorProps {
  open: boolean
  role: Role | null
  permissions: PermissionDefinition[]
  onClose: () => void
  onSaved: () => Promise<void>
}

export function RoleEditor({ open, role, permissions, onClose, onSaved }: RoleEditorProps) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const groups = useMemo(
    () => Array.from(new Set(permissions.map((permission) => permission.group))),
    [permissions],
  )

  useEffect(() => {
    setCode(role?.code ?? '')
    setName(role?.name ?? '')
    setDescription(role?.description ?? '')
    setSelected(role?.permissions ?? [])
    setReason('')
    setError('')
    setMessage('')
  }, [role, open])

  function togglePermission(key: string) {
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    )
  }

  async function saveRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason.trim()) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      if (role) {
        await adminApi.access.updateRole(role.id, {
          name: name.trim(),
          description: description.trim(),
          permissionKeys: selected,
          version: role.version,
          reason: reason.trim(),
        })
      } else {
        await adminApi.access.createRole({
          code: code.trim().toLowerCase(),
          name: name.trim(),
          description: description.trim(),
          permissionKeys: selected,
          reason: reason.trim(),
        })
      }
      setMessage(role ? '角色权限已更新。' : '角色已创建。')
      await onSaved()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '角色保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null
  return (
    <Drawer
      open
      title={role ? `编辑角色 · ${role.name}` : '创建权限角色'}
      subtitle={role?.system ? 'SYSTEM ROLE' : 'CUSTOM ROLE'}
      onClose={onClose}
    >
      <Notice>
        <span><strong>最小权限原则：</strong>只勾选完成岗位职责所必需的权限。最高管理员专属权限永不进入自定义角色。</span>
      </Notice>
      <form className={formStyles.form} onSubmit={saveRole}>
        <div className={formStyles.grid}>
          <Field label="角色编码" htmlFor="roleCode" required>
            <input className={formStyles.input} id="roleCode" value={code} onChange={(event) => setCode(event.target.value.toLowerCase())} disabled={Boolean(role)} pattern="[a-z][a-z0-9._-]+" required />
          </Field>
          <Field label="角色名称" htmlFor="roleName" required>
            <input className={formStyles.input} id="roleName" value={name} onChange={(event) => setName(event.target.value)} disabled={role?.system} required />
          </Field>
          <Field label="角色说明" htmlFor="roleDescription" required>
            <input className={formStyles.input} id="roleDescription" value={description} onChange={(event) => setDescription(event.target.value)} required />
          </Field>
        </div>
        <div className={uiStyles.tableWrap}>
          <table className={pageStyles.matrix}>
            <thead><tr><th>权限组</th><th>权限</th><th>说明</th><th>授予</th></tr></thead>
            <tbody>
              {groups.flatMap((group) =>
                permissions.filter((permission) => permission.group === group).map((permission, index) => (
                  <tr key={permission.key}>
                    <td>{index === 0 ? group : ''}</td>
                    <td><span className={pageStyles.code}>{permission.key}</span></td>
                    <td><strong>{permission.name}</strong><div>{permission.description}</div></td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`授予 ${permission.name}`}
                        checked={selected.includes(permission.key)}
                        disabled={permission.ownerOnly}
                        onChange={() => togglePermission(permission.key)}
                      />
                      {permission.ownerOnly ? <span className={formStyles.hint}> Owner</span> : null}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <Field label="变更理由" htmlFor="roleReason" required>
          <textarea className={formStyles.textarea} id="roleReason" value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <HighRiskReview
          summary={`${role ? '更新' : '创建'}角色「${name || '未命名'}」，授予 ${selected.length} 项权限`}
          reason={reason}
        />
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        {message ? <FormMessage kind="success">{message}</FormMessage> : null}
        <Button type="submit" icon={<Save size={17} />} disabled={saving || !code.trim() || !name.trim() || !reason.trim()}>
          保存角色权限
        </Button>
      </form>
    </Drawer>
  )
}
