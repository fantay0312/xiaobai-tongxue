/**
 * 备课页 /prep/:topicId —— 自习桌面。
 * 流程:壹 摸底快测(误区库判断题,逐题即时反馈,可重新摸底) → 贰 教学任务卡(真实卡片质感)
 *      → 叁 讲课路线图(checklist 教学大纲 + 小白的追问原话)
 *      → 肆 研读材料包(微课讲义 + 例题 + 误区剧本预演 + 视频参考 + 延伸书单,按错题相关展开)
 *      → 伍 自检清单全勾 → 解锁讲解舱。
 * 全对可跳过备课直接开讲;状态只经 store(completePrep)。
 * 侧栏「备课五步」= 锚点导航:点击平滑滚动到分节,IntersectionObserver 高亮当前在读分节。
 * 右下角常驻备课助教「小砚」(PrepCoach)——只在备课页出现,课堂(/teach)是防作弊红线。
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { getTopic } from '../../data';
import { Md } from '../../components/Md';
import { PrepCoach } from '../../components/coach/PrepCoach';
import type { Misconception, PrepReference, QuestionLevel } from '../../types';
import s from './prep.module.css';

/** 追问层级 → 路线图徽章文案(checklist 无 L4;L4 = 误区注入,以途中试探标记呈现) */
const LEVEL_META: Record<QuestionLevel, string> = {
  L1: '澄清',
  L2: '举例',
  L3: '边界',
  L4: '试探',
  L5: '迁移',
};

/** 壹-伍分节的稳定锚点;侧栏「备课五步」据此导航与 scrollspy 高亮 */
const SECTIONS = [
  { id: 'prep-sec-1', name: '摸底快测' },
  { id: 'prep-sec-2', name: '教学任务卡' },
  { id: 'prep-sec-3', name: '讲课路线图' },
  { id: 'prep-sec-4', name: '研读材料包' },
  { id: 'prep-sec-5', name: '备课自检' },
] as const;

/** 延伸书单 kind → 朱文小印用字 */
const REF_SEAL: Record<PrepReference['kind'], string> = {
  官方文档: '官',
  教程: '教',
  视频: '视',
  论文: '论',
  工具: '工',
  长文: '长',
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 视频出处的人话名(域名 → 平台名;未知域名原样给 hostname) */
function videoHost(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.endsWith('bilibili.com') || host === 'b23.tv') return '哔哩哔哩';
    return host;
  } catch {
    return '';
  }
}

/** 例题与错题的相关性:命中该误区的纠正关键词或误区表述即视为相关 */
function relatedToWrong(text: string, wrong: Misconception[]): boolean {
  return wrong.some(
    (mc) =>
      text.includes(mc.belief) ||
      mc.correctionKeywords.flat().some((kw) => kw.length > 1 && text.includes(kw)),
  );
}

function Collapse({ title, tag, tagTone, defaultOpen, children }: {
  title: string;
  tag?: string;
  tagTone?: 'warn' | 'plain';
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`${s.collapse} ${open ? s.collapseOn : ''}`}>
      <button
        type="button"
        className={s.collapseHead}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={s.collapseChev} aria-hidden="true" />
        <span className={s.collapseTitle}>{title}</span>
        {tag ? (
          <span className={tagTone === 'warn' ? s.collapseTagWarn : s.collapseTag}>{tag}</span>
        ) : null}
      </button>
      <div className={`${s.collapseBody} ${open ? s.collapseOpen : ''}`}>
        <div className={s.collapseInner}>{children}</div>
      </div>
    </section>
  );
}

export default function PrepPage() {
  const { topicId = '' } = useParams();
  // 按知识点重挂载:路由参数变化时 React Router 复用同一元素,摸底作答/自检勾选/
  // submittedRef 会带着上一个知识点的状态给新知识点判分——key 强制全部归零
  return <PrepRoom key={topicId} topicId={topicId} />;
}

