import type { AuthField } from '../../store/authStore';
import { normalizeMainlandPhoneInput } from '../../hooks/useAuthForm';
import fs from './EmailCodeField.module.css';

interface PhoneCodeFieldProps {
  phone: string;
  code: string;
  issueField?: AuthField;
  sending: boolean;
  cooldown: number;
  idPrefix?: string;
  feedbackId?: string;
  phoneLabel?: string;
  autoFocusPhone?: boolean;
  disabled?: boolean;
  onPhoneChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSend: () => void;
}

const feedbackFor = (field: AuthField, issueField: AuthField | undefined, feedbackId: string) =>
  field === issueField ? feedbackId : undefined;

export function PhoneCodeField({
  phone, code, issueField, sending, cooldown,
  idPrefix = 'auth', feedbackId = 'auth-feedback', phoneLabel = '手机号',
  autoFocusPhone = false, disabled = false,
  onPhoneChange, onCodeChange, onSend,
}: PhoneCodeFieldProps) {
  const phoneId = `${idPrefix}-phone`;
  const codeId = `${idPrefix}-code`;
  const phoneHintId = `${idPrefix}-phone-hint`;
  const codeHintId = `${idPrefix}-code-hint`;
  const sendLabel = sending ? '正在发送…' : cooldown > 0 ? `${cooldown} 秒后重发` : '获取验证码';
  const phoneDescribedBy = [
    feedbackFor('phone', issueField, feedbackId),
    phoneHintId,
  ].filter(Boolean).join(' ');
  const codeDescribedBy = [
    feedbackFor('code', issueField, feedbackId),
    codeHintId,
  ].filter(Boolean).join(' ');

  return (
    <>
      <label className={fs.field} htmlFor={phoneId}>
        <span className={fs.label}>{phoneLabel}</span>
        <span className={fs.phoneRow}>
          <span className={fs.dialCode} aria-hidden="true">+86</span>
          <input
            id={phoneId}
            className={fs.input}
            type="tel"
            value={phone}
            autoFocus={autoFocusPhone}
            autoComplete="tel-national"
            inputMode="numeric"
            pattern="1[3-9][0-9]{9}"
            maxLength={11}
            required
            disabled={disabled || sending}
            aria-invalid={issueField === 'phone' || undefined}
            aria-describedby={phoneDescribedBy}
            aria-label={`${phoneLabel}，中国大陆`}
            onChange={(event) => onPhoneChange(normalizeMainlandPhoneInput(event.target.value))}
          />
        </span>
        <span className={fs.hint} id={phoneHintId}>仅支持中国大陆 11 位手机号</span>
      </label>
      <div className={fs.field}>
        <label className={fs.label} htmlFor={codeId}>手机验证码</label>
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
            disabled={disabled}
            aria-invalid={issueField === 'code' || undefined}
            aria-describedby={codeDescribedBy}
            onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <button
            type="button"
            className={fs.sendCode}
            disabled={disabled || sending || cooldown > 0}
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
