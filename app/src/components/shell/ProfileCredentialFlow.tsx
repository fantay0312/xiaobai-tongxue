import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import fieldStyles from '../../pages/login/EmailCodeField.module.css';
import {
  useAuthStore,
  type AccountVerificationAction,
  type AuthField,
} from '../../store/authStore';
import { Icon, type IconName } from '../ui/Icon';
import styles from './ProfileCredentialFlow.module.css';

interface FlowMeta {
  icon: IconName;
  label: string;
  nextStep: string;
}

const FLOW_META: Record<AccountVerificationAction, FlowMeta> = {
  'change-phone': { icon: 'phone', label: '手机号', nextStep: '设置新手机号' },
  'change-email': { icon: 'mail', label: '邮箱', nextStep: '设置新邮箱' },
  'change-password': { icon: 'circle-check', label: '登录密码', nextStep: '设置新密码' },
};

interface ProfileCredentialFlowProps {
  action: AccountVerificationAction;
  step: 1 | 2;
  onBack: () => void;
  children: ReactNode;
}

export function ProfileCredentialFlow({
  action, step, onBack, children,
}: ProfileCredentialFlowProps) {
  const meta = FLOW_META[action];
  const flowRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (step !== 2) return;
    const flow = flowRef.current;
    flow?.parentElement?.scrollTo({ top: 0, behavior: 'auto' });
    window.requestAnimationFrame(() => flow?.querySelector('input')?.focus({ preventScroll: true }));
  }, [step]);

  return (
    <section ref={flowRef} className={styles.flow} aria-label={`更换${meta.label}流程`}>
      <button className={styles.back} type="button" onClick={onBack}>
        <Icon name="arrow-left" size={16} />
        返回账号与安全
      </button>

      <ol className={styles.steps} aria-label="安全操作进度">
        <li data-active={step === 1 || undefined} data-complete={step === 2 || undefined}>
          <span>{step === 2 ? <Icon name="check" size={14} /> : '01'}</span>
          <div><small>第一步</small><strong>验证当前身份</strong></div>
        </li>
        <li data-active={step === 2 || undefined}>
          <span>02</span>
          <div><small>第二步</small><strong>{meta.nextStep}</strong></div>
        </li>
      </ol>

      <div className={styles.ticket}>
        <div className={styles.body}>{children}</div>
        <aside className={styles.stub} aria-hidden="true">
          <Icon name={meta.icon} size={22} />
          <span>SECURITY</span>
          <strong>{step === 1 ? 'VERIFY' : 'UPDATE'}</strong>
          <small>10 MIN</small>
        </aside>
      </div>
    </section>
  );
}

interface ProfileIdentityVerificationProps {
  action: AccountVerificationAction;
  currentCredential: string;
  onVerified: (verificationToken: string) => void;
}

const VERIFICATION_ID = 'profile-credential-verification';

export function ProfileIdentityVerification({
  action, currentCredential, onVerified,
}: ProfileIdentityVerificationProps) {
  const verifyAccountPassword = useAuthStore((state) => state.verifyAccountPassword);
  const [currentPassword, setCurrentPassword] = useState('');
  const [issue, setIssue] = useState<{ field: AuthField; message: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const operation = useRef(0);

  useEffect(() => () => { operation.current += 1; }, []);
  useEffect(() => {
    if (issue?.field === 'currentPassword') {
      document.getElementById(`${VERIFICATION_ID}-password`)?.focus();
    }
  }, [issue]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (verifying) return;
    if (!currentPassword) {
      setIssue({ field: 'currentPassword', message: '请输入当前登录密码' });
      return;
    }
    if (currentPassword.length > 128) {
      setIssue({ field: 'currentPassword', message: '当前密码不能超过 128 位' });
      return;
    }
    const operationId = ++operation.current;
    setVerifying(true);
    setIssue(null);
    const result = await verifyAccountPassword(currentPassword, action);
    if (operationId !== operation.current) return;
    setVerifying(false);
    if (!result.ok || !result.verificationToken) {
      setIssue({
        field: result.field ?? 'form',
        message: result.message ?? '身份验证失败，请稍后再试',
      });
      return;
    }
    setCurrentPassword('');
    onVerified(result.verificationToken);
  };

  return (
    <div className={styles.stage}>
      <header className={styles.stageHead}>
        <p className={styles.typeLabel}>IDENTITY CHECK</p>
        <h3>先确认是你本人</h3>
        <p>输入当前登录密码。验证通过后，才会进入新的凭证设置界面。</p>
      </header>
      <p className={styles.currentCredential}>
        <span>当前登录凭证</span>
        <strong>{currentCredential}</strong>
      </p>
      <form className={styles.form} noValidate aria-busy={verifying} onSubmit={submit}>
        <label className={fieldStyles.field} htmlFor={`${VERIFICATION_ID}-password`}>
          <span className={fieldStyles.label}>当前密码</span>
          <input
            id={`${VERIFICATION_ID}-password`}
            className={fieldStyles.input}
            type="password"
            value={currentPassword}
            autoFocus
            autoComplete="current-password"
            maxLength={128}
            required
            aria-invalid={issue?.field === 'currentPassword' || undefined}
            aria-describedby={issue ? `${VERIFICATION_ID}-feedback` : `${VERIFICATION_ID}-hint`}
            onChange={(event) => { setCurrentPassword(event.target.value); setIssue(null); }}
          />
          <span className={fieldStyles.hint} id={`${VERIFICATION_ID}-hint`}>
            验证结果仅对本次操作有效，不会写入浏览器存储
          </span>
        </label>
        {issue ? (
          <p className={styles.error} id={`${VERIFICATION_ID}-feedback`} role="alert">{issue.message}</p>
        ) : null}
        <button className={styles.primary} type="submit" disabled={verifying}>
          {verifying ? '正在验证…' : '验证并继续'}
          {!verifying ? <Icon name="arrow-right" size={16} /> : null}
        </button>
      </form>
    </div>
  );
}
