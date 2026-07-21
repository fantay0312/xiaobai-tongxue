/**
 * 备课页 /prep/:topicId —— 自习桌面。
 * 流程:壹 摸底快测(两波:误区判断题 → 多维选择题,均逐题即时反馈,可重新摸底,计分合并)
 *      → 贰 教学任务卡(真实卡片质感)
 *      → 叁 讲课路线图(checklist 教学大纲 + 小白的追问原话)
 *      → 肆 研读材料包(微课讲义 + 一张图看懂 + 例题 + 误区剧本预演 + 视频参考 + 延伸书单,按错题相关展开)
 *      → 伍 自检清单全勾 → 解锁讲解舱。
 * 全对可跳过备课直接开讲;状态只经 store(completePrep)。
 * 侧栏「备课五步」= 锚点导航:点击平滑滚动到分节,IntersectionObserver 高亮当前在读分节。
 * 右下角常驻备课助教「小砚」(PrepCoach)——只在备课页出现,课堂(/teach)是防作弊红线。
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { getTopic, TOPICS } from '../../data';
// 记忆回执:engine/recall 纯派生(不进 barrel),按路径直连
import { deriveTopicRecall, type TopicRecall } from '../../engine/recall';
import { getSelfTest } from '../../data/selfTest';
import { getFigures } from '../../components/diagrams';
import { Md } from '../../components/Md';
import { PrepCoach } from '../../components/coach/PrepCoach';
import { Tour, type TourStep } from '../../components/tour/Tour';
import { Icon } from '../../components/ui/Icon';
import { RoundStamp } from '../../components/ui/RoundStamp';
import type { Misconception, PrepReference, QuestionLevel } from '../../types';
import { useDocTitle } from '../../hooks/useDocTitle';
import { deriveTeachingFlow } from './flow';
import paper from '../../styles/paper.module.css';
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

/** 备课桌引路(称「先生」):只指首访就在场的三处——贰至伍分节要摸完底才摊开,不硬指 */
const PREP_TOUR: TourStep[] = [
  {
    target: `#${SECTIONS[0].id}`,
    title: '先摸个底',
    text: '开讲前先把摸底做完,看看先生现在站在哪——摸完这轮底,下面的讲义材料才会摊开;全对还能直接拍案开讲。',
  },
  {
    target: '[data-tour="prep-steps"]',
    title: '备课五步',
    text: '温书按这五步走:摸底、任务卡、路线图、材料包、自检。走到哪儿这里亮到哪儿,亮开的一步点一下就能跳过去。',
  },
  {
    target: '[data-tour="coach"]',
    title: '备课助教小砚',
    text: '卡住了就点它。小砚只陪备课、不进课堂,问答也不落进课堂记录,先生放心打草稿。',
  },
];

/** 延伸书单 kind → 朱文小印用字 */
const REF_SEAL: Record<PrepReference['kind'], string> = {
  讲义: '义',
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
      {/* inert:收起态把子树(外链/横滚容器)整体移出 Tab 序,0fr 高度动画不受影响 */}
      <div className={`${s.collapseBody} ${open ? s.collapseOpen : ''}`} inert={!open}>
        <div className={s.collapseInner}>{children}</div>
      </div>
    </section>
  );
}

/**
 * 「接着上次讲」记忆回执纸条:小白对这门课的记忆(册页语域,称「先生」)。
 * 只在 deriveTopicRecall 非 null 且有可显示内容时露面——首学该课不渲染。
 * 展示项对齐工单:上次日期 / 结局句 / 记得的要点 / 裱起来的金句 / 清掉的心魔 / 保持度。
 * 评估隐身:仅要点名(prep 页路线图本已展示)、金句原文、心魔策展名与真实衰减数。
 */
