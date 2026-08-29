/**
 * 考场作答台 —— 一张试卷 + 一个考生席。
 * 左:试卷本体(卷头/题干/作答栏),小白落笔时墨迹在作答栏里写出来,判定章直接盖在卷面上;
 * 右:考生席(心声气泡 + 小白 + 四拍竖轨)。先生只在场外看,页面上没有任何可代答的入口。
 */
import type { RefObject } from 'react';
import { Icon } from '../../components/ui/Icon';
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

export function ExamQuestion({
  topic, quiz, answer, questionIndex, level, beat, point, whisper, thoughtMs,
  reducedMotion, headingRef, onWhisperDone, onSkip, onAdvance,
}: ExamQuestionProps) {
  const question = topic.quizBank.find((item) => item.id === answer.quizId);
  const total = quiz.answers.length;
  const isLast = questionIndex === total - 1;
  const inking = beat === 'writing' || beat === 'judged';
  const mood = beat === 'judged'
    ? (answer.correct ? 'aha' : 'confused')
    : beat === 'prompt' ? 'curious' : 'thinking';

  return (
    <section className={surface.examDesk} aria-labelledby="question-title">
      <header className={s.examHead}>
        <div className={s.headMain}>
          <p className={surface.kicker}>考场实录 · {topic.title}</p>
          <h1 className={s.examTitle}>小白正在独自作答</h1>
        </div>
        <div className={s.headSide}>
          {/* 答题卡:一排小格,答过的落黛绿,当前格描赭 */}
          <ol className={s.answerCard} aria-label={`共 ${total} 题,当前第 ${questionIndex + 1} 题`}>
            {quiz.answers.map((item, index) => (
              <li
                key={item.quizId}
                className={`${s.cell} ${index < questionIndex ? s.cellPast : ''} ${index === questionIndex ? s.cellNow : ''}`}
                aria-current={index === questionIndex ? 'step' : undefined}
              >
                <span aria-hidden="true">{index + 1}</span>
                <span className={surface.srOnly}>第 {index + 1} 题</span>
              </li>
            ))}
          </ol>
          <button type="button" className={s.skipBtn} onClick={onSkip}>直接放榜</button>
        </div>
      </header>

      <div className={s.stage}>
        {/* ── 试卷 ── */}
        <div key={questionIndex} className={`${s.sheet} ${paper.texture}`}>
          <div className={s.sheetHead}>
            <span className={s.sheetSubject}>{topic.title} · 随堂测验</span>
            <span className={s.sheetNo}>第 {questionIndex + 1} 题<small> / 共 {total} 题</small></span>
          </div>
          <h2 ref={headingRef} tabIndex={-1} id="question-title" className={s.questionText}>
            {question?.question ?? point}
          </h2>
          {question?.code ? <pre className={s.code}><code>{question.code}</code></pre> : null}

          <div className={s.answerArea}>
            <span className={s.answerLabel}>小白作答</span>
            <div className={s.answerLines} aria-hidden="true">
              {INK_LINES.map((d, index) => (
                <svg
                  key={d}
                  className={`${s.inkLine} ${inking ? s.inkLineOn : ''} ${beat === 'judged' ? s.inkLineDone : ''}`}
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
          </div>

          {beat === 'judged' ? (
            <div className={`${s.stamp} ${answer.correct ? s.stampGood : s.stampBad}`} role="status">
              <span className={s.stampGlyph} aria-hidden="true">{answer.correct ? '稳' : '疑'}</span>
              <span className={s.stampText}>{answer.correct ? '朱印 · 答稳了' : '墨痕 · 还没答稳'}</span>
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
            <XiaobaiAvatar mood={mood} level={level} variant="paper" size={150} />
          </div>
          <ol className={s.beatRail} aria-label="每题四拍:亮题、心声、落笔、判定">
            {EXAM_BEATS.map((item, index) => (
              <li
                key={item.key}
                className={`${s.beat} ${index < BEAT_INDEX[beat] ? s.beatPast : ''} ${item.key === beat ? s.beatNow : ''}`}
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
          <Icon name={beat === 'prompt' ? 'book-open' : beat === 'thinking' ? 'lightbulb' : beat === 'writing' ? 'pen' : 'circle-check'} size={16} />
          {BEAT_NOTE[beat]}
        </p>
        <button type="button" className={surface.nextBtn} disabled={beat !== 'judged'} onClick={onAdvance}>
          {isLast ? '去放榜' : '看下一题'}
          <Icon name="arrow-right" size={17} />
        </button>
      </footer>
    </section>
  );
}
