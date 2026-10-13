/**
 * 考场作答台 —— 一张试卷 + 一个考生席。
 * 左:试卷本体(卷头/题干/选项/作答栏),小白落笔时墨迹在作答栏里写出来,判定章直接盖在卷面上,
 *    判定后红笔批出正解与讲评;
 * 右:考生席(心声气泡 + 小白 + 四拍进度)。先生只在场外看,页面上没有任何可代答的入口。
 * 小测只记录每题对错,不记录小白选了哪个错项——答错时只说"没选对",不替它编一个选项。
 */
import type { RefObject } from 'react';
import { ArrowRight, BookOpenText, CircleCheck, FastForward, Lightbulb, PenLine } from 'lucide-react';
import { Button, Progress, cx } from '../../components/ui';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import type { Topic, XiaobaiGlobal, XiaobaiQuizResult } from '../../types';
import { BEAT_INDEX, EXAM_BEATS, type ExamBeat } from './examStory';
import { WhisperText } from './WhisperText';
import paper from '../../styles/paper.module.css';
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

/** 作答栏里的手写墨迹:两行潦草的笔画,落笔拍逐段写出,判定拍保持写满 */
const INK_LINES = [
  'M4 17c5-13 9-1 14-6s6 10 12 4 4-9 9-4 3 11 10 5 6-14 12-6 2 9 8 7 5-13 12-5 3 9 9 7 5-15 13-8 2 8 7 8 6-13 13-6 3 10 9 6 5-12 12-7 2 8 8 6 5-11 12-5 3 8 9 5 6-11 11-6 3 9 9 5',
  'M4 16c6-12 10 0 15-5s5 9 11 4 4-10 9-3 3 10 10 3 5-12 12-5 2 9 8 6 5-11 11-6 4 10 10 4 4-12 11-7 3 9 9 6 5-10 11-5',
];

const BEAT_NOTE: Record<ExamBeat, string> = {
  prompt: '亮题,小白先默读一遍题意。',
  thinking: '心声流过,小白正在盘算。',
  writing: '小白正在落笔,先生只能在场外看着。',
  judged: '判定已落卷,看完可翻下一题。',
};

const BEAT_ICON = {
  prompt: BookOpenText,
  thinking: Lightbulb,
  writing: PenLine,
  judged: CircleCheck,
} satisfies Record<ExamBeat, typeof PenLine>;

const optionKey = (index: number) => String.fromCharCode(65 + index);

