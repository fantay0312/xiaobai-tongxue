import { Link } from 'react-router-dom';
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
    <section className={styles.wrap} aria-labelledby="final-callout-title">
      <div className={styles.copy}>
        <p className={styles.kicker}>从一个知识点开始</p>
        <h2 id="final-callout-title" className={styles.title}>
          挑一课，开讲吧
        </h2>
        <p className={styles.note}>先做摸底题，再把它讲给小白听。</p>
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
