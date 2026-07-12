import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getTopic } from '../../data';
import { Icon } from '../../components/ui/Icon';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { useAppStore } from '../../store/appStore';
import type { XiaobaiQuizResult } from '../../types';
import { useDocTitle } from '../../hooks/useDocTitle';
import { ExamQuestion } from './ExamQuestion';
import {
  BEAT_INDEX, EXAM_BEATS, deriveUnderstanding, examWhisper, thinkingDuration, type ExamBeat,
} from './examStory';
import s from './exam.module.css';

type ExamPhase = 'sendoff' | 'question' | 'result';

function resultLine(score: number): string {
  if (score >= 90) return '先生，我把你讲过的都带进考场了。总有一天，我也想把这些道理讲给别人听。';
  if (score >= 60) return '先生，有几处我答得不够稳。你愿意在灯下再替我批一批么？';
  return '先生，我把几处听岔了。别怪自己，我们把它们一处一处救回来。';
}

function correctCount(quiz: XiaobaiQuizResult): number {
  return quiz.answers.reduce((sum, answer) => sum + (answer.correct ? 1 : 0), 0);
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
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    stageHeadingRef.current?.focus({ preventScroll: true });
  }, [phase, questionIndex]);

  if (!report || !topic) {
    return (
      <div className={s.page}>
        <div className={s.empty}>
          <Icon name="route" size={28} />
          <h1>这场考试还没有入册</h1>
          <p>先在学堂里给小白讲完一课，它才有东西可以带进考场。</p>
          <Link to="/study" className={s.primaryBtn}>回书斋</Link>
        </div>
      </div>
    );
  }

  if (!quiz || quiz.answers.length === 0) {
    return (
      <div className={s.page}>
        <div className={s.empty}>
          <Icon name="notebook" size={28} />
          <h1>这是一堂温故课</h1>
          <p>本轮没有另设考试，小白把想起来的地方都留在灯下批注里了。</p>
          <Link to={`/review/${report.sessionId}`} className={s.primaryBtn}>
            去灯下批注 <Icon name="arrow-right" size={17} />
          </Link>
        </div>
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

  return (
    <div className={s.page}>
      <span className={s.watermark} aria-hidden="true">考</span>
      <p className={s.srOnly} aria-live="polite">
        {phase === 'sendoff'
          ? '送小白赴考'
          : phase === 'question'
            ? `小白正在作答第 ${questionIndex + 1} 题，共 ${quiz.answers.length} 题，当前${EXAM_BEATS[BEAT_INDEX[beat]].label}`
            : `考试放榜，小白得分 ${quiz.score} 分`}
      </p>

      {phase === 'sendoff' && (
        <section className={s.sendoff} aria-labelledby="exam-title">
          <div className={s.avatarSide}>
            <span className={s.gateMark} aria-hidden="true"><Icon name="school" size={23} /></span>
            <XiaobaiAvatar mood="shy" level={level} variant="paper" size={190} />
            <span className={s.satchel}>小书箱已背好</span>
            <div className={s.ticket} aria-label="小白的准考证">
              <p className={s.ticketHead}>
                准考证
                <span className={s.ticketStamp} aria-hidden="true">考</span>
              </p>
              <dl className={s.ticketRows}>
                <div><dt>考生</dt><dd>小白</dd></div>
                <div><dt>科目</dt><dd>{topic.title}</dd></div>
                <div><dt>试题</dt><dd>{quiz.answers.length} 道</dd></div>
                <div><dt>监考</dt><dd>导演</dd></div>
              </dl>
            </div>
          </div>
          <div className={s.sendoffBody}>
            <p className={s.kicker}>第三章 · 送小白赴考</p>
            <h1 ref={stageHeadingRef} tabIndex={-1} id="exam-title" className={s.title}>先生，我去了！</h1>
            <p className={s.lead}>
              你刚才讲下的每一句，都已经装进小白的脑袋。接下来它要独自答完
              <b> {quiz.answers.length} </b>道题——你只能在场外看着，不能替它开口。
            </p>
            <blockquote className={s.rule}>考场之内，先生不得代答。</blockquote>
            <button type="button" className={s.primaryBtn} onClick={() => setPhase('question')}>
              <Icon name="route" size={18} />
              送小白入场
            </button>
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
          <div className={s.resultSeal} aria-hidden="true">榜</div>
          <div className={s.resultMain}>
            <p className={s.kicker}>放榜 · 本场真实评估</p>
            <h1 ref={stageHeadingRef} tabIndex={-1} id="result-title" className={s.resultTitle}>小白，{quiz.score} 分</h1>
            <p className={s.resultMeta}>
              {correctCount(quiz)} 题答稳 · {quiz.answers.length - correctCount(quiz)} 题留下墨痕
            </p>
            <blockquote className={s.resultQuote}>「{resultLine(quiz.score)}」</blockquote>
            {report.masteredNow && (
              <p className={s.resultMastered}>
                <Icon name="graduation" size={17} />
                这一场过后，小白在「{topic.title}」上正式出师——结业证书已收进灯下批注。
              </p>
            )}
            <p className={s.resultNote}>分数只来自随堂测验；考场独白只是把小白当时的理解状态说给你听。</p>
            <Link to={`/review/${report.sessionId}`} className={s.primaryBtn}>
              <Icon name="pen" size={18} />
              灯下批注这份答卷
            </Link>
          </div>
          <div className={s.resultAvatar}>
            <XiaobaiAvatar mood={quiz.score >= 80 ? 'proud' : 'shy'} level={level} variant="paper" size={180} />
          </div>
        </section>
      )}
    </div>
  );
}
