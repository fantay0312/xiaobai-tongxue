import type { MouseEventHandler } from 'react';
import { Link } from 'react-router';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { Icon } from '../../components/ui/Icon';
import { Seal } from '../../components/shell/Seal';
import { getStageMeta } from '../../engine/evolution';
import anchor from '../../styles/anchor.module.css';
import paper from '../../styles/paper.module.css';
import styles from './LandingHero.module.css';

const DEMO_STAGE = getStageMeta(2);

interface LandingHeroProps {
  onFlowClick: MouseEventHandler<HTMLAnchorElement>;
}

export function LandingHero({ onFlowClick }: LandingHeroProps) {
  return (
    <section className={styles.hero} aria-labelledby="landing-title">
      <div className={styles.copy}>
        <p className={`${paper.typeLabel} ${styles.eyebrow} ${styles.enter}`}>
          小白同学 · 教然后知困
        </p>
        <h1
          id="landing-title"
          className={`${styles.title} ${styles.enter}`}
          style={{ animationDelay: '70ms' }}
        >
          你来当老师，
          <br />
          把知识<em>讲明白</em>
        </h1>
        <p
          className={`${styles.lede} ${styles.enter}`}
          style={{ animationDelay: '140ms' }}
        >
          选一个知识点，先备课，再讲给小白听。它会接着问，也会把听岔的地方带进考场。
          哪一步没讲清，课后批注会告诉你。
        </p>
        <div
          className={`${styles.actions} ${styles.enter}`}
          style={{ animationDelay: '210ms' }}
        >
          <Link className={styles.primary} to="/study">
            去课程书架
            <Icon name="arrow-right" size={17} />
          </Link>
          <a className={styles.secondary} href="#full-flow" onClick={onFlowClick}>
            看看一堂课怎么走
            <Icon name="chevron-down" size={15} />
          </a>
        </div>
        <p
          className={`${styles.proofLine} ${styles.enter}`}
          style={{ animationDelay: '280ms' }}
        >
          <span>按课程内容追问</span>
          <span>考试时不接收提示</span>
          <span>关键判断留下原话摘录</span>
        </p>
      </div>

      <article
        className={`${styles.ticket} ${paper.texture} ${styles.enter}`}
        style={{ animationDelay: '120ms' }}
        aria-label="Token 与分词演示课"
      >
        <span className={paper.notch} aria-hidden="true" />
        <header className={styles.ticketHead}>
          <div>
            <p className={`${paper.typeLabel} ${styles.ticketKicker}`}>本次演示</p>
            <h2 className={styles.ticketTitle}>Token 与分词</h2>
          </div>
          <Seal className={styles.seal} />
        </header>
        <div className={styles.pupil}>
          <XiaobaiAvatar variant="paper" mood="curious" level={2} size={106} />
          <div>
            <p className={styles.pupilName}>
              小白 · {DEMO_STAGE.name} · {DEMO_STAGE.description}
            </p>
            <p className={styles.pupilRole}>等你来教</p>
          </div>
        </div>
        <dl className={styles.ticketMeta}>
          <div>
            <dt>所属课程</dt>
            <dd>大模型训练</dd>
          </div>
          <div>
            <dt>你要完成</dt>
            <dd>备课 · 讲解 · 纠错</dd>
          </div>
          <div>
            <dt>课后可看</dt>
            <dd>随堂测验 · 五维批注</dd>
          </div>
        </dl>
        <footer className={styles.ticketFoot}>
          <span className={paper.typeLabel}>演示课 · TOKENIZATION</span>
          <Link to="/study" aria-label="进入书斋体验 Token 与分词">
            <Icon name="arrow-right" size={18} />
          </Link>
        </footer>
      </article>

      <blockquote className={`${anchor.quote} ${styles.marginalia}`}>
        <p className={anchor.quoteText}>
          教然后知困，
          <br />
          知困然后能自强
        </p>
        <cite className={anchor.quoteFrom}>《礼记 · 学记》</cite>
      </blockquote>
    </section>
  );
}
