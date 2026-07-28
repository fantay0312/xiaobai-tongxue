import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthStore, type AuthField } from '../../store/authStore';
import {
  CODE_RE, EMAIL_RE, MAINLAND_PHONE_RE, mainlandPhoneToE164, mapPasswordIssueField,
  useCooldown, type Issue,
} from '../../hooks/useAuthForm';
import { EmailCodeField } from './EmailCodeField';
import { PhoneCodeField } from './PhoneCodeField';
import fs from './EmailCodeField.module.css';
import s from './login.module.css';

interface PasswordResetFormProps {
  onBusyChange: (busy: boolean) => void;
  onSuccess: () => void;
}

const ID_PREFIX = 'password-reset';
const FEEDBACK_ID = `${ID_PREFIX}-feedback`;
type ResetMethod = 'phone' | 'email';

export function PasswordResetForm({ onBusyChange, onSuccess }: PasswordResetFormProps) {
  const emailAuthAvailable = useAuthStore((state) => state.emailAuthAvailable);
  const smsAuthAvailable = useAuthStore((state) => state.smsAuthAvailable);
  const requestPasswordResetCode = useAuthStore((state) => state.requestPasswordResetCode);
  const resetPassword = useAuthStore((state) => state.resetPassword);
  const requestEmailPasswordResetCode = useAuthStore((state) => state.requestEmailPasswordResetCode);
  const resetPasswordWithEmail = useAuthStore((state) => state.resetPasswordWithEmail);
  const [method, setMethod] = useState<ResetMethod>(
    () => useAuthStore.getState().smsAuthAvailable ? 'phone' : 'email',
  );
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [issue, setIssue] = useState<Issue | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { cooldown, resetCooldown, startCooldown } = useCooldown();
  const operation = useRef(0);
  const busy = sending || resetting;

  useEffect(() => () => { operation.current += 1; }, []);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!issue || issue.field === 'form') return;
    const fieldId: Partial<Record<AuthField, string>> = {
      phone: `${ID_PREFIX}-phone`,
      email: `${ID_PREFIX}-email`,
      code: `${ID_PREFIX}-code`,
      newPassword: `${ID_PREFIX}-new-password`,
      confirmPassword: `${ID_PREFIX}-confirm-password`,
    };
    document.getElementById(fieldId[issue.field] ?? '')?.focus();
  }, [issue]);

  const clearIssue = (field: AuthField) => {
    setIssue((current) => current?.field === field || current?.field === 'form' ? null : current);
  };

  const changePhone = (value: string) => {
    setPhone(value);
    setCode('');
    resetCooldown();
    setFeedback(null);
    setIssue((current) => current?.field === 'phone' || current?.field === 'code'
      || current?.field === 'form' ? null : current);
  };

  const changeEmail = (value: string) => {
    setEmail(value);
    setCode('');
    resetCooldown();
    setFeedback(null);
    setIssue((current) => current?.field === 'email' || current?.field === 'code'
      || current?.field === 'form' ? null : current);
  };

  const switchMethod = (nextMethod: ResetMethod) => {
    if (busy || nextMethod === method) return;
    setMethod(nextMethod);
    setCode('');
    resetCooldown();
    setFeedback(null);
    setIssue(null);
  };

  const sendCode = async () => {
    if (busy || cooldown > 0) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (method === 'phone' && !MAINLAND_PHONE_RE.test(phone)) {
      setIssue({ field: 'phone', message: '请输入中国大陆 11 位手机号' });
      return;
    }
    if (method === 'email' && !EMAIL_RE.test(normalizedEmail)) {
      setIssue({ field: 'email', message: '请输入已验证的有效邮箱地址' });
      return;
    }
    const operationId = ++operation.current;
    setSending(true);
    setIssue(null);
    setFeedback(null);
    const result = method === 'phone'
      ? await requestPasswordResetCode(mainlandPhoneToE164(phone))
      : await requestEmailPasswordResetCode(normalizedEmail);
    if (operationId !== operation.current) return;
    setSending(false);
    if (!result.ok) {
      setIssue({
        field: mapPasswordIssueField(result.field),
        message: result.message ?? '验证码发送失败，请稍后再试',
      });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    startCooldown(Math.max(60, result.retryAfter ?? 60));
    setFeedback(method === 'phone'
      ? '若该手机号已绑定账号，验证码会发送至手机，请在十分钟内完成重设'
      : '若该邮箱已验证，验证码会发送至邮箱，请在十分钟内完成重设');
  };

  const submitReset = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const normalizedEmail = email.trim().toLowerCase();
    let localIssue: Issue | null = null;
    if (method === 'phone' && !MAINLAND_PHONE_RE.test(phone)) {
      localIssue = { field: 'phone', message: '请输入中国大陆 11 位手机号' };
    } else if (method === 'email' && !EMAIL_RE.test(normalizedEmail)) {
      localIssue = { field: 'email', message: '请输入已验证的有效邮箱地址' };
    } else if (!CODE_RE.test(code)) {
      localIssue = {
        field: 'code',
        message: `请输入${method === 'phone' ? '短信' : '邮件'}中的 6 位验证码`,
      };
    }
    else if (newPassword.length < 8) localIssue = { field: 'newPassword', message: '新密码至少需要 8 位' };
    else if (newPassword.length > 128) localIssue = { field: 'newPassword', message: '新密码不能超过 128 位' };
    else if (confirmPassword !== newPassword) {
      localIssue = { field: 'confirmPassword', message: '两次输入的新密码不一致' };
    }
    if (localIssue) {
      setIssue(localIssue);
      setFeedback(null);
      return;
    }
    const operationId = ++operation.current;
    setResetting(true);
    setIssue(null);
    setFeedback(null);
    const result = method === 'phone'
      ? await resetPassword(mainlandPhoneToE164(phone), code, newPassword)
      : await resetPasswordWithEmail(normalizedEmail, code, newPassword);
    if (operationId !== operation.current) return;
    setResetting(false);
    if (!result.ok) {
      setIssue({
        field: mapPasswordIssueField(result.field),
        message: result.message ?? '密码重设失败，请稍后再试',
      });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    setNewPassword('');
    setConfirmPassword('');
    onSuccess();
  };

  return (
    <form className={s.fields} id="password-reset-form" noValidate aria-busy={busy} onSubmit={submitReset}>
      {smsAuthAvailable && emailAuthAvailable ? (
        <div className={s.loginMethods} role="group" aria-label="密码找回方式">
          <button type="button" className={s.methodSwitch} disabled={busy}
            aria-pressed={method === 'phone'} onClick={() => switchMethod('phone')}>
            手机验证（优先）
          </button>
          <button type="button" className={s.methodSwitch} disabled={busy}
            aria-pressed={method === 'email'} onClick={() => switchMethod('email')}>
            已验证邮箱
          </button>
        </div>
      ) : null}
      <fieldset className={s.fieldset} disabled={busy}>
        {method === 'phone' ? <PhoneCodeField
          phone={phone}
          code={code}
          issueField={issue?.field}
          sending={sending}
          cooldown={cooldown}
          idPrefix={ID_PREFIX}
          feedbackId={FEEDBACK_ID}
          phoneLabel="已绑定手机号"
          autoFocusPhone
          onPhoneChange={changePhone}
          onCodeChange={(value) => { setCode(value); clearIssue('code'); }}
          onSend={() => void sendCode()}
        /> : <EmailCodeField
          email={email}
          code={code}
          issueField={issue?.field}
          sending={sending}
          cooldown={cooldown}
          idPrefix={ID_PREFIX}
          feedbackId={FEEDBACK_ID}
          emailLabel="已验证邮箱"
          autoFocusEmail
          onEmailChange={changeEmail}
          onCodeChange={(value) => { setCode(value); clearIssue('code'); }}
          onSend={() => void sendCode()}
        />}
        <label className={fs.field} htmlFor={`${ID_PREFIX}-new-password`}>
          <span className={fs.label}>新密码</span>
          <input
            id={`${ID_PREFIX}-new-password`}
            className={fs.input}
            type="password"
            value={newPassword}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            aria-invalid={issue?.field === 'newPassword' || undefined}
            aria-describedby={issue?.field === 'newPassword' ? FEEDBACK_ID : `${ID_PREFIX}-password-hint`}
            onChange={(event) => { setNewPassword(event.target.value); clearIssue('newPassword'); }}
          />
          <span className={fs.hint} id={`${ID_PREFIX}-password-hint`}>至少 8 位；重设成功后会自动登录</span>
        </label>
        <label className={fs.field} htmlFor={`${ID_PREFIX}-confirm-password`}>
          <span className={fs.label}>再次输入新密码</span>
          <input
            id={`${ID_PREFIX}-confirm-password`}
            className={fs.input}
            type="password"
            value={confirmPassword}
            autoComplete="new-password"
            maxLength={128}
            required
            aria-invalid={issue?.field === 'confirmPassword' || undefined}
            aria-describedby={issue?.field === 'confirmPassword' ? FEEDBACK_ID : undefined}
            onChange={(event) => { setConfirmPassword(event.target.value); clearIssue('confirmPassword'); }}
          />
        </label>
      </fieldset>

      <div className={s.feedbackSlot}>
        {issue ? <p className={s.error} id={FEEDBACK_ID} role="alert">{issue.message}</p>
          : feedback ? <p className={s.success} role="status">{feedback}</p> : null}
      </div>
      <button className={s.submit} type="submit" data-busy={busy || undefined} disabled={busy}>
        {resetting ? '正在重设…' : '验证并重设密码'}
      </button>
    </form>
  );
}
