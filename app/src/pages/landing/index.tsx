/**
 * 宣传页 —— 站点门面(公开,无需登录)。
 * 与全站同一纸墨世界,但允许比应用页更海报化:大字楷体主张、巨字水印、
 * 四幕流程、课堂实录、实证数字带、朱文印机制卡、书架预览、结尾砚墨 CTA 带。
 * 实证纪律:实录台词、课程/知识点/误区数、泄漏率一律从数据模块与离线实测报告导入,
 * 页面不手写任何会漂移的数字。
 * 入场用与门厅一致的 rise 编排;滚动显现用 IntersectionObserver,尊重 reduced-motion。
 */
import { useEffect, useRef, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { Icon } from '../../components/ui/Icon';
import { TOPICS, XIAOBAI_LINES } from '../../data';
import { tokenizationDemo, tokenizationTopic } from '../../data/topics/tokenization';
import type { Topic } from '../../types';
import s from './landing.module.css';
import anchor from '../../styles/anchor.module.css';

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
    name: '赴考',
    desc: '你在场外看小白独自答题。它记住了什么、在哪里犹豫、带着哪处误解落笔，都会如实上演。',
  },
  {
    act: '第四幕',
    name: '灯下批注',
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

// ── 实证素材:全部从课程数据与离线实测报告导入 ──

/** 台词裁剪:去掉承上启下的短引子;过长时在句读处截断,数据变动自动跟随 */
function trimLine(text: string, max = 110): string {
  const lead = text.indexOf(':');
  let t = lead > -1 && lead < 16 ? text.slice(lead + 1) : text;
  if (t.length > max) {
    const cut = t.slice(0, max);
    const brk = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf(','), cut.lastIndexOf(';'));
    t = `${cut.slice(0, brk > max * 0.5 ? brk : max)}……`;
  }
  return t;
}

/** 课堂实录三拍:老师讲解(演示台词②)→ 小白开窍复述 → 小白抛出 M1 错误直觉 */
const TEACH_LINE = trimLine(
  (tokenizationDemo.find((l) => l.label.includes('②')) ?? tokenizationDemo[1]).text,
);
const M1 =
  tokenizationTopic.misconceptions.find((m) => m.mcId.endsWith('_M1')) ??
  tokenizationTopic.misconceptions[0];
const AHA_LINE = (
  XIAOBAI_LINES.好奇型.express_understanding[0] ?? '哦——!我懂了!所以说{paraphrase},对吧?'
).replaceAll('{paraphrase}', '切句子之前先开好一份积木块清单,往后都照这份清单来切');

/** 数字带:课程数 / 知识点数 / 误区剧本数从 TOPICS 现算 */
const COURSE_COUNT = new Set(TOPICS.map((t) => t.course)).size;
const MC_COUNT = TOPICS.filter((t) => !t.locked).reduce((n, t) => n + t.misconceptions.length, 0);

/** 泄漏率实测:与教师端同源读法(离线模拟脚本产物;文件缺失时优雅降级为「待测」) */
const leakModules = import.meta.glob('../../data/leakageReport.json', { eager: true }) as Record<
  string,
  { default: { naiveLeakRate?: unknown; guardedLeakRate?: unknown } }
>;
const leakReport = Object.values(leakModules)[0]?.default;
const fmtRate = (v: number): string => `${(v <= 1 ? v * 100 : v).toFixed(1)}%`;
/* 报告缺席时整格降级为单个「待测」——不渲染 pair 结构,免得「待测」还被划掉像排版错误 */
const leakPair =
  typeof leakReport?.naiveLeakRate === 'number' && typeof leakReport?.guardedLeakRate === 'number'
    ? { from: fmtRate(leakReport.naiveLeakRate), to: fmtRate(leakReport.guardedLeakRate) }
    : undefined;

const STATS: {
  label: string;
  note: string;
  num?: string;
  unit?: string;
  pair?: { from: string; to: string };
}[] = [
  { num: String(COURSE_COUNT), unit: '门', label: '已开课程', note: '分学科排架,任何学科都能上架开教室' },
  { num: String(TOPICS.length), unit: '个', label: '知识点', note: '含图谱占位知识点,课程版图持续铺开' },
  { num: String(MC_COUNT), unit: '套', label: '预埋误区剧本', note: '每套自带触发台词与纠偏判据,课上现场埋雷' },
  leakPair
    ? { pair: leakPair, label: '泄漏防线实测', note: '对抗样本下的术语泄漏率:裸输出 → 白名单闸门' }
    : { num: '待测', label: '泄漏防线实测', note: '对抗样本下的术语泄漏率:裸输出 → 白名单闸门' },
];

