import type { MouseEventHandler } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../components/ui/Icon';
import styles from './LandingHero.module.css';

interface LandingHeroProps {
  onFlowClick: MouseEventHandler<HTMLAnchorElement>;
}

/** 首屏：一句话说清产品，一个主动作，画面交给下方的课堂窗口。 */
export function LandingHero({ onFlowClick }: LandingHeroProps) {
  return (
    <section className={styles.hero} aria-labelledby="landing-title">
      <h1 id="landing-title" className={`${styles.title} ${styles.enter}`}>
        你来当老师，把知识<em>讲明白</em>。
      </h1>
      <p className={`${styles.lede} ${styles.enter}`} style={{ animationDelay: '70ms' }}>
        小白同学是一个会追问的学生。你备课、讲解、纠错，它独自去考试。
        <br />
        哪里没讲明白，课后一页看清。
      </p>
      <div className={`${styles.actions} ${styles.enter}`} style={{ animationDelay: '140ms' }}>
        <Link className={styles.primary} to="/study">
          开始讲课
          <Icon name="arrow-right" size={17} />
        </Link>
        <a className={styles.secondary} href="#product" onClick={onFlowClick}>
          看一堂课怎么上
          <Icon name="chevron-down" size={15} />
        </a>
      </div>
    </section>
  );
}
