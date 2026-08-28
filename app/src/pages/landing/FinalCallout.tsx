import { Link } from 'react-router';
import { Icon } from '../../components/ui/Icon';
import { Seal } from '../../components/shell/Seal';
import styles from './FinalCallout.module.css';

const PROMISES = [
  '摸底题和备课材料',
  '小白追问和误区试探',
  '独立随堂测验',
  '五维批注和补学重讲',
] as const;

export function FinalCallout() {
  return (
    <section
      className={styles.wrap}
      aria-labelledby="final-callout-title"
      data-landing-reveal
      data-reveal-order="0"
    >
      <div className={styles.copy}>
        <h2 id="final-callout-title" className={styles.title}>
          挑一课，开讲吧
        </h2>
        <Link className={styles.action} to="/study">
          去课程书架
          <Icon name="arrow-right" size={17} />
        </Link>
      </div>
      <ul className={styles.list}>
        {PROMISES.map((promise) => (
          <li key={promise}>
            <Icon name="check" size={15} />
            {promise}
          </li>
        ))}
      </ul>
      <div className={styles.sign} aria-hidden="true">
        <Seal className={styles.seal} />
        <span>小白同学 · 教然后知困</span>
      </div>
    </section>
  );
}
