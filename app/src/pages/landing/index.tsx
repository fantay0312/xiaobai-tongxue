/**
 * 宣传页（站点根 `/`）。
 * 版式：顶栏 → 首屏大字 + 会动的迷你学习终端 → 产品全景 → 七章（学 / 教 / 练 / 托 / 研 / 记 / 随）→ 常见问题与收尾 → 页脚。
 * 章节 id 与名字统一登记在 sections.ts；全页只用皮肤令牌，访客换肤时整页与终端一起变。
 */
import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Seal } from '../../components/shell/Seal';
import { useDocTitle } from '../../hooks/useDocTitle';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SKINS, useSkinStore } from '../../store/skinStore';
import { LandingNav } from './LandingNav';
import { Hero } from './Hero';
import { Overview } from './Overview';
import { LearnChapter } from './LearnChapter';
import { TeachChapter } from './TeachChapter';
import { PracticeChapter } from './PracticeChapter';
import { DelegateChapter } from './DelegateChapter';
import { ResearchChapter } from './ResearchChapter';
import { MemoryChapter } from './MemoryChapter';
import { Anywhere } from './Anywhere';
import { Closing } from './Closing';
import s from './landing.module.css';

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

export default function LandingPage() {
  useDocTitle();
  const reducedMotion = useReducedMotion();
  const pageRef = useScrollReveal(reducedMotion);
  const skin = useSkinStore((state) => state.skin);
  const darkSkin = SKINS.find((item) => item.id === skin)?.dark ?? false;
  const sealPlate = darkSkin ? 'paper' : 'ink';

  return (
    <div className={s.page} ref={pageRef}>
      <LandingNav reducedMotion={reducedMotion} sealPlate={sealPlate} />

      {/* AppShell 已包了一层 <main>，这里不再嵌套 */}
      <div>
        <Hero />
        <Overview />
        <LearnChapter />
        <TeachChapter />
        <PracticeChapter />
        <DelegateChapter />
        <ResearchChapter />
        <MemoryChapter />
        <Anywhere />
        <Closing />
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
