/** 个人中心：桌面双栏设置页，保留 native dialog 的焦点、Escape 与滚动纪律。 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { useAuthStore } from '../../store/authStore';
import { useAppStore } from '../../store/appStore';
import { TOPICS } from '../../data';
// 学习身份三引擎：同 growth 页按路径直连纯派生，不进 engine barrel
import { deriveTeacherRank } from '../../engine/achievements';
import { deriveWisdom, deriveEvolution, getStageMeta } from '../../engine/evolution';
import { Icon } from '../ui/Icon';
import { ProfileEmailChange } from './ProfileEmailChange';
import { ProfilePhoneChange } from './ProfilePhoneChange';
import { ProfilePasswordChange } from './ProfilePasswordChange';
import { TranscriptUpload } from './TranscriptUpload';
import { ProfileCommerce } from './ProfileCommerce';
import styles from './ProfileDialog.module.css';

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

const PROFILE_SECTIONS = [
  {
    id: 'overview',
    label: '概览',
    icon: 'school',
    kicker: '书斋名帖',
    title: '个人中心',
    description: '查看学习身份、账号状态与常用入口。',
  },
  {
    id: 'commerce',
    label: '订阅与用量',
    icon: 'ticket',
    kicker: '用量账簿',
    title: '订阅与用量',
    description: '查看套餐、有效权益、用量积分并兑换 CDK。',
  },
  {
    id: 'security',
    label: '账号与安全',
    icon: 'phone',
    kicker: '凭证簿',
    title: '账号与安全',
    description: '管理手机号、邮箱与登录密码。',
  },
  {
    id: 'records',
    label: '成绩单与数据',
    icon: 'file',
    kicker: '档案袋',
    title: '成绩单与数据',
    description: '上传、预览、替换或下载你的成绩单。',
  },
  {
    id: 'preferences',
    label: '偏好设置',
    icon: 'settings',
    kicker: '书斋陈设',
    title: '偏好设置',
    description: '调整台词、语音与学习引路方式。',
  },
] as const;

type ProfileSection = (typeof PROFILE_SECTIONS)[number]['id'];

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
  const phoneMasked = useAuthStore((state) => state.phoneMasked);
  const phoneBindingRequired = useAuthStore((state) => state.phoneBindingRequired);
  const logout = useAuthStore((state) => state.logout);
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
  const stageMeta = getStageMeta(evolution.stage);
  const [activeSection, setActiveSection] = useState<ProfileSection>('overview');
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutIssue, setLogoutIssue] = useState<string | null>(null);
  const [emailEditorOpen, setEmailEditorOpen] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [phoneEditorOpen, setPhoneEditorOpen] = useState(false);
  const [phoneNotice, setPhoneNotice] = useState<string | null>(null);
  const [passwordEditorOpen, setPasswordEditorOpen] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const emailToggleRef = useRef<HTMLButtonElement>(null);
  const phoneToggleRef = useRef<HTMLButtonElement>(null);
  const passwordToggleRef = useRef<HTMLButtonElement>(null);
  const backdropArmed = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeMeta = PROFILE_SECTIONS.find((section) => section.id === activeSection)
    ?? PROFILE_SECTIONS[0];

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
    setEmailEditorOpen(false);
    setEmailNotice(null);
    setPhoneEditorOpen(false);
    setPhoneNotice(null);
    setPasswordEditorOpen(false);
    setPasswordNotice(null);
    setLogoutIssue(null);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeSection]);

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

  const closePhoneEditor = () => {
    setPhoneEditorOpen(false);
    window.requestAnimationFrame(() => phoneToggleRef.current?.focus());
  };

  const closePasswordEditor = () => {
    setPasswordEditorOpen(false);
    window.requestAnimationFrame(() => passwordToggleRef.current?.focus());
  };

  const openPhoneEditor = () => {
    setPhoneNotice(null);
    setEmailNotice(null);
    setPasswordNotice(null);
    setEmailEditorOpen(false);
    setPasswordEditorOpen(false);
    setPhoneEditorOpen((current) => !current);
  };

  const openEmailEditor = () => {
    setEmailNotice(null);
    setPhoneNotice(null);
    setPasswordNotice(null);
    setPhoneEditorOpen(false);
    setPasswordEditorOpen(false);
    setEmailEditorOpen((current) => !current);
  };

  const openPasswordEditor = () => {
    setPasswordNotice(null);
    setEmailNotice(null);
    setPhoneNotice(null);
    setPhoneEditorOpen(false);
    setEmailEditorOpen(false);
    setPasswordEditorOpen((current) => !current);
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
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={handleBackdropDown}
      onClick={handleBackdropClick}
    >
      <aside className={styles.rail} aria-label="个人中心导航">
        <div className={styles.railTop}>
          <button ref={closeRef} type="button" className={styles.closeBtn} onClick={onClose} aria-label="关闭个人中心">
            <Icon name="x" size={19} />
          </button>
          <span className={styles.railBrand}>学伴书斋</span>
        </div>

        <div className={styles.railIdentity}>
          <ProfileMark name={user} compact />
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
              onClick={() => setActiveSection(section.id)}
            >
              <Icon name={section.icon} size={18} />
              <span>{section.label}</span>
            </button>
          ))}
        </nav>

        <div className={styles.railFoot}>
          {logoutIssue ? <p className={styles.logoutIssue} role="alert">{logoutIssue}</p> : null}
          <button className={styles.logoutBtn} type="button" disabled={logoutBusy} onClick={() => void handleLogout()}>
            <Icon name="logout" size={17} />
            <span>{logoutBusy ? '正在退出…' : '退出当前账号'}</span>
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.contentHead}>
          <div>
            <p className={styles.eyebrow}>{activeMeta.kicker}</p>
            <h2 className={styles.title} id="profile-title">{activeMeta.title}</h2>
            <p className={styles.description} id="profile-description">{activeMeta.description}</p>
          </div>
          <span className={styles.sectionIndex} aria-hidden="true">
            {String(PROFILE_SECTIONS.findIndex((section) => section.id === activeSection) + 1).padStart(2, '0')}
          </span>
        </header>

        <div ref={scrollRef} className={styles.scroll}>
          {activeSection === 'overview' ? (
            <>
              <Link
                className={styles.identity}
                to="/growth"
                onClick={onClose}
                aria-label={`${accountName} · 师道${rank.title} · 小白科名${stageMeta.name}·${stageMeta.description} · 学识第 ${wisdom.level} 阶 · ${phoneSummary} · ${emailSummary}，点按翻开成长册`}
              >
                <div className={styles.identityHead}>
                  <ProfileMark name={user} />
                  <div>
                    <p className={styles.accountKind}>授课账号 · 学习身份</p>
                    <p className={styles.userName}>{accountName}</p>
                  </div>
                  <span className={styles.identityArrow} aria-hidden="true">
                    <Icon name="chevron-right" size={18} />
                  </span>
                </div>
                <div className={styles.creds}>
                  <span className={styles.rankChip}>{rank.title}</span>
                  <span className={styles.credChip}>科名 · {stageMeta.name} · {stageMeta.description}</span>
                  <span className={styles.credChip}>学识第 {wisdom.level} 阶</span>
                </div>
                <div className={styles.credentialGrid}>
                  <p>
                    <Icon name="phone" size={15} />
                    <span>{phoneSummary}</span>
                    <small data-pending={phoneBindingRequired || undefined}>
                      {phoneBindingRequired ? '待绑定' : '已验证'}
                    </small>
                  </p>
                  <p>
                    <Icon name="mail" size={15} />
                    <span>{emailSummary}</span>
                    <small data-pending={emailBindingRequired || undefined}>
                      {emailBindingRequired ? '待补录' : '已验证'}
                    </small>
                  </p>
                </div>
                <span className={styles.identityHint}>翻开成长册，查看完整学习轨迹</span>
              </Link>

              <section className={styles.section} aria-labelledby="quick-entry-title">
                <div className={styles.sectionLead}>
                  <div>
                    <h3 id="quick-entry-title">常用入口</h3>
                    <p>从这里继续学习，或回看小白的成长。</p>
                  </div>
                </div>
                <nav className={styles.entries} aria-label="学习入口">
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
                </nav>
              </section>
            </>
          ) : null}

          {activeSection === 'security' ? (
            <>
              <section className={styles.section} aria-labelledby="security-title">
                <div className={styles.sectionLead}>
                  <div>
                    <h3 id="security-title">登录凭证</h3>
                    <p>已验证的凭证可用于登录与找回账号。</p>
                  </div>
                  <span className={allCredentialsReady ? styles.readyBadge : styles.todoBadge}>
                    {allCredentialsReady ? '凭证齐备' : '仍需补全'}
                  </span>
                </div>
                <div className={styles.statusList}>
                  <div className={styles.statusRow}>
                    <span className={styles.statusTile}><Icon name="phone" size={18} /></span>
                    <div><strong>手机凭证</strong><span>{phoneSummary}</span></div>
                    {phoneBindingRequired ? <small data-pending="true">待验证</small> : (
                      <button
                        ref={phoneToggleRef}
                        className={styles.statusAction}
                        type="button"
                        aria-expanded={phoneEditorOpen}
                        aria-controls="profile-phone-change"
                        onClick={openPhoneEditor}
                      >
                        {phoneEditorOpen ? '收起' : '更换手机号'}
                      </button>
                    )}
                  </div>
                  <div className={styles.statusRow}>
                    <span className={styles.statusTile}><Icon name="mail" size={18} /></span>
                    <div><strong>邮箱凭证</strong><span>{emailSummary}</span></div>
                    {emailBindingRequired ? <small data-pending="true">待验证</small> : (
                      <button
                        ref={emailToggleRef}
                        className={styles.statusAction}
                        type="button"
                        aria-expanded={emailEditorOpen}
                        aria-controls="profile-email-change"
                        onClick={openEmailEditor}
                      >
                        {emailEditorOpen ? '收起' : '更换邮箱'}
                      </button>
                    )}
                  </div>
                  <div className={styles.statusRow}>
                    <span className={styles.statusTile} data-secure="true">
                      <Icon name="circle-check" size={18} />
                    </span>
                    <div><strong>登录密码</strong><span>用于邮箱或账号 + 密码登录</span></div>
                    <button
                      ref={passwordToggleRef}
                      className={styles.statusAction}
                      type="button"
                      aria-expanded={passwordEditorOpen}
                      aria-controls="profile-password-change"
                      onClick={openPasswordEditor}
                    >
                      {passwordEditorOpen ? '收起' : '修改密码'}
                    </button>
                  </div>
                </div>
                {phoneNotice ? <p className={styles.notice} role="status">{phoneNotice}</p> : null}
                {emailNotice ? <p className={styles.notice} role="status">{emailNotice}</p> : null}
                {passwordNotice ? <p className={styles.notice} role="status">{passwordNotice}</p> : null}
                {!phoneBindingRequired && phoneEditorOpen ? (
                  <ProfilePhoneChange
                    onCancel={closePhoneEditor}
                    onSuccess={() => {
                      setPhoneNotice('验证手机号已更换，新的验证码登录与找回凭证现已生效。');
                      closePhoneEditor();
                    }}
                  />
                ) : null}
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

              {emailBindingRequired || phoneBindingRequired ? (
                <section className={styles.section} aria-labelledby="binding-title">
                  <div className={styles.sectionLead}>
                    <div>
                      <h3 id="binding-title">补全账号</h3>
                      <p>完成所缺凭证后，即可解锁完整业务页面。</p>
                    </div>
                  </div>
                  <nav className={styles.entries} aria-label="账号补全入口">
                    {emailBindingRequired ? (
                      <Link className={styles.entry} to="/login?next=%2Fstudy" onClick={onClose}>
                        <span className={styles.entryTile}><Icon name="mail" size={18} /></span>
                        <span className={styles.entryCopy}><strong>补录验证邮箱</strong><small>完成验证后解锁备课与讲解</small></span>
                        <Icon name="chevron-right" size={16} className={styles.entryChevron} />
                      </Link>
                    ) : null}
                    {phoneBindingRequired ? (
                      <Link className={styles.entry} to="/login?next=%2Fstudy" onClick={onClose}>
                        <span className={styles.entryTile}><Icon name="phone" size={18} /></span>
                        <span className={styles.entryCopy}><strong>绑定验证手机号</strong><small>完成验证后解锁全部业务页面</small></span>
                        <Icon name="chevron-right" size={16} className={styles.entryChevron} />
                      </Link>
                    ) : null}
                  </nav>
                </section>
              ) : null}
            </>
          ) : null}

          {activeSection === 'commerce' ? <ProfileCommerce /> : null}

          {activeSection === 'records' ? (
            <section className={styles.section} aria-labelledby="transcript-title">
              <div className={styles.sectionLead}>
                <div>
                  <h3 id="transcript-title">我的成绩单</h3>
                  <p>支持 PDF 与常见图片格式，上传后可随时预览、下载或替换。</p>
                </div>
              </div>
              <TranscriptUpload enabled={allCredentialsReady} />
            </section>
          ) : null}

          {activeSection === 'preferences' ? (
            <section className={styles.section} aria-labelledby="preferences-title">
              <div className={styles.sectionLead}>
                <div>
                  <h3 id="preferences-title">学习体验</h3>
                  <p>偏好设置会在独立面板中打开，便于专心调整。</p>
                </div>
              </div>
              <button className={styles.preferenceEntry} type="button" onClick={onOpenSettings}>
                <span className={styles.preferenceIcon}><Icon name="settings" size={22} /></span>
                <span>
                  <strong>打开偏好设置</strong>
                  <small>调整台词、语音与引路方式</small>
                </span>
                <Icon name="chevron-right" size={17} className={styles.entryChevron} />
              </button>
              <div className={styles.preferenceNote}>
                <Icon name="sparkles" size={18} />
                <p><strong>一处调整，贯穿书斋</strong><span>修改后，相关学习页面会采用新的体验偏好。</span></p>
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </dialog>
  );
}
