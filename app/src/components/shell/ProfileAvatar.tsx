import styles from './ProfileAvatar.module.css';

export type ProfileAvatarSize = 'nav' | 'rail' | 'hero';

interface ProfileAvatarProps {
  name: string | null;
  src: string | null;
  size?: ProfileAvatarSize;
  className?: string;
}

function profileInitial(name: string | null): string {
  return Array.from(name?.trim() || '师')[0] ?? '师';
}

export function ProfileAvatar({ name, src, size = 'rail', className }: ProfileAvatarProps) {
  const rootClass = className ? `${styles.avatar} ${className}` : styles.avatar;
  return (
    <span className={rootClass} data-size={size} data-image={src ? 'true' : undefined} aria-hidden="true">
      {src ? <img src={src} alt="" /> : profileInitial(name)}
    </span>
  );
}
