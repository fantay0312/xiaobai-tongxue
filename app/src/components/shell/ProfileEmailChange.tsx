import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EmailCodeField } from '../../pages/login/EmailCodeField';
import fieldStyles from '../../pages/login/EmailCodeField.module.css';
import { useAuthStore, type AuthField } from '../../store/authStore';
import styles from './ProfileEmailChange.module.css';

interface ProfileEmailChangeProps {
  onCancel: () => void;
  onSuccess: () => void;
}

type Issue = { field: AuthField; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;
const ID_PREFIX = 'profile-email-change';
const FEEDBACK_ID = `${ID_PREFIX}-feedback`;

export function ProfileEmailChange({ onCancel, onSuccess }: ProfileEmailChangeProps) {
  const requestEmailChangeCode = useAuthStore((state) => state.requestEmailChangeCode);
  const changeEmail = useAuthStore((state) => state.changeEmail);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [issue, setIssue] = useState<Issue | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [changing, setChanging] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const operation = useRef(0);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - clock) / 1000));
  const busy = sending || changing;

  useEffect(() => {
    if (cooldownUntil <= clock) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(1000, cooldownUntil - clock));
    return () => window.clearTimeout(timer);
  }, [clock, cooldownUntil]);

  useEffect(() => () => { operation.current += 1; }, []);

  useEffect(() => {
    if (!issue || issue.field === 'form') return;
    const target = issue.field === 'currentPassword' ? `${ID_PREFIX}-current-password`
      : issue.field === 'email' ? `${ID_PREFIX}-email` : `${ID_PREFIX}-code`;
    document.getElementById(target)?.focus();
  }, [issue]);

  const startCooldown = (seconds: number) => {
    const now = Date.now();
    setClock(now);
    setCooldownUntil(now + Math.max(0, seconds) * 1000);
  };

  const changeDraftEmail = (value: string) => {
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
      setIssue({ field: 'email', message: '请输入有效的新邮箱地址' });
      return;
    }
    if (!currentPassword) {
      setIssue({ field: 'currentPassword', message: '请输入当前密码以确认身份' });
      return;
    }
    if (currentPassword.length > 128) {
      setIssue({ field: 'currentPassword', message: '当前密码不能超过 128 位' });
      return;
    }
    const operationId = ++operation.current;
    setSending(true);
    setIssue(null);
    setFeedback(null);
    const result = await requestEmailChangeCode(normalizedEmail, currentPassword);
    if (operationId !== operation.current) return;
    setSending(false);
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '验证码发送失败，请稍后再试' });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    startCooldown(Math.max(60, result.retryAfter ?? 60));
    setFeedback('验证码已发送，请在十分钟内完成验证');
  };

  const submitChange = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail)) {
      setIssue({ field: 'email', message: '请输入有效的新邮箱地址' });
      return;
    }
    if (!CODE_RE.test(code)) {
      setIssue({ field: 'code', message: '请输入邮件中的 6 位验证码' });
      return;
    }
    if (!currentPassword) {
      setIssue({ field: 'currentPassword', message: '请输入当前密码以确认身份' });
      return;
    }
    const operationId = ++operation.current;
    setChanging(true);
    setIssue(null);
    setFeedback(null);
    const result = await changeEmail(normalizedEmail, code, currentPassword);
    if (operationId !== operation.current) return;
    setChanging(false);
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '邮箱更换失败，请稍后再试' });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    onSuccess();
  };

  return (
    <section className={styles.editor} id={ID_PREFIX} aria-labelledby={`${ID_PREFIX}-title`}>
      <header className={styles.head}>
        <div>
          <h4 className={styles.title} id={`${ID_PREFIX}-title`}>更换验证邮箱</h4>
          <p className={styles.copy}>先用当前密码确认身份；验证成功后，新邮箱将用于登录与账号验证。</p>
        </div>
      </header>
      <form className={styles.form} noValidate aria-busy={busy} onSubmit={submitChange}>
        <fieldset className={styles.fieldset} disabled={busy}>
          <label className={fieldStyles.field} htmlFor={`${ID_PREFIX}-current-password`}>
            <span className={fieldStyles.label}>当前密码</span>
            <input
              id={`${ID_PREFIX}-current-password`}
              className={fieldStyles.input}
              type="password"
              value={currentPassword}
              autoFocus
              autoComplete="current-password"
              maxLength={128}
              required
              aria-invalid={issue?.field === 'currentPassword' || undefined}
              aria-describedby={issue?.field === 'currentPassword' ? FEEDBACK_ID : `${ID_PREFIX}-password-hint`}
              onChange={(event) => {
                setCurrentPassword(event.target.value);
                setIssue((current) => current?.field === 'currentPassword' || current?.field === 'form'
                  ? null : current);
              }}
            />
            <span className={fieldStyles.hint} id={`${ID_PREFIX}-password-hint`}>发码与换绑前都需要再次确认</span>
          </label>
          <EmailCodeField
            email={email}
            code={code}
            issueField={issue?.field}
            sending={sending}
            cooldown={cooldown}
            idPrefix={ID_PREFIX}
            feedbackId={FEEDBACK_ID}
            emailLabel="新邮箱"
            onEmailChange={changeDraftEmail}
            onCodeChange={(value) => {
              setCode(value);
              setIssue((current) => current?.field === 'code' || current?.field === 'form' ? null : current);
            }}
            onSend={() => void sendCode()}
          />
        </fieldset>
        {issue ? <p className={styles.error} id={FEEDBACK_ID} role="alert">{issue.message}</p>
          : feedback ? <p className={styles.success} role="status">{feedback}</p> : null}
        <div className={styles.actions}>
          <button className={styles.cancel} type="button" disabled={busy} onClick={onCancel}>取消</button>
          <button className={styles.confirm} type="submit" disabled={busy}>
            {changing ? '正在核验…' : '确认换绑'}
          </button>
        </div>
      </form>
    </section>
  );
}
