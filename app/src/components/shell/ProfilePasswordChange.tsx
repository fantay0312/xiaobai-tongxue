import { useEffect, useRef, useState, type FormEvent } from 'react';
import fieldStyles from '../../pages/login/EmailCodeField.module.css';
import { useAuthStore, type AuthField } from '../../store/authStore';
import styles from './ProfileEmailChange.module.css';

interface ProfilePasswordChangeProps {
  onCancel: () => void;
  onSuccess: () => void;
}

type Issue = { field: AuthField; message: string };

const ID_PREFIX = 'profile-password-change';
const FEEDBACK_ID = `${ID_PREFIX}-feedback`;

function passwordIssueField(field: AuthField | undefined): AuthField {
  return field === 'password' ? 'newPassword' : field ?? 'form';
}

export function ProfilePasswordChange({ onCancel, onSuccess }: ProfilePasswordChangeProps) {
  const changePassword = useAuthStore((state) => state.changePassword);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [issue, setIssue] = useState<Issue | null>(null);
  const [changing, setChanging] = useState(false);
  const operation = useRef(0);

  useEffect(() => () => { operation.current += 1; }, []);

  useEffect(() => {
    if (!issue || issue.field === 'form') return;
    const fieldId: Partial<Record<AuthField, string>> = {
      currentPassword: `${ID_PREFIX}-current-password`,
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
    if (!currentPassword) localIssue = { field: 'currentPassword', message: '请输入当前密码' };
    else if (currentPassword.length > 128) {
      localIssue = { field: 'currentPassword', message: '当前密码不能超过 128 位' };
    } else if (newPassword.length < 8) {
      localIssue = { field: 'newPassword', message: '新密码至少需要 8 位' };
    } else if (newPassword.length > 128) {
      localIssue = { field: 'newPassword', message: '新密码不能超过 128 位' };
    } else if (newPassword === currentPassword) {
      localIssue = { field: 'newPassword', message: '新密码不能与当前密码相同' };
    } else if (confirmPassword !== newPassword) {
      localIssue = { field: 'confirmPassword', message: '两次输入的新密码不一致' };
    }
    if (localIssue) {
      setIssue(localIssue);
      return;
    }

    const operationId = ++operation.current;
    setChanging(true);
    setIssue(null);
    const result = await changePassword(currentPassword, newPassword);
    if (operationId !== operation.current) return;
    setChanging(false);
    if (!result.ok) {
      setIssue({
        field: passwordIssueField(result.field),
        message: result.message ?? '密码更改失败，请稍后再试',
      });
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    onSuccess();
  };

  return (
    <section className={styles.editor} id={ID_PREFIX} aria-labelledby={`${ID_PREFIX}-title`}>
      <header className={styles.head}>
        <div>
          <h4 className={styles.title} id={`${ID_PREFIX}-title`}>修改登录密码</h4>
          <p className={styles.copy}>修改成功后，其他设备上的旧会话将失效，请使用新密码登录。</p>
        </div>
      </header>
      <form className={styles.form} noValidate aria-busy={changing} onSubmit={submitChange}>
        <fieldset className={styles.fieldset} disabled={changing}>
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
              aria-describedby={issue?.field === 'currentPassword' ? FEEDBACK_ID : undefined}
              onChange={(event) => { setCurrentPassword(event.target.value); clearIssue('currentPassword'); }}
            />
          </label>
          <label className={fieldStyles.field} htmlFor={`${ID_PREFIX}-new-password`}>
            <span className={fieldStyles.label}>新密码</span>
            <input
              id={`${ID_PREFIX}-new-password`}
              className={fieldStyles.input}
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
            <span className={fieldStyles.hint} id={`${ID_PREFIX}-password-hint`}>至少 8 位，且不要与当前密码相同</span>
          </label>
          <label className={fieldStyles.field} htmlFor={`${ID_PREFIX}-confirm-password`}>
            <span className={fieldStyles.label}>再次输入新密码</span>
            <input
              id={`${ID_PREFIX}-confirm-password`}
              className={fieldStyles.input}
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
        {issue ? <p className={styles.error} id={FEEDBACK_ID} role="alert">{issue.message}</p> : null}
        <div className={styles.actions}>
          <button className={styles.cancel} type="button" disabled={changing} onClick={onCancel}>取消</button>
          <button className={styles.confirm} type="submit" disabled={changing}>
            {changing ? '正在更改…' : '确认修改'}
          </button>
        </div>
      </form>
    </section>
  );
}
