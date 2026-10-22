/**
 * 应用侧栏 —— 成长册、教师看板、赴考、复盘等二级页面使用。
 * 与学习终端侧栏同一套导航项与令牌；导航定义在 pages/learn/shell/views.ts，两边共用。
 */
import { Link, useLocation } from 'react-router';
import { Menu as MenuIcon, PanelLeftClose, Settings } from 'lucide-react';
import { IconButton } from '../ui';
import { JourneyStatusCard } from '../story/JourneyStatus';
import { PRIMARY_TERMINAL_NAV, terminalViewPath } from '../../pages/learn/shell/views';
import { MoreNavigationMenu } from '../../pages/learn/shell/MoreNavigationMenu';
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

      <nav className={s.navLinks} aria-label="学习终端">
        <p className={s.navHeading}>学习终端</p>
        {PRIMARY_TERMINAL_NAV.map(({ view, label, icon: ItemIcon }) => (
          <Link key={view} to={terminalViewPath(view)} className={s.navItem} data-active={(view === 'feynman' && inReview) || undefined} onClick={onNavigate}>
            <ItemIcon size={17} active={view === 'feynman' && inReview} />
            <span>{label}</span>
          </Link>
        ))}
        <MoreNavigationMenu side="right" onNavigate={onNavigate}><button type="button" className={s.navItem} aria-label="更多功能" data-active={!inReview || undefined}>
          <MenuIcon size={17} /><span>更多</span>
        </button></MoreNavigationMenu>
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
