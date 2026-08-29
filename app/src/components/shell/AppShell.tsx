/**
 * 全局外壳 —— 顶部导航 + 设置弹窗。
 * 品牌章 Seal 与 public/ 下的页签图标是同一枚小白同学标记,改任一侧必须同步。
 * /teach 路由下切换为「夜自习」深色透明变体(粉笔白文字),
 * 页面根不铺纸色底,由讲解舱自铺黑板底。
 * / (宣传页)下头部同样吸顶;下滚收起、上滚滑出;品牌落款回宣传页,「书斋」导航到 /study。
 * 宣传页头部不放应用内导航/登入——对外留品牌、「进入书斋」与外观设置入口。
 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation } from 'react-router';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Seal } from './Seal';
import { StoryTrail } from '../story/StoryTrail';
import { Icon } from '../ui/Icon';
import { AmbiencePlayer, AtmosphereToggles } from './Atmosphere';
import { TechBarfield } from './TechBarfield';
import { useThemeStore } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { profileAccountKey, useProfileStore } from '../../store/profileStore';
import { ProfileAvatar } from './ProfileAvatar';
import {
  LETTER_CLOSED_EVENT,
  THEME_HINT_EVENT,
  markThemeHintDone,
} from '../tour/tourState';
import styles from './AppShell.module.css';

const ProfileDialog = lazy(() =>
  import('./ProfileDialog').then((module) => ({ default: module.ProfileDialog })),
);
const SettingsDialog = lazy(() =>
  import('./SettingsDialog').then((module) => ({ default: module.SettingsDialog })),
);

interface NavGroup {
  key: string;
  path: string;
  label: string;
  end: boolean;
  sections: { to: string; label: string }[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    key: 'study', path: '/study', label: '书斋', end: true,
    sections: [
      { to: '/study#study-overview', label: '书斋门厅' },
      { to: '/study#lesson-loop', label: '一课的走法' },
      { to: '/study#shelf', label: '选课书架' },
    ],
  },
  {
    key: 'growth', path: '/growth', label: '成长册', end: false,
    sections: [
      { to: '/growth#growth-overview', label: '册页卷首' },
      { to: '/growth#chronicle', label: '成长编年史' },
      { to: '/growth#map', label: '知识星海' },
      { to: '/growth#memory', label: '记忆匣' },
      { to: '/growth#bond', label: '师徒羁绊' },
    ],
  },
  {
    key: 'teacher', path: '/teacher', label: '教师看板', end: false,
    sections: [
      { to: '/teacher#teacher-overview', label: '档案总览' },
      { to: '/teacher#blind-spots', label: '讲不清盲区' },
      { to: '/teacher#topic-progress', label: '知识点学情' },
      { to: '/teacher#misconceptions', label: '心魔台账' },
      { to: '/teacher#recent-sessions', label: '近期会话' },
    ],
  },
];

const THEME_HINT_ID = 'xiaobai-theme-hint';
const THEME_HINT_COPY = '开始前可以选一个好看的主题呀，点我选择！';

function SettingsGear({
  hint,
  wrapRef,
  bubbleRef,
  onClick,
}: {
  hint: boolean;
  wrapRef: RefObject<HTMLSpanElement | null>;
  bubbleRef: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!hint) {
      setPos(null);
      return undefined;
    }
    const place = () => {
      const gear = wrapRef.current?.querySelector('button');
      if (!gear) return;
      const rect = gear.getBoundingClientRect();
      setPos({
        top: Math.round(rect.bottom + 6),
        right: Math.round(window.innerWidth - rect.right),
      });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [hint, wrapRef]);

  return (
    <span className={styles.gearWrap} ref={wrapRef}>
      <button
        type="button"
        className={hint ? `${styles.gearBtn} ${styles.gearBtnHint}` : styles.gearBtn}
        onClick={onClick}
        aria-haspopup="dialog"
        aria-label="打开设置"
        aria-describedby={hint ? THEME_HINT_ID : undefined}
        title="设置"
      >
        <Icon name="settings" size={16} />
      </button>
      {hint && pos && createPortal(
        <button
          id={THEME_HINT_ID}
          ref={bubbleRef}
          type="button"
          className={styles.themeHint}
          style={{ top: pos.top, right: pos.right }}
          aria-live="polite"
          onClick={onClick}
        >
          {THEME_HINT_COPY}
        </button>,
        document.body,
      )}
    </span>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // 讲解舱已改「亮书斋 + 木框黑板物件」,全暗外壳退役(board 变体样式保留备用)
  const boardMode = false;
  // 宣传页场景:头部吸顶,品牌落款回首页
  const landingMode = pathname === '/';
  // 注意精确到 '/teach/':裸 startsWith('/teach') 会把 /teacher 教师看板一并锁死(2026-07-16 生产 bug)
  const appLocked = pathname.startsWith('/teach/');
  const authMode = pathname === '/login';
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeHint, setThemeHint] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [headerHidden, setHeaderHidden] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const themeHintRef = useRef<HTMLSpanElement>(null);
  const themeHintBubbleRef = useRef<HTMLButtonElement>(null);
  const themeHintOn = useRef(false);
  const lastScrollY = useRef(0);
  const reducedMotion = useReducedMotion();
  const uiTheme = useThemeStore((s) => s.theme);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const authStatus = useAuthStore((s) => s.status);
  const authUser = useAuthStore((s) => s.user);
  const avatar = useProfileStore((s) => s.avatars[profileAccountKey(authUser)] ?? null);
  themeHintOn.current = themeHint;

  const openSettings = useCallback(() => {
    setOpenMenu(null);
    setProfileOpen(false);
    setSettingsOpen(true);
  }, []);

  const settleThemeHint = useCallback((openPanel: boolean) => {
    if (themeHintOn.current) {
      themeHintOn.current = false;
      setThemeHint(false);
      markThemeHintDone();
      window.dispatchEvent(new CustomEvent(LETTER_CLOSED_EVENT));
    }
    if (openPanel) openSettings();
  }, [openSettings]);

  useEffect(() => {
    const onHint = () => {
      themeHintOn.current = true;
      setThemeHint(true);
      setHeaderHidden(false);
    };
    window.addEventListener(THEME_HINT_EVENT, onHint);
    return () => window.removeEventListener(THEME_HINT_EVENT, onHint);
  }, []);

  useEffect(() => {
    if (!themeHint) return undefined;
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node;
      if (themeHintRef.current?.contains(node) || themeHintBubbleRef.current?.contains(node)) return;
      settleThemeHint(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') settleThemeHint(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [themeHint, settleThemeHint]);

  const openSettingsFromProfile = useCallback(() => {
    setProfileOpen(false);
    window.requestAnimationFrame(() => setSettingsOpen(true));
  }, []);

  useEffect(() => {
    if (authStatus === 'anon' || authStatus === 'standalone' || authStatus === 'unavailable') {
      setProfileOpen(false);
    }
  }, [authStatus]);

  useEffect(() => {
    setOpenMenu(null);
    setHeaderHidden(false);
    lastScrollY.current = window.scrollY;
  }, [pathname]);

  useEffect(() => {
    if (appLocked) {
      setHeaderHidden(false);
      return undefined;
    }

    lastScrollY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastScrollY.current;
      lastScrollY.current = y;
      if (openMenu || profileOpen || settingsOpen || themeHint || y < 16) {
        setHeaderHidden(false);
        return;
      }
      if (Math.abs(delta) < 8) return;
      setHeaderHidden(delta > 0);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [appLocked, openMenu, profileOpen, settingsOpen, themeHint]);

  useEffect(() => {
    if (!openMenu) return undefined;

    const closeOutside = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const menuKey = openMenu;
      setOpenMenu(null);
      window.requestAnimationFrame(() => document.getElementById(`nav-${menuKey}`)?.focus({ preventScroll: true }));
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [openMenu]);

  const onSectionLinkClick = useCallback((to: string) => {
    const menuKey = openMenu;
    setOpenMenu(null);
    const [targetPath, fragment] = to.split('#');
    const restoreTriggerFocus = () => {
      if (menuKey) document.getElementById(`nav-${menuKey}`)?.focus({ preventScroll: true });
    };
    if (targetPath !== pathname || !fragment) {
      window.requestAnimationFrame(restoreTriggerFocus);
      return;
    }
    window.requestAnimationFrame(() => {
      document.getElementById(decodeURIComponent(fragment))?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
      restoreTriggerFocus();
    });
  }, [openMenu, pathname]);

  const shellVariantClass = boardMode
    ? `${styles.shell} ${styles.board}`
    : landingMode
      ? `${styles.shell} ${styles.landing}`
      : authMode ? `${styles.shell} ${styles.auth}` : styles.shell;
  const shellClass = `${shellVariantClass}${appLocked ? ` ${styles.locked}` : ''}`;

  return (
    <div className={shellClass}>
      {uiTheme === 'tech' && <TechBarfield />}
      <header
        className={`${styles.header}${headerHidden ? ` ${styles.headerHidden}` : ''}${reducedMotion ? ` ${styles.headerInstant}` : ''}`}
        onFocusCapture={() => setHeaderHidden(false)}
      >
        {/* 版心内壳:内容收进 72rem 居中栏,品牌落款与每页正文左缘对齐 */}
        <div className={styles.headerInner}>
          <NavLink to="/" className={styles.brand} aria-label="回到首页">
            <Seal className={styles.seal} />
            <span className={styles.brandName}>小白同学</span>
            <span className={styles.brandRule} aria-hidden="true" />
            <span className={styles.brandMotto}>教然后知困</span>
          </NavLink>

          {landingMode ? (
            <nav className={styles.nav} aria-label="入口">
              <AtmosphereToggles />
              <SettingsGear
                hint={themeHint}
                wrapRef={themeHintRef}
                bubbleRef={themeHintBubbleRef}
                onClick={() => settleThemeHint(true)}
              />
              <NavLink to="/study" className={styles.loginBtn}>进入书斋</NavLink>
            </nav>
          ) : (
          <nav ref={navRef} className={styles.nav} aria-label="主导航">
            {NAV_GROUPS.map((group) => {
              const expanded = openMenu === group.key;
              return (
                <div key={group.key} className={styles.navGroup}>
                  <NavLink
                    to={group.path}
                    end={group.end}
                    className={({ isActive }) => `${styles.link}${isActive ? ` ${styles.linkActive}` : ''}`}
                    data-tour={group.key === 'growth' ? 'nav-growth' : undefined}
                    onClick={() => setOpenMenu(null)}
                  >
                    {group.label}
                  </NavLink>
                  <button
                    id={`nav-${group.key}`}
                    type="button"
                    className={styles.menuButton}
                    aria-expanded={expanded}
                    aria-controls={`nav-${group.key}-sections`}
                    aria-label={`${group.label}章节快跳`}
                    onClick={() => setOpenMenu(expanded ? null : group.key)}
                  >
                    <Icon name="chevron-down" size={13} className={styles.menuChevron} />
                  </button>
                  <div
                    id={`nav-${group.key}-sections`}
                    className={styles.sectionMenu}
                    data-open={expanded || undefined}
                    aria-label={`${group.label}章节快跳`}
                    aria-hidden={!expanded}
                  >
                    {group.sections.map((section) => (
                      <Link
                        key={section.to}
                        to={section.to}
                        className={styles.sectionMenuLink}
                        tabIndex={expanded ? 0 : -1}
                        onClick={() => onSectionLinkClick(section.to)}
                      >
                        {section.label}
                        <Icon name="chevron-right" size={13} />
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}

            <span className={styles.navRule} aria-hidden="true" />

            <AtmosphereToggles />
            <SettingsGear
              hint={themeHint}
              wrapRef={themeHintRef}
              bubbleRef={themeHintBubbleRef}
              onClick={() => settleThemeHint(true)}
            />
            {authStatus === 'anon' && (
              <NavLink to="/login" className={styles.loginBtn}>
                登入
              </NavLink>
            )}
            {/* 已登录:只留一枚圆头像,名字与状态收进个人中心 */}
            {authStatus === 'authed' && (
              <button
                type="button"
                className={styles.profileTrigger}
                aria-haspopup="dialog"
                aria-expanded={profileOpen}
                aria-controls="profile-dialog"
                aria-label={`打开 ${authUser ?? ''} 的个人中心`}
                onClick={() => {
                  setOpenMenu(null);
                  setProfileOpen(true);
                }}
                title={authUser ?? '个人中心'}
              >
                <ProfileAvatar name={authUser} src={avatar} size="nav" />
              </button>
            )}
          </nav>
          )}
        </div>
      </header>

      {!landingMode && <StoryTrail key={pathname} pathname={pathname} board={boardMode} />}

      <main className={styles.main}>{children}</main>

      <AmbiencePlayer />

      <Suspense fallback={null}>
        {!landingMode && (
          <ProfileDialog
            open={profileOpen && authStatus === 'authed'}
            onClose={closeProfile}
            onOpenSettings={openSettingsFromProfile}
          />
        )}
        <SettingsDialog open={settingsOpen} onClose={closeSettings} />
      </Suspense>
    </div>
  );
}
