/**
 * 全局外壳 —— 顶部导航 + 设置弹窗。
 * 品牌章 SealMark 与 public/favicon.svg 是同一枚「白」字白文印,改任一侧必须同步。
 * /teach 路由下切换为「夜自习」深色透明变体(粉笔白文字),
 * 页面根不铺纸色底,由讲解舱自铺黑板底。
 * / (宣传页)下头部退为透明静置变体,随海报滚走;品牌落款回宣传页,「书斋」导航到 /study。
 * 宣传页头部不放应用内导航/登入/设置——对外只留品牌与「进入书斋」一个入口。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ProfileDialog, ProfileMark } from './ProfileDialog';
import { SettingsDialog } from './SettingsDialog';
import { Seal } from './Seal';
import { StoryTrail } from '../story/StoryTrail';
import { Icon } from '../ui/Icon';
import { useAuthStore } from '../../store/authStore';
import styles from './AppShell.module.css';

const NAV_LINKS: { to: string; label: string; end: boolean }[] = [
  { to: '/study', label: '书斋', end: true },
  { to: '/growth', label: '成长册', end: false },
  { to: '/teacher', label: '教师看板', end: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // 讲解舱已改「亮书斋 + 木框黑板物件」,全暗外壳退役(board 变体样式保留备用)
  const boardMode = false;
  // 宣传页场景:头部退为透明静置,随海报一起滚走
  const landingMode = pathname === '/';
  const authMode = pathname === '/login';
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const authStatus = useAuthStore((s) => s.status);
  const authUser = useAuthStore((s) => s.user);

  const openSettings = useCallback(() => {
    setProfileOpen(false);
    setSettingsOpen(true);
  }, []);

  const openSettingsFromProfile = useCallback(() => {
    setProfileOpen(false);
    window.requestAnimationFrame(() => setSettingsOpen(true));
  }, []);

  useEffect(() => {
    if (authStatus === 'anon' || authStatus === 'standalone' || authStatus === 'unavailable') {
      setProfileOpen(false);
    }
  }, [authStatus]);

  const shellClass = boardMode
    ? `${styles.shell} ${styles.board}`
    : landingMode
      ? `${styles.shell} ${styles.landing}`
      : authMode ? `${styles.shell} ${styles.auth}` : styles.shell;

  return (
    <div className={shellClass}>
      <header className={styles.header}>
        <NavLink to="/" className={styles.brand} aria-label="回到首页">
          <Seal className={styles.seal} />
          <span className={styles.brandName}>小白同学</span>
          <span className={styles.brandRule} aria-hidden="true" />
          <span className={styles.brandMotto}>教然后知困</span>
        </NavLink>

        {landingMode ? (
          <nav className={styles.nav} aria-label="入口">
            <NavLink to="/study" className={styles.loginBtn}>进入书斋</NavLink>
          </nav>
        ) : (
        <nav className={styles.nav} aria-label="主导航">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.linkActive}` : styles.link
              }
              data-tour={link.to === '/growth' ? 'nav-growth' : undefined}
            >
              {link.label}
            </NavLink>
          ))}

          <span className={styles.navRule} aria-hidden="true" />

          {authStatus === 'anon' && (
            <NavLink to="/login" className={styles.loginBtn}>
              登入
            </NavLink>
          )}
          {authStatus === 'authed' && (
            <button
              type="button"
              className={styles.profileTrigger}
              aria-haspopup="dialog"
              aria-expanded={profileOpen}
              aria-controls="profile-dialog"
              aria-label={`打开 ${authUser ?? ''} 的个人中心`}
              onClick={() => setProfileOpen(true)}
              title={`打开 ${authUser ?? ''} 的个人中心`}
            >
              <ProfileMark name={authUser} compact />
              <span className={styles.profileName}>{authUser}</span>
              <Icon name="chevron-down" size={14} className={styles.profileChevron} />
            </button>
          )}
          <button
            type="button"
            className={styles.gearBtn}
            onClick={openSettings}
            aria-haspopup="dialog"
            aria-label="打开设置"
            title="设置"
          >
            <Icon name="settings" size={16} />
          </button>
        </nav>
        )}
      </header>

      {!landingMode && <StoryTrail pathname={pathname} board={boardMode} />}

      <main className={styles.main}>{children}</main>

      <ProfileDialog
        open={profileOpen && authStatus === 'authed'}
        onClose={closeProfile}
        onOpenSettings={openSettingsFromProfile}
      />
      <SettingsDialog open={settingsOpen} onClose={closeSettings} />
    </div>
  );
}
