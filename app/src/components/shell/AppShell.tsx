/**
 * 全局外壳 —— 顶部导航 + 设置抽屉。
 * 品牌章 SealMark 与 public/favicon.svg 是同一枚「白」字白文印,改任一侧必须同步。
 * /teach 路由下切换为「夜自习」深色透明变体(粉笔白文字),
 * 页面根不铺纸色底,由讲解舱自铺黑板底。
 * / (宣传页)下头部退为透明静置变体,随海报滚走;品牌落款回宣传页,「书斋」导航到 /study。
 * 宣传页头部不放应用内导航/登入/设置——对外只留品牌与「进入书斋」一个入口。
 */
import { useCallback, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { SettingsDrawer } from './SettingsDrawer';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const authStatus = useAuthStore((s) => s.status);
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const shellClass = boardMode
    ? `${styles.shell} ${styles.board}`
    : landingMode
      ? `${styles.shell} ${styles.landing}`
      : styles.shell;

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
              className={styles.userBtn}
              onClick={() => void logout()}
              title={`已登录:${authUser ?? ''} · 点击退出`}
            >
              <span className={styles.userName}>{authUser}</span>
              <span className={styles.userExit}>退出</span>
            </button>
          )}
          <button
            type="button"
            className={styles.gearBtn}
            onClick={() => setSettingsOpen(true)}
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

      <SettingsDrawer open={settingsOpen} onClose={closeSettings} />
    </div>
  );
}
