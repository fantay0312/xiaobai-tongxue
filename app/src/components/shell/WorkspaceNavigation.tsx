import { Link, NavLink } from 'react-router';
import { Icon } from '../ui/Icon';
import { Seal } from './Seal';
import { useShellActions } from './ShellActions';
import { useAuthStore } from '../../store/authStore';
import s from './workspace.module.css';

export function WorkspaceNavigation({ onClose, onNavigate }: { onClose?: () => void; onNavigate?: () => void }) {
  const { openSettings, openProfile } = useShellActions();
  const authed = useAuthStore((state) => state.status === 'authed');
  return <aside className={s.navigation} aria-label="应用导航">
    <div className={s.brandRow}><Link to="/learn" className={s.brand}><Seal /><span>小白同学</span></Link>{onClose && <button className={s.iconButton} aria-label="收起应用导航" onClick={onClose}><Icon name="panel-left" size={19} /></button>}</div>
    <nav className={s.navLinks} aria-label="学习工具" onClick={onNavigate}>
      <NavLink to="/learn" end><Icon name="message" />新会话</NavLink>
      <Link to="/learn?view=library"><Icon name="library" />资料库</Link>
      <Link to="/learn?view=journey"><Icon name="route" />师徒旅程</Link>
      <NavLink to="/growth"><Icon name="notebook" />学习记录</NavLink>
      <NavLink to="/teacher"><Icon name="clipboard" />教师看板</NavLink>
    </nav>
    <div className={s.navHint}>课程与学习对话<br />都在学习终端中继续。</div>
    <footer className={s.footer}><button onClick={openSettings}><Icon name="settings" />设置</button>{authed ? <button onClick={openProfile}><Icon name="user" />个人中心</button> : <Link to="/login"><Icon name="user" />登录</Link>}</footer>
  </aside>;
}
