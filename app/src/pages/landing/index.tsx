import { useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { Link } from 'react-router';
import { useDocTitle } from '../../hooks/useDocTitle';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { Seal } from '../../components/shell/Seal';
import { CourseArchive } from './CourseArchive';
import { EvidenceArchive } from './EvidenceArchive';
import { FinalCallout } from './FinalCallout';
import { Highlights } from './Highlights';
import { LandingHero } from './LandingHero';
import { LearningWorkspace } from './LearningWorkspace';
import styles from './landing.module.css';

function useScrollReveal(
  pageRef: RefObject<HTMLDivElement | null>,
  reducedMotion: boolean,
) {
  useLayoutEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const elements = Array.from(
      root.querySelectorAll<HTMLElement>('[data-landing-reveal]'),
    );
    const showWithoutMotion = () => {
      elements.forEach((element) => delete element.dataset.revealState);
    };
    if (reducedMotion || !('IntersectionObserver' in window)) {
      showWithoutMotion();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.revealState = 'shown';
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.01, rootMargin: '0px 0px -10% 0px' },
    );

    const revealLine = window.innerHeight * 0.9;
    elements.forEach((element) => {
      const bounds = element.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top <= revealLine) {
        element.dataset.revealState = 'shown';
        return;
      }
      element.dataset.revealState = 'pending';
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, [pageRef, reducedMotion]);
}

export default function LandingPage() {
  useDocTitle();
  const pageRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useScrollReveal(pageRef, reducedMotion);

  const scrollToProduct = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById('product')?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return (
    <div className={styles.page} ref={pageRef}>
      <LandingHero onFlowClick={scrollToProduct} />

      <section className={styles.product} id="product" aria-label="一堂课的六个步骤">
        <div className={styles.productFrame}>
          <LearningWorkspace />
        </div>
      </section>

      <Highlights />
      <EvidenceArchive />
      <CourseArchive />
      <FinalCallout />

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <Seal className={styles.footerSeal} />
          <span>小白同学</span>
          <span className={styles.footerMotto}>教然后知困</span>
        </div>
        <nav className={styles.footerNav} aria-label="页脚">
          <Link to="/study">课程书架</Link>
          <Link to="/login">登录</Link>
        </nav>
      </footer>
    </div>
  );
}
