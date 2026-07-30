import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import {
  BadgeCheck,
  BookOpenCheck,
  Boxes,
  Coins,
  FileClock,
  Gauge,
  KeyRound,
  LogOut,
  Menu,
  ShieldCheck,
  TicketCheck,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { canAny } from '../lib/permissions'
import { useAuthStore } from '../store/auth'
import type { Permission } from '../types/admin'
import styles from '../styles/Shell.module.css'

interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  permissions: Permission[]
  group: '运营账册' | '商业配置' | '治理留痕'
}

const navItems: NavItem[] = [
  { label: '运营总览', path: '/', icon: Gauge, permissions: ['overview.read'], group: '运营账册' },
  { label: '用户管理', path: '/users', icon: Users, permissions: ['users.read'], group: '运营账册' },
  { label: '订阅套餐', path: '/subscriptions', icon: TicketCheck, permissions: ['plans.read', 'subscriptions.read'], group: '商业配置' },
  { label: '权益与功能', path: '/entitlements', icon: Boxes, permissions: ['entitlements.read', 'features.read'], group: '商业配置' },
  { label: '积分总账', path: '/points', icon: Coins, permissions: ['points.read'], group: '商业配置' },
  { label: 'CDK 兑换', path: '/cdk', icon: KeyRound, permissions: ['cdk.read'], group: '商业配置' },
  { label: '团队与权限', path: '/access', icon: ShieldCheck, permissions: ['team.read'], group: '治理留痕' },
  { label: '审计日志', path: '/audit', icon: FileClock, permissions: ['audit.read'], group: '治理留痕' },
]

const pageNames: Record<string, string> = {
  '/': '总务处 / 运营总览',
  '/users': '总务处 / 用户管理',
  '/subscriptions': '总务处 / 订阅套餐',
  '/entitlements': '总务处 / 权益与功能',
  '/points': '总务处 / 积分总账',
  '/cdk': '总务处 / CDK 兑换',
  '/access': '总务处 / 团队与权限',
  '/audit': '总务处 / 审计日志',
}

export function AdminShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  const session = useAuthStore((state) => state.session)
  const signOut = useAuthStore((state) => state.signOut)
  const navigate = useNavigate()
  const location = useLocation()
  const visibleItems = navItems.filter((item) => canAny(session, item.permissions))

  async function handleLogout() {
    if (await signOut()) navigate('/login', { replace: true })
  }

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#admin-main">跳到主要内容</a>
      {menuOpen ? (
        <button
          className={styles.scrim}
          aria-label="关闭导航"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''}`}>
        <NavLink className={styles.brand} to="/" onClick={() => setMenuOpen(false)}>
          <span className={styles.brandSeal} aria-hidden="true">务</span>
          <span>
            <span className={styles.brandName}>学籍总务处</span>
            <span className={styles.brandMeta}>XIAOBAI OPERATIONS</span>
          </span>
        </NavLink>
        <nav className={styles.nav} aria-label="管理功能">
          {(['运营账册', '商业配置', '治理留痕'] as const).map((group) => {
            const groupItems = visibleItems.filter((item) => item.group === group)
            if (groupItems.length === 0) return null
            return (
              <div key={group}>
                <p className={styles.navLabel}>{group}</p>
                {groupItems.map(({ label, path, icon: Icon }) => (
                  <NavLink
                    key={path}
                    to={path}
                    end={path === '/'}
                    className={({ isActive }) =>
                      `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                    }
                    onClick={() => setMenuOpen(false)}
                  >
                    <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
                    {label}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className={styles.identity}>
          <span className={styles.identityRole}>
            {session?.isOwner ? <BadgeCheck size={15} /> : <BookOpenCheck size={15} />}
            {session?.roleName ?? '管理成员'}
          </span>
          <span className={styles.identityEmail}>{session?.email}</span>
          <button className={styles.logout} onClick={handleLogout}>
            <LogOut size={15} aria-hidden="true" />
            退出独立管理会话
          </button>
        </div>
      </aside>
      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <button
            className={styles.mobileMenu}
            aria-label={menuOpen ? '关闭导航' : '打开导航'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className={styles.crumb}>{pageNames[location.pathname] ?? '总务处'}</span>
          <span className={styles.sessionTag}>管理会话已验证</span>
        </header>
        <main className={styles.main} id="admin-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
