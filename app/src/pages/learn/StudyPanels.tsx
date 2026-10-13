import { useEffect, useRef, useState } from 'react';
import type { Topic } from '../../types';
import { getSelfTest } from '../../data/selfTest';
import { lectureSections, studyCards, downloadStudyFile, type StudyWorkspace } from '../../engine/studyWorkspace';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { getFigures } from '../../components/diagrams';
import { Icon } from '../../components/ui/Icon';
import s from './learn.module.css';

export function ReadingPanel({ topic, readSections, onRead, onAsk }: {
  topic: Topic; readSections: number[]; onRead: (index: number) => void; onAsk: (text: string) => void;
}) {
  const sections = lectureSections(topic);
  const [index, setIndex] = useState(() => Math.max(0, sections.findIndex((_, i) => !readSections.includes(i))));
  const active = sections[index];
  const [examplesOpen, setExamplesOpen] = useState(false);
  const figures = getFigures(topic.topicId);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // 窄屏上段落小签是一条横向滑动的带子：让当前段落保持可见，只动这一条，不带动正文
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const box = nav.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    nav.scrollLeft += item.left - box.left - (box.width - item.width) / 2;
  }, [index]);
  return <div className={s.reading}>
    <div className={s.sectionHeading}><div><h2>{topic.prep.microLecture.title}</h2><p>逐段读懂，再用自己的话说出来。</p></div><span>{index + 1} / {sections.length}</span></div>
    <nav ref={navRef} className={s.chapterNav} aria-label="讲义段落">{sections.map((section, i) => <button key={i} className={i === index ? s.chapterActive : ''} aria-current={i === index ? 'step' : undefined} onClick={() => setIndex(i)}>{readSections.includes(i) ? <Icon name="check" size={13} /> : <span>{i + 1}</span>}{section.title}</button>)}</nav>
    {active && <article className={s.lecturePaper}><CoachMarkdown text={active.text} /></article>}
    <div className={s.readingActions}>
      <button className={s.softButton} disabled={index === 0} onClick={() => setIndex((i) => i - 1)}><Icon name="arrow-left" size={15} />上一段</button>
      <button className={s.primaryButton} onClick={() => { onRead(index); if (index < sections.length - 1) setIndex(index + 1); }}>{readSections.includes(index) ? '已读过' : '标记已读'}{index < sections.length - 1 ? '，读下一段' : ''}<Icon name="check" size={15} /></button>
      <button className={s.textButton} onClick={() => onAsk(`请帮我理解这一段，先讲清核心想法，再给一个例子：\n${active?.text.slice(0, 1800) ?? ''}`)}>带着这段问小砚<Icon name="arrow-right" size={15} /></button>
    </div>
    {figures.length > 0 && <section className={s.figureSection}><h3>一张图看懂</h3>{figures.map(({ id, Svg, caption }) => <figure key={id}><Svg /><figcaption className={s.footnote}>{caption}</figcaption></figure>)}</section>}
    {topic.prep.examples.length > 0 && <section className={s.examples}>
      <button className={s.disclosure} aria-expanded={examplesOpen} onClick={() => setExamplesOpen((open) => !open)}><span>用例子想一想 <small>{topic.prep.examples.length} 个例子</small></span><Icon name="chevron-down" size={16} /></button>
      {examplesOpen && topic.prep.examples.map((example) => <article key={example.title}><h3>{example.title}</h3><pre>{example.code}</pre><CoachMarkdown text={example.walkthrough} /><button className={s.textButton} onClick={() => onAsk(`请一步步带我理解这个例子：${example.title}\n${example.code}`)}>请小砚讲这个例子</button></article>)}
    </section>}
  </div>;
}

