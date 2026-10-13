import { Link } from 'react-router';
import { Menu as MenuIcon, Settings } from 'lucide-react';
import { Tip } from '../../../components/ui';
import { IconGrowth } from '../../../components/ui/icons';
import { AccountButton } from '../../../components/shell/WorkspaceNavigation';
import { useShellActions } from '../../../components/shell/ShellActions';
import { TERMINAL_NAV, railKey, type View } from './views';
import t from '../terminal.module.css';

/** 小屏底栏只放最常用的四项，其余收进「更多」抽屉 */
const MOBILE_PRIMARY = new Set(['ask', 'workbench', 'feynman', 'classroom']);

/** 应用导轨：桌面在最左一列，小屏变成底部栏 */
export function TerminalRail({ view, onView, onMore }: {
  view: View;
  onView: (view: View) => void;
  /** 小屏底栏的「更多」：打开侧栏抽屉 */
  onMore: () => void;
}) {
  const { openSettings } = useShellActions();
  const active = railKey(view);
  return (
    <nav className={t.rail} aria-label="终端导航">
      <div className={t.railGroup}>
        {TERMINAL_NAV.map(({ view: id, label, icon: ItemIcon }) => (
          <Tip key={id} label={label} side="right">
            <button
              type="button"
              className={t.railItem}
              aria-label={label}
              aria-current={active === id ? 'page' : undefined}
              data-mobile-hidden={!MOBILE_PRIMARY.has(id) || undefined}
              onClick={() => onView(id as View)}
            >
              <ItemIcon size={19} active={active === id} />
              <span className={t.railLabel}>{label}</span>
            </button>
          </Tip>
        ))}
        <button type="button" className={`${t.railItem} ${t.railMore}`} aria-label="更多" data-active={!MOBILE_PRIMARY.has(active) || undefined} onClick={onMore}>
          <MenuIcon size={19} strokeWidth={1.75} />
          <span className={t.railLabel}>更多</span>
        </button>
      </div>
      <div className={t.railBottom}>
        <Tip label="成长册" side="right">
          <Link className={t.railItem} to="/growth" aria-label="成长册">
            <IconGrowth size={19} />
          </Link>
        </Tip>
        <Tip label="设置" side="right">
          <button type="button" className={t.railItem} aria-label="设置" onClick={openSettings}>
            <Settings size={19} strokeWidth={1.75} />
          </button>
        </Tip>
        <AccountButton compact />
      </div>
    </nav>
  );
}
