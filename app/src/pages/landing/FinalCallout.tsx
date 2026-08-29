import { Link } from 'react-router';
import { Icon } from '../../components/ui/Icon';
import { Seal } from '../../components/shell/Seal';
import styles from './FinalCallout.module.css';

export function FinalCallout() {
  return (
    <section
      className={styles.wrap}
      aria-labelledby="final-callout-title"
      data-landing-reveal
    >
      <div className={styles.copy}>
        <h2 id="final-callout-title" className={styles.title}>
          挑一课，开讲吧
        </h2>
        <p className={styles.note}>先做几道摸底题，再把它讲给小白听。</p>
        <Link className={styles.action} to="/study">
          开始讲课
          <Icon name="arrow-right" size={17} />
        </Link>
      </div>
      <div className={styles.sign} aria-hidden="true">
        <Seal className={styles.seal} />
        <span>小白同学 · 教然后知困</span>
      </div>
    </section>
  );
}
