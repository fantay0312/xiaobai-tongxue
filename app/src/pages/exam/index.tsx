/**
 * 考场 /exam/:sessionId —— 送小白赴考。
 * 三幕:送考(准考证) → 作答(一张试卷 + 考生席,逐题四拍) → 放榜(榜文 + 逐题判定)。
 * 分数与对错全部来自会话报告里的随堂小测;页面只负责把它演出来,不改任何判定。
 * 准考证、试卷、榜文是纸质故事物件(data-story),其余走应用外壳的令牌。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, GraduationCap, NotebookPen, PenLine, Route, ShieldAlert } from 'lucide-react';
import { getTopic } from '../../data';
import { Button, Empty, cx } from '../../components/ui';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { useAppStore } from '../../store/appStore';
import { getStageMeta } from '../../engine/evolution';
import type { XiaobaiQuizResult } from '../../types';
import { useDocTitle } from '../../hooks/useDocTitle';
import { ExamQuestion } from './ExamQuestion';
import {
  BEAT_INDEX, EXAM_BEATS, deriveUnderstanding, examWhisper, thinkingDuration, type ExamBeat,
} from './examStory';
import paper from '../../styles/paper.module.css';
import s from './exam.module.css';

type ExamPhase = 'sendoff' | 'question' | 'result';

const PHASES: { key: ExamPhase; label: string }[] = [
  { key: 'sendoff', label: '送考' },
  { key: 'question', label: '作答' },
  { key: 'result', label: '放榜' },
];

function resultLine(score: number): string {
  if (score >= 90) return '先生，我把你讲过的都带进考场了。总有一天，我也想把这些道理讲给别人听。';
  if (score >= 60) return '先生，有几处我答得不够稳。你愿意在灯下再替我批一批么？';
  return '先生，我把几处听岔了。别怪自己，我们把它们一处一处救回来。';
}

/** 榜上的等第:只是分数的另一种读法 */
function gradeOf(score: number): string {
  if (score >= 90) return '甲等';
  if (score >= 75) return '乙等';
  if (score >= 60) return '丙等';
  return '未及格';
}

function correctCount(quiz: XiaobaiQuizResult): number {
  return quiz.answers.reduce((sum, answer) => sum + (answer.correct ? 1 : 0), 0);
}

/** 放榜时分数从零数上去;减动效时直接给终值 */
function useCountUp(target: number, active: boolean, instant: boolean): number {
  const [value, setValue] = useState(active && !instant ? 0 : target);
  useEffect(() => {
    if (!active || instant) {
      setValue(target);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 900);
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, instant]);
  return value;
}

