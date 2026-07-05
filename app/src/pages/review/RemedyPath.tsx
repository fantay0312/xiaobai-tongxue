/**
 * 补学微路径 —— 内联三段式:
 * ① 输入:remedy.microLesson 微课 + askBack 强调
 * ② 加工:predictionQuiz 三题交互(猜错的瞬间就是认知冲突)
 * ③ 输出:回讲解舱重讲验证(completeRemedy → /teach/:topicId?mode=reteach)
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Misconception } from '../../types';
import { useAppStore } from '../../store/appStore';
import { Md } from '../../components/Md';
import s from './review.module.css';

export function RemedyPath({ topicId, mc }: { topicId: string; mc: Misconception }) {
  const navigate = useNavigate();
  const completeRemedy = useAppStore((st) => st.completeRemedy);
  const [picked, setPicked] = useState<Record<string, number>>({});

  const quiz = mc.remedy.predictionQuiz;
  const allAnswered = quiz.every((q) => picked[q.id] !== undefined);

  const goReteach = () => {
    completeRemedy(topicId, mc.mcId);
    navigate(`/teach/${topicId}?mode=reteach`);
  };

  return (
    <div className={s.remedy}>
      {/* ① 输入 */}
      <section className={s.remedyStage}>
        <header className={s.stageHead}>
          <span className={s.stageNo}>①</span>
          <h4 className={s.stageTitle}>输入 · {mc.remedy.microLesson.title}</h4>
        </header>
        <Md text={mc.remedy.microLesson.body} className={s.lesson} />
        <p className={s.askBack}>{mc.remedy.microLesson.askBack}</p>
      </section>

      {/* ② 加工 */}
      <section className={s.remedyStage}>
        <header className={s.stageHead}>
          <span className={s.stageNo}>②</span>
          <h4 className={s.stageTitle}>加工 · 预测输出三题</h4>
        </header>
        <p className={s.stageHint}>先猜,再看答案——猜错的瞬间,就是认知冲突发生的地方。</p>
        {quiz.map((q, qi) => {
          const sel = picked[q.id];
          const answered = sel !== undefined;
          return (
            <div key={q.id} className={s.quizBlock}>
              <p className={s.quizQ}>{qi + 1}. {q.question}</p>
              {q.code && (
                <pre className={s.code}><code>{q.code}</code></pre>
              )}
              <div className={s.optList}>
                {q.options.map((opt, oi) => {
                  let cls = s.opt;
                  if (answered) {
                    if (oi === sel && oi === q.answerIndex) cls += ` ${s.optCorrect}`;
                    else if (oi === sel) cls += ` ${s.optWrong}`;
                    else if (oi === q.answerIndex) cls += ` ${s.optReveal}`;
                    else cls += ` ${s.optDim}`;
                  }
                  return (
                    <button
                      key={`${q.id}-${oi}`}
                      type="button"
                      className={cls}
                      disabled={answered}
                      onClick={() => setPicked((p) => ({ ...p, [q.id]: oi }))}
                    >
                      <code>{opt}</code>
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
          <span className={s.stageNo}>③</span>
          <h4 className={s.stageTitle}>输出 · 重讲验证</h4>
        </header>
        <p className={s.stageHint}>
          {allAnswered
            ? '三题做完了。现在回讲解舱,用你自己的话把这里重讲一遍——小白还在等。'
            : '先把上面三道预测题做完,再回去教小白。'}
        </p>
        <button type="button" className={s.btnPrimary} disabled={!allAnswered} onClick={goReteach}>
          回讲解舱,把这里讲明白
        </button>
      </section>
    </div>
  );
}
