/**
 * 个人中心 —— 与设置同一套骨架：题头是头像与名字，左侧分区目录，右侧一列设置行。
 * 账号、凭证与订阅共用一套分区骨架。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Tabs as RTabs } from 'radix-ui';
import {
  ArrowRight, ChevronRight, LogOut, ShieldCheck, SlidersHorizontal, Ticket, UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useAppStore } from '../../store/appStore';
import { profileAccountKey, useProfileStore } from '../../store/profileStore';
import { useAllTopics } from '../../hooks/useAllTopics';
// 学习身份三引擎：同 growth 页按路径直连纯派生，不进 engine barrel
import { deriveTeacherRank } from '../../engine/achievements';
import { deriveWisdom, deriveEvolution, getStageMeta } from '../../engine/evolution';
import { Badge, Button, Dialog, Progress } from '../ui';
import { ProfileEmailChange } from './ProfileEmailChange';
import { ProfilePhoneChange } from './ProfilePhoneChange';
import { ProfilePasswordChange } from './ProfilePasswordChange';
import { ProfileCommerce } from './ProfileCommerce';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileAvatarEditor } from './ProfileAvatarEditor';
import { useSheetKeyboardInset } from './ProfileSheetKeyboard';
import s from './ProfileDialog.module.css';

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}

type ProfileSection = 'overview' | 'commerce' | 'security' | 'preferences';
type SecurityFlow = 'phone' | 'email' | 'password';

const PROFILE_SECTIONS: { id: ProfileSection; label: string; icon: LucideIcon; description: string }[] = [
  { id: 'overview', label: '个人资料', icon: UserRound, description: '头像、学习身份与账号状态。' },
  { id: 'commerce', label: '订阅与用量', icon: Ticket, description: '套餐、有效权益、用量积分与兑换码。' },
  { id: 'security', label: '账号与安全', icon: ShieldCheck, description: '管理手机号、邮箱与登录密码。' },
  { id: 'preferences', label: '偏好设置', icon: SlidersHorizontal, description: '外观、模型、语音与新手引路都在设置里。' },
];

const SECURITY_FLOW_META: Record<SecurityFlow, { label: string; description: string }> = {
  phone: { label: '更换手机号', description: '先验证当前身份，再设置并验证新的手机号。' },
  email: { label: '更换邮箱', description: '先验证当前身份，再设置并验证新的邮箱。' },
  password: { label: '修改登录密码', description: '先验证当前身份，再设置新的登录密码。' },
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
  const [narrow, setNarrow] = useState(false);
  const emailToggleRef = useRef<HTMLButtonElement>(null);
  const phoneToggleRef = useRef<HTMLButtonElement>(null);
  const passwordToggleRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  useSheetKeyboardInset(scrollRef, open);

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

  /* 窄屏目录是一条横滑的胶囊：把选中的那一枚带到中间，后面的分区才露得出来 */
  useEffect(() => {
    const nav = navRef.current;
    const chip = nav?.querySelector<HTMLElement>('[data-state="active"]');
    if (!nav || !chip || nav.scrollWidth <= nav.clientWidth) return;
    const navBox = nav.getBoundingClientRect();
    const chipBox = chip.getBoundingClientRect();
    nav.scrollTo({
      left: nav.scrollLeft + chipBox.left - navBox.left - (navBox.width - chipBox.width) / 2,
      behavior: 'smooth',
    });
  }, [activeSection]);

  /* 窄屏目录横排：朝向如实交给 Tabs（断点与 module.css 的 720 咬合） */
  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

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

  /* 凭证流程里按 Esc 先退回列表，不直接关窗。
     在 window 捕获阶段拦下，事件就到不了弹窗自己的 Esc 监听 */
  useEffect(() => {
    if (!open || !securityFlow) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeSecurityFlow();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // closeSecurityFlow 只依赖 securityFlow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, securityFlow]);

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

  const baseMeta = PROFILE_SECTIONS.find((section) => section.id === activeSection) ?? PROFILE_SECTIONS[0];
  const paneMeta = activeSection === 'security' && securityFlow ? SECURITY_FLOW_META[securityFlow] : baseMeta;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      size="lg"
      className={s.dialog}
      title={(
        <span className={s.identity}>
          <ProfileAvatar name={user} src={avatar} size="rail" />
          <span className={s.identityCopy}>
            <span className={s.srOnly}>个人中心：</span>
            <span className={s.identityName}>{accountName}</span>
            <span className={s.identityMeta}>{rank.title} · {stageMeta.name} · 学识第 {wisdom.level} 阶</span>
          </span>
        </span>
      )}
    >
      <RTabs.Root
        className={s.layout}
        value={activeSection}
        onValueChange={(value) => selectSection(value as ProfileSection)}
        orientation={narrow ? 'horizontal' : 'vertical'}
      >
        <div className={s.rail}>
          <RTabs.List ref={navRef} className={s.nav} aria-label="个人中心分区">
            {PROFILE_SECTIONS.map(({ id, label, icon: IconComp }) => (
              <RTabs.Trigger key={id} value={id} className={s.navItem}>
                <IconComp size={17} strokeWidth={1.75} />
                <span>{label}</span>
              </RTabs.Trigger>
            ))}
          </RTabs.List>
          <div className={s.railFoot}>
            {logoutIssue ? <p className={s.logoutIssue} role="alert">{logoutIssue}</p> : null}
            <button className={s.logout} type="button" disabled={logoutBusy} onClick={() => void handleLogout()}>
              <LogOut size={17} strokeWidth={1.75} />
              <span>{logoutBusy ? '正在退出…' : '退出登录'}</span>
            </button>
          </div>
        </div>

        <div ref={scrollRef} className={s.pane} data-scroll-root="">
          <header className={s.paneHead}>
            <h3>{paneMeta.label}</h3>
            <p>{paneMeta.description}</p>
          </header>

          <RTabs.Content value="overview" className={s.content}>
            <div className={s.hero}>
              <div className={s.heroStage}>
                <span className={s.heroLabel}>小白的科名</span>
                <strong>{stageMeta.name}</strong>
                <span className={s.heroNote}>{stageMeta.description}</span>
              </div>
              <div className={s.heroWisdom}>
                <span className={s.heroLabel}>学识第 {wisdom.level} 阶</span>
                <Progress value={wisdom.intoLevel} max={wisdom.forNext} label="学识进度" />
                <span className={s.heroNote}>{wisdom.intoLevel} / {wisdom.forNext} · 你是{rank.title}</span>
              </div>
              <Button asChild variant="outline" size="sm" iconRight={<ArrowRight size={14} strokeWidth={1.75} />}>
                <Link to="/growth" onClick={onClose}>成长册</Link>
              </Button>
            </div>

            <Group title="资料">
              <ProfileAvatarEditor account={accountName}>头像</ProfileAvatarEditor>
              <Row label="用户名">
                <span className={s.value}>{accountName}</span>
              </Row>
              <Row label="手机" note={phoneSummary}>
                <Badge tone={phoneBindingRequired ? 'warn' : 'ok'} dot>{phoneBindingRequired ? '待绑定' : '已验证'}</Badge>
              </Row>
              <Row label="邮箱" note={emailSummary}>
                <Badge tone={emailBindingRequired ? 'warn' : 'ok'} dot>{emailBindingRequired ? '待补录' : '已验证'}</Badge>
              </Row>
            </Group>

            <Group title="常用入口">
              <EntryLink to="/learn" onClick={onClose} title="回到学习终端" note="继续选择课程与知识点" />
              <EntryLink to="/growth" onClick={onClose} title="查看成长册" note="回看教学轨迹与小白成长" />
            </Group>
          </RTabs.Content>

          <RTabs.Content value="commerce" className={s.content}>
            <ProfileCommerce />
          </RTabs.Content>

          <RTabs.Content value="security" className={s.content}>
            {!securityFlow ? (
              <>
                <Group
                  title="登录凭证"
                  aside={(
                    <Badge tone={allCredentialsReady ? 'ok' : 'warn'} dot>
                      {allCredentialsReady ? '凭证齐备' : '仍需补全'}
                    </Badge>
                  )}
                >
                  <Row label="手机号" note={phoneSummary}>
                    {phoneBindingRequired ? <Badge tone="warn">待验证</Badge> : (
                      <Button ref={phoneToggleRef} variant="outline" size="sm" onClick={() => openSecurityFlow('phone')}>
                        更换
                      </Button>
                    )}
                  </Row>
                  <Row label="邮箱" note={emailSummary}>
                    {emailBindingRequired ? <Badge tone="warn">待验证</Badge> : (
                      <Button ref={emailToggleRef} variant="outline" size="sm" onClick={() => openSecurityFlow('email')}>
                        更换
                      </Button>
                    )}
                  </Row>
                  <Row label="登录密码" note="用于邮箱或账号 + 密码登录">
                    <Button ref={passwordToggleRef} variant="outline" size="sm" onClick={() => openSecurityFlow('password')}>
                      修改
                    </Button>
                  </Row>
                </Group>
                {securityNotice ? <p className={s.notice} role="status">{securityNotice}</p> : null}

                {emailBindingRequired || phoneBindingRequired ? (
                  <Group title="补全账号">
                    {emailBindingRequired ? (
                      <EntryLink
                        to="/login?next=%2Fstudy"
                        onClick={onClose}
                        title="补录验证邮箱"
                        note="完成验证后解锁备课与讲解"
                      />
                    ) : null}
                    {phoneBindingRequired ? (
                      <EntryLink
                        to="/login?next=%2Fstudy"
                        onClick={onClose}
                        title="绑定验证手机号"
                        note="完成验证后解锁全部业务页面"
                      />
                    ) : null}
                  </Group>
                ) : null}
              </>
            ) : null}

            {securityFlow === 'phone' ? (
              <ProfilePhoneChange
                currentCredential={phoneSummary}
                onCancel={closeSecurityFlow}
                onSuccess={() => {
                  setSecurityNotice('验证手机号已更换，新的验证码登录与找回凭证现已生效。');
                  closeSecurityFlow();
                }}
              />
            ) : null}

            {securityFlow === 'email' ? (
              <ProfileEmailChange
                currentCredential={emailSummary}
                onCancel={closeSecurityFlow}
                onSuccess={() => {
                  setSecurityNotice('验证邮箱已更换，新的登录凭证现已生效。');
                  closeSecurityFlow();
                }}
              />
            ) : null}

            {securityFlow === 'password' ? (
              <ProfilePasswordChange
                currentCredential={`账号 · ${accountName}`}
                onCancel={closeSecurityFlow}
                onSuccess={() => {
                  setSecurityNotice('登录密码已更新，其他设备上的旧会话已失效。');
                  closeSecurityFlow();
                }}
              />
            ) : null}
          </RTabs.Content>

          <RTabs.Content value="preferences" className={s.content}>
            <Group title="设置">
              <Row label="外观与皮肤" note="皮肤、强调色、字体、壁纸与对话样式">
                <Button variant="outline" size="sm" onClick={onOpenSettings}>打开设置</Button>
              </Row>
              <Row label="模型、语音与小白" note="模型线路、语音输入、小白的性格与记忆、新手引路">
                <Button variant="ghost" size="sm" onClick={onOpenSettings}>前往</Button>
              </Row>
            </Group>
          </RTabs.Content>
        </div>
      </RTabs.Root>
    </Dialog>
  );
}

/** 一组设置：小标题（右侧可带状态）+ 若干行 */
function Group({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className={s.group}>
      <div className={s.groupHead}>
        <h4 className={s.groupTitle}>{title}</h4>
        {aside}
      </div>
      <div className={s.rows}>{children}</div>
    </section>
  );
}

/** 设置行：左标签（可带一行注），右侧值或动作 */
function Row({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className={s.row}>
      <div className={s.rowCopy}>
        <span className={s.rowLabel}>{label}</span>
        {note ? <span className={s.rowNote}>{note}</span> : null}
      </div>
      <div className={s.rowControl}>{children}</div>
    </div>
  );
}

function EntryLink({ to, title, note, onClick }: { to: string; title: string; note: string; onClick: () => void }) {
  return (
    <Link className={s.entry} to={to} onClick={onClick}>
      <span className={s.entryCopy}>
        <span>{title}</span>
        <small>{note}</small>
      </span>
      <ChevronRight size={16} strokeWidth={1.75} className={s.entryChevron} />
    </Link>
  );
}
