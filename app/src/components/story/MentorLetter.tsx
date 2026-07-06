/**
 * 拜师帖 —— 首页零履历时的开场书信(events 为空才由 home 挂载)。
 * 一封信讲清世界观:小白是个什么都想学明白的 AI 学徒,聘你为师;
 * 教明白 = 你真懂(费曼),教到出师 = 你毕业。
 * CTA 不自作主张:走 journey.nextStep,与旅程带同一条路由逻辑。
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { TOPICS } from '../../data';
import { nextStep } from '../../engine/journey';
import s from './story.module.css';

export function MentorLetter() {
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const topicStates = useAppStore((st) => st.topicStates);

  const step = useMemo(
    () => nextStep({ events, reports, topicStates, topics: TOPICS }),
    [events, reports, topicStates],
  );

  return (
    <section className={s.letter} aria-label="小白的拜师帖">
      <p className={s.letterHead} aria-hidden="true">拜师帖</p>

      <div className={s.letterBody}>
        <p className={s.salute}>先生台鉴:</p>
        <p className={s.letterText}>
          小生「小白」,一个什么都想学明白的 AI 学徒。都说<em>讲得出,才是真的懂</em>——故冒昧投帖,聘先生为师。
        </p>
        <p className={s.letterText}>
          往后先生备一课,便讲一课与小生听;小生愚钝,不懂必问,问到先生讲清为止。先生能把小生教明白的学问,才算真正落进先生自己手里。
        </p>
        <p className={s.letterText}>
          教到小生出师那日,便是先生功成之时。
        </p>

        <div className={s.letterFoot}>
          <span className={s.signature}>学徒 小白 敬上</span>
          <span className={s.sealMark} aria-hidden="true">白</span>
        </div>

        <Link className={s.letterCta} to={step.to}>{step.cta}</Link>
      </div>
    </section>
  );
}
