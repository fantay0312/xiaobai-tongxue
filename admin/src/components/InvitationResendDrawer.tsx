import { useEffect, useState, type FormEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { adminApi } from '../lib/api'
import type { Invitation } from '../types/admin'
import { Drawer } from './Drawer'
import { Field, FormMessage, HighRiskReview, formStyles } from './forms'
import { Button } from './ui'

interface InvitationResendDrawerProps {
  invitation: Invitation | null
  onClose: () => void
  onSaved: () => Promise<void>
}

export function InvitationResendDrawer({
  invitation,
  onClose,
  onSaved,
}: InvitationResendDrawerProps) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setReason('')
    setError('')
  }, [invitation])

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!invitation || !reason.trim()) return
    setSaving(true)
    setError('')
    try {
      await adminApi.access.resendInvitation(invitation.id, reason.trim())
      await onSaved()
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '重发失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={Boolean(invitation)}
      title="重发激活链接"
      subtitle={invitation?.email}
      onClose={onClose}
    >
      <form className={formStyles.form} onSubmit={resend}>
        <Field label="重发理由" htmlFor="resendReason" required>
          <textarea
            className={formStyles.textarea}
            id="resendReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            required
          />
        </Field>
        <HighRiskReview
          summary={`向 ${invitation?.email ?? ''} 重新发送一次性激活链接`}
          reason={reason}
        />
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Button
          type="submit"
          icon={<RefreshCw size={16} />}
          disabled={saving || !reason.trim()}
        >
          重新发送
        </Button>
      </form>
    </Drawer>
  )
}
