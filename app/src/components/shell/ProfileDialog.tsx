/** 个人中心:桌面双栏设置页(左目录 + 右一列设置行),保留 native dialog 的焦点、Escape 与滚动纪律。 */
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuthStore } from '../../store/authStore';
import { useAppStore } from '../../store/appStore';
import { profileAccountKey, useProfileStore } from '../../store/profileStore';
import { useAllTopics } from '../../hooks/useAllTopics';
// 学习身份三引擎：同 growth 页按路径直连纯派生，不进 engine barrel
import { deriveTeacherRank } from '../../engine/achievements';
import { deriveWisdom, deriveEvolution, getStageMeta } from '../../engine/evolution';
import { Icon } from '../ui/Icon';
import { ProfileEmailChange } from './ProfileEmailChange';
import { ProfilePhoneChange } from './ProfilePhoneChange';
import { ProfilePasswordChange } from './ProfilePasswordChange';
import { TranscriptUpload } from './TranscriptUpload';
import { ProfileCommerce } from './ProfileCommerce';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileAvatarEditor } from './ProfileAvatarEditor';
import styles from './ProfileDialog.module.css';

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

const PROFILE_SECTIONS = [
  {
    id: 'overview',
    label: '个人资料',
    icon: 'school',
    title: '个人资料',
    description: '头像、学习身份、账号状态与常用入口。',
  },
  {
    id: 'commerce',
    label: '订阅与用量',
    icon: 'ticket',
    title: '订阅与用量',
    description: '查看套餐、有效权益、用量积分并兑换 CDK。',
  },
  {
    id: 'security',
    label: '账号与安全',
    icon: 'phone',
    title: '账号与安全',
    description: '管理手机号、邮箱与登录密码。',
  },
  {
    id: 'records',
    label: '成绩单与数据',
    icon: 'file',
    title: '成绩单与数据',
    description: '上传、预览、替换或下载你的成绩单。',
  },
  {
    id: 'preferences',
    label: '偏好设置',
    icon: 'settings',
    title: '偏好设置',
    description: '调整台词、语音与学习引路方式。',
  },
] as const;

type ProfileSection = (typeof PROFILE_SECTIONS)[number]['id'];
type SecurityFlow = 'phone' | 'email' | 'password';

const SECURITY_FLOW_META: Record<SecurityFlow, { title: string; description: string }> = {
  phone: { title: '更换手机号', description: '先验证当前身份，再设置并验证新的手机号。' },
  email: { title: '更换邮箱', description: '先验证当前身份，再设置并验证新的邮箱。' },
  password: { title: '修改登录密码', description: '先验证当前身份，再设置新的登录密码。' },
};

