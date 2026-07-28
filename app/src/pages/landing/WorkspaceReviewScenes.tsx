import { useState, type CSSProperties } from 'react';
import { XiaobaiAvatar } from '../../components/xiaobai/XiaobaiAvatar';
import { Icon } from '../../components/ui/Icon';
import { DEMO } from './landingData';
import { DemoTypewriter } from './DemoTypewriter';
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

export function ExamScene({
  motionMode,
  reducedMotion,
}: {
  motionMode: DemoMotionMode;
  reducedMotion: boolean;
}) {
  const playing = motionMode === 'playing';
  return (
    <section className={`${s.scene} ${s.examScene}`} data-motion={motionMode}>
      <SceneHeading eyebrow="赴考 · 第 3 题" title="小白正在独自作答" note="先生不得代答" />
      <ol className={s.examBeats} aria-label="亮题、心声、落笔、判定">
        {['亮题', '心声', '落笔', '判定'].map((label, index) => (
          <li key={label} style={{ '--beat': index } as CSSProperties}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>
      <div className={s.examDesk}>
        <div className={s.examPupil}>
          <XiaobaiAvatar
            mood="thinking"
            level={1}
            size={112}
            variant="paper"
            speaking={playing}
          />
          <small>小白 · 考场内</small>
        </div>
        <article className={s.examPaper}>
          <span>题目 3 / 5</span>
          <h4>{DEMO.examQuestion}</h4>
          <blockquote>
            <DemoTypewriter
              text={DEMO.examWhisper}
              motionMode={motionMode}
              reducedMotion={reducedMotion}
              startDelay={950}
            />
          </blockquote>
          <p className={s.examVerdict}>
            <Icon name="circle-x" size={17} />
            还没答稳 · 对应要点：哪些词切得整，哪些词切得碎
          </p>
        </article>
      </div>
    </section>
  );
}

export function ReviewScene({ motionMode }: { motionMode: DemoMotionMode }) {
  return (
    <section className={`${s.scene} ${s.reviewScene}`} data-motion={motionMode}>
      <SceneHeading eyebrow="灯下批注" title="小白没答稳的地方，回到这里看" note="带偏分支回放" />
      <div className={s.reviewGrid}>
        <article className={s.scoreStub}>
          <span>随堂测验</span>
          <strong>{DEMO.examScore}</strong>
          <small>分</small>
          <p>1 题答稳 · 4 题留下墨痕</p>
        </article>
        <article className={s.blindReport}>
          <span>高风险盲区</span>
          <h4>{DEMO.blindSpot}</h4>
          <p>{DEMO.blindSpotEvidence}</p>
          <strong><Icon name="swords" size={16} />需要补学后重讲</strong>
        </article>
      </div>
      <ol className={s.eventTape}>
        <li><time>讲解</time><span>积木块清单讲清了两个要点</span></li>
        <li><time>误区</time><span>小白把“一个字一块”当成了正确答案</span></li>
        <li><time>赴考</time><span>随堂测验 20 分，四个要点未答稳</span></li>
      </ol>
      <p className={s.persistenceNote}>
        课后长期保留的是这类结构化事件；课堂关闭后，不把整段对话冒充永久录像。
      </p>
    </section>
  );
}

export function RemedyScene({
  motionMode,
  onInteract,
}: {
  motionMode: DemoMotionMode;
  onInteract: () => void;
}) {
  const [picked, setPicked] = useState(1);
  const correct = picked === 1;
  const options = ['一整块', DEMO.remedyAnswer, '一个字母一块', '直接丢掉'];
  return (
    <section className={`${s.scene} ${s.remedyScene}`} data-motion={motionMode}>
      <SceneHeading eyebrow="补学微路径" title={DEMO.remedyTitle} note="三步走完，再回讲解舱" />
      <div className={s.remedyGrid}>
        <article className={s.microLesson}>
          <span>1 · 输入</span>
          <pre>{DEMO.remedyCode}</pre>
          <p>同样的字数，常见搭配切得整，生僻内容切得碎。</p>
        </article>
        <article className={s.predictionQuiz}>
          <span>2 · 预测</span>
          <h4>{DEMO.remedyQuestion}</h4>
          <div>
            {options.map((option, index) => (
              <button
                className={picked === index ? (correct ? s.optionCorrect : s.optionWrong) : ''}
                key={option}
                type="button"
                onClick={() => { onInteract(); setPicked(index); }}
              >
                {option}
              </button>
            ))}
          </div>
          <p>{correct ? '答对了。新词没有现成整块，只能继续拆小。' : '再看一眼上面的三个切分例子。'}</p>
        </article>
      </div>
      <div className={s.outputStep}>
        <span>3 · 输出</span>
        <p>三题做完了。现在回讲解舱，用自己的话把这里重讲一遍。</p>
        <strong><Icon name="arrow-right" size={15} />下一步：再讲</strong>
      </div>
    </section>
  );
}
