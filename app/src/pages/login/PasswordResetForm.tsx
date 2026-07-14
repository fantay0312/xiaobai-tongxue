import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthStore, type AuthField } from '../../store/authStore';
import { EmailCodeField } from './EmailCodeField';
import fs from './EmailCodeField.module.css';
import s from './login.module.css';

interface PasswordResetFormProps {
  onBusyChange: (busy: boolean) => void;
  onSuccess: () => void;
}

type Issue = { field: AuthField; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;
const ID_PREFIX = 'password-reset';
const FEEDBACK_ID = `${ID_PREFIX}-feedback`;

function resetIssueField(field: AuthField | undefined): AuthField {
  return field === 'password' ? 'newPassword' : field ?? 'form';
}

export function PasswordResetForm({ onBusyChange, onSuccess }: PasswordResetFormProps) {
  const requestPasswordResetCode = useAuthStore((state) => state.requestPasswordResetCode);
  const resetPassword = useAuthStore((state) => state.resetPassword);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [issue, setIssue] = useState<Issue | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const operation = useRef(0);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - clock) / 1000));
  const busy = sending || resetting;

  useEffect(() => {
    if (cooldownUntil <= clock) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(1000, cooldownUntil - clock));
    return () => window.clearTimeout(timer);
  }, [clock, cooldownUntil]);

  useEffect(() => () => { operation.current += 1; }, []);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    if (!issue || issue.field === 'form') return;
    const fieldId: Partial<Record<AuthField, string>> = {
      email: `${ID_PREFIX}-email`,
      code: `${ID_PREFIX}-code`,
      newPassword: `${ID_PREFIX}-new-password`,
      confirmPassword: `${ID_PREFIX}-confirm-password`,
    };
    document.getElementById(fieldId[issue.field] ?? '')?.focus();
  }, [issue]);

  const startCooldown = (seconds: number) => {
    const now = Date.now();
    setClock(now);
    setCooldownUntil(now + Math.max(0, seconds) * 1000);
  };

  const clearIssue = (field: AuthField) => {
    setIssue((current) => current?.field === field || current?.field === 'form' ? null : current);
  };

  const changeEmail = (value: string) => {
    setEmail(value);
    setCode('');
    setCooldownUntil(0);
    setFeedback(null);
    setIssue((current) => current?.field === 'email' || current?.field === 'code'
      || current?.field === 'form' ? null : current);
  };

  const sendCode = async () => {
    if (busy || cooldown > 0) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      setIssue({ field: 'email', message: '请输入用于注册的有效邮箱地址' });
      return;
    }
    const operationId = ++operation.current;
    setSending(true);
    setIssue(null);
    setFeedback(null);
    const result = await requestPasswordResetCode(normalizedEmail);
    if (operationId !== operation.current) return;
    setSending(false);
    if (!result.ok) {
      setIssue({
        field: resetIssueField(result.field),
        message: result.message ?? '验证码发送失败，请稍后再试',
      });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    startCooldown(Math.max(60, result.retryAfter ?? 60));
    setFeedback('若该邮箱已绑定账号，验证码会发送至邮箱，请在十分钟内完成重设');
  };

  const submitReset = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const normalizedEmail = email.trim().toLowerCase();
    let localIssue: Issue | null = null;
    if (!EMAIL_RE.test(normalizedEmail)) localIssue = { field: 'email', message: '请输入有效的邮箱地址' };
    else if (!CODE_RE.test(code)) localIssue = { field: 'code', message: '请输入邮件中的 6 位验证码' };
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
    const result = await resetPassword(normalizedEmail, code, newPassword);
    if (operationId !== operation.current) return;
    setResetting(false);
    if (!result.ok) {
      setIssue({
        field: resetIssueField(result.field),
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
      <fieldset className={s.fieldset} disabled={busy}>
        <EmailCodeField
          email={email}
          code={code}
          issueField={issue?.field}
          sending={sending}
          cooldown={cooldown}
          idPrefix={ID_PREFIX}
          feedbackId={FEEDBACK_ID}
          emailLabel="注册邮箱"
          autoFocusEmail
          onEmailChange={changeEmail}
          onCodeChange={(value) => { setCode(value); clearIssue('code'); }}
          onSend={() => void sendCode()}
        />
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
