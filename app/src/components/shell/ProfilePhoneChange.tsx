import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PhoneCodeField } from '../../pages/login/PhoneCodeField';
import {
  CODE_RE, MAINLAND_PHONE_RE, mainlandPhoneToE164, useCooldown, type Issue,
} from '../../hooks/useAuthForm';
import { useAuthStore } from '../../store/authStore';
import {
  ProfileCredentialFlow,
  ProfileIdentityVerification,
} from './ProfileCredentialFlow';
import styles from './ProfileCredentialFlow.module.css';

interface ProfilePhoneChangeProps {
  currentCredential: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const ID_PREFIX = 'profile-phone-change';
const FEEDBACK_ID = `${ID_PREFIX}-feedback`;

export function ProfilePhoneChange({
  currentCredential, onCancel, onSuccess,
}: ProfilePhoneChangeProps) {
  const requestPhoneChangeCode = useAuthStore((state) => state.requestPhoneChangeCode);
  const changePhone = useAuthStore((state) => state.changePhone);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
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
    const target = issue.field === 'phone' ? `${ID_PREFIX}-phone` : `${ID_PREFIX}-code`;
    document.getElementById(target)?.focus();
  }, [issue]);

  const changeDraftPhone = (value: string) => {
    setPhone(value);
    setCode('');
    resetCooldown();
    setFeedback(null);
    setIssue((current) => current?.field === 'phone' || current?.field === 'code'
      || current?.field === 'form' ? null : current);
  };

  const validateIdentity = (): Issue | null => {
    if (!MAINLAND_PHONE_RE.test(phone)) {
      return { field: 'phone', message: '请输入中国大陆 11 位新手机号' };
    }
    return null;
  };

  const sendCode = async () => {
    if (busy || cooldown > 0) return;
    const localIssue = validateIdentity();
    if (localIssue) {
      setIssue(localIssue);
      return;
    }
    if (!verificationToken) return;
    const operationId = ++operation.current;
    setSending(true);
    setIssue(null);
    setFeedback(null);
    const result = await requestPhoneChangeCode(mainlandPhoneToE164(phone), verificationToken);
    if (operationId !== operation.current) return;
    setSending(false);
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '验证码发送失败，请稍后再试' });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    startCooldown(Math.max(60, result.retryAfter ?? 60));
    setFeedback('短信验证码已发送，请在十分钟内完成换绑');
  };

  const submitChange = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const localIssue = validateIdentity();
    if (localIssue) {
      setIssue(localIssue);
      return;
    }
    if (!CODE_RE.test(code)) {
      setIssue({ field: 'code', message: '请输入短信中的 6 位验证码' });
      return;
    }
    if (!verificationToken) return;
    const operationId = ++operation.current;
    setChanging(true);
    setIssue(null);
    setFeedback(null);
    const result = await changePhone(mainlandPhoneToE164(phone), code, verificationToken);
    if (operationId !== operation.current) return;
    setChanging(false);
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '手机号换绑失败，请稍后再试' });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    onSuccess();
  };

  if (!verificationToken) {
    return (
      <ProfileCredentialFlow action="change-phone" step={1} onBack={onCancel}>
        <ProfileIdentityVerification
          action="change-phone"
          currentCredential={currentCredential}
          onVerified={setVerificationToken}
        />
      </ProfileCredentialFlow>
    );
  }

  return (
    <ProfileCredentialFlow action="change-phone" step={2} onBack={onCancel}>
      <div className={styles.stage} id={ID_PREFIX}>
        <header className={styles.stageHead}>
          <p className={styles.typeLabel}>NEW CREDENTIAL</p>
          <h3>设置新的验证手机号</h3>
          <p>验证码通过后，新手机号会立即用于验证码登录与密码找回。</p>
        </header>
      <form className={styles.form} noValidate aria-busy={busy} onSubmit={submitChange}>
        <fieldset className={styles.fieldset} disabled={busy}>
          <PhoneCodeField
            phone={phone}
            code={code}
            issueField={issue?.field}
            sending={sending}
            cooldown={cooldown}
            idPrefix={ID_PREFIX}
            feedbackId={FEEDBACK_ID}
            phoneLabel="新手机号"
            onPhoneChange={changeDraftPhone}
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
            {changing ? '正在更换…' : '确认更换手机号'}
          </button>
        </div>
      </form>
      </div>
    </ProfileCredentialFlow>
  );
}
