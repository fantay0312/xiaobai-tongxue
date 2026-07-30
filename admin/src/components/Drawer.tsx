import { useEffect, useRef, type PropsWithChildren } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui'
import styles from '../styles/Drawer.module.css'

interface DrawerProps extends PropsWithChildren {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
}

export function Drawer({ open, title, subtitle, onClose, children }: DrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
      previous?.focus()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <button className={styles.scrim} aria-label="关闭侧栏" onClick={onClose} />
      <aside className={styles.drawer} aria-label={title}>
        <header className={styles.header}>
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <Button
            ref={closeButtonRef}
            variant="secondary"
            icon={<X size={18} />}
            iconOnly
            aria-label="关闭"
            onClick={onClose}
          />
        </header>
        <div className={styles.body}>{children}</div>
      </aside>
    </>
  )
}
