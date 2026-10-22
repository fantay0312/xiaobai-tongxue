/**
 * 应用侧栏 —— 成长册、教师看板、赴考、复盘等二级页面使用。
 * 与学习终端侧栏同一套导航项与令牌；导航定义在 pages/learn/shell/views.ts，两边共用。
 */
import { Link, NavLink, useLocation } from 'react-router';
import { ClipboardList, PanelLeftClose, Settings } from 'lucide-react';
import { IconButton } from '../ui';
import { IconGrowth } from '../ui/icons';
import { JourneyStatusCard } from '../story/JourneyStatus';
import { TERMINAL_NAV, terminalViewPath } from '../../pages/learn/shell/views';
import { AccountButton } from './AccountButton';
import { Seal } from './Seal';
import { useShellActions } from './ShellActions';
import s from './workspace.module.css';

export { AccountButton } from './AccountButton';

export function WorkspaceNavigation({ onClose, onNavigate }: { onClose?: () => void; onNavigate?: () => void }) {
  const { openSettings } = useShellActions();
  const { pathname } = useLocation();
  const inReview = pathname.startsWith('/exam/') || pathname.startsWith('/review/');
  return (
    <aside className={s.navigation} aria-label="应用导航">
      <div className={s.brandRow}>
        <Link to="/learn" className={s.brand} onClick={onNavigate}>
          <Seal />
          <span>小白同学</span>
        </Link>
        {onClose && (
          <IconButton label="收起侧栏" size="sm" tip="bottom" onClick={onClose}>
            <PanelLeftClose size={17} strokeWidth={1.75} />
          </IconButton>
        )}
      </div>

      <nav className={s.navLinks} aria-label="学习终端" onClick={onNavigate}>
        <p className={s.navHeading}>学习终端</p>
        {TERMINAL_NAV.map(({ view, label, icon: ItemIcon }) => (
          <Link key={view} to={terminalViewPath(view)} className={s.navItem} data-active={(view === 'feynman' && inReview) || undefined}>
            <ItemIcon size={17} active={view === 'feynman' && inReview} />
            <span>{label}</span>
          </Link>
        ))}
        <p className={s.navHeading}>记录</p>
        <NavLink to="/growth" className={s.navItem}>
          <IconGrowth size={17} />
          <span>成长册</span>
        </NavLink>
        <NavLink to="/teacher" className={s.navItem}>
          <ClipboardList size={17} strokeWidth={1.75} />
          <span>教师看板</span>
        </NavLink>
      </nav>

      <div className={s.navFooter}>
        <JourneyStatusCard compact />
        <div className={s.footerRow} onClick={onNavigate}>
          <AccountButton />
          <IconButton label="设置" size="sm" onClick={openSettings}>
            <Settings size={17} strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>
    </aside>
  );
}
