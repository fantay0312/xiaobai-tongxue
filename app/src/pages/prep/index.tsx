/**
 * 备课页 /prep/:topicId —— 自习桌面。
 * 流程:壹 摸底快测(误区库判断题,逐题即时反馈) → 贰 教学任务卡(真实卡片质感)
 *      → 叁 材料包(微课讲义 + 例题,按错题相关展开) → 肆 自检清单全勾 → 解锁讲解舱。
 * 全对可跳过备课直接开讲;状态只经 store(completePrep)。
 */
import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../../store/appStore';
import { getTopic } from '../../data';
import { Md } from '../../components/Md';
import type { Misconception } from '../../types';
import s from './prep.module.css';

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
    <section className={s.collapse}>
      <button
        type="button"
        className={s.collapseHead}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={s.collapseMark} aria-hidden="true">{open ? '−' : '+'}</span>
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
  const navigate = useNavigate();
  const topic = getTopic(topicId);
  const completePrep = useAppStore((st) => st.completePrep);
  const prepDone = useAppStore((st) => st.topicStates[topicId]?.prepDone ?? false);

  /** 摸底快测:已作答的选择(true=判"对",false=判"错") */
  const [answers, setAnswers] = useState<boolean[]>([]);
  /** 全对时用户仍选择过一遍材料 */
  const [wantMaterials, setWantMaterials] = useState(false);
  const [checks, setChecks] = useState<boolean[]>([]);
  const submittedRef = useRef(false);

  if (!topic || topic.locked) {
    return (
      <div className={s.page}>
        <p className={s.notFound}>
          这个知识点还没有开放。<Link to="/study">← 回书斋</Link>
        </p>
      </div>
    );
  }

  const probes = topic.misconceptions.slice(0, 3);
  const quizDone = answers.length >= probes.length;
  const correctCount = answers.filter((c, i) => c === probes[i].probe.isTrue).length;
  const allCorrect = quizDone && correctCount === probes.length;
  const wrongMcs = probes.filter((mc, i) => i < answers.length && answers[i] !== mc.probe.isTrue);
  const materialsVisible = quizDone && (!allCorrect || wantMaterials);

  /** 材料包按需展开:有错题时,微课讲义 + 与错题相关的例题默认展开 */
  const exampleRelated = topic.prep.examples.map((ex) =>
    relatedToWrong(ex.title + ex.code + ex.walkthrough, wrongMcs),
  );
  const anyRelated = exampleRelated.some(Boolean);
  const exampleDefaultOpen = (i: number) =>
    wrongMcs.length > 0 && (exampleRelated[i] || !anyRelated);

  const allChecked =
    topic.prep.selfCheck.length > 0 && topic.prep.selfCheck.every((_, i) => checks[i]);

  const answer = (choice: boolean) =>
    setAnswers((a) => (a.length >= probes.length ? a : [...a, choice]));

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
          <section className={s.section} style={{ animationDelay: '80ms' }}>
            <h2 className={s.sectionTitle}>
              <span className={s.sectionNum}>壹</span>摸底快测
            </h2>
            <p className={s.sectionHint}>
              开讲之前,先看看你现在站在哪。判断下面的说法对不对:
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
                  </div>
                </div>
              ) : (
                <div className={s.verdictBad}>
                  <p>
                    摸底 {correctCount}/{probes.length}——有 {wrongMcs.length} 个误区还没吃透。
                    别慌,下面的材料就是为它准备的;等会小白多半会拿这里考你。
                  </p>
                </div>
              )
            )}
          </section>

          {materialsVisible && (
            <>
              {/* ── 贰 · 教学任务卡 ── */}
              <section className={s.section}>
                <h2 className={s.sectionTitle}>
                  <span className={s.sectionNum}>贰</span>教学任务卡
                </h2>
                <div className={s.taskCard}>
                  <span className={s.taskPin} aria-hidden="true" />
                  <span className={s.taskLabel}>教 学 任 务</span>
                  <p className={s.taskText}>{topic.prep.taskCard}</p>
                </div>
              </section>

              {/* ── 叁 · 材料包 ── */}
              <section className={s.section}>
                <h2 className={s.sectionTitle}>
                  <span className={s.sectionNum}>叁</span>研读材料包
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
                </div>
              </section>

              {/* ── 肆 · 自检清单 ── */}
              <section className={s.section}>
                <h2 className={s.sectionTitle}>
                  <span className={s.sectionNum}>肆</span>备课自检
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
          <div>
            <h3 className={s.asideTitle}>备课四步</h3>
            <ol className={s.stepList}>
              {[
                { name: '摸底快测', done: quizDone, active: !quizDone },
                { name: '教学任务卡', done: materialsVisible, active: false },
                {
                  name: '研读材料包',
                  done: materialsVisible && allChecked,
                  active: materialsVisible && !allChecked,
                },
                { name: '自检清单', done: allChecked, active: false },
              ].map((st) => (
                <li
                  key={st.name}
                  className={`${s.step} ${st.done ? s.stepDone : ''} ${st.active ? s.stepActive : ''}`}
                >
                  <span className={s.stepDot} aria-hidden="true" />
                  {st.name}
                </li>
              ))}
            </ol>
          </div>
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
    </div>
  );
}