export function ExamQuestion({
  topic, quiz, answer, questionIndex, level, beat, point, whisper, thoughtMs,
  reducedMotion, headingRef, onWhisperDone, onSkip, onAdvance,
}: ExamQuestionProps) {
  const question = topic.quizBank.find((item) => item.id === answer.quizId);
  const total = quiz.answers.length;
  const isLast = questionIndex === total - 1;
  const judged = beat === 'judged';
  const inking = beat === 'writing' || judged;
  const mood = judged
    ? (answer.correct ? 'aha' : 'confused')
    : beat === 'prompt' ? 'curious' : 'thinking';
  const BeatIcon = BEAT_ICON[beat];
  // 进度:答完的题数 + 当前题四拍走到哪
  const progress = questionIndex + (judged ? 1 : BEAT_INDEX[beat] / EXAM_BEATS.length);

  return (
    <section className={surface.examDesk} aria-labelledby="question-title">
      <header className={s.examHead}>
        <div className={s.headMain}>
          <p className={surface.kicker}>考场实录 · {topic.title}</p>
          <h1 className={s.examTitle}>小白正在独自作答</h1>
        </div>
        <div className={s.headSide}>
          {/* 答题卡:一排小格,答过的按对错落色,当前格描边 */}
          <ol className={s.answerCard} aria-label={`共 ${total} 题,当前第 ${questionIndex + 1} 题`}>
            {quiz.answers.map((item, index) => {
              const revealed = index < questionIndex || (index === questionIndex && judged);
              return (
                <li
                  key={item.quizId}
                  className={cx(s.cell, index === questionIndex && s.cellNow)}
                  data-result={revealed ? (item.correct ? 'right' : 'wrong') : undefined}
                  aria-current={index === questionIndex ? 'step' : undefined}
                >
                  <span aria-hidden="true">{index + 1}</span>
                  <span className={surface.srOnly}>
                    第 {index + 1} 题{revealed ? (item.correct ? ',答稳了' : ',还没答稳') : ''}
                  </span>
                </li>
              );
            })}
          </ol>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSkip}
            iconRight={<FastForward size={14} strokeWidth={1.75} />}
          >
            直接放榜
          </Button>
        </div>
      </header>
      <Progress className={s.progress} value={progress} max={total} label="考试进度" />

      <div className={s.stage}>
        {/* ── 试卷 ── */}
        <div key={questionIndex} className={cx(s.sheet, paper.texture)} data-story>
          <div className={s.sheetHead}>
            <span className={s.sheetSubject}>{topic.title} · 随堂测验</span>
            <span className={s.sheetNo}>第 {questionIndex + 1} 题<small> / 共 {total} 题</small></span>
          </div>
          <h2 ref={headingRef} tabIndex={-1} id="question-title" className={s.questionText}>
            {question?.question ?? point}
          </h2>
          {question?.code ? <pre className={s.code}><code>{question.code}</code></pre> : null}

          {question && question.options.length > 0 ? (
            <ol className={s.options} aria-label="选项">
              {question.options.map((option, index) => {
                const isAnswer = judged && index === question.answerIndex;
                return (
                  <li
                    key={`${question.id}-${index}`}
                    className={cx(s.option, isAnswer && s.optionAnswer, isAnswer && answer.correct && s.optionPicked)}
                  >
                    <span className={s.optionKey}>{optionKey(index)}</span>
                    <span className={s.optionText}>{option}</span>
                    {isAnswer ? (
                      <svg className={s.optionTick} viewBox="0 0 22 22" width="20" height="20" aria-hidden="true">
                        <path d="M3.5 12.5c2 1.6 3.6 3.4 4.8 5.4C10.6 12 14 7.4 19 3.6" />
                      </svg>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}

          <div className={s.answerArea}>
            <span className={s.answerLabel}>小白作答</span>
            <div className={s.answerLines} aria-hidden="true">
              {INK_LINES.map((d, index) => (
                <svg
                  key={d}
                  className={cx(s.inkLine, inking && s.inkLineOn, judged && s.inkLineDone)}
                  viewBox="0 0 320 24"
                  preserveAspectRatio="none"
                  style={{ animationDelay: `${index * 420}ms` }}
                >
                  <path d={d} />
                </svg>
              ))}
              {!inking ? (
                <span className={s.answerHint}>
                  {beat === 'prompt' ? '默读题意中……' : '笔尖悬着,还没落下……'}
                </span>
              ) : null}
            </div>
            {judged ? (
              <div className={cx(s.stamp, answer.correct ? s.stampGood : s.stampBad)} role="status">
                <span className={s.stampGlyph} aria-hidden="true">{answer.correct ? '稳' : '疑'}</span>
                <span className={s.stampText}>{answer.correct ? '朱印 · 答稳了' : '墨痕 · 还没答稳'}</span>
              </div>
            ) : null}
          </div>

          {/* 红笔批语:小白答得怎样、正解是哪项、为什么 */}
          {judged ? (
            <div className={s.verdict}>
              <p className={s.verdictRow}>
                <b>小白</b>
                <span>
                  {answer.correct
                    ? (question ? `选了 ${optionKey(question.answerIndex)},答稳了。` : '答稳了。')
                    : '没有选对这一题。'}
                </span>
              </p>
              {question ? (
                <p className={s.verdictRow}>
                  <b>正解</b>
                  <span>{optionKey(question.answerIndex)} · {question.options[question.answerIndex]}</span>
                </p>
              ) : null}
              {question?.explanation ? <p className={s.verdictNote}>批:{question.explanation}</p> : null}
            </div>
          ) : null}
          <span className={s.sheetFold} aria-hidden="true" />
        </div>

        {/* ── 考生席 ── */}
        <aside className={s.seat} aria-label="小白的考生席">
          <div className={s.bubble}>
            <p className={s.bubbleLabel}>小白心声</p>
            <p className={s.bubbleText}>
              {beat === 'prompt' ? '题目亮起,小白先默读一遍。' : (
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
          <div className={s.seatAvatar}>
            <XiaobaiAvatar mood={mood} level={level} variant="paper" size={140} />
          </div>
          <ol className={s.beatRail} aria-label="每题四拍:亮题、心声、落笔、判定">
            {EXAM_BEATS.map((item, index) => (
              <li
                key={item.key}
                className={cx(s.beat, index < BEAT_INDEX[beat] && s.beatPast, item.key === beat && s.beatNow)}
                aria-current={item.key === beat ? 'step' : undefined}
              >
                <span className={s.beatNo}>{item.no}</span>
                <span className={s.beatLabel}>{item.label}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <footer className={s.foot}>
        <p className={s.footNote} aria-live="polite">
          <BeatIcon size={16} strokeWidth={1.75} aria-hidden="true" />
          {BEAT_NOTE[beat]}
        </p>
        <Button
          variant="solid"
          size="lg"
          className={s.nextBtn}
          disabled={!judged}
          onClick={onAdvance}
          iconRight={<ArrowRight size={17} strokeWidth={1.75} />}
        >
          {isLast ? '去放榜' : '看下一题'}
        </Button>
      </footer>
    </section>
  );
}
