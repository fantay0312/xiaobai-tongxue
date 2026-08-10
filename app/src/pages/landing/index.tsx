import { useEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { useDocTitle } from '../../hooks/useDocTitle';
import { CourseArchive } from './CourseArchive';
import { EvidenceArchive } from './EvidenceArchive';
import { FinalCallout } from './FinalCallout';
import { LandingHero } from './LandingHero';
import { LearningWorkspace } from './LearningWorkspace';
import styles from './landing.module.css';

function useScrollReveal(pageRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add(styles.shown));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add(styles.shown);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pageRef]);
}

export default function LandingPage() {
  useDocTitle();
  const pageRef = useRef<HTMLDivElement>(null);
  useScrollReveal(pageRef);

  const scrollToFlow = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
        <header className={`${styles.sectionHead} ${styles.reveal}`} data-reveal>
          <p className={styles.kicker}>《Token 与分词》演示课</p>
          <h2 id="full-flow-title" className={styles.sectionTitle}>
            看一次讲岔，
            <br />
            <em>怎样被追回来</em>
          </h2>
          <p className={styles.sectionNote}>
            这是一次完整的失败分支：老师顺着误区讲错，小白带着错误赴考，再由批注、补学和重讲把它纠正。可暂停或点开任一步细看。
          </p>
        </header>
        <div className={`${styles.workspaceReveal} ${styles.reveal}`} data-reveal>
          <LearningWorkspace />
        </div>
      </section>

      <div className={`${styles.archiveReveal} ${styles.reveal}`} data-reveal>
        <EvidenceArchive />
      </div>

      <div className={`${styles.archiveReveal} ${styles.reveal}`} data-reveal>
        <CourseArchive />
      </div>

      <div className={`${styles.archiveReveal} ${styles.reveal}`} data-reveal>
        <FinalCallout />
      </div>
    </div>
  );
}
