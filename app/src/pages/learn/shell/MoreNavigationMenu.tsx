import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ClipboardList, PanelLeft, Settings, UserRound } from 'lucide-react';
import { IconGrowth } from '../../../components/ui/icons';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '../../../components/ui';
import { useShellActions } from '../../../components/shell/ShellActions';
import { useAuthStore } from '../../../store/authStore';
import { MORE_TERMINAL_NAV, terminalViewPath, type View } from './views';
import s from './moreNavigation.module.css';

/** Secondary tools stay discoverable without occupying the primary navigation. */
export function MoreNavigationMenu({ children, active, onView, onOpenSidebar, side = 'right', onNavigate }: {
  children: ReactNode;
  active?: string;
  onView?: (view: View) => void;
  onOpenSidebar?: () => void;
  side?: 'top' | 'right' | 'bottom';
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const { openSettings, openProfile } = useShellActions();
  const status = useAuthStore((state) => state.status);
  const go = (path: string) => { onNavigate?.(); navigate(path); };
  return <Menu>
    <MenuTrigger asChild>{children}</MenuTrigger>
    <MenuContent side={side} align="start" aria-label="更多功能" className={s.menu}>
      {onOpenSidebar && <><MenuItem icon={<PanelLeft size={17} />} onSelect={onOpenSidebar}>课程与对话</MenuItem><MenuSeparator /></>}
      <MenuLabel>更多工具</MenuLabel>
      {MORE_TERMINAL_NAV.map(({ view, label, icon: Icon }) => <MenuItem key={view} icon={<Icon size={17} />} checked={active === view} onSelect={() => {
        onNavigate?.();
        if (onView) onView(view as View); else navigate(terminalViewPath(view));
      }}>{label}</MenuItem>)}
      <MenuSeparator />
      <MenuItem icon={<IconGrowth size={17} />} onSelect={() => go('/growth')}>成长册</MenuItem>
      <MenuItem icon={<ClipboardList size={17} />} onSelect={() => go('/teacher')}>教师看板</MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Settings size={17} />} onSelect={() => { onNavigate?.(); openSettings(); }}>设置</MenuItem>
      <MenuItem icon={<UserRound size={17} />} onSelect={() => { onNavigate?.(); if (status === 'authed') openProfile(); else navigate('/login'); }}>{status === 'authed' ? '个人中心' : '登录'}</MenuItem>
    </MenuContent>
  </Menu>;
}