export function PracticePanel({ topic, onAsk, answers, onAnswers, selfChecks }: { topic: Topic; onAsk: (text: string) => void; answers: Record<string, number>; onAnswers: (value: Record<string, number>) => void; selfChecks?: { id: string; front: string; back: string }[] }) {
  const questions = [
    ...topic.misconceptions.map((item) => ({ id: item.mcId, stem: item.probe.statement, options: ['正确', '不正确'], answerIndex: item.probe.isTrue ? 0 : 1, explanation: item.probe.explanation })),
    ...getSelfTest(topic.topicId).map((item) => ({ id: item.id, stem: `${item.question}${item.code ? `\n\n${item.code}` : ''}`, options: item.options, answerIndex: item.answerIndex, explanation: item.explanation })),
  ];
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  if (selfChecks) {
    const item = selfChecks[index];
    if (!item) return <div className={s.panelEmpty}>请先选择有正文的资料。</div>;
    return <div className={s.practice}><div className={s.sectionHeading}><div><h2>根据所选资料自检</h2><p>先用自己的话回答，再对照原文。这是自评，不是模型评分。</p></div><span>{index + 1} / {selfChecks.length}</span></div><article className={s.question}><h3>{item.front}</h3><button className={s.softButton} onClick={() => setRevealed((value) => !value)}>{revealed ? '收起参考' : '查看原文要点'}</button>{revealed && <CoachMarkdown text={item.back} />}</article><div className={s.readingActions}><button className={s.softButton} disabled={!revealed} onClick={() => onAnswers({ ...answers, [item.id]: 0 })}>还需要复习</button><button className={s.primaryButton} disabled={!revealed} onClick={() => onAnswers({ ...answers, [item.id]: 1 })}>我能解释</button><button className={s.textButton} onClick={() => onAsk(`请根据所选资料问我一个关于「${item.front}」的问题，等我回答再反馈。`)}>请小砚追问</button><button className={s.softButton} disabled={index === selfChecks.length - 1} onClick={() => { setIndex(index + 1); setRevealed(false); }}>下一题</button></div><p className={s.footnote}>{answers[item.id] === 1 ? '你已标记：我能解释。' : answers[item.id] === 0 ? '你已标记：还需要复习。' : '尚未自评。'}</p></div>;
  }
  const question = questions[index];
  if (!question) return <div className={s.panelEmpty}><h2>这门课还没有随堂题</h2><p>先读一段讲义，再请小砚围绕这一段向你提问。</p><button className={s.primaryButton} onClick={() => onAsk('请围绕本课核心概念，一次问我一道自检问题，等我回答再反馈。')}>请小砚出一道思考题</button></div>;
  const answered = answers[question.id] !== undefined;
  const correct = answers[question.id] === question.answerIndex;
  const score = questions.filter((q) => answers[q.id] === q.answerIndex).length;
  return <div className={s.practice}>
    <div className={s.sectionHeading}><div><h2>练一练，找到还没懂的地方</h2><p>这里是自主练习，不计入小白的考试成绩。</p></div><span>{index + 1} / {questions.length}</span></div>
    <div className={s.practiceProgress}>{questions.map((q, i) => <button key={q.id} aria-label={`第 ${i + 1} 题${answers[q.id] !== undefined ? '，已作答' : ''}`} aria-current={i === index ? 'step' : undefined} data-result={answers[q.id] === undefined ? undefined : answers[q.id] === q.answerIndex ? 'right' : 'wrong'} onClick={() => setIndex(i)}>{i + 1}</button>)}</div>
    <article className={s.question}><span className={s.questionLabel}>选出你的判断</span><h3>{question.stem}</h3><div className={s.options}>{question.options.map((option, i) => <button key={i} disabled={answered} className={s.option} data-result={answered && i === question.answerIndex ? 'right' : answered && answers[question.id] === i ? 'wrong' : undefined} onClick={() => onAnswers({ ...answers, [question.id]: i })}><span>{String.fromCharCode(65 + i)}</span>{option}{answered && i === question.answerIndex && <Icon name="check" size={18} />}</button>)}</div>
      {answered && <div className={s.answerFeedback} role="status" data-correct={correct}><strong>{correct ? '判断正确。' : '这是一处值得补上的理解。'}</strong><CoachMarkdown text={question.explanation || '回到讲义核对这一点，也可以请小砚帮助解释。'} /><button className={s.textButton} onClick={() => onAsk(`我在这道题上${correct ? '答对了，但想进一步理解' : '答错了'}：${question.stem}\n请解释为什么，给一个能区分两种情况的例子。`)}>让小砚解释这道题<Icon name="arrow-right" size={14} /></button></div>}
    </article>
    <div className={s.readingActions}><span className={s.muted}>已答 {Object.keys(answers).length} 题 · 答对 {score} 题</span><button className={s.softButton} onClick={() => { onAnswers({}); setIndex(0); }}>重新练习</button><button className={s.primaryButton} disabled={index === questions.length - 1} onClick={() => setIndex((i) => i + 1)}>下一题<Icon name="arrow-right" size={15} /></button></div>
  </div>;
}

