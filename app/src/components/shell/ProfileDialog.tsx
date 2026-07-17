/** 用户明确要求的个人中心弹层；沿用设置册页的淡墨罩、焦点与滚动纪律。 */
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { Icon } from '../ui/Icon';
import { ProfileEmailChange } from './ProfileEmailChange';
import { ProfilePasswordChange } from './ProfilePasswordChange';
import { TranscriptUpload } from './TranscriptUpload';
import styles from './ProfileDialog.module.css';

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

function profileInitial(name: string | null): string {
  return Array.from(name?.trim() || '师')[0] ?? '师';
}

export function ProfileMark({ name, compact = false }: { name: string | null; compact?: boolean }) {
  return (
    <span className={styles.mark} data-compact={compact || undefined} aria-hidden="true">
      {profileInitial(name)}
    </span>
  );
}

export function ProfileDialog({ open, onClose, onOpenSettings }: ProfileDialogProps) {
  const user = useAuthStore((state) => state.user);
  const emailMasked = useAuthStore((state) => state.emailMasked);
  const emailBindingRequired = useAuthStore((state) => state.emailBindingRequired);
  const logout = useAuthStore((state) => state.logout);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutIssue, setLogoutIssue] = useState<string | null>(null);
  const [emailEditorOpen, setEmailEditorOpen] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const emailToggleRef = useRef<HTMLButtonElement>(null);
  const passwordToggleRef = useRef<HTMLButtonElement>(null);
  const backdropArmed = useRef(false);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      if (dialog?.open) dialog.close();
      returnTarget?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const docStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    if (docStyle.overflow === 'hidden' || bodyStyle.overflow === 'hidden') return;
    const previous = { doc: docStyle.overflow, body: bodyStyle.overflow, pad: bodyStyle.paddingRight };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    docStyle.overflow = 'hidden';
    bodyStyle.overflow = 'hidden';
    if (gutter > 0) bodyStyle.paddingRight = `${gutter}px`;
    return () => {
      docStyle.overflow = previous.doc;
      bodyStyle.overflow = previous.body;
      bodyStyle.paddingRight = previous.pad;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', closeOnEscape, true);
    return () => document.removeEventListener('keydown', closeOnEscape, true);
  }, [onClose, open]);

  useEffect(() => {
    if (open) return;
    setEmailEditorOpen(false);
    setEmailNotice(null);
    setPasswordEditorOpen(false);
    setPasswordNotice(null);
  }, [open]);

  const outsideDialog = (event: MouseEvent<HTMLDialogElement>): boolean => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
  };

  const handleBackdropDown = (event: MouseEvent<HTMLDialogElement>) => {
    backdropArmed.current = event.target === event.currentTarget && outsideDialog(event);
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (backdropArmed.current && event.target === event.currentTarget && outsideDialog(event)) onClose();
    backdropArmed.current = false;
  };

  const handleLogout = async () => {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLogoutIssue(null);
    const result = await logout();
    setLogoutBusy(false);
    if (result.ok) {
      onClose();
      return;
    }
    setLogoutIssue(result.message ?? '退出失败，请稍后重试');
  };

  const closeEmailEditor = () => {
    setEmailEditorOpen(false);
    window.requestAnimationFrame(() => emailToggleRef.current?.focus());
  };

  const closePasswordEditor = () => {
    setPasswordEditorOpen(false);
    window.requestAnimationFrame(() => passwordToggleRef.current?.focus());
  };

  if (!open) return null;

  const emailSummary = emailBindingRequired ? '尚未绑定验证邮箱' : emailMasked ?? '邮箱已完成验证';

  return (
    <dialog
      id="profile-dialog"
      ref={dialogRef}
      className={styles.dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-title"
      aria-describedby="profile-description"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={handleBackdropDown}
      onClick={handleBackdropClick}
    >
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>书斋名帖</p>
          <h2 className={styles.title} id="profile-title">个人中心</h2>
        </div>
        <button ref={closeRef} type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭个人中心">
          <Icon name="x" size={18} />
        </button>
      </header>

      <div className={styles.scroll}>
        <section className={styles.identity} aria-label="账号身份">
          <ProfileMark name={user} />
          <div className={styles.identityCopy}>
            <p className={styles.accountKind}>授课账号</p>
            <p className={styles.userName}>{user}</p>
            <p className={styles.email}>{emailSummary}</p>
          </div>
          <span className={emailBindingRequired ? styles.pendingBadge : styles.secureBadge}>
            {emailBindingRequired ? '待补录' : '已验证'}
          </span>
        </section>

        <p className={styles.intro} id="profile-description">
          这里收拢你的账号凭证与学习入口。会话凭证由服务器安全保管，不会写入页面存储。
        </p>

        <section className={styles.section} aria-labelledby="security-title">
          <h3 className={styles.sectionTitle} id="security-title">认证与安全</h3>
          <div className={styles.statusList}>
            <div className={styles.statusRow}>
              <Icon name="circle-check" size={17} className={styles.statusIcon} />
              <div><strong>服务器会话</strong><span>已安全登录</span></div>
              <small>有效</small>
            </div>
            <div className={styles.statusRow}>
              <Icon name="mail" size={17} className={styles.statusIcon} />
              <div><strong>邮箱凭证</strong><span>{emailSummary}</span></div>
              {emailBindingRequired ? <small data-pending="true">待验证</small> : (
                <button
                  ref={emailToggleRef}
                  className={styles.emailToggle}
                  type="button"
                  aria-expanded={emailEditorOpen}
                  aria-controls="profile-email-change"
                  onClick={() => {
                    setEmailNotice(null);
                    setPasswordNotice(null);
                    setPasswordEditorOpen(false);
                    setEmailEditorOpen((current) => !current);
                  }}
                >
                  {emailEditorOpen ? '收起' : '更换邮箱'}
                </button>
              )}
            </div>
            <div className={styles.statusRow}>
              <Icon name="circle-check" size={17} className={styles.statusIcon} />
              <div><strong>登录密码</strong><span>用于邮箱或账号 + 密码登录</span></div>
              <button
                ref={passwordToggleRef}
                className={styles.emailToggle}
                type="button"
                aria-expanded={passwordEditorOpen}
                aria-controls="profile-password-change"
                onClick={() => {
                  setPasswordNotice(null);
                  setEmailNotice(null);
                  setEmailEditorOpen(false);
                  setPasswordEditorOpen((current) => !current);
                }}
              >
                {passwordEditorOpen ? '收起' : '修改密码'}
              </button>
            </div>
          </div>
          {emailNotice ? <p className={styles.emailNotice} role="status">{emailNotice}</p> : null}
          {passwordNotice ? <p className={styles.emailNotice} role="status">{passwordNotice}</p> : null}
          {!emailBindingRequired && emailEditorOpen ? (
            <ProfileEmailChange
              onCancel={closeEmailEditor}
              onSuccess={() => {
                setEmailNotice('验证邮箱已更换，新的登录凭证现已生效。');
                closeEmailEditor();
              }}
            />
          ) : null}
          {passwordEditorOpen ? (
            <ProfilePasswordChange
              onCancel={closePasswordEditor}
              onSuccess={() => {
                setPasswordNotice('登录密码已更新，其他设备上的旧会话已失效。');
                closePasswordEditor();
              }}
            />
          ) : null}
        </section>

        <section className={styles.section} aria-labelledby="transcript-title">
          <h3 className={styles.sectionTitle} id="transcript-title">我的成绩单</h3>
          <TranscriptUpload enabled={!emailBindingRequired} />
        </section>

        <section className={styles.section} aria-labelledby="entries-title">
          <h3 className={styles.sectionTitle} id="entries-title">学习与账户</h3>
          <nav className={styles.entries} aria-label="个人中心入口">
            <Link className={styles.entry} to="/study" onClick={onClose}>
              <Icon name="book-open" size={18} />
              <span><strong>回到书斋</strong><small>继续选择课程与知识点</small></span>
              <Icon name="chevron-right" size={16} />
            </Link>
            <Link className={styles.entry} to="/growth" onClick={onClose}>
              <Icon name="graduation" size={18} />
              <span><strong>查看成长册</strong><small>回看教学轨迹与小白成长</small></span>
              <Icon name="chevron-right" size={16} />
            </Link>
            {emailBindingRequired ? (
              <Link className={styles.entry} to="/login?next=%2Fstudy" onClick={onClose}>
                <Icon name="mail" size={18} />
                <span><strong>补录验证邮箱</strong><small>完成验证后解锁备课与讲解</small></span>
                <Icon name="chevron-right" size={16} />
              </Link>
            ) : null}
            <button className={styles.entry} type="button" onClick={onOpenSettings}>
              <Icon name="settings" size={18} />
              <span><strong>偏好设置</strong><small>调整台词、语音与引路</small></span>
              <Icon name="chevron-right" size={16} />
            </button>
          </nav>
        </section>
      </div>

      <footer className={styles.foot}>
        {logoutIssue ? <p className={styles.logoutIssue} role="alert">{logoutIssue}</p> : null}
        <button className={styles.logoutBtn} type="button" disabled={logoutBusy} onClick={() => void handleLogout()}>
          <Icon name="logout" size={17} />
          {logoutBusy ? '正在退出…' : '退出当前账号'}
        </button>
      </footer>
    </dialog>
  );
}
