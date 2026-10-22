import { useEffect, useRef, type FocusEvent as ReactFocusEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router';
import { Menu as MenuIcon, Settings } from 'lucide-react';
import { IconGrowth } from '../../../components/ui/icons';
import { AccountButton } from '../../../components/shell/AccountButton';
import { useShellActions } from '../../../components/shell/ShellActions';
import { TERMINAL_NAV, railKey, type View } from './views';
import t from '../terminal.module.css';

/** 小屏底栏只放最常用的四项，其余收进「更多」抽屉 */
const MOBILE_PRIMARY = new Set(['ask', 'workbench', 'feynman', 'classroom']);

/** 最近一次输入来自键盘还是指针。指针点过导轨后，不要让残留焦点把展开状态钉住。 */
function useInputModality() {
  const modality = useRef<'keyboard' | 'pointer'>('pointer');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return;
      modality.current = 'keyboard';
    };
    const onPointer = () => { modality.current = 'pointer'; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  return modality;
}

/** 应用导轨：桌面在最左一列，小屏变成底部栏 */
export function TerminalRail({ view, onView, onMore }: {
  view: View;
  onView: (view: View) => void;
  /** 小屏底栏的「更多」：打开侧栏抽屉 */
  onMore: () => void;
}) {
  const { openSettings } = useShellActions();
  const active = railKey(view);
  const modality = useInputModality();

  const onFocus = (event: ReactFocusEvent<HTMLElement>) => {
    const rail = event.currentTarget;
    if (modality.current === 'keyboard') {
      rail.removeAttribute('data-suppress-focus');
      rail.removeAttribute('data-settled');
      return;
    }
    rail.setAttribute('data-suppress-focus', '');
  };
  const onClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.detail === 0) return;
    const rail = event.currentTarget;
    rail.setAttribute('data-settled', '');
    rail.setAttribute('data-suppress-focus', '');
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && rail.contains(focused)) focused.blur();
  };
  const onMouseLeave = (event: ReactMouseEvent<HTMLElement>) => {
    event.currentTarget.removeAttribute('data-settled');
  };

  return (
    <nav
      className={t.rail}
      aria-label="终端导航"
      onFocus={onFocus}
      onClick={onClick}
      onMouseLeave={onMouseLeave}
    >
      <div className={t.railGroup}>
        {TERMINAL_NAV.map(({ view: id, label, icon: ItemIcon }) => (
          <button
            key={id}
            type="button"
            className={t.railItem}
            aria-label={label}
            aria-current={active === id ? 'page' : undefined}
            data-mobile-hidden={!MOBILE_PRIMARY.has(id) || undefined}
            onClick={() => onView(id as View)}
          >
            <span className={t.railGlyph}><ItemIcon size={19} active={active === id} /></span>
            <span className={t.railLabel}>{label}</span>
          </button>
        ))}
        <button type="button" className={`${t.railItem} ${t.railMore}`} aria-label="更多" data-active={!MOBILE_PRIMARY.has(active) || undefined} onClick={onMore}>
          <span className={t.railGlyph}><MenuIcon size={19} strokeWidth={1.75} /></span>
          <span className={t.railLabel}>更多</span>
        </button>
      </div>
      <div className={t.railBottom}>
        <Link className={t.railItem} to="/growth" aria-label="成长册">
          <span className={t.railGlyph}><IconGrowth size={19} /></span>
          <span className={t.railLabel}>成长册</span>
        </Link>
        <button type="button" className={t.railItem} aria-label="设置" onClick={openSettings}>
          <span className={t.railGlyph}><Settings size={19} strokeWidth={1.75} /></span>
          <span className={t.railLabel}>设置</span>
        </button>
        <AccountButton compact nameClassName={t.railLabel} />
      </div>
    </nav>
  );
}
