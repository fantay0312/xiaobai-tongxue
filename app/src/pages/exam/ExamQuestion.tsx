import type { RefObject } from 'react';
import { Icon } from '../../components/ui/Icon';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import type { Topic, XiaobaiGlobal, XiaobaiQuizResult } from '../../types';
import { BEAT_INDEX, EXAM_BEATS, type ExamBeat } from './examStory';
import { WhisperText } from './WhisperText';
import surface from './exam.module.css';
import s from './examQuestion.module.css';

interface ExamQuestionProps {
  topic: Topic;
  quiz: XiaobaiQuizResult;
  answer: XiaobaiQuizResult['answers'][number];
  questionIndex: number;
  level: XiaobaiGlobal['learningLevel'];
  beat: ExamBeat;
  point: string;
  whisper: string;
  thoughtMs: number;
  reducedMotion: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onWhisperDone: () => void;
  onSkip: () => void;
  onAdvance: () => void;
}

export function ExamQuestion({
  topic, quiz, answer, questionIndex, level, beat, point, whisper, thoughtMs,
  reducedMotion, headingRef, onWhisperDone, onSkip, onAdvance,
}: ExamQuestionProps) {
  const question = topic.quizBank.find((item) => item.id === answer.quizId);

  return (
    <section className={surface.examDesk} aria-labelledby="question-title">
      <header className={s.examHead}>
        <div>
          <p className={surface.kicker}>考场实录 · {topic.title}</p>
          <h1 className={s.examTitle}>小白正在独自作答</h1>
        </div>
        <button type="button" className={s.skipBtn} onClick={onSkip}>直接放榜</button>
      </header>

      <ol className={s.progress} aria-label={`共 ${quiz.answers.length} 题，当前第 ${questionIndex + 1} 题`}>
        {quiz.answers.map((item, index) => (
          <li
            key={item.quizId}
            className={`${s.progressDot} ${index < questionIndex ? s.progressPast : ''} ${index === questionIndex ? s.progressNow : ''}`}
            aria-current={index === questionIndex ? 'step' : undefined}
          >
            <span className={s.cellNo} aria-hidden="true">{index + 1}</span>
            <span className={surface.srOnly}>第 {index + 1} 题</span>
          </li>
        ))}
      </ol>

      <ol className={s.beatRail} aria-label="每题四拍：亮题、心声、落笔、判定">
        {EXAM_BEATS.map((item, index) => (
          <li
            key={item.key}
            className={`${s.beatStep} ${index < BEAT_INDEX[beat] ? s.beatPast : ''} ${item.key === beat ? s.beatNow : ''}`}
            aria-current={item.key === beat ? 'step' : undefined}
          >
            <span>{item.no}</span>{item.label}
          </li>
        ))}
      </ol>

      <div className={s.questionCard}>
        <p className={s.questionNo}>第 {questionIndex + 1} / {quiz.answers.length} 题</p>
        <h2 ref={headingRef} tabIndex={-1} id="question-title" className={s.questionText}>
          {question?.question ?? point}
        </h2>
        {question?.code ? <pre className={s.code}><code>{question.code}</code></pre> : null}
      </div>

      <div className={s.thought}>
        <div className={s.miniAvatar}>
          <XiaobaiAvatar
            mood={beat === 'judged' ? (answer.correct ? 'aha' : 'confused') : beat === 'prompt' ? 'curious' : 'thinking'}
            level={level}
            variant="paper"
            size={92}
          />
        </div>
        <div>
          <p className={s.thoughtLabel}>小白心声</p>
          <p className={s.thoughtText}>
            {beat === 'prompt' ? '题目亮起，小白先默读一遍。' : (
              <WhisperText
                text={whisper}
                mode={beat === 'thinking' ? 'typing' : 'complete'}
                durationMs={thoughtMs}
                reducedMotion={reducedMotion}
                onDone={onWhisperDone}
              />
            )}
          </p>
        </div>
      </div>

      <div className={`${s.judgement} ${beat === 'judged' ? s.judgementShown : ''}`} aria-live="polite">
        {beat === 'judged' ? (
          answer.correct ? (
            <div className={s.correctStamp}><Icon name="circle-check" size={23} /><span>朱印 · 答稳了</span></div>
          ) : (
            <div className={s.wrongStamp}><Icon name="circle-x" size={23} /><span>墨痕 · 还没答稳</span></div>
          )
        ) : (
          <p className={s.writing}>
            <Icon name={beat === 'prompt' ? 'book-open' : beat === 'thinking' ? 'lightbulb' : 'pen'} size={17} />
            {beat === 'prompt' ? '亮题，默读题意……' : beat === 'thinking' ? '心声流过，小白正在盘算……' : '小白正在落笔……'}
          </p>
        )}
        <button type="button" className={surface.nextBtn} disabled={beat !== 'judged'} onClick={onAdvance}>
          {questionIndex === quiz.answers.length - 1 ? '去放榜' : '看下一题'}
          <Icon name="arrow-right" size={17} />
        </button>
      </div>
    </section>
  );
}
