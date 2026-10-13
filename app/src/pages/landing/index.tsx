/**
 * 宣传页（站点根 `/`）。
 * 版式：自带顶栏 → 首屏大字 + 一台会动的迷你学习终端 → 学 / 教 / 练 / 托 四章 → 换肤与收尾。
 * 全页只用皮肤令牌，访客在页尾换肤，整页与终端一起变。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '../../components/ui';
import { Seal } from '../../components/shell/Seal';
import { useDocTitle } from '../../hooks/useDocTitle';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useAuthStore } from '../../store/authStore';
import { SKINS, useSkinStore } from '../../store/skinStore';
import { HeroTerminal } from './HeroTerminal';
import { LearnChapter } from './LearnChapter';
import { TeachChapter } from './TeachChapter';
import { PracticeChapter } from './PracticeChapter';
import { DelegateChapter } from './DelegateChapter';
import s from './landing.module.css';

const CHAPTERS = [
  { id: 'learn', label: '学习终端' },
  { id: 'teach', label: '教小白' },
  { id: 'practice', label: '工作台' },
  { id: 'delegate', label: '助理与课堂' },
] as const;

/** 滚动到某一章。HashRouter 下不能用真锚点（会被当成路由），所以手动滚。 */
function scrollToChapter(id: string, smooth: boolean) {
  document.getElementById(id)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

/** 分组滚动显现：只在支持且未减弱动效时启用；否则内容始终可见。 */
function useScrollReveal(reducedMotion: boolean) {
  const pageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = pageRef.current;
    if (!root || reducedMotion || !('IntersectionObserver' in window)) return undefined;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.shown = '';
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    const foldLine = window.innerHeight * 0.95;
    for (const target of targets) {
      if (target.getBoundingClientRect().top < foldLine) target.dataset.shown = '';
      else observer.observe(target);
    }
    root.dataset.motion = 'on';
    return () => {
      observer.disconnect();
      delete root.dataset.motion;
    };
  }, [reducedMotion]);
  return pageRef;
}

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
    for (const chapter of CHAPTERS) {
      const node = document.getElementById(chapter.id);
      if (node) spy.observe(node);
    }
    return () => {
      topObserver.disconnect();
      spy.disconnect();
    };
  }, []);

  return { sentinelRef, scrolled, active };
}

function SkinStrip() {
  const skin = useSkinStore((state) => state.skin);
  const update = useSkinStore((state) => state.update);
  const current = SKINS.find((item) => item.id === skin) ?? SKINS[0];
  return (
    <div className={s.skins} data-reveal>
      <div className={s.skinsText}>
        <h3>终端的样子，你来定</h3>
        <p>八套皮肤，另可调强调色、圆角、字体和壁纸。在这里点一下，这一页和你的终端一起换。</p>
      </div>
      <div className={s.skinList} role="radiogroup" aria-label="选择皮肤">
        {SKINS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={item.id === skin}
            aria-label={`${item.name}：${item.hint}`}
            className={s.skin}
            onClick={() => update({ skin: item.id })}
          >
            <span className={s.skinChip} style={{ background: item.swatch[0] }}>
              <i style={{ background: item.swatch[1] }} />
              <i style={{ background: item.swatch[2] }} />
              {item.id === skin && <Check size={14} strokeWidth={2.4} className={s.skinCheck} style={{ color: item.swatch[2] }} />}
            </span>
            <span className={s.skinName}>{item.name}</span>
          </button>
        ))}
      </div>
      <p className={s.skinHint} aria-live="polite">{current.name} · {current.hint}</p>
    </div>
  );
}