export function ProfileDialog({ open, onClose, onOpenSettings }: ProfileDialogProps) {
  const user = useAuthStore((state) => state.user);
  const avatar = useProfileStore((state) => state.avatars[profileAccountKey(user)] ?? null);
  const emailMasked = useAuthStore((state) => state.emailMasked);
  const emailBindingRequired = useAuthStore((state) => state.emailBindingRequired);
  const phoneMasked = useAuthStore((state) => state.phoneMasked);
  const phoneBindingRequired = useAuthStore((state) => state.phoneBindingRequired);
  const logout = useAuthStore((state) => state.logout);
  const global = useAppStore((state) => state.global);
  const events = useAppStore((state) => state.events);
  const reports = useAppStore((state) => state.reports);
  const topicStates = useAppStore((state) => state.topicStates);
  const allTopics = useAllTopics();
  const rank = useMemo(
    () => deriveTeacherRank({ events, reports, global, topicStates, topics: allTopics }),
    [events, reports, global, topicStates, allTopics],
  );
  const wisdom = useMemo(() => deriveWisdom(events), [events]);
  const evolution = useMemo(() => deriveEvolution(events, allTopics), [events, allTopics]);
  const stageMeta = getStageMeta(evolution.stage);
  const [activeSection, setActiveSection] = useState<ProfileSection>('overview');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutIssue, setLogoutIssue] = useState<string | null>(null);
  const [securityFlow, setSecurityFlow] = useState<SecurityFlow | null>(null);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const emailToggleRef = useRef<HTMLButtonElement>(null);
  const phoneToggleRef = useRef<HTMLButtonElement>(null);
  const passwordToggleRef = useRef<HTMLButtonElement>(null);
  const backdropArmed = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const baseMeta = PROFILE_SECTIONS.find((section) => section.id === activeSection)
    ?? PROFILE_SECTIONS[0];
  const activeMeta = activeSection === 'security' && securityFlow
    ? { ...baseMeta, ...SECURITY_FLOW_META[securityFlow] }
    : baseMeta;

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
    setActiveSection('overview');
    setSecurityFlow(null);
    setSecurityNotice(null);
    setLogoutIssue(null);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeSection, securityFlow]);

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

  const flowTrigger = (flow: SecurityFlow) => {
    if (flow === 'phone') return phoneToggleRef.current;
    if (flow === 'email') return emailToggleRef.current;
    return passwordToggleRef.current;
  };

  const closeSecurityFlow = () => {
    const returningFlow = securityFlow;
    setSecurityFlow(null);
    if (returningFlow) {
      window.requestAnimationFrame(() => flowTrigger(returningFlow)?.focus());
    }
  };

  const openSecurityFlow = (flow: SecurityFlow) => {
    setSecurityNotice(null);
    setSecurityFlow(flow);
  };

  const selectSection = (section: ProfileSection) => {
    setActiveSection(section);
    setSecurityFlow(null);
  };

  if (!open) return null;

  const accountName = user ?? '授课同学';
  const emailSummary = emailBindingRequired ? '尚未绑定验证邮箱' : emailMasked ?? '邮箱已完成验证';
  const phoneSummary = phoneBindingRequired ? '尚未绑定验证手机号' : phoneMasked ?? '手机号已完成验证';
  const allCredentialsReady = !emailBindingRequired && !phoneBindingRequired;

  return (
    <dialog
      id="profile-dialog"
      ref={dialogRef}
      className={styles.dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-title"
      aria-describedby="profile-description"
      onCancel={(event) => {
        event.preventDefault();
        if (securityFlow) closeSecurityFlow();
        else onClose();
      }}
      onMouseDown={handleBackdropDown}
      onClick={handleBackdropClick}
    >
      <aside className={styles.rail} aria-label="个人中心导航">
        <button ref={closeRef} type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭个人中心">
          <Icon name="x" size={18} />
        </button>

        <div className={styles.railIdentity}>
          <ProfileAvatar name={user} src={avatar} size="rail" />
          <div>
            <strong>{accountName}</strong>
            <span>{rank.title} · {stageMeta.name}</span>
          </div>
        </div>

        <nav className={styles.sideNav} aria-label="个人中心分区">
          {PROFILE_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={styles.navItem}
              data-active={activeSection === section.id || undefined}
              aria-current={activeSection === section.id ? 'page' : undefined}
              onClick={() => selectSection(section.id)}
            >
              <Icon name={section.icon} size={17} className={styles.navIcon} />
              <span>{section.label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.railFoot}>
          {logoutIssue ? <p className={styles.logoutIssue} role="alert">{logoutIssue}</p> : null}
          <button className={styles.logoutBtn} type="button" disabled={logoutBusy} onClick={() => void handleLogout()}>
            <Icon name="logout" size={16} className={styles.navIcon} />
            <span>{logoutBusy ? '正在退出…' : '退出登录'}</span>
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.contentHead}>
          <h2 className={styles.title} id="profile-title">{activeMeta.title}</h2>
          <p className={styles.srOnly} id="profile-description">{activeMeta.description}</p>
        </header>

        <div ref={scrollRef} className={styles.scroll}>
          {activeSection === 'overview' ? (
            <>
              <div className={styles.rows}>
                <ProfileAvatarEditor account={accountName}>头像</ProfileAvatarEditor>
                <Row label="用户名">
                  <span className={styles.value}>{accountName}</span>
                </Row>
                <Row label="学习身份" note={`${rank.title} · ${stageMeta.name}，${stageMeta.description}`}>
                  <span className={styles.value}>学识第 {wisdom.level} 阶</span>
                  <Link className={styles.rowLink} to="/growth" onClick={onClose}>
                    成长册 <Icon name="arrow-right" size={14} />
                  </Link>
                </Row>
                <Row label="手机">
                  <span className={styles.value}>{phoneSummary}</span>
                  <span className={styles.state} data-pending={phoneBindingRequired || undefined}>
                    {phoneBindingRequired ? '待绑定' : '已验证'}
                  </span>
                </Row>
                <Row label="邮箱">
                  <span className={styles.value}>{emailSummary}</span>
                  <span className={styles.state} data-pending={emailBindingRequired || undefined}>
                    {emailBindingRequired ? '待补录' : '已验证'}
                  </span>
                </Row>
              </div>

              <h3 className={styles.groupTitle} id="quick-entry-title">常用入口</h3>
              <nav className={styles.rows} aria-labelledby="quick-entry-title">
                <Link className={styles.entry} to="/study" onClick={onClose}>
                  <span className={styles.entryCopy}><span>回到书斋</span><small>继续选择课程与知识点</small></span>
                  <Icon name="chevron-right" size={16} className={styles.entryChevron} />
                </Link>
                <Link className={styles.entry} to="/growth" onClick={onClose}>
                  <span className={styles.entryCopy}><span>查看成长册</span><small>回看教学轨迹与小白成长</small></span>
                  <Icon name="chevron-right" size={16} className={styles.entryChevron} />
                </Link>
              </nav>
            </>
          ) : null}

          {activeSection === 'security' && !securityFlow ? (
            <>
              <div className={styles.groupHead}>
                <h3 className={styles.groupTitle} id="security-title">登录凭证</h3>
                <span className={styles.state} data-pending={!allCredentialsReady || undefined}>
                  {allCredentialsReady ? '凭证齐备' : '仍需补全'}
                </span>
              </div>
              <div className={styles.rows} aria-labelledby="security-title">
                <Row label="手机号" note={phoneSummary}>
                  {phoneBindingRequired ? <span className={styles.state} data-pending="true">待验证</span> : (
                    <button
                      ref={phoneToggleRef}
                      className={styles.btn}
                      type="button"
                      onClick={() => openSecurityFlow('phone')}
                    >
                      更换
                    </button>
                  )}
                </Row>
                <Row label="邮箱" note={emailSummary}>
                  {emailBindingRequired ? <span className={styles.state} data-pending="true">待验证</span> : (
                    <button
                      ref={emailToggleRef}
                      className={styles.btn}
                      type="button"
                      onClick={() => openSecurityFlow('email')}
                    >
                      更换
                    </button>
                  )}
                </Row>
                <Row label="登录密码" note="用于邮箱或账号 + 密码登录">
                  <button
                    ref={passwordToggleRef}
                    className={styles.btn}
                    type="button"
                    onClick={() => openSecurityFlow('password')}
                  >
                    修改
                  </button>
                </Row>
              </div>
              {securityNotice ? <p className={styles.notice} role="status">{securityNotice}</p> : null}

              {emailBindingRequired || phoneBindingRequired ? (
                <>
                  <h3 className={styles.groupTitle} id="binding-title">补全账号</h3>
                  <nav className={styles.rows} aria-labelledby="binding-title">
                    {emailBindingRequired ? (
                      <Link className={styles.entry} to="/login?next=%2Fstudy" onClick={onClose}>
                        <span className={styles.entryCopy}><span>补录验证邮箱</span><small>完成验证后解锁备课与讲解</small></span>
                        <Icon name="chevron-right" size={16} className={styles.entryChevron} />
                      </Link>
                    ) : null}
                    {phoneBindingRequired ? (
                      <Link className={styles.entry} to="/login?next=%2Fstudy" onClick={onClose}>
                        <span className={styles.entryCopy}><span>绑定验证手机号</span><small>完成验证后解锁全部业务页面</small></span>
                        <Icon name="chevron-right" size={16} className={styles.entryChevron} />
                      </Link>
                    ) : null}
                  </nav>
                </>
              ) : null}
            </>
          ) : null}

          {activeSection === 'security' && securityFlow === 'phone' ? (
            <ProfilePhoneChange
              currentCredential={phoneSummary}
              onCancel={closeSecurityFlow}
              onSuccess={() => {
                setSecurityNotice('验证手机号已更换，新的验证码登录与找回凭证现已生效。');
                closeSecurityFlow();
              }}
            />
          ) : null}

          {activeSection === 'security' && securityFlow === 'email' ? (
            <ProfileEmailChange
              currentCredential={emailSummary}
              onCancel={closeSecurityFlow}
              onSuccess={() => {
                setSecurityNotice('验证邮箱已更换，新的登录凭证现已生效。');
                closeSecurityFlow();
              }}
            />
          ) : null}

          {activeSection === 'security' && securityFlow === 'password' ? (
            <ProfilePasswordChange
              currentCredential={`账号 · ${accountName}`}
              onCancel={closeSecurityFlow}
              onSuccess={() => {
                setSecurityNotice('登录密码已更新，其他设备上的旧会话已失效。');
                closeSecurityFlow();
              }}
            />
          ) : null}

          {activeSection === 'commerce' ? <ProfileCommerce /> : null}

          {activeSection === 'records' ? (
            <>
              <div className={styles.groupHead}>
                <h3 className={styles.groupTitle} id="transcript-title">我的成绩单</h3>
                <span className={styles.groupNote}>PDF 或常见图片，可随时预览、下载或替换</span>
              </div>
              <TranscriptUpload enabled={allCredentialsReady} />
            </>
          ) : null}

          {activeSection === 'preferences' ? (
            <div className={styles.rows}>
              <Row label="偏好设置" note="外观、台词引擎、语音输入与新手引路">
                <button className={styles.btn} type="button" onClick={onOpenSettings}>
                  打开
                </button>
              </Row>
            </div>
          ) : null}
        </div>
      </main>
    </dialog>
  );
}

/** 设置行:左标签(可带一行注),右侧值或动作 */
function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowCopy}>
        <span className={styles.rowLabel}>{label}</span>
        {note ? <span className={styles.rowNote}>{note}</span> : null}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}