export default function ExamPage() {
  const { sessionId = '' } = useParams();
  const reports = useAppStore((st) => st.reports);
  const level = useAppStore((st) => st.global.learningLevel);
  const report = reports.find((item) => item.sessionId === sessionId);
  const topic = report ? getTopic(report.topicId) : undefined;
  useDocTitle(topic ? `送小白赴考 · ${topic.title}` : '送小白赴考');
  const quiz = report?.quiz ?? null;
  const topicState = useAppStore((st) => report ? st.topicStates[report.topicId] : undefined);

  const [phase, setPhase] = useState<ExamPhase>('sendoff');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [beat, setBeat] = useState<ExamBeat>('prompt');
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const prefersReducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const answer = quiz?.answers[questionIndex];
  const point = answer
    ? topic?.checklist.find((item) => item.id === answer.checklistRef)?.point ?? '这一处学问'
    : '这一处学问';
  const carriedMisconception = Boolean(answer && report?.blindSpots.some(
    (spot) => spot.checklistId === answer.checklistRef && spot.mcId,
  ));
  const understanding = deriveUnderstanding(
    answer,
    carriedMisconception,
    topicState?.hitChecklist ?? [],
  );
  const whisper = examWhisper(understanding, point);
  const thoughtMs = thinkingDuration(understanding, topicState?.mastery ?? 0);
  const shownScore = useCountUp(quiz?.score ?? 0, phase === 'result', prefersReducedMotion);

  useEffect(() => {
    if (phase !== 'question' || !answer) return;
    setBeat('prompt');
    const timer = window.setTimeout(
      () => setBeat('thinking'),
      prefersReducedMotion ? 0 : 900,
    );
    return () => window.clearTimeout(timer);
  }, [answer, phase, questionIndex, prefersReducedMotion]);

  useEffect(() => {
    if (phase !== 'question' || beat !== 'writing') return;
    const timer = window.setTimeout(
      () => setBeat('judged'),
      prefersReducedMotion ? 0 : 760,
    );
    return () => window.clearTimeout(timer);
  }, [beat, phase, prefersReducedMotion]);

  useEffect(() => {
    // 换幕/换题回到页首:外壳的滚动容器不是 window,两边都归零
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    pageRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    stageHeadingRef.current?.focus({ preventScroll: true });
  }, [phase, questionIndex]);

  if (!report || !topic) {
    return (
      <div className={s.page}>
        <Empty
          icon={<Route size={22} strokeWidth={1.75} />}
          title="这场考试还没有入册"
          description="先在学堂里给小白讲完一课，它才有东西可以带进考场。"
          action={<Button asChild variant="solid"><Link to="/learn">回学习终端</Link></Button>}
        />
      </div>
    );
  }

  if (!quiz || quiz.answers.length === 0) {
    return (
      <div className={s.page}>
        <Empty
          icon={<NotebookPen size={22} strokeWidth={1.75} />}
          title="这是一堂温故课"
          description="本轮没有另设考试，小白把想起来的地方都留在灯下批注里了。"
          action={(
            <Button asChild variant="solid" iconRight={<ChevronRight size={16} strokeWidth={1.75} />}>
              <Link to={`/review/${report.sessionId}`}>去灯下批注</Link>
            </Button>
          )}
        />
      </div>
    );
  }

  const advance = () => {
    if (questionIndex >= quiz.answers.length - 1) {
      setPhase('result');
      return;
    }
    setBeat('prompt');
    setQuestionIndex((index) => index + 1);
  };

  const stage = getStageMeta(level);
  const phaseIndex = PHASES.findIndex((item) => item.key === phase);
  const right = correctCount(quiz);
  const wrong = quiz.answers.length - right;

  return (
    <div className={s.page} ref={pageRef}>
      <p className={s.srOnly} aria-live="polite">
        {phase === 'sendoff'
          ? '送小白赴考'
          : phase === 'question'
            ? `小白正在作答第 ${questionIndex + 1} 题，共 ${quiz.answers.length} 题，当前${EXAM_BEATS[BEAT_INDEX[beat]].label}`
            : `考试放榜，小白得分 ${quiz.score} 分`}
      </p>

      {/* 页头:所在位置 + 三幕进程 */}
      <header className={s.pageHead}>
        <nav className={s.crumb} aria-label="所在位置">
          <Link to="/learn">学习终端</Link>
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>第三章 · 送小白赴考</span>
        </nav>
        <ol className={s.phaseRail} aria-label="考试进程">
          {PHASES.map((item, index) => (
            <li
              key={item.key}
              className={s.phaseStep}
              data-state={index < phaseIndex ? 'done' : index === phaseIndex ? 'now' : 'todo'}
              aria-current={index === phaseIndex ? 'step' : undefined}
            >
              <i aria-hidden="true">{index + 1}</i>
              {item.label}
            </li>
          ))}
        </ol>
      </header>

      {phase === 'sendoff' && (
        <section className={s.sendoff} aria-labelledby="exam-title">
          <div className={s.avatarSide}>
            <XiaobaiAvatar mood="shy" level={level} variant="paper" size={168} />
            <span className={s.satchel}>小书箱已背好</span>
            <div className={cx(s.ticket, paper.texture)} data-story aria-label="小白的准考证">
              <p className={s.ticketHead}>
                准考证
                <span className={s.ticketStamp} aria-hidden="true">考</span>
              </p>
              <dl className={s.ticketRows}>
                <div><dt>考生</dt><dd>小白 · {stage.name}</dd></div>
                <div><dt>科目</dt><dd>{topic.title}</dd></div>
                <div><dt>试题</dt><dd>{quiz.answers.length} 道</dd></div>
                <div><dt>监考</dt><dd>导演</dd></div>
              </dl>
              <p className={cx(paper.perfLine, s.ticketAdmit)}>
                <span className={paper.perfNote}>凭此证入场</span>
                <span className={paper.perfNote}>ADMIT ONE</span>
              </p>
            </div>
          </div>
          <div className={s.sendoffBody}>
            <p className={s.kicker}>{topic.course} · {topic.title}</p>
            <h1 ref={stageHeadingRef} tabIndex={-1} id="exam-title" className={s.title}>先生，我去了！</h1>
            <p className={s.lead}>
              你刚才讲下的每一句，都已经装进小白的脑袋。接下来它要独自答完
              <b> {quiz.answers.length} </b>道题——你只能在场外看着，不能替它开口。
            </p>
            <p className={s.rule}>
              <ShieldAlert size={17} strokeWidth={1.75} aria-hidden="true" />
              考场之内，先生不得代答。
            </p>
            {/* 手机上这一条吸在屏幕底部（见 exam.module.css），主动作始终够得着 */}
            <div className={s.sendoffAction}>
              <Button
                variant="solid"
                size="lg"
                icon={<Route size={18} strokeWidth={1.75} />}
                onClick={() => setPhase('question')}
              >
                送小白入场
              </Button>
            </div>
          </div>
        </section>
      )}

      {phase === 'question' && answer && (
        <ExamQuestion
          topic={topic}
          quiz={quiz}
          answer={answer}
          questionIndex={questionIndex}
          level={level}
          beat={beat}
          point={point}
          whisper={whisper}
          thoughtMs={thoughtMs}
          reducedMotion={prefersReducedMotion}
          headingRef={stageHeadingRef}
          onWhisperDone={() => setBeat('writing')}
          onSkip={() => setPhase('result')}
          onAdvance={advance}
        />
      )}

      {phase === 'result' && (
        <section className={s.result} aria-labelledby="result-title">
          {/* 榜文:一张贴出来的纸榜,朱印压角 */}
          <div className={cx(s.board, paper.texture)} data-story>
            <span className={s.resultSeal} aria-hidden="true">榜</span>
            <p className={s.boardKicker}>放榜 · {topic.title}</p>
            <h1 ref={stageHeadingRef} tabIndex={-1} id="result-title" className={s.resultTitle}>
              <span className={s.resultName}>{stage.name} 小白</span>
              <span className={s.resultScore} aria-label={`${quiz.score} 分`}>
                {shownScore}<small aria-hidden="true">分</small>
              </span>
            </h1>
            <p className={s.resultMeta}>
              <b>{gradeOf(quiz.score)}</b>
              {right} 题答稳 · {wrong} 题留下墨痕
            </p>
            <blockquote className={s.resultQuote}>「{resultLine(quiz.score)}」</blockquote>
            {report.masteredNow && (
              <p className={s.resultMastered}>
                <GraduationCap size={17} strokeWidth={1.75} aria-hidden="true" />
                这一场过后，小白在「{topic.title}」上正式出师——结业证书已收进灯下批注。
              </p>
            )}
            <div className={s.resultAvatar}>
              <XiaobaiAvatar mood={quiz.score >= 80 ? 'proud' : 'shy'} level={level} variant="paper" size={132} />
            </div>
          </div>

          {/* 逐题判定:每题一枚小章 */}
          <div className={s.resultDetail}>
            <h2 className={s.detailTitle}>逐题判定</h2>
            <ol className={s.resultList}>
              {quiz.answers.map((item, index) => {
                const question = topic.quizBank.find((q) => q.id === item.quizId);
                const itemPoint = topic.checklist.find((c) => c.id === item.checklistRef)?.point;
                return (
                  <li key={item.quizId} className={s.resultItem} style={{ animationDelay: `${Math.min(index * 70, 350)}ms` }}>
                    <span className={cx(s.miniStamp, item.correct ? s.miniGood : s.miniBad)} aria-hidden="true">
                      {item.correct ? '稳' : '疑'}
                    </span>
                    <span className={s.resultQ}>
                      {index + 1}. {question?.question ?? itemPoint ?? '这一处学问'}
                      <small>{item.correct ? '答稳了' : '还没答稳'}{itemPoint ? ` · ${itemPoint}` : ''}</small>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className={s.resultEnd}>
            <p className={s.resultNote}>分数只来自随堂测验；考场独白只是把小白当时的理解状态说给你听。</p>
            <footer className={s.resultFoot}>
              <Button
                asChild
                variant="solid"
                size="lg"
                icon={<PenLine size={18} strokeWidth={1.75} />}
              >
                <Link to={`/review/${report.sessionId}`}>灯下批注这份答卷</Link>
              </Button>
            </footer>
          </div>
        </section>
      )}
    </div>
  );
}