function PrepRoom({ topicId }: { topicId: string }) {
  const navigate = useNavigate();
  const topic = getTopic(topicId);
  const usable = !!topic && !topic.locked;
  const completePrep = useAppStore((st) => st.completePrep);
  const prepDone = useAppStore((st) => st.topicStates[topicId]?.prepDone ?? false);

  /** 摸底快测:已作答的选择(true=判"对",false=判"错") */
  const [answers, setAnswers] = useState<boolean[]>([]);
  /** 全对时用户仍选择过一遍材料 */
  const [wantMaterials, setWantMaterials] = useState(false);
  const [checks, setChecks] = useState<boolean[]>([]);
  /** scrollspy:当前滚入视口阅读带的分节 id */
  const [currentId, setCurrentId] = useState<string>(SECTIONS[0].id);
  const submittedRef = useRef(false);

  /* 派生态提前算(hooks 必须在提前 return 之前):不可用主题一律给空 */
  const probes = usable ? topic!.misconceptions.slice(0, 3) : [];
  const quizDone = usable && answers.length >= probes.length;
  const correctCount = answers.filter((c, i) => c === probes[i]?.probe.isTrue).length;
  const allCorrect = quizDone && correctCount === probes.length;
  const wrongMcs = probes.filter((mc, i) => i < answers.length && answers[i] !== mc.probe.isTrue);
  const materialsVisible = quizDone && (!allCorrect || wantMaterials);

  /**
   * scrollspy:观察各分节与视口上部"阅读带"(约 30%~45% 高度)的交叠。
   * 取带内文档序最靠后者——向下读时新分节一进带即接管高亮;分节增减(materialsVisible)时重建。
   */
  useEffect(() => {
    const els = SECTIONS.map((sec) => document.getElementById(sec.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (els.length === 0) return;
    setCurrentId((prev) => (els.some((el) => el.id === prev) ? prev : SECTIONS[0].id));
    const inBand = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) inBand.add(en.target.id);
          else inBand.delete(en.target.id);
        });
        for (let i = SECTIONS.length - 1; i >= 0; i -= 1) {
          if (inBand.has(SECTIONS[i].id)) {
            setCurrentId(SECTIONS[i].id);
            return;
          }
        }
      },
      { rootMargin: '-30% 0px -55% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [materialsVisible, topicId]);

  if (!topic || topic.locked) {
    return (
      <div className={s.page}>
        <p className={s.notFound}>
          这个知识点还没有开放。<Link to="/study">← 回书斋</Link>
        </p>
      </div>
    );
  }

  /** 材料包按需展开:有错题时,微课讲义 + 与错题相关的例题默认展开 */
  const exampleRelated = topic.prep.examples.map((ex) =>
    relatedToWrong(ex.title + ex.code + ex.walkthrough, wrongMcs),
  );
  const anyRelated = exampleRelated.some(Boolean);
  const exampleDefaultOpen = (i: number) =>
    wrongMcs.length > 0 && (exampleRelated[i] || !anyRelated);

  const allChecked =
    topic.prep.selfCheck.length > 0 && topic.prep.selfCheck.every((_, i) => checks[i]);

  /** 路线图途中试探标记插在大纲中段(L4 误区注入没有固定位置,只提示"路上会来") */
  const ambushAfter = Math.max(0, Math.floor((topic.checklist.length - 1) / 2));

  /** 阅读量估算:讲义 + 例题总字数 ÷ 400 字/分钟,向上取整 */
  const readChars =
    topic.prep.microLecture.title.length +
    topic.prep.microLecture.body.length +
    topic.prep.examples.reduce(
      (n, ex) => n + ex.title.length + ex.code.length + ex.walkthrough.length,
      0,
    );
  const readMinutes = Math.max(1, Math.ceil(readChars / 400));

  /** 延伸资料(防御式渲染):视频拆出独立「视频参考」区,其余走书单 */
  const references = topic.prep.references ?? [];
  const videoRefs = references.filter((r) => r.kind === '视频');
  const readRefs = references.filter((r) => r.kind !== '视频');

  /** 侧栏五步的进度态(done/active 与 scrollspy 的"当前在读"叠加,互不打架) */
  const stepStates = [
    { done: quizDone, active: !quizDone, reachable: true },
    { done: materialsVisible, active: false, reachable: materialsVisible },
    { done: materialsVisible, active: false, reachable: materialsVisible },
    {
      done: materialsVisible && allChecked,
      active: materialsVisible && !allChecked,
      reachable: materialsVisible,
    },
    { done: allChecked, active: false, reachable: materialsVisible },
  ];

  const answer = (choice: boolean) =>
    setAnswers((a) => (a.length >= probes.length ? a : [...a, choice]));

  /** 锚点滚动:reduced-motion 直接跳,不做平滑 */
  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  /** 重新摸底:清空作答与"过一遍材料"的选择;completePrep 仍只在进讲解舱时按当次成绩提交 */
  const retakeQuiz = () => {
    setAnswers([]);
    setWantMaterials(false);
    jumpTo(SECTIONS[0].id);
  };

  const enterClassroom = () => {
    if (!submittedRef.current) {
      submittedRef.current = true;
      completePrep(topic.topicId, correctCount, probes.length);
    }
    navigate(`/teach/${topic.topicId}`);
  };

  return (
    <div className={s.page}>
      <header className={s.head}>
        <Link to="/study" className={s.back}>← 回书斋</Link>
        <p className={s.course}>{topic.course} · 备课室</p>
        <h1 className={s.title}>{topic.title}</h1>
        <p className={s.tagline}>{topic.tagline}</p>
      </header>

      <div className={s.layout}>
        <main className={s.main}>
          {/* ── 壹 · 摸底快测 ── */}
          <section id={SECTIONS[0].id} className={s.section} style={{ animationDelay: '80ms' }}>
            <h2 className={s.sectionTitle}>
              <span className={s.sectionNum}>壹</span>摸底快测
            </h2>
            <p className={s.sectionHint}>
              开讲之前,先看看你现在站在哪。判断下面的说法对不对:
              {!quizDone && (
                <span className={s.quizCount}>已答 {answers.length} / {probes.length}</span>
              )}
            </p>
            <ol className={s.probeList}>
              {probes.map((mc, i) => {
                if (i > answers.length) return null;
                const answered = i < answers.length;
                const choice = answers[i];
                const good = answered && choice === mc.probe.isTrue;
                return (
                  <li
                    key={mc.mcId}
                    className={`${s.probe} ${answered ? (good ? s.probeGood : s.probeBad) : ''}`}
                  >
                    <p className={s.probeNo}>第 {i + 1} / {probes.length} 题</p>
                    <p className={s.probeStatement}>「{mc.probe.statement}」</p>
                    {!answered ? (
                      <div className={s.probeBtns}>
                        <button type="button" onClick={() => answer(true)}>对</button>
                        <button type="button" onClick={() => answer(false)}>错</button>
                      </div>
                    ) : (
                      <div className={s.probeFb}>
                        <p className={good ? s.fbGood : s.fbBad}>
                          {good
                            ? `答对了——这句话是${mc.probe.isTrue ? '对' : '错'}的。`
                            : '答错了——这正是一个高频误区。'}
                        </p>
                        <p className={s.fbExplain}>{mc.probe.explanation}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {quizDone && (
              allCorrect ? (
                <div className={s.verdictGood}>
                  <p>
                    摸底 {correctCount}/{probes.length},基础相当扎实——你有资格直接上讲台。
                  </p>
                  <div className={s.verdictBtns}>
                    <button type="button" className={s.primaryBtn} onClick={enterClassroom}>
                      跳过备课,直接开讲 →
                    </button>
                    {!wantMaterials && (
                      <button
                        type="button"
                        className={s.ghostBtn}
                        onClick={() => setWantMaterials(true)}
                      >
                        稳一点,还是过一遍材料
                      </button>
                    )}
                    <button type="button" className={s.ghostBtnSm} onClick={retakeQuiz}>
                      重新测一遍
                    </button>
                  </div>
                </div>
              ) : (
                <div className={s.verdictBad}>
                  <p>
                    摸底 {correctCount}/{probes.length}——有 {wrongMcs.length} 个误区还没吃透。
                    别慌,下面的材料就是为它准备的;等会小白多半会拿这里考你。
                  </p>
                  <div className={s.verdictBtns}>
                    <button type="button" className={s.ghostBtnSm} onClick={retakeQuiz}>
                      重新测一遍
                    </button>
                  </div>
                </div>
              )
            )}
          </section>

          {materialsVisible && (
            <>
              {/* ── 贰 · 教学任务卡 ── */}
              <section id={SECTIONS[1].id} className={s.section}>
                <h2 className={s.sectionTitle}>
                  <span className={s.sectionNum}>贰</span>教学任务卡
                </h2>
                <div className={s.taskCard}>
                  <span className={s.taskPin} aria-hidden="true" />
                  <span className={s.taskLabel}>教 学 任 务</span>
                  <p className={s.taskText}>{topic.prep.taskCard}</p>
                </div>
              </section>

              {/* ── 叁 · 讲课路线图 ── */}
              <section id={SECTIONS[2].id} className={s.section}>
                <h2 className={s.sectionTitle}>
                  <span className={s.sectionNum}>叁</span>讲课路线图
                </h2>
                <p className={s.sectionHint}>
                  你要把下面 {topic.checklist.length} 件事讲明白——小白到时候大概会这么问。
                </p>
                <ol className={s.roadmap}>
                  {topic.checklist.map((item, i) => (
                    <Fragment key={item.id}>
                      <li className={s.roadStep} style={{ animationDelay: `${i * 70}ms` }}>
                        <span className={s.roadBadge}>
                          <b>{item.level}</b>
                          {LEVEL_META[item.level]}
                        </span>
                        <div className={s.roadBody}>
                          <p className={s.roadPoint}>{item.point}</p>
                          <p className={s.roadProbe}>
                            「{item.probeLine}」
                            <span className={s.roadWho}>—— 小白</span>
                          </p>
                        </div>
                      </li>
                      {i === ambushAfter && topic.misconceptions.length > 0 && (
                        <li
                          className={s.roadAmbush}
                          style={{ animationDelay: `${(i + 1) * 70}ms` }}
                        >
                          <span className={s.roadBadgeWarn}>
                            <b>L4</b>
                            试探
                          </span>
                          <p className={s.roadAmbushText}>
                            途中它还会用错误直觉试探你 ×{topic.misconceptions.length}
                            ——剧本在下面的「误区剧本」里。
                          </p>
                        </li>
                      )}
                    </Fragment>
                  ))}
                </ol>
              </section>

              {/* ── 肆 · 材料包 ── */}
              <section id={SECTIONS[3].id} className={s.section}>
                <h2 className={s.sectionTitle}>
                  <span className={s.sectionNum}>肆</span>研读材料包
                  <span className={s.readTime}>全读约 {readMinutes} 分钟</span>
                </h2>
                <p className={s.sectionHint}>
                  {wrongMcs.length > 0
                    ? '已按你的错题展开了相关部分;带着任务卡上的问题读。'
                    : '你全对了,材料默认收起,想翻哪节点哪节。'}
                </p>
                <div className={s.materials}>
                  <Collapse
                    title={topic.prep.microLecture.title}
                    tag="微课讲义"
                    tagTone="plain"
                    defaultOpen
                  >
                    <Md text={topic.prep.microLecture.body} className={s.md} />
                  </Collapse>
                  {topic.prep.examples.map((ex, i) => (
                    <Collapse
                      key={ex.title}
                      title={ex.title}
                      tag={wrongMcs.length > 0 && exampleRelated[i] ? '与错题相关' : undefined}
                      tagTone="warn"
                      defaultOpen={exampleDefaultOpen(i)}
                    >
                      <pre className={s.code}><code>{ex.code}</code></pre>
                      <p className={s.walkthrough}>{ex.walkthrough}</p>
                    </Collapse>
                  ))}
                  <Collapse
                    title="预演:小白会怎么为难你"
                    tag="误区剧本"
                    tagTone="warn"
                    defaultOpen={wrongMcs.length > 0}
                  >
                    <p className={s.drillLead}>
                      纠不动它,它就真的学错——复盘时会现形。
                    </p>
                    <ul className={s.drillList}>
                      {topic.misconceptions.map((mc) => {
                        const stumbled = wrongMcs.some((w) => w.mcId === mc.mcId);
                        return (
                          <li
                            key={mc.mcId}
                            className={`${s.drill} ${stumbled ? s.drillStumbled : ''}`}
                          >
                            <p className={s.drillBelief}>
                              它会坚信:{mc.belief}
                              {stumbled && (
                                <span className={s.drillStumbleTag}>你刚栽在这里</span>
                              )}
                            </p>
                            <p className={s.drillLine}>
                              「{mc.triggerLine}」
                              <span className={s.roadWho}>—— 小白,开口大概是这样</span>
                            </p>
                            <p className={s.drillCritTitle}>纠正到位的标准</p>
                            <ul className={s.drillCrits}>
                              {mc.correctionCriteria.map((c) => (
                                <li key={c}>{c}</li>
                              ))}
                            </ul>
                          </li>
                        );
                      })}
                    </ul>
                  </Collapse>
                  {videoRefs.length > 0 && (
                    <Collapse
                      title="视频参考"
                      tag={`选看 · ${videoRefs.length} 部`}
                      tagTone="plain"
                      defaultOpen={wrongMcs.length > 0}
                    >
                      <p className={s.refLead}>
                        读不进去的时候换只耳朵——挑一部当预习就够,别当追剧。
                      </p>
                      <ul className={s.videoList}>
                        {videoRefs.map((ref) => (
                          <li key={ref.url}>
                            <a
                              className={s.videoCard}
                              href={ref.url}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              <span className={s.videoPlay} aria-hidden="true">▶</span>
                              <span className={s.videoBody}>
                                <span className={s.videoTitle}>
                                  {ref.title}
                                  <span className={s.refArrow} aria-hidden="true">↗</span>
                                </span>
                                <span className={s.videoNote}>{ref.note}</span>
                                {videoHost(ref.url) && (
                                  <span className={s.videoHost}>{videoHost(ref.url)}</span>
                                )}
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </Collapse>
                  )}
                  {readRefs.length > 0 && (
                    <Collapse title="延伸书单" tag="选读" tagTone="plain" defaultOpen={false}>
                      <p className={s.refLead}>课上用不到,课后想深挖再看——先把课讲完。</p>
                      <ul className={s.refList}>
                        {readRefs.map((ref) => (
                          <li key={ref.url} className={s.refItem}>
                            <span className={s.refSeal} aria-hidden="true">
                              {REF_SEAL[ref.kind] ?? ref.kind.slice(0, 1)}
                            </span>
                            <div className={s.refBody}>
                              <p className={s.refTitleRow}>
                                <a
                                  className={s.refLink}
                                  href={ref.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                >
                                  {ref.title}
                                  <span className={s.refArrow} aria-hidden="true">↗</span>
                                </a>
                                <span className={s.refKind}>{ref.kind}</span>
                              </p>
                              <p className={s.refNote}>{ref.note}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Collapse>
                  )}
                </div>
              </section>

              {/* ── 伍 · 自检清单 ── */}
              <section id={SECTIONS[4].id} className={s.section}>
                <h2 className={s.sectionTitle}>
                  <span className={s.sectionNum}>伍</span>备课自检
                </h2>
                <p className={s.sectionHint}>对着清单问自己,都能点头再上讲台。</p>
                <ul className={s.checkList}>
                  {topic.prep.selfCheck.map((item, i) => {
                    const on = !!checks[i];
                    return (
                      <li key={item}>
                        <label className={`${s.checkLabel} ${on ? s.checkOn : ''}`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setChecks((c) => {
                                const next = [...c];
                                next[i] = !next[i];
                                return next;
                              })
                            }
                          />
                          <span className={s.checkBox} aria-hidden="true">{on ? '✓' : ''}</span>
                          <span className={s.checkText}>{item}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <div className={s.unlockRow}>
                  <button
                    type="button"
                    className={s.primaryBtn}
                    disabled={!allChecked}
                    onClick={enterClassroom}
                  >
                    备课完成,进入讲解舱 →
                  </button>
                  {!allChecked && (
                    <p className={s.lockHint}>把自检清单全部勾完,讲解舱才会解锁。</p>
                  )}
                </div>
              </section>
            </>
          )}
        </main>

        {/* ── 眉批侧注 ── */}
        <aside className={s.aside}>
          <nav aria-label="备课五步">
            <h3 className={s.asideTitle}>备课五步</h3>
            <ol className={s.stepList}>
              {SECTIONS.map((sec, i) => {
                const st = stepStates[i];
                const current = currentId === sec.id && st.reachable;
                const cls = [
                  s.step,
                  st.done ? s.stepDone : '',
                  st.active ? s.stepActive : '',
                  current ? s.stepCurrent : '',
                ].join(' ');
                return (
                  <li key={sec.id}>
                    {st.reachable ? (
                      <button
                        type="button"
                        className={cls}
                        aria-current={current ? 'true' : undefined}
                        onClick={() => jumpTo(sec.id)}
                      >
                        <span className={s.stepDot} aria-hidden="true" />
                        {sec.name}
                      </button>
                    ) : (
                      <span className={`${s.step} ${s.stepLocked}`}>
                        <span className={s.stepDot} aria-hidden="true" />
                        {sec.name}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          {materialsVisible && (
            <div>
              <h3 className={s.asideTitle}>路线图</h3>
              <ol className={s.miniRoute}>
                {topic.checklist.map((item) => (
                  <li key={item.id} className={s.miniRouteItem}>
                    <span className={s.miniRouteLevel}>{LEVEL_META[item.level]}</span>
                    {item.point}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {wrongMcs.length > 0 && (
            <div>
              <h3 className={s.asideTitle}>摸底暴露的薄弱点</h3>
              <ul className={s.weakList}>
                {wrongMcs.map((mc) => (
                  <li key={mc.mcId} className={s.weakItem}>× {mc.belief}</li>
                ))}
              </ul>
            </div>
          )}
          {prepDone && (
            <p>
              <Link className={s.doneLink} to={`/teach/${topic.topicId}`}>
                你之前备过这门课 · 直接开讲 →
              </Link>
            </p>
          )}
          <blockquote className={s.asideQuote}>
            「教然后知困。」
            <br />
            带着小白的问题去读,比通读三遍记得牢。
          </blockquote>
        </aside>
      </div>

      <PrepCoach topic={topic} />
    </div>
  );
}
