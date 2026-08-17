import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EmailCodeField } from '../../pages/login/EmailCodeField';
import { CODE_RE, EMAIL_RE, useCooldown, type Issue } from '../../hooks/useAuthForm';
import { useAuthStore } from '../../store/authStore';
import {
  ProfileCredentialFlow,
  ProfileIdentityVerification,
} from './ProfileCredentialFlow';
import styles from './ProfileCredentialFlow.module.css';

interface ProfileEmailChangeProps {
  currentCredential: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const ID_PREFIX = 'profile-email-change';
const FEEDBACK_ID = `${ID_PREFIX}-feedback`;

export function ProfileEmailChange({
  currentCredential, onCancel, onSuccess,
}: ProfileEmailChangeProps) {
  const requestEmailChangeCode = useAuthStore((state) => state.requestEmailChangeCode);
  const changeEmail = useAuthStore((state) => state.changeEmail);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [issue, setIssue] = useState<Issue | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [changing, setChanging] = useState(false);
  const { cooldown, resetCooldown, startCooldown } = useCooldown();
  const operation = useRef(0);
  const busy = sending || changing;

  useEffect(() => () => { operation.current += 1; }, []);

  useEffect(() => {
    if (!issue || issue.field === 'form') return;
    const target = issue.field === 'email' ? `${ID_PREFIX}-email` : `${ID_PREFIX}-code`;
    document.getElementById(target)?.focus();
  }, [issue]);

  const changeDraftEmail = (value: string) => {
    setEmail(value);
    setCode('');
    resetCooldown();
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
    if (!verificationToken) return;
    const operationId = ++operation.current;
    setSending(true);
    setIssue(null);
    setFeedback(null);
    const result = await requestEmailChangeCode(normalizedEmail, verificationToken);
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
    if (!verificationToken) return;
    const operationId = ++operation.current;
    setChanging(true);
    setIssue(null);
    setFeedback(null);
    const result = await changeEmail(normalizedEmail, code, verificationToken);
    if (operationId !== operation.current) return;
    setChanging(false);
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '邮箱更换失败，请稍后再试' });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    onSuccess();
  };

  if (!verificationToken) {
    return (
      <ProfileCredentialFlow action="change-email" step={1} onBack={onCancel}>
        <ProfileIdentityVerification
          action="change-email"
          currentCredential={currentCredential}
          onVerified={setVerificationToken}
        />
      </ProfileCredentialFlow>
    );
  }

  return (
    <ProfileCredentialFlow action="change-email" step={2} onBack={onCancel}>
      <div className={styles.stage} id={ID_PREFIX}>
        <header className={styles.stageHead}>
          <p className={styles.typeLabel}>NEW CREDENTIAL</p>
          <h3>设置新的验证邮箱</h3>
          <p>验证码通过后，新邮箱会立即接替当前邮箱，用于登录与账号找回。</p>
        </header>
      <form className={styles.form} noValidate aria-busy={busy} onSubmit={submitChange}>
        <fieldset className={styles.fieldset} disabled={busy}>
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
          <button
            className={styles.secondary}
            type="button"
            disabled={busy}
            onClick={() => { setVerificationToken(null); setIssue(null); setFeedback(null); }}
          >
            重新验证
          </button>
          <button className={styles.primary} type="submit" disabled={busy}>
            {changing ? '正在更换…' : '确认更换邮箱'}
          </button>
        </div>
      </form>
      </div>
    </ProfileCredentialFlow>
  );
}