export function CardsPanel({ topic, ratings, onRate, sourceCards }: { topic: Topic; ratings: StudyWorkspace['ratings']; onRate: (id: string, value: 'again' | 'know') => void; sourceCards?: { id: string; front: string; back: string }[] }) {
  const cards = sourceCards ?? studyCards(topic);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[index];
  const known = cards.filter((item) => ratings[item.id] === 'know').length;
  if (!card) return <div className={s.panelEmpty}><h2>暂时没有可用闪卡</h2><p>课题发布并包含误区讲解后，就能在这里复习。</p></div>;
  const next = () => { setFlipped(false); setIndex((i) => (i + 1) % cards.length); };
  return <div className={s.cardsPanel}>
    <div className={s.sectionHeading}><div><h2>{topic.title} · 复习卡片</h2><p>先回想，再翻面。用自己的话解释，比记住答案更重要。</p></div></div>
    <nav className={s.cardPager} aria-label="切换复习卡片"><button className={s.pagerArrow} aria-label="上一张卡片" disabled={index === 0} onClick={() => { setIndex(index - 1); setFlipped(false); }}><Icon name="arrow-left" size={20} /></button><div>{cards.map((item, i) => <button key={item.id} className={s.pagerDot} aria-label={`查看第 ${i + 1} 张卡片`} aria-current={i === index ? 'true' : undefined} onClick={() => { setIndex(i); setFlipped(false); }} />)}</div><button className={s.pagerArrow} aria-label="下一张卡片" disabled={index === cards.length - 1} onClick={() => { setIndex(index + 1); setFlipped(false); }}><Icon name="arrow-right" size={20} /></button></nav>
    <div className={s.cardToolbar}><span>共 {cards.length} 张卡片</span><button className={s.textButton} onClick={() => downloadStudyFile(`${topic.title}-闪卡.tsv`, cards.map((item) => [item.front, item.back].map((text) => text.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n'), 'text/tab-separated-values')}><Icon name="download" size={16} />导出 Anki 文本</button></div>
    <div className={s.cardStatus}><div><Icon name="circle-check" size={18} /><strong>复习卡片已准备好</strong><span>{sourceCards ? '来自所选资料' : '来自本课易错点'}</span></div><span>已掌握 {known} / {cards.length}</span></div>
    <div className={s.cardStatusBar} role="progressbar" aria-label="闪卡掌握进度" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={known}><span style={{ width: `${known / cards.length * 100}%` }} /></div>
    <button className={s.flashcard} aria-label={flipped ? '闪卡答案，点击返回题面' : '闪卡题面，点击查看答案'} onClick={() => setFlipped((value) => !value)}>
      <span className={s.flashcardLabel}>{flipped ? '对照答案' : '先在心里回答'} · {index + 1} / {cards.length}</span><div><CoachMarkdown text={flipped ? card.back : card.front} /></div><span className={s.flipHint}>{flipped ? '点击返回题面' : '点击翻面，核对你的理解'}<Icon name="eye" size={15} /></span>
    </button>
    <div className={s.cardActions}><button className={s.softButton} disabled={!flipped} onClick={() => { onRate(card.id, 'again'); next(); }}>还要复习</button><button className={s.primaryButton} disabled={!flipped} onClick={() => { onRate(card.id, 'know'); next(); }}>我记住了<Icon name="check" size={15} /></button></div>
    <p className={s.footnote}>翻卡记录保存在此浏览器。导出的 TSV 可作为正面／背面两列导入 Anki。</p>
  </div>;
}
