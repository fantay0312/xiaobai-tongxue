/**
 * 宣传页 —— 站点门面(公开,无需登录)。
 * 与全站同一纸墨世界,但允许比应用页更海报化:大字楷体主张、巨字水印、
 * 三幕流程、朱文印机制卡、结尾黑板色 CTA 带(呼应讲解舱夜自习场景)。
 * 入场用与门厅一致的 rise 编排;滚动显现用 IntersectionObserver,尊重 reduced-motion。
 */
import { useEffect, useRef, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import s from './landing.module.css';

const ACTS: { act: string; name: string; desc: string }[] = [
  {
    act: '第一幕',
    name: '备课',
    desc: '选一个知识点,先做一轮摸底快测。系统按你的底子发放讲解材料包——你要带着教案走进教室。',
  },
  {
    act: '第二幕',
    name: '开讲',
    desc: '你讲,小白听。它会追问,会卡壳等你递台阶,还会用一个错误直觉试探你——教得动它,才算真懂。',
  },
  {
    act: '第三幕',
    name: '复盘补学',
    desc: '下课领五维雷达和盲区证据链,每个分数都有出处。哪里讲不清补哪里,补完再讲,直到出师。',
  },
];

const FEATURES: { mark: string; name: string; desc: string }[] = [
  {
    mark: '误',
    name: '误区注入',
    desc: '它会真诚地坚持一个错误直觉,等你纠正——纠不动,它就被你带偏,复盘时当场现形。',
  },
  {
    mark: '界',
    name: '认知白名单 · 泄漏防线',
    desc: '小白只知道你讲过的东西,永远不剧透你没教的术语——学生不该比老师先知道答案。',
  },
  {
    mark: '援',
    name: '救援梯度 R1→R4',
    desc: '你卡壳时它不揭答案,而是一级级递台阶:换个问法、给半句提示、最后陪你一起查书。',
  },
  {
    mark: '证',
    name: '五维雷达 · 证据链',
    desc: '准确、完整、清晰、深度、纠偏五维打分,每个分数都能展开,看到课堂上的原话依据。',
  },
  {
    mark: '架',
    name: '分学科书架',
    desc: '每门课自成一架,分学科陈列;任何学科都能上架,开成一间新教室。',
  },
  {
    mark: '衡',
    name: '语义评估',
    desc: '讲得对不对,由 DeepSeek 做语义判定;断网时自动降级到本地规则引擎,课不会停。',
  },
];

export default function LandingPage() {
  const level = useAppStore((st) => st.global.learningLevel);
  const pageRef = useRef<HTMLDivElement>(null);

  // 滚动显现:进入视口即定格,只演一次
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add(s.shown));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add(s.shown);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // HashRouter 下锚点 href 会污染路由,拦截后平滑滚动(与门厅同一手法)
  const scrollToHow = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById('how')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={s.page} ref={pageRef}>
      {/* ── 首屏海报:主张 + 小白 + 竖排《学记》 ── */}
      <section className={s.hero}>
        <span className={s.heroGlyph} aria-hidden="true">教</span>

        <div className={s.heroMain}>
          <p className={`${s.kicker} ${s.enter}`}>费曼反转式学习智能体</p>
          <h1 className={`${s.claim} ${s.enter}`} style={{ animationDelay: '70ms' }}>
            不是 AI 教你,
            <br />
            是<em>你教会</em>一个 AI
          </h1>
          <p className={`${s.intro} ${s.enter}`} style={{ animationDelay: '140ms' }}>
            你来当老师,把知识讲给会追问、会犯错、会卡壳的 AI 学生「小白」听——讲不清的地方,就是你真正的盲区。
          </p>
          <div className={`${s.ctaRow} ${s.enter}`} style={{ animationDelay: '210ms' }}>
            <Link className={s.cta} to="/study">
              进入书斋,开始教学
            </Link>
            <a className={s.ctaGhost} href="#how" onClick={scrollToHow}>
              看看它怎么运作 ↓
            </a>
          </div>
        </div>

        <div className={`${s.heroAvatar} ${s.enter}`} style={{ animationDelay: '160ms' }}>
          <XiaobaiAvatar variant="paper" mood="curious" level={level} size={200} />
          <p className={s.avatarCaption}>你的 AI 学生 · 小白</p>
        </div>

        <blockquote className={`${s.quote} ${s.enter}`} style={{ animationDelay: '120ms' }}>
          <p className={s.quoteText}>
            教然后知困,
            <br />
            知困然后能自强
          </p>
          <cite className={s.quoteFrom}>《礼记 · 学记》</cite>
        </blockquote>
      </section>

      {/* ── 理念:费曼学习法一句话 ── */}
      <section className={s.why} aria-label="理念">
        <p className={`${s.whyText} ${s.reveal}`} data-reveal>
          检验你是否真懂的唯一办法,
          <br />
          是把它<em>讲明白</em>给别人听。
        </p>
        <p className={`${s.whySub} ${s.reveal}`} data-reveal style={{ transitionDelay: '90ms' }}>
          这是费曼学习法的全部秘密。小白,就是那个「别人」。
        </p>
      </section>

      {/* ── 三幕流程 ── */}
      <section className={s.acts} id="how" aria-label="三幕流程">
        <header className={`${s.secHead} ${s.reveal}`} data-reveal>
          <p className={s.secKicker}>一堂课,三幕</p>
          <h2 className={s.secTitle}>从备课到出师</h2>
        </header>
        <div className={s.actRow}>
          {ACTS.map((act, i) => (
            <article
              key={act.name}
              className={`${s.act} ${s.reveal}`}
              data-reveal
              style={{ transitionDelay: `${i * 90}ms` }}
            >
              <p className={s.actNo}>{act.act}</p>
              <h3 className={s.actName}>{act.name}</h3>
              <p className={s.actDesc}>{act.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── 机制亮点:朱文印分栏 ── */}
      <section className={s.mech} aria-label="机制亮点">
        <header className={`${s.secHead} ${s.reveal}`} data-reveal>
          <p className={s.secKicker}>不止一个会聊天的角色</p>
          <h2 className={s.secTitle}>教学机制,件件有据</h2>
        </header>
        <div className={s.grid}>
          {FEATURES.map((f, i) => (
            <article
              key={f.name}
              className={`${s.card} ${s.reveal}`}
              data-reveal
              style={{ transitionDelay: `${(i % 3) * 70}ms` }}
            >
              <span className={s.stamp} aria-hidden="true">{f.mark}</span>
              <h3 className={s.cardName}>{f.name}</h3>
              <p className={s.cardDesc}>{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── 结尾 CTA:黑板夜自习色带,门后就是教室 ── */}
      <section className={`${s.band} ${s.reveal}`} data-reveal aria-label="开始教学">
        <p className={s.bandKicker}>教室的灯已经亮了</p>
        <h2 className={s.bandTitle}>现在,轮到你来教了</h2>
        <Link className={s.bandCta} to="/study">
          进入书斋,开始教学
        </Link>
      </section>

      {/* ── 参赛信息位 ── */}
      <footer className={s.foot}>
        学习支持类智能体 · 「小白同学——教然后知困」参赛演示
      </footer>
    </div>
  );
}
