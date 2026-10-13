/**
 * 全局外壳 —— 不再有统一顶栏：宣传页、登录页、讲解舱各自渲染顶栏，学习终端自带导轨与侧栏。
 * 这里只负责：设置 / 个人中心弹窗、背景乐、页面场景标记（data-surface），
 * 以及成长册、教师看板、赴考、复盘这些二级页面共用的应用侧栏。
 * 品牌章 Seal 与 public/ 下的页签图标是同一枚小白同学标记，改任一侧必须同步。
 */
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Menu as MenuIcon, PanelLeft } from 'lucide-react';
import { IconButton, Sheet, cx } from '../ui';
import { AmbiencePlayer } from './Atmosphere';
import { Seal } from './Seal';
import { useAuthStore } from '../../store/authStore';
import { LETTER_CLOSED_EVENT, THEME_HINT_EVENT, markThemeHintDone } from '../tour/tourState';
import { retryModule } from '../../lib/moduleRecovery';
import { ShellActionsContext } from './ShellActions';
import { WorkspaceNavigation } from './WorkspaceNavigation';
import { TERMINAL_NAV, terminalViewPath } from '../../pages/learn/shell/views';
import styles from './AppShell.module.css';
import workspace from './workspace.module.css';

const ProfileDialog = lazy(() =>
  retryModule(() => import('./ProfileDialog')).then((module) => ({ default: module.ProfileDialog })),
);
const SettingsDialog = lazy(() =>
  retryModule(() => import('./SettingsDialog')).then((module) => ({ default: module.SettingsDialog })),
);

/** 手机底栏放的四个终端板块，与学习终端自己的底栏一致 */
const MOBILE_PRIMARY = ['ask', 'workbench', 'feynman', 'classroom'];
const MOBILE_NAV = TERMINAL_NAV.filter((item) => MOBILE_PRIMARY.includes(item.view));
/** 二级页面在手机顶栏上显示的名字 */
const SECONDARY_TITLES: [prefix: string, title: string][] = [
  ['/growth', '成长册'],
  ['/teacher', '教师看板'],
  ['/exam/', '赴考'],
  ['/review/', '复盘'],
];

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // 注意精确到 '/teach/'：裸 startsWith('/teach') 会把 /teacher 教师看板一并锁死（2026-07-16 生产 bug）
  const boardMode = pathname.startsWith('/teach/');
  const landingMode = pathname === '/';
  const authMode = pathname === '/login';
  const terminalMode = pathname === '/learn' || pathname.startsWith('/prep/');
  const workspaceMode = !landingMode && !authMode && !boardMode;
  const secondaryWorkspace = workspaceMode && !terminalMode;

  const [navSheetOpen, setNavSheetOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const authStatus = useAuthStore((state) => state.status);

  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openSettings = useCallback(() => {
    setProfileOpen(false);
    setSettingsOpen(true);
  }, []);
  const openProfile = useCallback(() => {
    setSettingsOpen(false);
    setProfileOpen(true);
  }, []);
  const openSettingsFromProfile = useCallback(() => {
    setProfileOpen(false);
    window.requestAnimationFrame(() => setSettingsOpen(true));
  }, []);

  useEffect(() => {
    // workspace = 应用内页面；marketing = 宣传页与登录；board = 讲解舱
    document.documentElement.dataset.surface = workspaceMode ? 'workspace' : boardMode ? 'board' : 'marketing';
    setNavSheetOpen(false);
    return () => { delete document.documentElement.dataset.surface; };
  }, [workspaceMode, boardMode, pathname]);

  useEffect(() => {
    // 顶栏的主题提示气泡已退役：拜师帖收下后直接放行，等在后面的引路照常继续
    const relay = () => {
      markThemeHintDone();
      window.dispatchEvent(new CustomEvent(LETTER_CLOSED_EVENT));
    };
    window.addEventListener(THEME_HINT_EVENT, relay);
    return () => window.removeEventListener(THEME_HINT_EVENT, relay);
  }, []);

  useEffect(() => {
    if (authStatus === 'anon' || authStatus === 'standalone' || authStatus === 'unavailable') setProfileOpen(false);
  }, [authStatus]);

  const shellClass = cx(
    styles.shell,
    boardMode && styles.locked,
    terminalMode && styles.terminal,
    workspaceMode && workspace.workspace,
  );

  return (
    <ShellActionsContext.Provider value={{ openSettings, openProfile }}>
      <div className={shellClass}>
        {secondaryWorkspace ? (
          <div className={workspace.surface} data-navigation-collapsed={navCollapsed || undefined}>
            <WorkspaceNavigation onClose={() => setNavCollapsed(true)} />
            <div className={workspace.pane}>
              <div className={workspace.mobileBar}>
                <IconButton label="打开导航" tip={false} onClick={() => setNavSheetOpen(true)}>
                  <PanelLeft size={18} strokeWidth={1.75} />
                </IconButton>
                <Seal />
                <span>{SECONDARY_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? '小白同学'}</span>
              </div>
              <IconButton label="展开侧栏" tip="right" className={workspace.reveal} onClick={() => setNavCollapsed(false)}>
                <PanelLeft size={18} strokeWidth={1.75} />
              </IconButton>
              <main className={cx(styles.main, workspace.content)}>{children}</main>
              {/* 手机底栏：和学习终端同一排入口，随时回到终端；本页在「更多」里 */}
              <nav className={workspace.mobileNav} aria-label="学习终端">
                {MOBILE_NAV.map(({ view, label, icon: ItemIcon }) => (
                  <Link key={view} to={terminalViewPath(view)} className={workspace.mobileNavItem}>
                    <ItemIcon size={19} />
                    <span>{label}</span>
                  </Link>
                ))}
                <button type="button" className={workspace.mobileNavItem} data-active aria-label="更多" onClick={() => setNavSheetOpen(true)}>
                  <MenuIcon size={19} strokeWidth={1.75} />
                  <span>更多</span>
                </button>
              </nav>
            </div>
            <Sheet open={navSheetOpen} onOpenChange={setNavSheetOpen} title="导航" side="left" width={300} className={workspace.sheet}>
              <WorkspaceNavigation onNavigate={() => setNavSheetOpen(false)} />
            </Sheet>
          </div>
        ) : (
          <main className={styles.main}>{children}</main>
        )}

        <AmbiencePlayer />

        <Suspense fallback={null}>
          {!landingMode && profileOpen && authStatus === 'authed' && (
            <ProfileDialog open onClose={closeProfile} onOpenSettings={openSettingsFromProfile} />
          )}
          {settingsOpen && <SettingsDialog open={settingsOpen} onClose={closeSettings} />}
        </Suspense>
      </div>
    </ShellActionsContext.Provider>
  );
}
