import type { AuthField } from '../../store/authStore';
import fs from './EmailCodeField.module.css';

interface EmailCodeFieldProps {
  email: string;
  code: string;
  issueField?: AuthField;
  sending: boolean;
  cooldown: number;
  idPrefix?: string;
  feedbackId?: string;
  emailLabel?: string;
  autoFocusEmail?: boolean;
  onEmailChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSend: () => void;
}

const feedbackFor = (field: AuthField, issueField: AuthField | undefined, feedbackId: string) =>
  field === issueField ? feedbackId : undefined;

export function EmailCodeField({
  email, code, issueField, sending, cooldown,
  idPrefix = 'auth', feedbackId = 'auth-feedback', emailLabel = '邮箱', autoFocusEmail = false,
  onEmailChange, onCodeChange, onSend,
}: EmailCodeFieldProps) {
  const emailId = `${idPrefix}-email`;
  const codeId = `${idPrefix}-code`;
  const codeHintId = `${idPrefix}-code-hint`;
  const sendLabel = sending ? '正在发送…' : cooldown > 0 ? `${cooldown} 秒后重发` : '获取验证码';
  const codeDescribedBy = [feedbackFor('code', issueField, feedbackId), codeHintId].filter(Boolean).join(' ');

  return (
    <>
      <label className={fs.field} htmlFor={emailId}>
        <span className={fs.label}>{emailLabel}</span>
        <input
          id={emailId}
          className={fs.input}
          type="email"
          value={email}
          autoFocus={autoFocusEmail}
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={254}
          required
          disabled={sending}
          aria-invalid={issueField === 'email' || undefined}
          aria-describedby={feedbackFor('email', issueField, feedbackId)}
          onChange={(event) => onEmailChange(event.target.value)}
        />
      </label>
      <div className={fs.field}>
        <label className={fs.label} htmlFor={codeId}>邮箱验证码</label>
        <div className={fs.codeRow}>
          <input
            id={codeId}
            className={fs.input}
            type="text"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            aria-invalid={issueField === 'code' || undefined}
            aria-describedby={codeDescribedBy}
            onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <button
            type="button"
            className={fs.sendCode}
            disabled={sending || cooldown > 0}
            aria-describedby={codeHintId}
            onClick={onSend}
          >
            {sendLabel}
          </button>
        </div>
        <span className={fs.hint} id={codeHintId}>6 位数字，十分钟内有效</span>
      </div>
    </>
  );
}
