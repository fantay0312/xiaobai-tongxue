import { useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { useDocTitle } from '../../hooks/useDocTitle';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { CourseArchive } from './CourseArchive';
import { EvidenceArchive } from './EvidenceArchive';
import { FinalCallout } from './FinalCallout';
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

  const scrollToFlow = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById('full-flow')?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return (
    <div className={styles.page} ref={pageRef}>
      <LandingHero onFlowClick={scrollToFlow} />

      <section
        className={styles.flow}
        id="full-flow"
        aria-labelledby="full-flow-title"
      >
        <header className={styles.sectionHead}>
          <p className={styles.kicker} data-landing-reveal data-reveal-order="0">
            演示课
          </p>
          <h2
            id="full-flow-title"
            className={styles.sectionTitle}
            data-landing-reveal
            data-reveal-order="1"
          >
            Token 与分词
          </h2>
        </header>
        <div className={styles.workspaceReveal} data-landing-reveal data-reveal-order="0">
          <LearningWorkspace />
        </div>
      </section>

      <div className={styles.archiveReveal}>
        <EvidenceArchive />
      </div>

      <div className={styles.archiveReveal}>
        <CourseArchive />
      </div>

      <div className={styles.archiveReveal}>
        <FinalCallout />
      </div>
    </div>
  );
}
