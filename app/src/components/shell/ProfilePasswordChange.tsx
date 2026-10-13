import { useEffect, useRef, useState, type FormEvent } from 'react';
import { mapPasswordIssueField, type Issue } from '../../hooks/useAuthForm';
import { useAuthStore, type AuthField } from '../../store/authStore';
import { Button, Field, Input } from '../ui';
import {
  ProfileCredentialFlow,
  ProfileIdentityVerification,
} from './ProfileCredentialFlow';
import styles from './ProfileCredentialFlow.module.css';

interface ProfilePasswordChangeProps {
  currentCredential: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const ID_PREFIX = 'profile-password-change';
const FEEDBACK_ID = `${ID_PREFIX}-feedback`;

export function ProfilePasswordChange({
  currentCredential, onCancel, onSuccess,
}: ProfilePasswordChangeProps) {
  const changePassword = useAuthStore((state) => state.changePassword);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [issue, setIssue] = useState<Issue | null>(null);
  const [changing, setChanging] = useState(false);
  const operation = useRef(0);

  useEffect(() => () => { operation.current += 1; }, []);

  useEffect(() => {
    if (!issue || issue.field === 'form') return;
    const fieldId: Partial<Record<AuthField, string>> = {
      newPassword: `${ID_PREFIX}-new-password`,
      confirmPassword: `${ID_PREFIX}-confirm-password`,
    };
    document.getElementById(fieldId[issue.field] ?? '')?.focus();
  }, [issue]);

  const clearIssue = (field: AuthField) => {
    setIssue((current) => current?.field === field || current?.field === 'form' ? null : current);
  };

  const submitChange = async (event: FormEvent) => {
    event.preventDefault();
    if (changing) return;
    let localIssue: Issue | null = null;
    if (newPassword.length < 8) {
      localIssue = { field: 'newPassword', message: '新密码至少需要 8 位' };
    } else if (newPassword.length > 128) {
      localIssue = { field: 'newPassword', message: '新密码不能超过 128 位' };
    } else if (confirmPassword !== newPassword) {
      localIssue = { field: 'confirmPassword', message: '两次输入的新密码不一致' };
    }
    if (localIssue) {
      setIssue(localIssue);
      return;
    }
    if (!verificationToken) return;

    const operationId = ++operation.current;
    setChanging(true);
    setIssue(null);
    const result = await changePassword(verificationToken, newPassword);
    if (operationId !== operation.current) return;
    setChanging(false);
    if (!result.ok) {
      setIssue({
        field: mapPasswordIssueField(result.field),
        message: result.message ?? '密码更改失败，请稍后再试',
      });
      return;
    }
    setNewPassword('');
    setConfirmPassword('');
    onSuccess();
  };

  if (!verificationToken) {
    return (
      <ProfileCredentialFlow action="change-password" step={1} onBack={onCancel}>
        <ProfileIdentityVerification
          action="change-password"
          currentCredential={currentCredential}
          onVerified={setVerificationToken}
        />
      </ProfileCredentialFlow>
    );
  }

  return (
    <ProfileCredentialFlow action="change-password" step={2} onBack={onCancel}>
      <div className={styles.stage} id={ID_PREFIX}>
        <header className={styles.stageHead}>
          <h3>设置新的登录密码</h3>
          <p>修改成功后，其他设备上的旧会话将失效，请使用新密码重新登录。</p>
        </header>
      <form className={styles.form} noValidate aria-busy={changing} onSubmit={submitChange}>
        <fieldset className={styles.fieldset} disabled={changing}>
          <Field
            label="新密码"
            htmlFor={`${ID_PREFIX}-new-password`}
            hint={<span id={`${ID_PREFIX}-password-hint`}>至少 8 位，且不能与当前密码相同</span>}
          >
            <Input
              id={`${ID_PREFIX}-new-password`}
              type="password"
              value={newPassword}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              invalid={issue?.field === 'newPassword'}
              aria-describedby={issue?.field === 'newPassword' ? FEEDBACK_ID : `${ID_PREFIX}-password-hint`}
              onChange={(event) => { setNewPassword(event.target.value); clearIssue('newPassword'); }}
            />
          </Field>
          <Field label="再次输入新密码" htmlFor={`${ID_PREFIX}-confirm-password`}>
            <Input
              id={`${ID_PREFIX}-confirm-password`}
              type="password"
              value={confirmPassword}
              autoComplete="new-password"
              maxLength={128}
              required
              invalid={issue?.field === 'confirmPassword'}
              aria-describedby={issue?.field === 'confirmPassword' ? FEEDBACK_ID : undefined}
              onChange={(event) => { setConfirmPassword(event.target.value); clearIssue('confirmPassword'); }}
            />
          </Field>
        </fieldset>
        {issue ? <p className={styles.error} id={FEEDBACK_ID} role="alert">{issue.message}</p> : null}
        <div className={styles.actions}>
          <Button
            variant="ghost"
            disabled={changing}
            onClick={() => { setVerificationToken(null); setIssue(null); }}
          >
            重新验证
          </Button>
          <Button type="submit" variant="solid" loading={changing}>
            {changing ? '正在更改…' : '确认修改'}
          </Button>
        </div>
      </form>
      </div>
    </ProfileCredentialFlow>
  );
}