function RecallCard({ recall }: { recall: TopicRecall }) {
  const hasContent =
    !!recall.lastOutcome ||
    recall.rememberedPoints.length > 0 ||
    recall.goldenQuotes.length > 0 ||
    recall.clearedDemons.length > 0 ||
    recall.retention != null;
  if (!hasContent) return null;

  const daysAgo =
    recall.lastStudiedAt != null
      ? Math.max(0, Math.round((Date.now() - recall.lastStudiedAt) / 86400000))
      : null;
  const whenLabel = daysAgo == null ? null : daysAgo === 0 ? '就在今天' : `${daysAgo} 天前`;
  const pct = recall.retention != null ? Math.round(recall.retention * 100) : null;
  const fogged = recall.daysToFog != null && recall.daysToFog <= 0;

  return (
    <aside className={`${s.recall} ${paper.texture}`} aria-label="小白对这门课的记忆">
      <span className={`${paper.perfNote} ${s.recallTear}`} aria-hidden="true">
        上次的存根 · 沿此撕开
      </span>
      <div className={s.recallHead}>
        <span className={s.recallLabel}>接着上次讲</span>
        {whenLabel && <span className={s.recallWhen}>上次温书 · {whenLabel}</span>}
      </div>
      {recall.lastOutcome && <p className={s.recallOutcome}>{recall.lastOutcome}</p>}

      {recall.rememberedPoints.length > 0 && (
        <div className={s.recallField}>
          <span className={s.recallFieldLabel}>还记得</span>
          <ul className={s.recallChips}>
            {recall.rememberedPoints.map((p, i) => (
              <li key={i} className={s.recallChip}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {recall.clearedDemons.length > 0 && (
        <div className={s.recallField}>
          <span className={s.recallFieldLabel}>清掉的心魔</span>
          <ul className={s.recallChips}>
            {recall.clearedDemons.map((d, i) => (
              <li key={i} className={`${s.recallChip} ${s.recallChipDemon}`}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {recall.goldenQuotes.length > 0 && (
        <ul className={s.recallQuotes}>
          {/* 金句为原文逐字,内容可能重复出现在多处——用稳定索引作 key */}
          {recall.goldenQuotes.map((q, i) => (
            <li key={i} className={s.recallQuote}>「{q}」</li>
          ))}
        </ul>
      )}

      {pct != null && (
        <div className={s.recallRet}>
          <div className={s.recallRetHead}>
            <span className={s.recallFieldLabel}>保持度</span>
            <span className={s.recallRetNote}>
              {pct}% ·{' '}
              {recall.daysToFog == null
                ? '暂稳'
                : recall.daysToFog === 0
                  ? '今日起雾'
                  : fogged
                    ? `已起雾 ${Math.abs(recall.daysToFog)} 天`
                    : `再 ${recall.daysToFog} 天起雾`}
            </span>
          </div>
          <div className={s.recallRetTrack} aria-hidden="true">
            <span
              className={`${s.recallRetFill} ${fogged ? s.recallRetFillFog : ''}`}
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
        </div>
      )}
    </aside>
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
  useDocTitle(topic ? `灯下温书 · ${topic.title}` : undefined);
  const usable = !!topic && !topic.locked;
  const completePrep = useAppStore((st) => st.completePrep);
  const prepDone = useAppStore((st) => st.topicStates[topicId]?.prepDone ?? false);
  // 记忆回执数据源:事件流 / 报告 / 主题状态(备课页原本不订阅,此处按需取,不改 store)
  const events = useAppStore((st) => st.events);
  const reports = useAppStore((st) => st.reports);
  const topicStates = useAppStore((st) => st.topicStates);

  /** 摸底第一波(判断题):已作答的选择(true=判"对",false=判"错") */
  const [answers, setAnswers] = useState<boolean[]>([]);
  /** 摸底第二波(多维选择题):已选项的下标,逐题追加 */
  const [mcAnswers, setMcAnswers] = useState<number[]>([]);
  /** 读屏播报:最近一次判分结果(常驻 aria-live 区,答题瞬间按钮禁用不卸载,焦点不丢) */
  const [liveMsg, setLiveMsg] = useState('');
  /** 全对时用户仍选择过一遍材料 */
  const [wantMaterials, setWantMaterials] = useState(false);
  const [checks, setChecks] = useState<boolean[]>([]);
  /** scrollspy:当前滚入视口阅读带的分节 id */
  const [currentId, setCurrentId] = useState<string>(SECTIONS[0].id);
  const submittedRef = useRef(false);

  /* 派生态提前算(hooks 必须在提前 return 之前):不可用主题一律给空 */
  // 记忆回执:首学该课(零事件)deriveTopicRecall 返回 null → 顶部纸条完全不渲染
  const recall = useMemo(
    () => (usable ? deriveTopicRecall({ topicId, events, reports, topicStates, topics: TOPICS }) : null),
    [usable, topicId, events, reports, topicStates],
  );
  const probes = usable ? topic!.misconceptions.slice(0, 3) : [];
  const selfTest = usable ? getSelfTest(topicId) : [];
  const probesDone = usable && answers.length >= probes.length;
  /** 两波都答完才算摸完底;第二波题库为空(如 Python 主题)时与旧行为完全一致 */
  const quizDone = probesDone && mcAnswers.length >= selfTest.length;
  const quizTotal = probes.length + selfTest.length;
  const correctCount =
    answers.filter((c, i) => c === probes[i]?.probe.isTrue).length +
    mcAnswers.filter((c, i) => c === selfTest[i]?.answerIndex).length;
  const allCorrect = quizDone && correctCount === quizTotal;
  /** 第二波答错的题(驱动侧栏薄弱点条目与 verdict 维度小结) */
  const wrongSelfTests = selfTest.filter(
    (q, i) => i < mcAnswers.length && mcAnswers[i] !== q.answerIndex,
  );
  /** 暴露的误区 = 判断题答错的 + 选择题答错且挂了 mcRef 的(按 mcId 去重) */
  const wrongMcs = (() => {
    const list = probes.filter((mc, i) => i < answers.length && answers[i] !== mc.probe.isTrue);
    const seen = new Set(list.map((mc) => mc.mcId));
    wrongSelfTests.forEach((q) => {
      if (!q.mcRef || seen.has(q.mcRef)) return;
      const mc = topic!.misconceptions.find((m) => m.mcId === q.mcRef);
      if (mc) {
        list.push(mc);
        seen.add(mc.mcId);
      }
    });
    return list;
  })();
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
        <div className={s.notFound}>
          <h1 className={s.notFoundTitle}>这个知识点还没有开放</h1>
          <p className={s.notFoundText}>
            书架上还有已开放的课在等你,先回书斋挑一本,回头再来看它。
          </p>
          <Link to="/study" className={s.primaryBtn}>回书斋门厅</Link>
        </div>
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

  /** 示意图(图解 Collapse):上游按主题给图,空数组则整区不渲染 */
  const figures = getFigures(topic.topicId);

  /** 错题维度小结:「边界题栽了 1 道」——verdict 顺带汇报第二波哪些角度没站稳 */
  const dimReport = (['概念', '推演', '边界', '应用', '辨析'] as const)
    .map((d) => ({ d, n: wrongSelfTests.filter((q) => q.dimension === d).length }))
    .filter((e) => e.n > 0)
    .map((e) => `${e.d}题栽了 ${e.n} 道`)
    .join('、');

  /** 阅读量估算:讲义 + 例题总字数 ÷ 400 字/分钟,向上取整(图不计入,看图不算读) */
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

  const answer = (choice: boolean) => {
    if (answers.length >= probes.length) return;
    const mc = probes[answers.length];
    const good = choice === mc.probe.isTrue;
    setLiveMsg(
      `${good ? `答对了——这句话是${mc.probe.isTrue ? '对' : '错'}的。` : '答错了——这正是一个高频误区。'}${mc.probe.explanation}`,
    );
    setAnswers((a) => (a.length >= probes.length ? a : [...a, choice]));
  };

  const answerMc = (choice: number) => {
    if (mcAnswers.length >= selfTest.length) return;
    const q = selfTest[mcAnswers.length];
    const good = choice === q.answerIndex;
    setLiveMsg(
      `${good ? '答对了。' : `答错了——该选「${q.options[q.answerIndex]}」。`}${q.explanation}`,
    );
    setMcAnswers((a) => (a.length >= selfTest.length ? a : [...a, choice]));
  };

  /** 锚点滚动:reduced-motion 直接跳,不做平滑 */
  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  /** 重新摸底:两波作答与"过一遍材料"的选择一并清空;completePrep 仍只在进讲解舱时按当次成绩提交 */
  const retakeQuiz = () => {
    setAnswers([]);
    setMcAnswers([]);
    setLiveMsg('');
    setWantMaterials(false);
    jumpTo(SECTIONS[0].id);
  };

  const enterClassroom = () => {
    if (!submittedRef.current) {
      submittedRef.current = true;
      completePrep(topic.topicId, correctCount, quizTotal);
    }
    navigate(`/teach/${topic.topicId}`);
  };

  return (
    <div className={s.page}>
      <header className={s.head}>
        <Link to="/study" className={s.back}><Icon name="arrow-left" size={15} />回书斋</Link>
        <div className={s.headGrid}>
          <div>
            <p className={`${paper.typeLabel} ${s.course}`}>第一章 · 入书房温书 · {topic.course}</p>
            <h1 className={s.title}>{topic.title}</h1>
            <p className={s.tagline}>{topic.tagline}</p>
          </div>
          <aside className={s.prepNote} aria-label="小白的课前问笺">
            <span className={s.prepNoteIcon} aria-hidden="true"><Icon name="mail" size={20} /></span>
            <div>
              <p className={s.prepNoteLabel}>小白的课前问笺</p>
              <p className={s.prepNoteText}>明日要讲「{topic.title}」，先生且温书。我会带着一个真问题在学堂里等你。</p>
            </div>
            {/* 小白的私章:信笺角落钤一枚白文小印(印章形制,走 --seal-red 别名) */}
            <span className={s.prepNoteSeal} aria-hidden="true">白</span>
          </aside>
        </div>
        {/* 全页唯一慢转邮戳:钤在问笺一角的邮驿戳(装饰性,RoundStamp 自带 aria-hidden) */}
        <RoundStamp className={s.headStamp} text="备课台 · 教然后知困 · " size={74} dur={54} />
      </header>

      <div className={s.layout}>
        <main className={s.main}>
          {/* ── 记忆回执:接着上次讲(首学该课不渲染) ── */}
          {recall && <RecallCard recall={recall} />}

          {/* ── 壹 · 摸底快测 ── */}
          <section
            id={SECTIONS[0].id}
            className={`${s.section} ${s.bandShade}`}
            style={{ animationDelay: '80ms' }}
          >
            <div className={s.secHead}>
              <span className={`${paper.typeLabel} ${s.secEyebrow}`}>备课台 · NO.01</span>
              <h2 className={s.sectionTitle}>
                <span className={s.sectionNum}>壹</span>摸底快测
              </h2>
            </div>
            <p className={s.sectionHint}>
              开讲之前,先看看你现在站在哪。判断下面的说法对不对:
              {!quizDone && (
                <span className={s.quizCount}>
                  已答 {answers.length + mcAnswers.length} / {quizTotal}
                </span>
              )}
            </p>
            {/* 常驻 live region:读屏用户答题后在此听到判分(节点须先于反馈存在,否则首条丢播) */}
            <p className={s.srOnly} aria-live="polite">{liveMsg}</p>
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
                    {/* 答后按钮禁用而不卸载:卸载会把键盘焦点甩回 body,读屏用户直接迷航 */}
                    <div className={s.probeBtns}>
                      <button
                        type="button"
                        disabled={answered}
                        className={answered && choice === true ? s.optPicked : undefined}
                        onClick={() => answer(true)}
                      >
                        对
                      </button>
                      <button
                        type="button"
                        disabled={answered}
                        className={answered && choice === false ? s.optPicked : undefined}
                        onClick={() => answer(false)}
                      >
                        错
                      </button>
                    </div>
                    {answered && (
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
            {/* ── 第二波 · 多方位摸底:判断题答完才登场;题库为空的主题走不到这里 ── */}
            {probesDone && selfTest.length > 0 && (
              <div className={s.mcWave}>
                <p className={s.mcWaveTitle}>第二波 · 多方位摸底</p>
                <p className={s.mcWaveHint}>
                  判断只是热身——下面换几个角度出选择题,看你的理解经不经得起转弯。
                </p>
                <ol className={s.probeList}>
                  {selfTest.map((q, i) => {
                    if (i > mcAnswers.length) return null;
                    const answered = i < mcAnswers.length;
                    const pick = mcAnswers[i];
                    const good = answered && pick === q.answerIndex;
                    return (
                      <li
                        key={q.id}
                        className={`${s.probe} ${answered ? (good ? s.probeGood : s.probeBad) : ''}`}
                      >
                        <p className={s.probeNo}>第 {i + 1} / {selfTest.length} 题</p>
                        <p className={s.probeStatement}>{q.question}</p>
                        {q.code ? (
                          <pre className={s.code}><code>{q.code}</code></pre>
                        ) : null}
                        <div className={s.mcOptions}>
                          {q.options.map((opt, oi) => (
                            <button
                              key={opt}
                              type="button"
                              disabled={answered}
                              className={answered && pick === oi ? s.optPicked : undefined}
                              onClick={() => answerMc(oi)}
                            >
                              <span className={s.mcOptNo} aria-hidden="true">
                                {String.fromCharCode(65 + oi)}
                              </span>
                              {opt}
                            </button>
                          ))}
                        </div>
                        {answered && (
                          <div className={s.probeFb}>
                            <p className={good ? s.fbGood : s.fbBad}>
                              <span className={s.mcDim}>{q.dimension}</span>
                              {good
                                ? '答对了。'
                                : `答错了——该选「${q.options[q.answerIndex]}」。`}
                            </p>
                            <p className={s.fbExplain}>{q.explanation}</p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
            {quizDone && (
              allCorrect ? (
                <div className={s.verdictGood}>
                  <p>
                    摸底 {correctCount}/{quizTotal},基础相当扎实——你有资格直接上讲台。
                  </p>
                  <div className={s.verdictBtns}>
                    <button type="button" className={s.primaryBtn} onClick={enterClassroom}>
                      跳过备课,拍案开讲 <Icon name="arrow-right" size={17} />
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
                    摸底 {correctCount}/{quizTotal}——
                    {wrongMcs.length > 0
                      ? `有 ${wrongMcs.length} 个误区还没吃透`
                      : '判断都稳,选择题露了怯'}
                    {dimReport ? `,${dimReport}` : ''}。
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
                <div className={s.secHead}>
                  <span className={`${paper.typeLabel} ${s.secEyebrow}`}>备课台 · NO.02</span>
                  <h2 className={s.sectionTitle}>
                    <span className={s.sectionNum}>贰</span>教学任务卡
                  </h2>
                </div>
                <div className={s.taskCard}>
                  <span className={s.taskPin} aria-hidden="true" />
                  <span className={s.taskLabel}><Icon name="clipboard" size={16} />教 学 任 务</span>
                  <p className={s.taskText}>{topic.prep.taskCard.replace(/^[📋🧾]\s*/u, '')}</p>
                </div>
              </section>

              {/* ── 叁 · 讲课路线图 ── */}
              <section id={SECTIONS[2].id} className={`${s.section} ${s.bandWarm}`}>
                <div className={s.secHead}>
                  <span className={`${paper.typeLabel} ${s.secEyebrow}`}>备课台 · NO.03</span>
                  <h2 className={s.sectionTitle}>
                    <span className={s.sectionNum}>叁</span>讲课路线图
                  </h2>
                </div>
                <p className={s.sectionHint}>
                  你要把下面 {topic.checklist.length} 件事讲明白——小白到时候大概会这么问。
                </p>
                <div className={s.flowNote}>
                  <span className={s.flowLabel}>讲课节奏</span>
                  <p className={s.flowText}>{deriveTeachingFlow(topic)}</p>
                </div>
                <ol className={s.roadmap}>
                  {topic.checklist.map((item, i) => (
                    <Fragment key={item.id}>
                      {/* R6:stagger 70ms,同屏最长 delay 封顶 280ms,后排不留白 */}
                      <li className={s.roadStep} style={{ animationDelay: `${Math.min(i * 70, 280)}ms` }}>
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
                          style={{ animationDelay: `${Math.min((i + 1) * 70, 280)}ms` }}
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
                <div className={s.secHead}>
                  <span className={`${paper.typeLabel} ${s.secEyebrow}`}>备课台 · NO.04</span>
                  <h2 className={s.sectionTitle}>
                    <span className={s.sectionNum}>肆</span>研读材料包
                    <span className={s.readTime}>全读约 {readMinutes} 分钟</span>
                  </h2>
                </div>
                <p className={s.sectionHint}>
                  {wrongMcs.length > 0
                    ? '已按你的错题展开了相关部分;带着任务卡上的问题读。'
                    : allCorrect
                      ? '你全对了,材料默认收起,想翻哪节点哪节。'
                      : '错的没挂到具体误区——对照右侧薄弱点,想翻哪节点哪节。'}
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
                  {figures.length > 0 && (
                    <Collapse
                      title="一张图看懂"
                      tag="图解"
                      tagTone="plain"
                      defaultOpen={wrongMcs.length > 0}
                    >
                      {figures.map((fig) => (
                        <figure key={fig.title} className={s.figItem}>
                          <p className={s.figTitle}>{fig.title}</p>
                          {/* 横滚壳可聚焦:键盘用户才能滚动看全图(SVG 有 min-width) */}
                          <div className={s.figScroll} tabIndex={0} role="group" aria-label={fig.title}>
                            <fig.Svg className={s.figSvg} />
                          </div>
                          <figcaption className={s.figCaption}>{fig.caption}</figcaption>
                        </figure>
                      ))}
                    </Collapse>
                  )}
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
                              <span className={s.videoPlay} aria-hidden="true"><Icon name="play" size={18} /></span>
                              <span className={s.videoBody}>
                                <span className={s.videoTitle}>
                                  {ref.title}
                                  <span className={s.refArrow} aria-hidden="true"><Icon name="external" size={14} /></span>
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
                                  <span className={s.refArrow} aria-hidden="true"><Icon name="external" size={14} /></span>
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
              <section id={SECTIONS[4].id} className={`${s.section} ${s.bandShade}`}>
                <div className={s.secHead}>
                  <span className={`${paper.typeLabel} ${s.secEyebrow}`}>备课台 · NO.05</span>
                  <h2 className={s.sectionTitle}>
                    <span className={s.sectionNum}>伍</span>备课自检
                  </h2>
                </div>
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
                          <span className={s.checkBox} aria-hidden="true">{on ? <Icon name="check" size={15} /> : null}</span>
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
                    备课完成,拍惊堂木 <Icon name="arrow-right" size={17} />
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
          <nav aria-label="备课五步" data-tour="prep-steps">
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
          {(wrongMcs.length > 0 || wrongSelfTests.length > 0) && (
            <div>
              <h3 className={s.asideTitle}>摸底暴露的薄弱点</h3>
              <ul className={s.weakList}>
                {wrongMcs.map((mc) => (
                  <li key={mc.mcId} className={s.weakItem}>× {mc.belief}</li>
                ))}
                {/* 第二波答错的题:标维度,要点名从路线图 checklist 里查 */}
                {wrongSelfTests.map((q) => (
                  <li key={q.id} className={s.weakItem}>
                    <span className={s.weakDim}>{q.dimension}</span>
                    {topic.checklist.find((c) => c.id === q.checklistRef)?.point ??
                      '这个角度还没答稳'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {prepDone && (
            <p>
              <Link className={s.doneLink} to={`/teach/${topic.topicId}`}>
                你之前备过这门课 · 直接开讲 <Icon name="arrow-right" size={15} />
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

      {/* ── 新手引路(首访自动开一次) ── */}
      <Tour tourKey="prep" steps={PREP_TOUR} />
    </div>
  );
}
