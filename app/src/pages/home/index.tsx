/**
 * 首页 —— 书斋门厅。
 * 大字楷体主张 + 《学记》竖排引文(全站精神锚点)+ 故事层 + 学习闭环横带 + 知识点书架。
 * 故事层二选一:零履历给「拜师帖」(书信体世界观),有履历给「旅程带」(称号印 + 当下一步)。
 */
import { type MouseEvent } from 'react';
import { useAppStore } from '../../store/appStore';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { MentorLetter } from '../../components/story/MentorLetter';
import { JourneyRibbon } from '../../components/story/JourneyRibbon';
import { Tour, type TourStep } from '../../components/tour/Tour';
import { RoundStamp } from '../../components/ui/RoundStamp';
import { Bookshelf } from './Bookshelf';
import { useDocTitle } from '../../hooks/useDocTitle';
import styles from './home.module.css';
import anchor from '../../styles/anchor.module.css';

/** 门厅引路(小白口吻,册页语境称「先生」):指路条 → 闭环 → 书架 → 成长册,自上而下不折返。
    第一步按履历分两套话:零履历时案头是拜师帖信封条,有履历才是指路的旅程带——话要对得上东西 */
function buildHomeTour(hasStory: boolean): TourStep[] {
  return [
    hasStory
      ? {
          target: '[data-tour="story"]',
          title: '案头一条笺',
          text: '这条案头笺永远指着「当下最该做的一步」——先生迷了路,回门厅看它准没错。',
        }
      : {
          target: '[data-tour="story"]',
          title: '案头一封帖',
          text: '小生的拜师帖收在案头,点「展帖重读」随时能重看。等先生开了课,这里会换成一条旅程带,永远指着当下最该做的一步。',
        },
    {
      target: '[data-tour="loop"]',
      title: '一课的走法',
      text: '每一课都走这六步:备课、讲解、赴考、批注、补学、再讲,直到把小生教到出师。',
    },
    {
      target: '#shelf',
      title: '满架的课',
      text: '一函一课。新书翻开先进备课桌温一遍;已开讲的书,翻开就回讲解舱接着讲。',
    },
    {
      target: '[data-tour="nav-growth"]',
      title: '小生的成长册',
      text: '小生学到的都记在成长册里:印章、旅程、还有小生的记忆匣,先生得空就来翻翻。',
    },
  ];
}

const LOOP_STEPS: { num: string; name: string; desc: string }[] = [
  { num: '壹', name: '备课', desc: '摸底快测,领材料包' },
  { num: '贰', name: '讲解', desc: '小白追问,误区试探' },
  { num: '叁', name: '赴考', desc: '独自作答,先生观战' },
  { num: '肆', name: '批注', desc: '五维雷达,盲区显形' },
  { num: '伍', name: '补学', desc: '哪里讲不清补哪里' },
  { num: '陆', name: '再讲', desc: '重讲验证,纠正误区' },
];

export default function HomePage() {
  useDocTitle('书斋门厅');
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

        <div
          className={`${anchor.heroAvatar} ${styles.lampNest} ${styles.enter}`}
          style={{ animationDelay: '160ms' }}
        >
          <XiaobaiAvatar variant="paper" mood="curious" level={level} size={192} />
          <p className={anchor.avatarCaption}>你的 AI 学生 · 小白</p>
          <blockquote className={styles.dreamQuote}>
            <span>小白的愿望</span>
            “我想有一天，也能像先生一样，把道理讲给别人听。”
          </blockquote>
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

      {/* ── 一课的走法:墨线路线图(题头 + 一线穿七节点,不裹卡) ── */}
      <section
        className={`${styles.loop} ${styles.enter}`}
        style={{ animationDelay: '260ms' }}
        aria-label="学习闭环:备课、讲解、赴考、批注、补学、再讲"
        data-tour="loop"
      >
        <header className={styles.loopHead}>
          <div className={styles.loopHeadText}>
            <p className={styles.loopEyebrow}>THE LESSON LOOP · 一课六步</p>
            <div className={styles.loopTitleRow}>
              <h2 className={styles.loopTitle}>一课的走法</h2>
              <p className={styles.loopNote}>六步一环，教到出师为止</p>
            </div>
          </div>
          <RoundStamp
            className={styles.loopStamp}
            text="小白同学 · 教然后知困 · "
            size={78}
            dur={60}
          />
        </header>
        <div className={styles.route}>
          {LOOP_STEPS.map((step) => (
            <div key={step.name} className={styles.node}>
              <span className={styles.nodeNum}>{step.num}</span>
              <span className={styles.nodeRail} aria-hidden="true">
                <span className={styles.nodeDot} />
              </span>
              <span className={styles.nodeName}>{step.name}</span>
              <span className={styles.nodeDesc}>{step.desc}</span>
            </div>
          ))}
          <div className={`${styles.node} ${styles.nodeEnd}`}>
            <span className={styles.nodeNum}>终</span>
            <span className={styles.nodeRail} aria-hidden="true">
              <span className={styles.nodeSeal} />
            </span>
            <span className={styles.nodeName}>出师</span>
            <span className={styles.nodeDesc}>图谱点亮</span>
          </div>
        </div>
      </section>

      {/* ── 知识点书架 ── */}
      <Bookshelf />

      {/* ── 新手引路(首访自动开;礼让拜师帖,帖收了才上前) ── */}
      <Tour tourKey="home" steps={buildHomeTour(hasStory)} />
    </div>
  );
}