export default function LandingPage() {
  useDocTitle();
  const reducedMotion = useReducedMotion();
  const pageRef = useScrollReveal(reducedMotion);
  const { sentinelRef, scrolled, active } = useNavState();
  const authed = useAuthStore((state) => state.status === 'authed');
  const skin = useSkinStore((state) => state.skin);
  const darkSkin = SKINS.find((item) => item.id === skin)?.dark ?? false;
  const sealPlate = darkSkin ? 'paper' : 'ink';

  return (
    <div className={s.page} ref={pageRef}>
      <span ref={sentinelRef} className={s.sentinel} aria-hidden="true" />

      <header className={s.nav} data-scrolled={scrolled || undefined}>
        <div className={`${s.wrap} ${s.navInner}`}>
          <Link to="/" className={s.brand} aria-label="小白同学 首页">
            <Seal className={s.brandSeal} plate={sealPlate} />
            <span>小白同学</span>
          </Link>
          <nav className={s.navLinks} aria-label="页面章节">
            {CHAPTERS.map((chapter) => (
              <button
                key={chapter.id}
                type="button"
                className={s.navLink}
                aria-current={active === chapter.id ? 'true' : undefined}
                onClick={() => scrollToChapter(chapter.id, !reducedMotion)}
              >
                {chapter.label}
              </button>
            ))}
          </nav>
          <div className={s.navActions}>
            {!authed && (
              <Button asChild variant="ghost">
                <Link to="/login">登录</Link>
              </Button>
            )}
            <Button asChild variant="solid">
              <Link to="/learn">进入学习终端</Link>
            </Button>
          </div>
        </div>
      </header>

      <div>
        <section className={s.hero} aria-labelledby="landing-title">
          <div className={`${s.wrap} ${s.heroHead}`}>
            <div>
              <p className={s.kicker}>
                <i aria-hidden="true" />
                一间按费曼学习法搭起来的学习终端
              </p>
              <h1 id="landing-title" className={s.heroTitle}>
                <span>讲得明白，</span>
                <span>才算学会。</span>
              </h1>
            </div>
            <div className={s.heroSide}>
              <p className={s.heroLead}>
                先跟导师<strong>小砚</strong>把资料读懂，再把它讲给 AI 学生<strong>小白</strong>
                听。他会追问，也要考试；你讲不清的地方，就是还没懂的地方。
              </p>
              <div className={s.heroActions}>
                <Button asChild variant="solid" size="lg" pill className={s.cta} iconRight={<ArrowRight size={17} strokeWidth={2} />}>
                  <Link to="/learn">进入学习终端</Link>
                </Button>
                {!authed && (
                  <Button asChild variant="outline" size="lg" pill className={s.cta}>
                    <Link to="/login">登录</Link>
                  </Button>
                )}
              </div>
              <p className={s.heroNote}>学习终端需要登录后使用。</p>
            </div>
          </div>
          <div className={`${s.wrap} ${s.heroScene}`}>
            <HeroTerminal />
          </div>
        </section>

        <LearnChapter />
        <TeachChapter />
        <PracticeChapter />
        <DelegateChapter />

        <section className={s.closing} aria-labelledby="landing-closing">
          <div className={s.wrap}>
            <SkinStrip />
            <div className={s.closingBody} data-reveal>
              <h2 id="landing-closing" className={s.closingTitle}>
                <span>今天学的，</span>
                <span>讲给小白听。</span>
              </h2>
              <div className={s.closingActions}>
                <Button asChild variant="solid" size="lg" pill className={s.cta} iconRight={<ArrowRight size={17} strokeWidth={2} />}>
                  <Link to="/learn">进入学习终端</Link>
                </Button>
                {!authed && (
                  <Button asChild variant="ghost" size="lg" pill className={s.cta}>
                    <Link to="/login">登录</Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <footer className={s.footer}>
        <div className={`${s.wrap} ${s.footerInner}`}>
          <div className={s.footerBrand}>
            <Seal className={s.footerSeal} plate={sealPlate} />
            <span>小白同学</span>
            <span className={s.footerTag}>把学会的，再讲一遍</span>
          </div>
          <nav className={s.footerNav} aria-label="页脚">
            <Link to="/learn">学习终端</Link>
            <Link to="/login">登录</Link>
            <button type="button" onClick={() => pageRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })}>
              回到顶部
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
