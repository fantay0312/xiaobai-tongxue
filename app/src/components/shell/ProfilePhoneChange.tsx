import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PhoneCodeField } from '../../pages/login/PhoneCodeField';
import fieldStyles from '../../pages/login/EmailCodeField.module.css';
import {
  CODE_RE, MAINLAND_PHONE_RE, mainlandPhoneToE164, useCooldown, type Issue,
} from '../../hooks/useAuthForm';
import { useAuthStore } from '../../store/authStore';
import styles from './ProfileEmailChange.module.css';

interface ProfilePhoneChangeProps {
  onCancel: () => void;
  onSuccess: () => void;
}

const ID_PREFIX = 'profile-phone-change';
const FEEDBACK_ID = `${ID_PREFIX}-feedback`;

export function ProfilePhoneChange({ onCancel, onSuccess }: ProfilePhoneChangeProps) {
  const requestPhoneBindingCode = useAuthStore((state) => state.requestPhoneBindingCode);
  const bindPhone = useAuthStore((state) => state.bindPhone);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
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
    const target = issue.field === 'currentPassword' ? `${ID_PREFIX}-current-password`
      : issue.field === 'phone' ? `${ID_PREFIX}-phone` : `${ID_PREFIX}-code`;
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
    if (!currentPassword) {
      return { field: 'currentPassword', message: '请输入当前密码以确认身份' };
    }
    if (currentPassword.length > 128) {
      return { field: 'currentPassword', message: '当前密码不能超过 128 位' };
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
    const operationId = ++operation.current;
    setSending(true);
    setIssue(null);
    setFeedback(null);
    const result = await requestPhoneBindingCode(mainlandPhoneToE164(phone), currentPassword);
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
    const operationId = ++operation.current;
    setChanging(true);
    setIssue(null);
    setFeedback(null);
    const result = await bindPhone(mainlandPhoneToE164(phone), code, currentPassword);
    if (operationId !== operation.current) return;
    setChanging(false);
    if (!result.ok) {
      setIssue({ field: result.field ?? 'form', message: result.message ?? '手机号换绑失败，请稍后再试' });
      if (result.retryAfter) startCooldown(result.retryAfter);
      return;
    }
    onSuccess();
  };

  return (
    <section className={styles.editor} id={ID_PREFIX} aria-labelledby={`${ID_PREFIX}-title`}>
      <header className={styles.head}>
        <div>
          <h4 className={styles.title} id={`${ID_PREFIX}-title`}>更换验证手机号</h4>
          <p className={styles.copy}>先用当前密码确认身份；验证成功后，新手机号将用于验证码登录与密码找回。</p>
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
          <button className={styles.cancel} type="button" disabled={busy} onClick={onCancel}>取消</button>
          <button className={styles.confirm} type="submit" disabled={busy}>
            {changing ? '正在核验…' : '确认换绑'}
          </button>
        </div>
      </form>
    </section>
  );
}
