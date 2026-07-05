/**
 * 全局外壳 —— 顶部导航 + 设置抽屉。
 * /teach 路由下切换为「夜自习」深色透明变体(粉笔白文字),
 * 页面根不铺纸色底,由讲解舱自铺黑板底。
 */
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { SettingsDrawer } from './SettingsDrawer';
import { useAuthStore } from '../../store/authStore';
import styles from './AppShell.module.css';

const NAV_LINKS: { to: string; label: string; end: boolean }[] = [
  { to: '/', label: '书斋', end: true },
  { to: '/growth', label: '成长册', end: false },
  { to: '/teacher', label: '教师看板', end: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const boardMode = /^\/teach(\/|$)/.test(pathname);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const authStatus = useAuthStore((s) => s.status);
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className={boardMode ? `${styles.shell} ${styles.board}` : styles.shell}>
      <header className={styles.header}>
        <NavLink to="/" className={styles.brand} aria-label="回到书斋首页">
          <span className={styles.seal} aria-hidden="true">小白</span>
          <span className={styles.brandText}>
            小白同学<span className={styles.brandDot}>·</span>
            <span className={styles.brandMotto}>教然后知困</span>
          </span>
        </NavLink>

        <nav className={styles.nav} aria-label="主导航">
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.linkActive}` : styles.link
              }
            >
              {link.label}
            </NavLink>
          ))}
          {authStatus === 'anon' && (
            <NavLink
              to="/login"
              className={({ isActive }) =>
                isActive ? `${styles.link} ${styles.linkActive}` : styles.link
              }
            >
              登录
            </NavLink>
          )}
          {authStatus === 'authed' && (
            <button
              type="button"
              className={styles.link}
              onClick={() => void logout()}
              title={`已登录:${authUser ?? ''} · 点击退出`}
            >
              {authUser} · 退出
            </button>
          )}
          <button
            type="button"
            className={styles.gearBtn}
            onClick={() => setSettingsOpen(true)}
            aria-label="打开设置"
            title="设置"
          >
            <GearIcon />
          </button>
        </nav>
      </header>

      <main className={styles.main}>{children}</main>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function GearIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
    </svg>
  );
}
