/** 用户明确要求的个人中心弹层；沿用设置册页的淡墨罩、焦点与滚动纪律。 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useAppStore } from '../../store/appStore';
import { TOPICS } from '../../data';
// 学习身份三引擎:同 growth 页按路径直连纯派生,不进 engine barrel
import { deriveTeacherRank } from '../../engine/achievements';
import { deriveWisdom, deriveEvolution } from '../../engine/evolution';
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

/* 修行阶名(evolution 五阶,口径同 engine/evolution 文档);阶序由 deriveEvolution 派生,名固定不漂 */
const STAGE_NAMES: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '嫩芽期',
  2: '开窍期',
  3: '求索期',
  4: '问难期',
  5: '出师期',
};

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
  // 学习身份:师道称号 / 修行阶 / 学识等级,全部从真实事件流纯派生(手法照 growth 页)
  const global = useAppStore((state) => state.global);
  const events = useAppStore((state) => state.events);
  const reports = useAppStore((state) => state.reports);
  const topicStates = useAppStore((state) => state.topicStates);
  const rank = useMemo(
    () => deriveTeacherRank({ events, reports, global, topicStates, topics: TOPICS }),
    [events, reports, global, topicStates],
  );
  const wisdom = useMemo(() => deriveWisdom(events), [events]);
  const evolution = useMemo(() => deriveEvolution(events, TOPICS), [events]);
  const stageName = STAGE_NAMES[evolution.stage];
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
        <Link
          className={styles.identity}
          to="/growth"
          onClick={onClose}
          aria-label={`${user ?? '你'} · 师道${rank.title} · 修行${stageName} · 学识第 ${wisdom.level} 级 · ${emailSummary},点按翻开成长册`}
        >
          <div className={styles.plate}>
            <p className={styles.accountKind}>授课账号</p>
            <p className={styles.userName}>{user}</p>
            <div className={styles.creds}>
              <span className={styles.rankChip}>{rank.title}</span>
              <span className={styles.credChip}>修行 · {stageName}</span>
              <span className={styles.credChip}>学识第 {wisdom.level} 级</span>
            </div>
            <p className={styles.emailLine}>
              <span className={styles.emailText}>{emailSummary}</span>
              <span className={emailBindingRequired ? styles.pendingBadge : styles.secureBadge}>
                {emailBindingRequired ? '待补录' : '已验证'}
              </span>
            </p>
          </div>
          <span className={styles.colophon} aria-hidden="true">
            <span className={styles.colophonText}>春雾书院 · 授课凭帖</span>
            <ProfileMark name={user} />
          </span>
        </Link>

        <p className={styles.intro} id="profile-description">
          这里收拢你的账号凭证与学习入口。会话凭证由服务器安全保管，不会写入页面存储。
        </p>

        <section className={styles.section} aria-labelledby="security-title">
          <h3 className={styles.sectionTitle} id="security-title">认证与安全</h3>
          <div className={styles.statusList}>
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
              <Icon name="circle-check" size={17} className={styles.statusIconOk} />
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
              <span className={styles.entryTile}><Icon name="book-open" size={18} /></span>
              <span className={styles.entryCopy}><strong>回到书斋</strong><small>继续选择课程与知识点</small></span>
              <Icon name="chevron-right" size={16} className={styles.entryChevron} />
            </Link>
            <Link className={styles.entry} to="/growth" onClick={onClose}>
              <span className={styles.entryTile}><Icon name="graduation" size={18} /></span>
              <span className={styles.entryCopy}><strong>查看成长册</strong><small>回看教学轨迹与小白成长</small></span>
              <Icon name="chevron-right" size={16} className={styles.entryChevron} />
            </Link>
            {emailBindingRequired ? (
              <Link className={styles.entry} to="/login?next=%2Fstudy" onClick={onClose}>
                <span className={styles.entryTile}><Icon name="mail" size={18} /></span>
                <span className={styles.entryCopy}><strong>补录验证邮箱</strong><small>完成验证后解锁备课与讲解</small></span>
                <Icon name="chevron-right" size={16} className={styles.entryChevron} />
              </Link>
            ) : null}
            <button className={styles.entry} type="button" onClick={onOpenSettings}>
              <span className={styles.entryTile}><Icon name="settings" size={18} /></span>
              <span className={styles.entryCopy}><strong>偏好设置</strong><small>调整台词、语音与引路</small></span>
              <Icon name="chevron-right" size={16} className={styles.entryChevron} />
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
