/**
 * 首页 —— 书斋门厅。
 * 大字楷体主张 + 《学记》竖排引文(全站精神锚点)+ 故事层 + 学习闭环横带 + 知识点书架。
 * 故事层二选一:零履历给「拜师帖」(书信体世界观),有履历给「旅程带」(等级印 + 当下一步)。
 */
import { Fragment, type MouseEvent } from 'react';
import { useAppStore } from '../../store/appStore';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { MentorLetter } from '../../components/story/MentorLetter';
import { JourneyRibbon } from '../../components/story/JourneyRibbon';
import { Bookshelf } from './Bookshelf';
import styles from './home.module.css';
import anchor from '../../styles/anchor.module.css';

const LOOP_STEPS: { num: string; name: string; desc: string }[] = [
  { num: '壹', name: '备课', desc: '摸底快测,领材料包' },
  { num: '贰', name: '讲解', desc: '小白追问,误区试探' },
  { num: '叁', name: '复盘', desc: '五维雷达,盲区显形' },
  { num: '肆', name: '补学', desc: '哪里讲不清补哪里' },
  { num: '伍', name: '再讲', desc: '重讲验证,纠正误区' },
];

export default function HomePage() {
  const level = useAppStore((s) => s.global.learningLevel);
  const hasStory = useAppStore((s) => s.events.length > 0);

  const scrollToShelf = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById('shelf')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={styles.page}>
      {/* ── 首屏:主张 + 小白 + 竖排引文 ── */}
      <section className={styles.hero}>
        <div className={styles.heroMain}>
          <p className={`${styles.kicker} ${styles.enter}`}>费曼学习法 · 反转式学习智能体</p>
          <h1 className={`${styles.claim} ${styles.enter}`} style={{ animationDelay: '70ms' }}>
            不是 AI 教你,
            <br />
            是<em>你教会</em>一个 AI
          </h1>
          <p className={`${styles.intro} ${styles.enter}`} style={{ animationDelay: '140ms' }}>
            你来当老师,把知识讲给会追问的 AI 学生「小白」听——讲不清的地方,就是你真正的盲区。
          </p>
          <a
            className={`${styles.cta} ${styles.enter}`}
            style={{ animationDelay: '210ms' }}
            href="#shelf"
            onClick={scrollToShelf}
          >
            带小白上课去
          </a>
        </div>

        <div className={`${anchor.heroAvatar} ${styles.enter}`} style={{ animationDelay: '160ms' }}>
          <XiaobaiAvatar variant="paper" mood="curious" level={level} size={192} />
          <p className={anchor.avatarCaption}>你的 AI 学生 · 小白</p>
        </div>

        <blockquote className={`${anchor.quote} ${styles.enter}`} style={{ animationDelay: '120ms' }}>
          <p className={anchor.quoteText}>
            教然后知困,
            <br />
            知困然后能自强
          </p>
          <cite className={anchor.quoteFrom}>《礼记 · 学记》</cite>
        </blockquote>
      </section>

      {/* ── 故事层:拜师帖(零履历) / 旅程带(有履历) ── */}
      {hasStory ? <JourneyRibbon /> : <MentorLetter />}

      {/* ── 学习闭环一条横带 ── */}
      <section
        className={`${styles.loop} ${styles.enter}`}
        style={{ animationDelay: '260ms' }}
        aria-label="学习闭环:备课、讲解、复盘、补学、再讲"
      >
        {LOOP_STEPS.map((step, i) => (
          <Fragment key={step.name}>
            {i > 0 && <span className={styles.loopArrow} aria-hidden="true" />}
            <div className={styles.loopStep}>
              <span className={styles.loopNum}>{step.num}</span>
              <span className={styles.loopName}>{step.name}</span>
              <span className={styles.loopDesc}>{step.desc}</span>
            </div>
          </Fragment>
        ))}
        <span className={`${styles.loopArrow} ${styles.loopArrowEnd}`} aria-hidden="true" />
        <div className={`${styles.loopStep} ${styles.loopEnd}`}>
          <span className={styles.loopNum}>终</span>
          <span className={styles.loopName}>出师</span>
          <span className={styles.loopDesc}>图谱点亮</span>
        </div>
      </section>

      {/* ── 知识点书架 ── */}
      <Bookshelf />

      {/* ── 参赛信息位 ── */}
      <footer className={anchor.foot}>
        多学科知识书架 · 学习支持类智能体 · 「小白同学——教然后知困」参赛演示
      </footer>
    </div>
  );
}
