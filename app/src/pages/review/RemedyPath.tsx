/**
 * 补学微路径 —— 内联三段式:
 * ① 输入:remedy.microLesson 微课 + askBack 强调
 * ② 加工:predictionQuiz 三题交互(猜错的瞬间就是认知冲突)
 * ③ 输出:回讲解舱重讲验证(completeRemedy → /teach/:topicId?mode=reteach)
 */
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Check, X } from 'lucide-react';
import type { Misconception } from '../../types';
import { useAppStore } from '../../store/appStore';
import { CoachMarkdown } from '../../components/coach/CoachMarkdown';
import { Button, cx } from '../../components/ui';
import s from './review.module.css';

export function RemedyPath({ topicId, mc }: { topicId: string; mc: Misconception }) {
  const navigate = useNavigate();
  const completeRemedy = useAppStore((st) => st.completeRemedy);
  const [picked, setPicked] = useState<Record<string, number>>({});

  const quiz = mc.remedy.predictionQuiz;
  const answeredCount = quiz.filter((q) => picked[q.id] !== undefined).length;
  const allAnswered = answeredCount === quiz.length;

  const goReteach = () => {
    completeRemedy(topicId, mc.mcId);
    navigate(`/teach/${topicId}?mode=reteach`);
  };

  return (
    <div className={s.remedy}>
      {/* ① 输入 */}
      <section className={s.remedyStage}>
        <header className={s.stageHead}>
          <span className={s.stageNo} aria-hidden="true">1</span>
          <h4 className={s.stageTitle}>输入 · {mc.remedy.microLesson.title}</h4>
        </header>
        <div className={s.lesson}><CoachMarkdown text={mc.remedy.microLesson.body} /></div>
        <p className={s.askBack}>{mc.remedy.microLesson.askBack}</p>
      </section>

      {/* ② 加工 */}
      <section className={s.remedyStage}>
        <header className={s.stageHead}>
          <span className={s.stageNo} aria-hidden="true">2</span>
          <h4 className={s.stageTitle}>加工 · 预测输出 {quiz.length} 题</h4>
          <span className={s.stageCount}>{answeredCount} / {quiz.length}</span>
        </header>
        <p className={s.stageHint}>先猜,再看答案——猜错的瞬间,就是认知冲突发生的地方。</p>
        {quiz.map((q, qi) => {
          const sel = picked[q.id];
          const answered = sel !== undefined;
          return (
            <div key={q.id} className={s.quizBlock}>
              <p className={s.remedyQ}>{qi + 1}. {q.question}</p>
              {q.code && (
                <pre className={s.code}><code>{q.code}</code></pre>
              )}
              <div className={s.optList}>
                {q.options.map((opt, oi) => {
                  const isPick = answered && oi === sel;
                  const isAnswer = answered && oi === q.answerIndex;
                  return (
                    <button
                      key={`${q.id}-${oi}`}
                      type="button"
                      className={cx(
                        s.opt,
                        isPick && isAnswer && s.optCorrect,
                        isPick && !isAnswer && s.optWrong,
                        !isPick && isAnswer && s.optReveal,
                        answered && !isPick && !isAnswer && s.optDim,
                      )}
                      disabled={answered}
                      onClick={() => setPicked((p) => ({ ...p, [q.id]: oi }))}
                    >
                      <span className={s.optKey} aria-hidden="true">{String.fromCharCode(65 + oi)}</span>
                      <code>{opt}</code>
                      {isAnswer ? <Check className={s.optMark} size={16} strokeWidth={2} aria-label="正确答案" /> : null}
                      {isPick && !isAnswer ? <X className={s.optMark} size={16} strokeWidth={2} aria-label="你的选择" /> : null}
                    </button>
                  );
                })}
              </div>
              {answered && (
                <p className={sel === q.answerIndex ? s.explainRight : s.explainWrong}>
                  {sel === q.answerIndex ? '猜对了。' : '猜错了——记住这一下,它比十遍笔记都深。'}
                  {q.explanation}
                </p>
              )}
            </div>
          );
        })}
      </section>

      {/* ③ 输出 */}
      <section className={s.remedyStage}>
        <header className={s.stageHead}>
          <span className={s.stageNo} aria-hidden="true">3</span>
          <h4 className={s.stageTitle}>输出 · 重讲验证</h4>
        </header>
        <p className={s.stageHint}>
          {allAnswered
            ? '题做完了。现在回讲解舱,用你自己的话把这里重讲一遍——小白还在等。'
            : '先把上面的预测题做完,再回去教小白。'}
        </p>
        <Button
          variant="solid"
          disabled={!allAnswered}
          onClick={goReteach}
          iconRight={<ArrowRight size={16} strokeWidth={1.75} />}
        >
          回讲解舱,把这里讲明白
        </Button>
      </section>
    </div>
  );
}
