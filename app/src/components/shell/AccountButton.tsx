import { Link } from 'react-router';
import { LogIn } from 'lucide-react';
import { cx } from '../ui';
import { useAuthStore } from '../../store/authStore';
import { profileAccountKey, useProfileStore } from '../../store/profileStore';
import { ProfileAvatar } from './ProfileAvatar';
import { useShellActions } from './ShellActions';
import s from './workspace.module.css';

/** Lightweight account control; importing it must not load course or journey data. */
export function AccountButton({ compact = false, nameClassName }: { compact?: boolean; nameClassName?: string }) {
  const { openProfile } = useShellActions();
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const avatar = useProfileStore((state) => state.avatars[profileAccountKey(user)] ?? null);
  const name = status === 'authed' ? (user ?? '个人中心') : '登录';
  const nameNode = (!compact || nameClassName) ? <span className={nameClassName ?? s.accountName}>{name}</span> : null;
  if (status === 'authed') return <button type="button" data-rail={nameClassName ? '' : undefined} className={cx(s.account, compact && s.accountCompact)} onClick={openProfile} aria-label={`打开 ${user ?? ''} 的个人中心`}>
    <ProfileAvatar name={user} src={avatar} size="nav" className={s.accountAvatar} />{nameNode}
  </button>;
  return <Link to="/login" data-rail={nameClassName ? '' : undefined} className={cx(s.account, compact && s.accountCompact)} aria-label="登录">
    <span className={s.accountIcon}><LogIn size={16} strokeWidth={1.75} /></span>{nameNode}
  </Link>;
}
