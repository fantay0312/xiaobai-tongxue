import { Icon, type IconName } from '../../components/ui/Icon';
import s from './Highlights.module.css';

const ITEMS: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'swords',
    title: '它会追问',
    body: '讲得含糊，小白会接着问；顺着误区讲，它会照单全收。你当时纠正了还是认同了，都记在课堂记录里。',
  },
  {
    icon: 'route',
    title: '考试不带提示',
    body: '你退到场外，小白独自答题。分数只反映你讲清楚了多少，每道题都对应回讲解要点。',
  },
  {
    icon: 'lamp',
    title: '课后一页看清',
    body: '关键原话、误区结果、逐题判定、五维批注，还有该先补哪一处。补完再回讲台重讲。',
  },
];

/** 三条产品要点:只说会发生什么，不解释原理。 */
export function Highlights() {
  return (
    <section className={s.section} aria-label="产品要点">
      <ul className={s.grid}>
        {ITEMS.map((item, index) => (
          <li className={s.item} key={item.title} data-landing-reveal data-reveal-order={index}>
            <span className={s.icon} aria-hidden="true">
              <Icon name={item.icon} size={20} />
            </span>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default Highlights;
