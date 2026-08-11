import { useState } from 'react';
import { Icon } from '../../components/ui/Icon';
import { DEMO } from './landingData';
import type { DemoMotionMode } from './useLearningDemo';
import s from './WorkspaceScenes.module.css';

function SceneHeading({
  eyebrow,
  title,
  note,
}: {
  eyebrow: string;
  title: string;
  note: string;
}) {
  return (
    <header className={s.sceneHeading}>
      <div>
        <span>{eyebrow}</span>
        <h3>{title}</h3>
      </div>
      <p>{note}</p>
    </header>
  );
}

export function PrepScene({
  motionMode,
  onInteract,
}: {
  motionMode: DemoMotionMode;
  onInteract: () => void;
}) {
  const [picked, setPicked] = useState<number>(DEMO.prepAnswerIndex);
  const correct = picked === DEMO.prepAnswerIndex;
  return (
    <section className={`${s.scene} ${s.paperScene}`} data-motion={motionMode}>
      <SceneHeading
        eyebrow="备课 · 摸底快测"
        title="先看看哪一处最容易讲岔"
        note={`第二波 · 第 ${DEMO.prepStep} / ${DEMO.prepTotal} 题`}
      />
      <div className={s.prepGrid}>
        <article className={s.quizSheet}>
          <pre>{DEMO.prepCode}</pre>
          <h4>{DEMO.prepQuestion}</h4>
          <div className={s.options}>
            {DEMO.prepOptions.map((option, index) => (
              <button
                className={picked === index ? (correct ? s.optionCorrect : s.optionWrong) : ''}
                key={option}
                type="button"
                onClick={() => { onInteract(); setPicked(index); }}
                onFocus={onInteract}
              >
                <span>{String.fromCharCode(65 + index)}</span>{option}
              </button>
            ))}
          </div>
          <p className={correct ? s.answerRight : s.answerWrong}>
            {correct ? '答对了。高频组合更容易在词表里成为整块。' : '再想想：BPE 合并看的是出现频率。'}
          </p>
        </article>
        <aside className={s.taskCard}>
          <span>教学任务卡</span>
          <h4>{DEMO.prepResult}</h4>
          <p>{DEMO.taskCard}</p>
          <ul>
            <li><Icon name="route" size={15} />讲课路线已展开</li>
            <li><Icon name="book-open" size={15} />错题相关讲义默认展开</li>
          </ul>
        </aside>
      </div>
    </section>
  );
}
