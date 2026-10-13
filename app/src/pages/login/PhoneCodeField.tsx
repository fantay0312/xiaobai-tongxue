import { Smartphone } from 'lucide-react';
import { Field, Input } from '../../components/ui';
import type { AuthField } from '../../store/authStore';
import { joinIds, normalizeMainlandPhoneInput } from '../../hooks/useAuthForm';
import { CodeField, IssueText } from './fields';
import fs from './EmailCodeField.module.css';

interface PhoneCodeFieldProps {
  phone: string;
  code: string;
  issueField?: AuthField;
  /** 传入后，手机号或验证码出错时文案就显示在该字段下方；不传则只标红，由外层提示行说明 */
  issueMessage?: string;
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

export function PhoneCodeField({
  phone, code, issueField, issueMessage, sending, cooldown,
  idPrefix = 'auth', feedbackId = 'auth-feedback', phoneLabel = '手机号',
  autoFocusPhone = false, disabled = false,
  onPhoneChange, onCodeChange, onSend,
}: PhoneCodeFieldProps) {
  const phoneId = `${idPrefix}-phone`;
  const phoneHintId = `${idPrefix}-phone-hint`;
  const phoneInvalid = issueField === 'phone';
  const phoneInline = phoneInvalid && Boolean(issueMessage);

  return (
    <>
      <Field
        label={phoneLabel}
        htmlFor={phoneId}
        hint={<span id={phoneHintId}>仅支持中国大陆 11 位手机号</span>}
        error={phoneInline ? <IssueText id={feedbackId}>{issueMessage}</IssueText> : undefined}
      >
        <Input
          id={phoneId}
          wrapClassName={fs.wrap}
          className={fs.autofill}
          type="tel"
          value={phone}
          autoFocus={autoFocusPhone}
          autoComplete="tel-national"
          inputMode="numeric"
          pattern="1[3-9][0-9]{9}"
          maxLength={11}
          required
          disabled={disabled || sending}
          invalid={phoneInvalid}
          placeholder="11 位手机号"
          leading={(
            <>
              <Smartphone size={16} strokeWidth={1.75} />
              <span className={fs.dialCode} aria-hidden="true">+86</span>
            </>
          )}
          aria-describedby={joinIds(phoneInvalid && feedbackId, !phoneInline && phoneHintId)}
          aria-label={`${phoneLabel}，中国大陆`}
          onChange={(event) => onPhoneChange(normalizeMainlandPhoneInput(event.target.value))}
        />
      </Field>
      <CodeField
        id={`${idPrefix}-code`}
        label="手机验证码"
        code={code}
        invalid={issueField === 'code'}
        issueMessage={issueMessage}
        feedbackId={feedbackId}
        sending={sending}
        cooldown={cooldown}
        disabled={disabled}
        onCodeChange={onCodeChange}
        onSend={onSend}
      />
    </>
  );
}
