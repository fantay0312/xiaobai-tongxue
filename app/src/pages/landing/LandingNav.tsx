/** 宣传页顶栏：品牌、章节导航（宽屏）、章节目录抽屉（窄屏）、登录与主按钮。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Menu as MenuIcon } from 'lucide-react';
import { Button, IconButton, Sheet } from '../../components/ui';
import { Seal } from '../../components/shell/Seal';
import { useAuthStore } from '../../store/authStore';
import { SECTIONS, scrollToSection } from './sections';
import base from './landing.module.css';
import s from './nav.module.css';

/** 顶栏状态：是否已离开页首、当前滚到哪一章。 */
function useNavState() {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const sentinel = sentinelRef.current;
    const topObserver = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting));
    if (sentinel) topObserver.observe(sentinel);

    const spy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) setActive(id);
          else setActive((current) => (current === id ? null : current));
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    for (const section of SECTIONS) {
      const node = document.getElementById(section.id);
      if (node) spy.observe(node);
    }
    return () => {
      topObserver.disconnect();
      spy.disconnect();
    };
  }, []);

  return { sentinelRef, scrolled, active };
}

/** 抽屉内容卸载（退场动画放完、滚动锁已解除）时回调一次 */
function OnUnmount({ run }: { run: () => void }) {
  useEffect(() => run, [run]);
  return null;
}

export function LandingNav({ reducedMotion, sealPlate }: { reducedMotion: boolean; sealPlate: 'ink' | 'paper' }) {
  const { sentinelRef, scrolled, active } = useNavState();
  const authed = useAuthStore((state) => state.status === 'authed');
  const [menuOpen, setMenuOpen] = useState(false);
  // 选了某一章：先关抽屉，等它完全收起（焦点回到菜单按钮、页面解除锁定）再滚过去
  const pendingRef = useRef<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const smooth = !reducedMotion;

  const afterClose = useCallback(() => {
    const target = pendingRef.current;
    pendingRef.current = null;
    // 抽屉没有用 Radix 的 Trigger，关上后焦点要自己还给菜单按钮；排在 Radix 卸载后的那一拍之后
    window.setTimeout(() => {
      triggerRef.current?.focus({ preventScroll: true });
      if (target) scrollToSection(target, smooth);
    }, 30);
  }, [smooth]);

  const pick = (id: string) => {
    pendingRef.current = id;
    setMenuOpen(false);
  };

  return (
    <>
      <span ref={sentinelRef} className={s.sentinel} aria-hidden="true" />
      <header className={s.nav} data-scrolled={scrolled || undefined}>
        <div className={`${base.wrap} ${s.inner}`}>
          <Link to="/" className={s.brand} aria-label="小白同学 首页">
            <Seal className={s.brandSeal} plate={sealPlate} />
            <span>小白同学</span>
          </Link>
          <nav className={s.links} aria-label="页面章节">
            {SECTIONS.filter((section) => section.nav).map((section) => (
              <button
                key={section.id}
                type="button"
                className={s.link}
                data-optional={section.no ? undefined : ''}
                aria-current={active === section.id ? 'true' : undefined}
                onClick={() => scrollToSection(section.id, smooth)}
              >
                {section.label}
              </button>
            ))}
          </nav>
          <div className={s.actions}>
            {!authed && (
              <Button asChild variant="ghost" className={s.login}>
                <Link to="/login">登录</Link>
              </Button>
            )}
            <Button asChild variant="solid" className={s.cta}>
              <Link to="/learn">进入学习终端</Link>
            </Button>
            <IconButton
              label="打开章节目录"
              tip={false}
              className={s.menuButton}
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              ref={triggerRef}
              onClick={() => setMenuOpen(true)}
            >
              <MenuIcon size={20} strokeWidth={1.75} />
            </IconButton>
          </div>
        </div>
      </header>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="目录" width={360} className={s.sheet}>
        <OnUnmount run={afterClose} />
        <div className={s.sheetBody}>
          <ul className={s.sheetList}>
            {SECTIONS.map((section) => {
              const here = active === section.id;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    className={s.sheetItem}
                    aria-current={here ? 'true' : undefined}
                    onClick={() => pick(section.id)}
                  >
                    <span className={s.sheetNo} aria-hidden="true">{section.no ?? ''}</span>
                    <span className={s.sheetGlyph} data-empty={section.glyph ? undefined : ''} aria-hidden="true">
                      {section.glyph ?? '·'}
                    </span>
                    <span className={s.sheetLabel}>{section.label}</span>
                    {here && <span className={s.sheetHere}>当前</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className={s.sheetActions}>
            <Button asChild variant="solid" size="lg" className={s.sheetCta} iconRight={<ArrowRight size={17} strokeWidth={2} />}>
              <Link to="/learn" onClick={() => setMenuOpen(false)}>进入学习终端</Link>
            </Button>
            {!authed && (
              <Button asChild variant="outline" size="lg" className={s.sheetCta}>
                <Link to="/login" onClick={() => setMenuOpen(false)}>登录</Link>
              </Button>
            )}
            <p className={s.sheetNote}>学习终端需要登录后使用。</p>
          </div>
        </div>
      </Sheet>
    </>
  );
}
