/** 凭证更换流程的共用壳：返回、两步进度、身份验证表单，以及「账号 + 验证码」两行字段。 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { normalizeMainlandPhoneInput } from '../../hooks/useAuthForm';
import {
  useAuthStore,
  type AccountVerificationAction,
  type AuthField,
} from '../../store/authStore';
import { Button, Field, Input } from '../ui';
import styles from './ProfileCredentialFlow.module.css';

interface FlowMeta {
  label: string;
  nextStep: string;
}

const FLOW_META: Record<AccountVerificationAction, FlowMeta> = {
  'change-phone': { label: '手机号', nextStep: '设置新手机号' },
  'change-email': { label: '邮箱', nextStep: '设置新邮箱' },
  'change-password': { label: '登录密码', nextStep: '设置新密码' },
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
    // 滚动容器由个人中心用 data-scroll-root 标出；流程嵌在分区面板里，不能再假设父节点就是它
    (flow?.closest('[data-scroll-root]') ?? flow?.parentElement)?.scrollTo({ top: 0, behavior: 'auto' });
    window.requestAnimationFrame(() => flow?.querySelector('input')?.focus({ preventScroll: true }));
  }, [step]);

  return (
    <section ref={flowRef} className={styles.flow} aria-label={`更换${meta.label}流程`}>
      <Button
        className={styles.back}
        variant="ghost"
        size="sm"
        icon={<ArrowLeft size={15} strokeWidth={1.75} />}
        onClick={onBack}
      >
        返回账号与安全
      </Button>

      <ol className={styles.steps} aria-label="安全操作进度">
        <li data-active={step === 1 || undefined} data-complete={step === 2 || undefined}>
          <span className={styles.stepDot}>{step === 2 ? <Check size={13} strokeWidth={2.5} /> : 1}</span>
          <span className={styles.stepText}><small>第一步</small><strong>验证当前身份</strong></span>
        </li>
        <li data-active={step === 2 || undefined}>
          <span className={styles.stepDot}>2</span>
          <span className={styles.stepText}><small>第二步</small><strong>{meta.nextStep}</strong></span>
        </li>
      </ol>

      <div className={styles.card}>{children}</div>
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
        <h3>先确认是你本人</h3>
        <p>输入当前登录密码。验证通过后，才会进入新的凭证设置界面。</p>
      </header>
      <p className={styles.currentCredential}>
        <span>当前登录凭证</span>
        <strong>{currentCredential}</strong>
      </p>
      <form className={styles.form} noValidate aria-busy={verifying} onSubmit={submit}>
        <Field
          label="当前密码"
          htmlFor={`${VERIFICATION_ID}-password`}
          hint={<span id={`${VERIFICATION_ID}-hint`}>验证结果仅对本次操作有效，不会写入浏览器存储</span>}
        >
          <Input
            id={`${VERIFICATION_ID}-password`}
            type="password"
            value={currentPassword}
            autoFocus
            autoComplete="current-password"
            maxLength={128}
            required
            invalid={issue?.field === 'currentPassword'}
            aria-describedby={issue ? `${VERIFICATION_ID}-feedback` : `${VERIFICATION_ID}-hint`}
            onChange={(event) => { setCurrentPassword(event.target.value); setIssue(null); }}
          />
        </Field>
        {issue ? (
          <p className={styles.error} id={`${VERIFICATION_ID}-feedback`} role="alert">{issue.message}</p>
        ) : null}
        <div className={styles.actions}>
          <Button
            type="submit"
            variant="solid"
            loading={verifying}
            iconRight={!verifying ? <ArrowRight size={15} strokeWidth={1.75} /> : undefined}
          >
            {verifying ? '正在验证…' : '验证并继续'}
          </Button>
        </div>
      </form>
    </div>
  );
}

interface ProfileCodeFieldsProps {
  /** 新凭证是邮箱还是中国大陆手机号 */
  kind: 'email' | 'phone';
  value: string;
  code: string;
  issueField?: AuthField;
  sending: boolean;
  cooldown: number;
  /** 输入框 id 前缀：`${idPrefix}-email` / `-phone` / `-code`，外层按 id 回焦 */
  idPrefix: string;
  feedbackId: string;
  label: string;
  onValueChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onSend: () => void;
}

const describedBy = (...ids: (string | false | undefined)[]) => ids.filter(Boolean).join(' ') || undefined;

/** 「新邮箱 / 新手机号」+「验证码与获取按钮」两行字段，校验与归一化规则同登录页 */
export function ProfileCodeFields({
  kind, value, code, issueField, sending, cooldown, idPrefix, feedbackId, label,
  onValueChange, onCodeChange, onSend,
}: ProfileCodeFieldsProps) {
  const valueId = `${idPrefix}-${kind}`;
  const codeId = `${idPrefix}-code`;
  const valueHintId = `${idPrefix}-${kind}-hint`;
  const codeHintId = `${idPrefix}-code-hint`;
  const sendLabel = sending ? '正在发送…' : cooldown > 0 ? `${cooldown} 秒后重发` : '获取验证码';

  return (
    <>
      {kind === 'email' ? (
        <Field label={label} htmlFor={valueId}>
          <Input
            id={valueId}
            type="email"
            value={value}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            required
            disabled={sending}
            invalid={issueField === 'email'}
            aria-describedby={describedBy(issueField === 'email' && feedbackId)}
            onChange={(event) => onValueChange(event.target.value)}
          />
        </Field>
      ) : (
        <Field label={label} htmlFor={valueId} hint={<span id={valueHintId}>仅支持中国大陆 11 位手机号</span>}>
          <Input
            id={valueId}
            type="tel"
            value={value}
            leading={<span className={styles.dialCode} aria-hidden="true">+86</span>}
            autoComplete="tel-national"
            inputMode="numeric"
            pattern="1[3-9][0-9]{9}"
            maxLength={11}
            required
            disabled={sending}
            invalid={issueField === 'phone'}
            aria-label={`${label}，中国大陆`}
            aria-describedby={describedBy(issueField === 'phone' && feedbackId, valueHintId)}
            onChange={(event) => onValueChange(normalizeMainlandPhoneInput(event.target.value))}
          />
        </Field>
      )}
      <Field
        label={kind === 'email' ? '邮箱验证码' : '手机验证码'}
        htmlFor={codeId}
        hint={<span id={codeHintId}>6 位数字，十分钟内有效</span>}
      >
        <div className={styles.codeRow}>
          <Input
            id={codeId}
            type="text"
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            invalid={issueField === 'code'}
            aria-describedby={describedBy(issueField === 'code' && feedbackId, codeHintId)}
            onChange={(event) => onCodeChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <Button
            className={styles.sendCode}
            variant="outline"
            size="lg"
            disabled={sending || cooldown > 0}
            aria-describedby={codeHintId}
            onClick={onSend}
          >
            {sendLabel}
          </Button>
        </div>
      </Field>
    </>
  );
}