/** 书架预览:按 course 分组,保持 TOPICS 陈列顺序(与门厅书架同一分组逻辑) */
function groupByCourse(topics: Topic[]): { course: string; topics: Topic[] }[] {
  const groups: { course: string; topics: Topic[] }[] = [];
  for (const t of topics) {
    const g = groups.find((x) => x.course === t.course);
    if (g) g.topics.push(t);
    else groups.push({ course: t.course, topics: [t] });
  }
  return groups;
}
const SHELF = groupByCourse(TOPICS);
const TEACHABLE_COUNT = TOPICS.filter((t) => !t.locked).length;

const CN_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1-99 → 汉字讲数(函套书口的传统写法,与门厅书架同一手法) */
function cnCount(n: number): string {
  if (n <= 0 || n >= 100) return String(n);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  if (tens === 0) return CN_DIGIT[ones];
  return `${tens > 1 ? CN_DIGIT[tens] : ''}十${ones ? CN_DIGIT[ones] : ''}`;
}

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
              <span className={s.ctaSeal} aria-hidden="true">教</span>
            </Link>
            <a className={s.ctaGhost} href="#how" onClick={scrollToHow}>
              看看它怎么运作 ↓
            </a>
          </div>
        </div>

        <div className={`${anchor.heroAvatar} ${s.enter}`} style={{ animationDelay: '160ms' }}>
          <XiaobaiAvatar variant="paper" mood="curious" level={level} size={200} />
          <p className={anchor.avatarCaption}>你的 AI 学生 · 小白</p>
        </div>

        <blockquote className={`${anchor.quote} ${s.enter}`} style={{ animationDelay: '120ms' }}>
          <p className={anchor.quoteText}>
            教然后知困,
            <br />
            知困然后能自强
          </p>
          <cite className={anchor.quoteFrom}>《礼记 · 学记》</cite>
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

      {/* ── 四幕流程 ── */}
      <section className={s.acts} id="how" aria-label="四幕流程">
        <header className={`${s.secHead} ${s.reveal}`} data-reveal>
          <p className={s.secKicker}>一堂课,四幕</p>
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

      {/* ── 课堂实录:黑板上的一分钟,台词逐字取自真实课程数据 ── */}
      <section className={s.scene} aria-label="课堂实录">
        <header className={`${s.secHead} ${s.reveal}`} data-reveal>
          <p className={s.secKicker}>课堂上的一分钟</p>
          <h2 className={s.secTitle}>刚被讲通,它就来试探你</h2>
        </header>

        <div className={s.sceneBoard}>
          <div className={`${s.beat} ${s.beatTeacher} ${s.reveal}`} data-reveal>
            <p className={s.speaker}>老师 · 你</p>
            <p className={s.bubble}>{TEACH_LINE}</p>
          </div>
          <div
            className={`${s.beat} ${s.beatXiaobai} ${s.reveal}`}
            data-reveal
            style={{ transitionDelay: '120ms' }}
          >
            <p className={s.speaker}>小白</p>
            <p className={s.bubble}>{AHA_LINE}</p>
          </div>
          <div
            className={`${s.beat} ${s.beatXiaobai} ${s.beatTrap} ${s.reveal}`}
            data-reveal
            style={{ transitionDelay: '240ms' }}
          >
            <p className={s.speaker}>小白 · 它真诚地坚持一个错误直觉</p>
            <p className={s.bubble}>{M1.triggerLine}</p>
          </div>
          {/* 同屏 stagger 封顶 300ms:黑板不许为等旁注空着 */}
          <p
            className={`${s.sceneAside} ${s.reveal}`}
            data-reveal
            style={{ transitionDelay: '300ms' }}
          >
            此刻:纠正它,或被它带偏——复盘时现形
          </p>
        </div>

        <p className={`${s.sceneCaption} ${s.reveal}`} data-reveal>
          <span className={s.sceneStamp} aria-hidden="true">实录</span>
          台词非摆拍:讲解与错误直觉逐字取自《{tokenizationTopic.course}》
          「{tokenizationTopic.title}」的课程数据,误区剧本编号 {M1.mcId}。
        </p>
      </section>

      {/* ── 数字带:四项实证,数字全部从数据模块现算 ── */}
      <section className={s.proof} aria-label="实证数字">
        <div className={s.proofRow}>
          {STATS.map((t, i) => (
            <div
              key={t.label}
              className={`${s.stat} ${s.reveal}`}
              data-reveal
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <p className={s.statNum}>
                {t.pair ? (
                  <>
                    <span className={s.statFrom}>{t.pair.from}</span>
                    <span className={s.statArrow} aria-hidden="true">→</span>
                    <span className={s.statTo}>{t.pair.to}</span>
                  </>
                ) : (
                  <>
                    {t.num}
                    <em className={s.statUnit}>{t.unit}</em>
                  </>
                )}
              </p>
              <p className={s.statLabel}>{t.label}</p>
              <p className={s.statNote}>{t.note}</p>
            </div>
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

      {/* ── 书斋一角:函套陈列(与门厅书架同语言)+ 书目摘抄,整柜直通书架 ── */}
      <section className={s.shelfSec} aria-label="书架预览">
        <header className={`${s.secHead} ${s.reveal}`} data-reveal>
          <p className={s.secKicker}>书斋一角</p>
          <h2 className={s.secTitle}>书架上已经摆好的课</h2>
        </header>

        <div className={s.shelfWrap}>
          <Link
            className={`${s.caseLink} ${s.reveal}`}
            data-reveal
            to="/study"
            aria-label="进入书架,挑一个知识点开讲"
          >
            <span className={s.caseRow}>
              {SHELF.map(({ course, topics }, i) => (
                <span
                  key={course}
                  className={`${s.vol} ${s[`volTone${i % 3}`]}`}
                  style={{ width: `${7.25 + Math.min(topics.length * 0.05, 1.5)}rem` }}
                >
                  <span className={`${s.volSlip} ${course.length > 6 ? s.volSlipLong : ''}`}>
                    {course}
                  </span>
                  <span className={s.volMeta}>{cnCount(topics.length)} 讲</span>
                </span>
              ))}
            </span>
            <span className={s.caseRail} aria-hidden="true" />
            <span className={s.caseCaption}>
              {TEACHABLE_COUNT} 个知识点可开讲 · 去书架挑一本 <Icon name="arrow-right" size={14} />
            </span>
          </Link>

          <div className={`${s.catalog} ${s.reveal}`} data-reveal style={{ transitionDelay: '120ms' }}>
            {SHELF.map(({ course, topics }) => {
              const open = topics.filter((t) => !t.locked);
              const names = open.slice(0, 3).map((t) => t.title);
              const bindCount = topics.length - open.length;
              return (
                <p key={course} className={s.cataRow}>
                  <span className={s.cataCourse}>《{course}》</span>
                  <span className={s.cataNames}>
                    {names.join(' · ')}
                    <span className={s.cataCount}>
                      {open.length > names.length ? ` ……共 ${open.length} 讲可开讲` : ` · 共 ${open.length} 讲可开讲`}
                      {bindCount > 0 ? `,另 ${bindCount} 讲装订中` : ''}
                    </span>
                  </span>
                </p>
              );
            })}
            <p className={s.cataNote}>
              每一讲都自带摸底快测、研读材料包与预埋误区剧本——拿来即可开讲;
              架上永远留着空函,任何学科都能上架,开成一间新教室。
            </p>
          </div>
        </div>
      </section>

      {/* ── 结尾 CTA:砚墨收尾锚点,一盏灯的余光——教室的灯已经亮了 ── */}
      <section className={`${s.band} ${s.reveal}`} data-reveal aria-label="开始教学">
        <p className={s.bandKicker}>教室的灯已经亮了</p>
        <h2 className={s.bandTitle}>现在,轮到你来教了</h2>
        <Link className={s.bandCta} to="/study">
          进入书斋,开始教学
          <span className={s.ctaSeal} aria-hidden="true">教</span>
        </Link>
      </section>
    </div>
  );
}
