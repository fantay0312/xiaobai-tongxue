/** 头像编辑行:左圆头像,中标签与状态,右上传/移除;与个人中心其他设置行同一制式 */
import { useRef, useState, type ReactNode } from 'react';
import { prepareProfileAvatar, PROFILE_AVATAR_ACCEPT, ProfileAvatarError } from '../../lib/profileAvatar';
import { profileAccountKey, useProfileStore } from '../../store/profileStore';
import { ProfileAvatar } from './ProfileAvatar';
import styles from './ProfileAvatarEditor.module.css';

export function ProfileAvatarEditor({ account, children }: { account: string; children: ReactNode }) {
  const accountKey = profileAccountKey(account);
  const avatar = useProfileStore((state) => state.avatars[accountKey] ?? null);
  const setAvatar = useProfileStore((state) => state.setAvatar);
  const removeAvatar = useProfileStore((state) => state.removeAvatar);
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const chooseAvatar = () => inputRef.current?.click();
  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy(true);
    setIssue(null);
    setNotice(null);
    try {
      const dataUrl = await prepareProfileAvatar(file);
      setAvatar(account, dataUrl);
      setNotice('新头像已保存到本机');
    } catch (error) {
      setIssue(error instanceof ProfileAvatarError ? error.message : '头像处理失败，请稍后重试');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className={styles.root}>
      <input
        ref={inputRef}
        className={styles.fileInput}
        type="file"
        accept={PROFILE_AVATAR_ACCEPT}
        tabIndex={-1}
        onChange={(event) => void handleFile(event.target.files?.[0])}
        aria-hidden="true"
      />
      <button
        type="button"
        className={styles.avatarButton}
        onClick={chooseAvatar}
        disabled={busy}
        aria-label={avatar ? '更换头像' : '上传头像'}
      >
        <ProfileAvatar name={account} src={avatar} size="hero" />
      </button>
      <div className={styles.copy}>
        <span className={styles.label}>{children}</span>
        <span className={styles.note} aria-live="polite" aria-atomic="true">
          {issue ? <span data-error="true">{issue}</span>
            : notice ? <span data-notice="true">{notice}</span>
              : 'JPG、PNG 或 WebP，自动裁切，仅存本机'}
        </span>
      </div>
      <div className={styles.actions}>
        {avatar ? (
          <button
            type="button"
            className={styles.ghostButton}
            disabled={busy}
            onClick={() => {
              removeAvatar(account);
              setIssue(null);
              setNotice('已恢复为默认头像');
            }}
          >
            移除
          </button>
        ) : null}
        <button type="button" className={styles.button} onClick={chooseAvatar} disabled={busy}>
          {busy ? '处理中…' : avatar ? '更换' : '上传'}
        </button>
      </div>
    </div>
  );
}
